'use strict';
// Equilibra API: servidor HTTP sem dependências externas (Node >= 22.13).
// Banco: SQLite embutido (node:sqlite). Senhas: scrypt. Sessão: cookie HttpOnly.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { DatabaseSync } = require('node:sqlite');
const scrypt = promisify(crypto.scrypt);

const SCHEMA = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, nome TEXT NOT NULL,
  senha_hash TEXT NOT NULL, criado_em TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(
  token_hash TEXT PRIMARY KEY, expira_em INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS transactions(
  id INTEGER PRIMARY KEY, ext_id TEXT NOT NULL, descricao TEXT NOT NULL,
  valor_centavos INTEGER NOT NULL CHECK(valor_centavos > 0),
  tipo TEXT NOT NULL CHECK(tipo IN ('r','d')), categoria TEXT NOT NULL,
  data TEXT NOT NULL, natureza TEXT NOT NULL, setup INTEGER NOT NULL DEFAULT 0,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, ext_id));
CREATE INDEX IF NOT EXISTS idx_tx_user_data ON transactions(user_id, data);
CREATE TABLE IF NOT EXISTS goals(
  id INTEGER PRIMARY KEY, ext_id TEXT NOT NULL, nome TEXT NOT NULL,
  alvo_centavos INTEGER NOT NULL CHECK(alvo_centavos > 0),
  guardado_centavos INTEGER NOT NULL CHECK(guardado_centavos >= 0),
  prazo TEXT NOT NULL, tipo TEXT NOT NULL CHECK(tipo IN ('meta','divida')), criada TEXT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, ext_id));
CREATE TABLE IF NOT EXISTS settings(
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  perfil TEXT, orcamento TEXT, criado TEXT);
`;

class Erro extends Error { constructor(status, msg) { super(msg); this.status = status; } }

// ---------- validação ----------
const dataOk = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
const texto = (v, min, max, campo) => {
  if (typeof v !== 'string') throw new Erro(400, `${campo} inválido.`);
  const t = v.trim();
  if (t.length < min || t.length > max) throw new Erro(400, `${campo} deve ter entre ${min} e ${max} caracteres.`);
  return t;
};
const centavos = (v, campo, zeroOk) => {
  if (typeof v !== 'number' || !isFinite(v) || v < 0 || v > 1e9 || (!zeroOk && v === 0)) throw new Erro(400, `${campo} inválido.`);
  return Math.round(v * 100);
};
const idExterno = (v, vistos) => {
  const e = String(v ?? '');
  if (!e || e.length > 40 || vistos.has(e)) throw new Erro(400, 'Identificador inválido ou repetido.');
  vistos.add(e); return e;
};
const CAMPOS_PERFIL = ['renda', 'outras', 'fixos', 'variaveis', 'parcelas', 'caixa', 'reserva'];

function validarEstado(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Erro(400, 'Corpo inválido.');
  const tx = Array.isArray(b.tx) ? b.tx : [], goals = Array.isArray(b.goals) ? b.goals : [];
  if (tx.length > 20000 || goals.length > 500) throw new Erro(413, 'Quantidade de registros acima do limite.');
  const v1 = new Set(), v2 = new Set();
  const T = tx.map(x => {
    if (!x || typeof x !== 'object') throw new Erro(400, 'Lançamento inválido.');
    if (x.type !== 'r' && x.type !== 'd') throw new Erro(400, 'Tipo de lançamento inválido.');
    if (!dataOk(x.date)) throw new Erro(400, 'Data inválida.');
    return { ext: idExterno(x.id, v1), desc: texto(x.desc, 1, 80, 'Descrição'), c: centavos(x.val, 'Valor', false),
      type: x.type, cat: texto(x.cat, 1, 40, 'Categoria'), date: x.date, kind: texto(x.kind ?? 'variável', 1, 20, 'Natureza'), setup: x.setup ? 1 : 0 };
  });
  const G = goals.map(g => {
    if (!g || typeof g !== 'object') throw new Erro(400, 'Meta inválida.');
    if (g.tipo !== 'meta' && g.tipo !== 'divida') throw new Erro(400, 'Tipo de meta inválido.');
    if (!dataOk(g.deadline)) throw new Erro(400, 'Prazo inválido.');
    if (g.created != null && !dataOk(g.created)) throw new Erro(400, 'Data de criação inválida.');
    return { ext: idExterno(g.id, v2), nome: texto(g.name, 1, 60, 'Nome da meta'), alvo: centavos(g.target, 'Valor da meta', false),
      guard: centavos(g.saved ?? 0, 'Valor acumulado', true), prazo: g.deadline, tipo: g.tipo, criada: g.created ?? null };
  });
  let perfil = null;
  if (b.perfil != null) {
    if (typeof b.perfil !== 'object' || Array.isArray(b.perfil)) throw new Erro(400, 'Perfil inválido.');
    perfil = {};
    for (const k of CAMPOS_PERFIL) {
      const v = b.perfil[k];
      if (v == null) perfil[k] = null;
      else { if (typeof v !== 'number' || !isFinite(v) || v < 0 || v > 1e9) throw new Erro(400, 'Valor do perfil inválido.'); perfil[k] = v; }
    }
  }
  let orc = {};
  if (b.orc != null) {
    if (typeof b.orc !== 'object' || Array.isArray(b.orc) || Object.keys(b.orc).length > 30) throw new Erro(400, 'Orçamento inválido.');
    for (const [k, v] of Object.entries(b.orc)) {
      if (k.length > 40 || typeof v !== 'number' || !isFinite(v) || v <= 0 || v > 1e9) throw new Erro(400, 'Limite de orçamento inválido.');
      orc[k] = v;
    }
  }
  if (b.created != null && !dataOk(b.created)) throw new Erro(400, 'Data inválida.');
  return { T, G, perfil, orc, created: b.created ?? new Date().toISOString().slice(0, 10) };
}

// ---------- senhas ----------
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
async function hashSenha(s) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${(await scrypt(s, salt, 64)).toString('hex')}`;
}
async function confereSenha(s, armazenado) {
  const [t, salt, h] = String(armazenado).split('$');
  if (t !== 'scrypt') return false;
  const calc = await scrypt(s, Buffer.from(salt, 'hex'), 64), a = Buffer.from(h, 'hex');
  return a.length === calc.length && crypto.timingSafeEqual(a, calc);
}

