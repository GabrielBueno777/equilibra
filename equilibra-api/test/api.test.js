'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { criar } = require('../server.js');

let app, base;
test.before(async () => {
  app = criar({ dbFile: ':memory:', publicDir: __dirname });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
test.after(() => app.fechar());

// cliente mínimo com "cookie jar"
function cliente() {
  let cookie = '';
  return async (metodo, rota, corpo, cab = {}) => {
    const r = await fetch(base + rota, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'equilibra', ...(cookie ? { Cookie: cookie } : {}), ...cab },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, corpo: j, headers: r.headers };
  };
}
const cadastrar = (c, email, nome = 'Ana') => c('POST', '/api/cadastro', { nome, email, senha: 'senha-segura-1' });
const estadoBase = () => ({
  tx: [
    { id: 1, desc: 'Salário', val: 3500.5, type: 'r', cat: 'Outros', date: '2026-10-05', kind: 'fixa' },
    { id: 2.5, desc: 'Mercado', val: 10.1, type: 'd', cat: 'Alimentação', date: '2026-10-06', kind: 'variável' },
    { id: 3, desc: 'Café', val: 0.1, type: 'd', cat: 'Alimentação', date: '2026-10-07', kind: 'variável' },
  ],
  goals: [{ id: 9, name: 'Viagem', target: 2000, saved: 150.75, deadline: '2027-06-30', tipo: 'meta', created: '2026-10-01' }],
  perfil: { renda: 3500.5, outras: null, fixos: 1200, variaveis: 800, parcelas: 0, caixa: 500, reserva: 1000 },
  orc: { Alimentação: 600 },
  created: '2026-10-01',
});

test('rotas privadas exigem login', async () => {
  const c = cliente();
  assert.equal((await c('GET', '/api/estado')).status, 401);
  assert.equal((await c('PUT', '/api/estado', estadoBase())).status, 401);
  assert.equal((await c('GET', '/api/eu')).status, 401);
});

test('cadastro, sessão e logout', async () => {
  const c = cliente();
  const r = await cadastrar(c, 'ana@exemplo.com');
  assert.equal(r.status, 201);
  assert.match(r.headers.get('set-cookie'), /HttpOnly/);
  assert.match(r.headers.get('set-cookie'), /SameSite=Strict/);
  assert.equal((await c('GET', '/api/eu')).corpo.usuario.email, 'ana@exemplo.com');
  assert.equal((await cadastrar(cliente(), 'ANA@exemplo.com')).status, 409, 'e-mail repetido, sem diferenciar maiúsculas');
  await c('POST', '/api/logout');
  assert.equal((await c('GET', '/api/eu')).status, 401);
});

test('senha nunca fica em texto puro no banco', async () => {
  await cadastrar(cliente(), 'hash@exemplo.com');
  const u = app.db.prepare('SELECT senha_hash FROM users WHERE email=?').get('hash@exemplo.com');
  assert.ok(u.senha_hash.startsWith('scrypt$'));
  assert.ok(!u.senha_hash.includes('senha-segura-1'));
});

test('validação do cadastro', async () => {
  const c = cliente();
  assert.equal((await c('POST', '/api/cadastro', { nome: 'A', email: 'ruim', senha: 'senha-segura-1' })).status, 400);
  assert.equal((await c('POST', '/api/cadastro', { nome: 'A', email: 'a@b.co', senha: 'curta' })).status, 400);
  assert.equal((await c('POST', '/api/cadastro', { nome: '', email: 'a@b.co', senha: 'senha-segura-1' })).status, 400);
});

test('login: erro genérico e bloqueio após 5 falhas', async () => {
  await cadastrar(cliente(), 'login@exemplo.com');
  const c = cliente();
  const a = await c('POST', '/api/login', { email: 'login@exemplo.com', senha: 'errada-errada' });
  const b = await c('POST', '/api/login', { email: 'naoexiste@exemplo.com', senha: 'errada-errada' });
  assert.equal(a.status, 401); assert.equal(b.status, 401);
  assert.equal(a.corpo.erro, b.corpo.erro, 'não revela se o e-mail existe');
  for (let i = 0; i < 4; i++) await c('POST', '/api/login', { email: 'login@exemplo.com', senha: 'errada-errada' });
  assert.equal((await c('POST', '/api/login', { email: 'login@exemplo.com', senha: 'senha-segura-1' })).status, 429);
});

test('login correto abre sessão', async () => {
  await cadastrar(cliente(), 'ok@exemplo.com');
  const c = cliente();
  assert.equal((await c('POST', '/api/login', { email: 'ok@exemplo.com', senha: 'senha-segura-1' })).status, 200);
  assert.equal((await c('GET', '/api/eu')).status, 200);
});

test('salvar e ler o estado: valores em centavos, sem erro de ponto flutuante', async () => {
  const c = cliente(); await cadastrar(c, 'estado@exemplo.com');
  assert.equal((await c('PUT', '/api/estado', estadoBase())).status, 200);
  const e = (await c('GET', '/api/estado')).corpo;
  assert.equal(e.tx.length, 3);
  assert.deepEqual(e.tx.map(t => t.val), [3500.5, 10.1, 0.1]);
  assert.equal(e.tx[1].id, 2.5);
  assert.equal(e.goals[0].saved, 150.75);
  assert.equal(e.orc['Alimentação'], 600);
  assert.equal(e.perfil.fixos, 1200);
  const v = app.db.prepare('SELECT valor_centavos v FROM transactions').all().map(r => r.v);
  assert.ok(v.includes(350050) && v.includes(1010) && v.includes(10));
});

test('PUT substitui o estado (editar e excluir refletem no banco)', async () => {
  const c = cliente(); await cadastrar(c, 'edita@exemplo.com');
  const s = estadoBase(); await c('PUT', '/api/estado', s);
  s.tx = s.tx.filter(t => t.id !== 2.5); s.tx[0].val = 4000;
  await c('PUT', '/api/estado', s);
  const e = (await c('GET', '/api/estado')).corpo;
  assert.equal(e.tx.length, 2);
  assert.equal(e.tx[0].val, 4000);
});

test('isolamento: um usuário nunca vê nem altera dados de outro', async () => {
  const a = cliente(), b = cliente();
  await cadastrar(a, 'a@iso.com'); await cadastrar(b, 'b@iso.com', 'Bia');
  await a('PUT', '/api/estado', estadoBase());
  const eb = (await b('GET', '/api/estado')).corpo;
  assert.equal(eb.tx.length, 0); assert.equal(eb.goals.length, 0);
  const outro = estadoBase();
  outro.tx = [{ id: 1, desc: 'Do B', val: 1, type: 'd', cat: 'Outros', date: '2026-10-01', kind: 'fixa' }];
  await b('PUT', '/api/estado', outro);
  const ea = (await a('GET', '/api/estado')).corpo;
  assert.equal(ea.tx.length, 3, 'dados de A intactos depois que B salvou o mesmo id');
  assert.ok(!ea.tx.some(t => t.desc === 'Do B'));
});

test('validação do estado rejeita dados inválidos e não grava nada', async () => {
  const c = cliente(); await cadastrar(c, 'val@exemplo.com');
  await c('PUT', '/api/estado', estadoBase());
  const mau = mut => { const s = estadoBase(); mut(s); return c('PUT', '/api/estado', s); };
  assert.equal((await mau(s => { s.tx[0].val = -5; })).status, 400);
  assert.equal((await mau(s => { s.tx[0].val = 0; })).status, 400);
  assert.equal((await mau(s => { s.tx[0].val = 'dez'; })).status, 400);
  assert.equal((await mau(s => { s.tx[0].date = '2026-02-30'; })).status, 400);
  assert.equal((await mau(s => { s.tx[0].type = 'x'; })).status, 400);
  assert.equal((await mau(s => { s.tx[1].id = s.tx[0].id; })).status, 400);
  assert.equal((await mau(s => { s.goals[0].target = 0; })).status, 400);
  assert.equal((await mau(s => { s.orc = { A: -1 }; })).status, 400);
  assert.equal((await mau(s => { s.tx[0].desc = 'x'.repeat(81); })).status, 400);
  assert.equal((await c('GET', '/api/estado')).corpo.tx.length, 3, 'estado anterior preservado');
});

test('datas: ano bissexto e virada de ano', async () => {
  const c = cliente(); await cadastrar(c, 'datas@exemplo.com');
  const s = estadoBase();
  s.tx = [
    { id: 1, desc: 'a', val: 1, type: 'd', cat: 'Outros', date: '2028-02-29', kind: 'fixa' },
    { id: 2, desc: 'b', val: 1, type: 'd', cat: 'Outros', date: '2026-12-31', kind: 'fixa' },
    { id: 3, desc: 'c', val: 1, type: 'd', cat: 'Outros', date: '2027-01-01', kind: 'fixa' }];
  assert.equal((await c('PUT', '/api/estado', s)).status, 200);
  s.tx[0].date = '2027-02-29';
  assert.equal((await c('PUT', '/api/estado', s)).status, 400);
});

test('proteção CSRF: exige cabeçalho e origem corretos', async () => {
  const c = cliente(); await cadastrar(c, 'csrf@exemplo.com');
  assert.equal((await c('PUT', '/api/estado', estadoBase(), { 'X-Requested-With': 'outro' })).status, 403);
  assert.equal((await c('PUT', '/api/estado', estadoBase(), { Origin: 'https://site-malicioso.com' })).status, 403);
});

test('rota inexistente e JSON inválido', async () => {
  const c = cliente(); await cadastrar(c, 'erro@exemplo.com');
  assert.equal((await c('GET', '/api/nada')).status, 404);
  const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'equilibra' }, body: '{ruim' });
  assert.equal(r.status, 400);
});

test('excluir conta apaga todos os dados do usuário', async () => {
  const c = cliente(); await cadastrar(c, 'sair@exemplo.com');
  await c('PUT', '/api/estado', estadoBase());
  assert.equal((await c('DELETE', '/api/conta', { senha: 'errada-errada' })).status, 401);
  assert.equal((await c('DELETE', '/api/conta', { senha: 'senha-segura-1' })).status, 200);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM users WHERE email=?').get('sair@exemplo.com').n, 0);
  assert.equal((await c('GET', '/api/estado')).status, 401);
});

test('cabeçalhos de segurança presentes', async () => {
  const r = await fetch(base + '/api/eu');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});