function criar(opcoes = {}) {
  const dbFile = opcoes.dbFile || process.env.DB_FILE || path.join(__dirname, 'data', 'equilibra.db');
  const prod = opcoes.prod ?? process.env.NODE_ENV === 'production';
  const publicDir = opcoes.publicDir || path.join(__dirname, 'public');
  if (dbFile !== ':memory:') fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = new DatabaseSync(dbFile);
  db.exec(SCHEMA);

  const q = {
    userPorEmail: db.prepare('SELECT * FROM users WHERE email=?'),
    novoUser: db.prepare('INSERT INTO users(email,nome,senha_hash,criado_em) VALUES(?,?,?,?)'),
    novaSessao: db.prepare('INSERT INTO sessions(token_hash,expira_em,user_id) VALUES(?,?,?)'),
    sessao: db.prepare('SELECT u.id,u.email,u.nome FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expira_em>?'),
    delSessao: db.prepare('DELETE FROM sessions WHERE token_hash=?'),
    limpaSessoes: db.prepare('DELETE FROM sessions WHERE expira_em<=?'),
    delUser: db.prepare('DELETE FROM users WHERE id=?'),
    txs: db.prepare('SELECT * FROM transactions WHERE user_id=? ORDER BY data,id'),
    gls: db.prepare('SELECT * FROM goals WHERE user_id=? ORDER BY id'),
    cfg: db.prepare('SELECT * FROM settings WHERE user_id=?'),
    delTx: db.prepare('DELETE FROM transactions WHERE user_id=?'),
    delGl: db.prepare('DELETE FROM goals WHERE user_id=?'),
    insTx: db.prepare('INSERT INTO transactions(user_id,ext_id,descricao,valor_centavos,tipo,categoria,data,natureza,setup) VALUES(?,?,?,?,?,?,?,?,?)'),
    insGl: db.prepare('INSERT INTO goals(user_id,ext_id,nome,alvo_centavos,guardado_centavos,prazo,tipo,criada) VALUES(?,?,?,?,?,?,?,?)'),
    upCfg: db.prepare('INSERT INTO settings(user_id,perfil,orcamento,criado) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET perfil=excluded.perfil,orcamento=excluded.orcamento,criado=excluded.criado'),
  };

  // limite de tentativas em memória (por processo)
  const tentativas = new Map();
  const contador = (chave, janelaMs) => {
    const agora = Date.now();
    if (tentativas.size > 10000) tentativas.clear();
    let r = tentativas.get(chave);
    if (!r || r.fim < agora) { r = { n: 0, fim: agora + janelaMs }; tentativas.set(chave, r); }
    return r;
  };
  const ip = req => req.socket.remoteAddress || 'ip';

  const json = (res, status, corpo, extra = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
    res.end(JSON.stringify(corpo));
  };
  const cookieSessao = (tok, maxAge) =>
    `eq_sess=${tok}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${prod ? '; Secure' : ''}`;
  const novaSessao = userId => {
    const tok = crypto.randomBytes(32).toString('base64url');
    q.limpaSessoes.run(Date.now());
    q.novaSessao.run(sha(tok), Date.now() + 30 * 864e5, userId);
    return cookieSessao(tok, 30 * 86400);
  };
  const tokenDe = req => {
    const c = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('eq_sess='));
    return c ? c.slice(8) : null;
  };
  const autenticar = req => {
    const t = tokenDe(req);
    const u = t && q.sessao.get(sha(t), Date.now());
    if (!u) throw new Erro(401, 'Sessão inválida ou expirada. Entre novamente.');
    return u;
  };
  const corpoJson = req => new Promise((ok, falha) => {
    const partes = []; let tam = 0;
    req.on('data', c => { tam += c.length; if (tam > 1e6) { falha(new Erro(413, 'Corpo grande demais.')); req.destroy(); } else partes.push(c); });
    req.on('end', () => {
      if (!tam) return ok({});
      if (!/^application\/json/i.test(req.headers['content-type'] || '')) return falha(new Erro(415, 'Use application/json.'));
      try { ok(JSON.parse(Buffer.concat(partes).toString('utf8'))); } catch { falha(new Erro(400, 'JSON inválido.')); }
    });
    req.on('error', () => falha(new Erro(400, 'Falha ao ler a requisição.')));
  });
  const emailOk = e => typeof e === 'string' && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  let falso;

  function montarEstado(uid) {
    const cfg = q.cfg.get(uid) || {};
    const num = e => (isFinite(Number(e)) ? Number(e) : e);
    return {
      tx: q.txs.all(uid).map(r => ({ id: num(r.ext_id), desc: r.descricao, val: r.valor_centavos / 100, type: r.tipo, cat: r.categoria, date: r.data, kind: r.natureza, ...(r.setup ? { setup: 1 } : {}) })),
      goals: q.gls.all(uid).map(r => ({ id: num(r.ext_id), name: r.nome, target: r.alvo_centavos / 100, saved: r.guardado_centavos / 100, deadline: r.prazo, tipo: r.tipo, created: r.criada })),
      perfil: cfg.perfil ? JSON.parse(cfg.perfil) : null,
      orc: cfg.orcamento ? JSON.parse(cfg.orcamento) : {},
      created: cfg.criado || new Date().toISOString().slice(0, 10),
    };
  }
  function gravarEstado(uid, v) {
    db.exec('BEGIN');
    try {
      q.delTx.run(uid); q.delGl.run(uid);
      for (const t of v.T) q.insTx.run(uid, t.ext, t.desc, t.c, t.type, t.cat, t.date, t.kind, t.setup);
      for (const g of v.G) q.insGl.run(uid, g.ext, g.nome, g.alvo, g.guard, g.prazo, g.tipo, g.criada);
      q.upCfg.run(uid, v.perfil ? JSON.stringify(v.perfil) : null, JSON.stringify(v.orc), v.created);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  async function api(req, res, p, m) {
    if (m !== 'GET') {
      if (req.headers['x-requested-with'] !== 'equilibra') throw new Erro(403, 'Requisição não autorizada.');
      const o = req.headers.origin;
      if (o) { let h; try { h = new URL(o).host; } catch { h = null; } if (h !== req.headers.host) throw new Erro(403, 'Origem não autorizada.'); }
    }
    const b = m === 'GET' ? {} : await corpoJson(req);

    if (p === '/api/cadastro' && m === 'POST') {
      const lim = contador('cad|' + ip(req), 36e5);
      if (lim.n >= 20) throw new Erro(429, 'Muitas tentativas. Tente de novo mais tarde.');
      lim.n++;
      const nome = texto(b.nome, 1, 50, 'Nome'), email = String(b.email || '').trim().toLowerCase();
      if (!emailOk(email)) throw new Erro(400, 'E-mail inválido.');
      if (typeof b.senha !== 'string' || b.senha.length < 8 || b.senha.length > 128) throw new Erro(400, 'A senha deve ter de 8 a 128 caracteres.');
      if (q.userPorEmail.get(email)) throw new Erro(409, 'Este e-mail já tem conta. Use Entrar.');
      const r = q.novoUser.run(email, nome, await hashSenha(b.senha), new Date().toISOString());
      return json(res, 201, { usuario: { email, nome } }, { 'Set-Cookie': novaSessao(Number(r.lastInsertRowid)) });
    }
    if (p === '/api/login' && m === 'POST') {
      const email = String(b.email || '').trim().toLowerCase();
      const lim = contador('login|' + ip(req) + '|' + email, 15 * 6e4);
      if (lim.n >= 5) throw new Erro(429, 'Muitas tentativas de login. Aguarde 15 minutos.');
      const u = emailOk(email) ? q.userPorEmail.get(email) : null;
      falso ??= await hashSenha('senha-falsa');
      const ok = await confereSenha(typeof b.senha === 'string' ? b.senha : '', u ? u.senha_hash : falso);
      if (!u || !ok) { lim.n++; throw new Erro(401, 'E-mail ou senha incorretos.'); }
      tentativas.delete('login|' + ip(req) + '|' + email);
      return json(res, 200, { usuario: { email: u.email, nome: u.nome } }, { 'Set-Cookie': novaSessao(u.id) });
    }
    if (p === '/api/logout' && m === 'POST') {
      const t = tokenDe(req); if (t) q.delSessao.run(sha(t));
      return json(res, 200, { ok: true }, { 'Set-Cookie': cookieSessao('', 0) });
    }
    if (p === '/api/eu' && m === 'GET') { const u = autenticar(req); return json(res, 200, { usuario: { email: u.email, nome: u.nome } }); }
    if (p === '/api/estado' && m === 'GET') return json(res, 200, montarEstado(autenticar(req).id));
    if (p === '/api/estado' && m === 'PUT') { const u = autenticar(req); gravarEstado(u.id, validarEstado(b)); return json(res, 200, { ok: true }); }
    if (p === '/api/conta' && m === 'DELETE') {
      const u = autenticar(req), reg = q.userPorEmail.get(u.email);
      if (!(await confereSenha(typeof b.senha === 'string' ? b.senha : '', reg.senha_hash))) throw new Erro(401, 'Senha incorreta.');
      q.delUser.run(u.id);
      return json(res, 200, { ok: true }, { 'Set-Cookie': cookieSessao('', 0) });
    }
    throw new Erro(404, 'Rota não encontrada.');
  }

  const server = http.createServer(async (req, res) => {
    try {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      if (prod) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
      const p = new URL(req.url, 'http://x').pathname;
      if (p.startsWith('/api/')) return await api(req, res, p, req.method);
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new Erro(405, 'Método não permitido.');
      if (p === '/' || p === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
        return res.end(fs.readFileSync(path.join(publicDir, 'index.html')));
      }
      throw new Erro(404, 'Não encontrado.');
    } catch (e) {
      const st = e.status || 500;
      if (st === 500) console.error('erro interno:', e.code || e.name);
      if (!res.headersSent) json(res, st, { erro: st === 500 ? 'Erro interno. Tente novamente.' : e.message });
    }
  });
  return { server, db, fechar: () => new Promise(r => server.close(() => { db.close(); r(); })) };
}

module.exports = { criar };
if (require.main === module) {
  const { server } = criar();
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, () => console.log(`Equilibra em http://localhost:${port}`));
}
