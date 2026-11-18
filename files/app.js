const CATS=["Moradia","Alimentação","Transporte","Saúde","Educação","Lazer","Assinaturas","Compras pessoais","Contas básicas","Dívidas e parcelas","Investimentos","Outros"];
const COR=["#0F3D2E","#2F7D5B","#7FD6A4","#B07A12","#B4412F","#5A6F9E","#8A6FB0","#C98A5A","#4E8E96","#7A7A52","#1E5F4B","#9AA7A0"];
const R=n=>(n||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const P=n=>(isFinite(n)?n:0).toLocaleString("pt-BR",{maximumFractionDigits:1})+"%";
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
let S=null,USER=null;
const lg=k=>{try{return JSON.parse(localStorage.getItem(k)||"null")}catch(e){return null}};
const sv=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}};
const novo=()=>({tx:[],goals:[],perfil:null,created:new Date().toISOString().slice(0,10)});
let API_NOME="";
const nuv=t=>{const e=document.getElementById("nuvem");if(e)e.textContent=t};
const MSG_OFF="O servidor do Equilibra não respondeu como esperado. Abra o site pelo endereço do servidor (por exemplo http://localhost:3000) e confirme que o comando npm start está rodando.";
let apiOff=false;
async function api(m,u,b){let r;try{r=await fetch(u,{method:m,credentials:"same-origin",headers:{"Content-Type":"application/json","X-Requested-With":"equilibra"},body:b?JSON.stringify(b):undefined})}catch(e){const er=new Error(MSG_OFF);er.off=true;throw er}
  let j=null;try{j=await r.json()}catch(e){}
  if(!j){const er=new Error(MSG_OFF+" (código "+r.status+")");er.off=true;throw er}
  if(!r.ok){const er=new Error(j.erro||"Erro inesperado.");er.status=r.status;throw er}
  return j}
let saveT=null,saving=false,dirty=false;
function save(){if(!USER)return;dirty=true;nuv("Salvando…");clearTimeout(saveT);saveT=setTimeout(envia,700)}
async function envia(){if(saving){saveT=setTimeout(envia,400);return}saving=true;dirty=false;try{await api("PUT","/api/estado",S);if(!dirty)nuv("Salvo no banco de dados")}catch(e){nuv(e.status===401?"Sessão expirada. Entre novamente.":"Não foi possível salvar: "+e.message);if(e.status===401){USER=null;S=null;view()}}saving=false}
function entrar(u,estado){USER=u.email;API_NOME=u.nome;S=Object.assign(novo(),estado||{});if(!S.tx)S.tx=[];if(!S.goals)S.goals=[];page=(!S.perfil&&!S.tx.length)?"config":"painel";nuv("Conectado ao banco de dados");view()}
const hoje=new Date().toISOString().slice(0,10);
let page="painel",mes=hoje.slice(0,7),edit=null;
const $=s=>document.querySelector(s);
function stats(m){
  const t=S.tx.filter(x=>x.date.slice(0,7)===m);
  const rec=t.filter(x=>x.type==="r").reduce((a,x)=>a+x.val,0);
  const cons=t.filter(x=>x.type==="d"&&x.cat!=="Investimentos").reduce((a,x)=>a+x.val,0);
  const inv=t.filter(x=>x.type==="d"&&x.cat==="Investimentos").reduce((a,x)=>a+x.val,0);
  const dev=t.filter(x=>x.type==="d"&&x.cat==="Dívidas e parcelas").reduce((a,x)=>a+x.val,0);
  const por={};t.filter(x=>x.type==="d"&&x.cat!=="Investimentos").forEach(x=>por[x.cat]=(por[x.cat]||0)+x.val);
  return{n:t.length,rec,cons,inv,dev,por,saldo:rec-cons-inv,taxa:rec>0?(rec-cons)/rec*100:null,comp:rec>0?cons/rec*100:null};
}
function meses(n){const o=[],d=new Date();d.setDate(1);for(let i=n-1;i>=0;i--){const x=new Date(d.getFullYear(),d.getMonth()-i,1);o.push(x.getFullYear()+"-"+String(x.getMonth()+1).padStart(2,"0"))}return o}
const nomeMes=m=>new Date(m+"-15").toLocaleDateString("pt-BR",{month:"short",year:"2-digit"});
function saude(s){
  if(s.n<3||s.rec<=0)return{t:"Dados insuficientes",d:"Registre sua renda e pelo menos algumas despesas do mês para receber uma análise. Não classificamos sem dados."};
  if(s.comp<=70)return{t:"Situação estável",d:`Suas despesas de consumo usam ${P(s.comp)} da renda do mês e sobram ${R(s.rec-s.cons)}.`};
  if(s.comp<=90)return{t:"Atenção aos gastos",d:`Suas despesas de consumo usam ${P(s.comp)} da renda. A margem é pequena (${R(s.rec-s.cons)}).`};
  return{t:"Orçamento comprometido",d:`Suas despesas de consumo usam ${P(s.comp)} da renda do mês.`};
}
function dica(s){
  const e=Object.entries(s.por).sort((a,b)=>b[1]-a[1])[0];
  if(!e||s.rec<=0)return"";
  const red=Math.round(e[1]*0.1/10)*10||10;
  return`<p><b>O que está acontecendo:</b> ${esc(e[0])} é sua maior categoria, com ${R(e[1])} (${P(e[1]/s.rec*100)} da renda).<br><b>Ação prática:</b> reduzir ${R(red)} por mês nessa categoria.<br><b>Economia estimada:</b> ${R(red*12)} em 12 meses, sem considerar rendimentos.</p>`;
}
function view(){
  document.body.classList.toggle("out",!USER);
  if(!USER){$("#app").innerHTML=auth();bindAuth();wire();return}
  document.querySelectorAll("nav button[data-p]").forEach(b=>b.classList.toggle("on",b.dataset.p===page));
  $("#app").innerHTML=({painel,mov,orc,metas,inv,evo,config})[page]();
  bind();wire();
}
function painel(){
  const s=stats(mes),h=saude(s),ms=meses(6),st=ms.map(stats),mx=Math.max(1,...st.map(x=>Math.max(x.rec,x.cons)));
  const tot=Object.values(s.por).reduce((a,b)=>a+b,0);let ac=0;
  const ents=Object.entries(s.por).sort((a,b)=>b[1]-a[1]);
  const conic=ents.map(([c,v])=>{const a=ac/tot*100;ac+=v;return`${COR[CATS.indexOf(c)]} ${a}% ${ac/tot*100}%`}).join(",");
  const dividas=S.goals.filter(g=>g.tipo==="divida").reduce((a,g)=>a+Math.max(0,g.target-g.saved),0);
  return`<h2>Painel</h2><p class="sub">Dados inseridos por você, calculados no seu navegador.</p>
  <label style="max-width:180px;margin-bottom:12px">Mês<input type="month" id="mes" value="${mes}"></label>
  <div class="grid">
  <div class="card"><div class="k">Renda do mês</div><div class="v">${R(s.rec)}</div></div>
  <div class="card"><div class="k">Despesas de consumo</div><div class="v">${R(s.cons)}</div></div>
  <div class="card"><div class="k">Investido</div><div class="v">${R(s.inv)}</div></div>
  <div class="card"><div class="k">Saldo livre</div><div class="v ${s.saldo<0?"neg":"pos"}">${R(s.saldo)}</div></div>
  <div class="card"><div class="k">Taxa de economia</div><div class="v">${s.taxa===null?"–":P(s.taxa)}</div></div>
  <div class="card"><div class="k">Renda comprometida</div><div class="v">${s.comp===null?"–":P(s.comp)}</div></div>
  <div class="card"><div class="k">Parcelas e dívidas no mês</div><div class="v">${R(s.dev)}</div></div>
  <div class="card"><div class="k">Dívidas pendentes (metas)</div><div class="v">${R(dividas)}</div></div></div>
  ${reservaCard()}${alertasOrc(s)}<div class="card"><b>Saúde financeira: <span class="badge">${h.t}</span></b><p>${h.d}</p>${dica(s)}
  <p class="note">Critério: despesas de consumo ÷ renda líquida do mês (até 70% estável, até 90% atenção, acima disso comprometido). Aportes em investimentos não contam como consumo. Renda baixa por si só não gera classificação negativa.</p></div>
  <div class="card"><b>Receitas x despesas (6 meses)</b>
  <svg viewBox="0 0 360 150" width="100%" role="img" aria-label="Receitas e despesas por mês">${ms.map((m,i)=>{const x=10+i*58,a=st[i].rec/mx*100,b=st[i].cons/mx*100;return`<rect x="${x}" y="${120-a}" width="22" height="${a}" fill="var(--gl)" rx="3"/><rect x="${x+24}" y="${120-b}" width="22" height="${b}" fill="var(--bad)" rx="3"/><text x="${x+23}" y="140" font-size="10" text-anchor="middle" fill="var(--mut)">${nomeMes(m)}</text>`}).join("")}</svg>
  <span class="k"><i class="dot" style="background:var(--gl)"></i>Receitas <i class="dot" style="background:var(--bad);margin-left:10px"></i>Despesas de consumo</span></div>
  <div class="card"><b>Despesas por categoria</b><div class="row" style="margin-top:10px">${tot?`<div class="donut" style="background:conic-gradient(${conic})" role="img" aria-label="Distribuição por categoria"></div><div>${ents.map(([c,v])=>`<div><i class="dot" style="background:${COR[CATS.indexOf(c)]}"></i>${esc(c)}: ${R(v)} (${P(v/tot*100)})</div>`).join("")}</div>`:`<p class="k">Sem despesas neste mês. Registre uma em Movimentações.</p>`}</div></div>`;
}
function mov(){
  const e=edit?S.tx.find(x=>x.id===edit):null;
  const list=[...S.tx].sort((a,b)=>b.date.localeCompare(a.date));
  return`<h2>Movimentações</h2><p class="sub">Entradas e saídas registradas manualmente. A plataforma não consulta seu banco.</p>
  <div class="card"><form id="fm"><label>Descrição<input name="desc" required maxlength="80" value="${e?esc(e.desc):""}"></label>
  <label>Valor (R$)<input name="val" type="number" step="0.01" min="0.01" required value="${e?e.val:""}"></label>
  <label>Tipo<select name="type"><option value="d">Despesa</option><option value="r" ${e&&e.type==="r"?"selected":""}>Receita</option></select></label>
  <label>Categoria<select name="cat">${CATS.map(c=>`<option ${e&&e.cat===c?"selected":""}>${c}</option>`).join("")}</select></label>
  <label>Data<input name="date" type="date" required value="${e?e.date:hoje}"></label>
  <label>Natureza<select name="kind">${["variável","fixa","parcelada"].map(k=>`<option ${e&&e.kind===k?"selected":""}>${k}</option>`).join("")}</select></label>
  <button class="btn">${e?"Salvar alterações":"Adicionar"}</button></form></div>
  <div class="card scroll"><input id="busca" placeholder="Buscar descrição" style="margin-bottom:10px;width:100%"><table><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Valor</th><th></th></tr>
  ${list.length?list.map(x=>`<tr data-q="${esc(x.desc.toLowerCase())}"><td>${x.date.split("-").reverse().join("/")}</td><td>${esc(x.desc)}</td><td>${esc(x.cat)}</td><td class="${x.type==="r"?"pos":"neg"}">${x.type==="r"?"+":"−"}${R(x.val)}</td><td><button class="btn s" data-e="${x.id}">Editar</button> <button class="btn s" data-x="${x.id}">Excluir</button></td></tr>`).join(""):`<tr><td colspan="5">Nenhuma movimentação ainda. Comece registrando sua renda do mês.</td></tr>`}</table></div>`;
}
function metas(){
  return`<h2>Metas</h2><p class="sub">Defina objetivos e veja quanto guardar por mês.</p>
  <div class="card"><form id="fg"><label>Nome<input name="name" required maxlength="60"></label><label>Valor desejado<input name="target" type="number" min="1" step="0.01" required></label><label>Já acumulado<input name="saved" type="number" min="0" step="0.01" value="0"></label><label>Prazo<input name="deadline" type="date" required></label>
  <label>Tipo<select name="tipo"><option value="meta">Meta</option><option value="divida">Dívida a quitar</option></select></label><button class="btn">Criar meta</button></form></div>
  ${S.goals.length?S.goals.map(g=>{const pr=Math.min(100,g.saved/g.target*100),mm=Math.max(0,(new Date(g.deadline)-new Date(hoje))/2629800000),falta=Math.max(0,g.target-g.saved);return`<div class="card"><b>${esc(g.name)}</b> ${g.tipo==="divida"?'<span class="badge">dívida</span>':""}<div class="bar" style="margin:8px 0"><i style="width:${pr}%"></i></div>
  <div class="k">${R(g.saved)} de ${R(g.target)} (${P(pr)}). Faltam ${R(falta)}.</div>
  <div>${falta===0?"Meta atingida.":mm<1?"O prazo é menor que um mês: guarde o valor restante de uma vez ou estenda o prazo.":`Para chegar no prazo: <b>${R(falta/Math.ceil(mm))}</b> por mês durante ${Math.ceil(mm)} meses.`}</div>
  <form data-a="${g.id}" style="margin-top:8px;grid-template-columns:140px auto auto"><input name="add" type="number" step="0.01" min="0.01" placeholder="Valor" required><button class="btn">Adicionar valor</button><button type="button" class="btn s" data-gx="${g.id}">Excluir</button></form></div>`}).join(""):`<div class="card k">Nenhuma meta ainda. Crie a primeira acima, como uma reserva de emergência ou uma viagem.</div>`}`;
}
function inv(){
  return`<h2>Investimentos</h2><p class="sub">Simulador educativo. Não é recomendação de investimento nem promessa de ganho.</p>
  <div class="card"><b>Quanto cabe no seu orçamento</b><p id="cap"></p></div>
  <div class="card"><form id="fs"><label>Valor inicial (R$)<input name="ini" type="number" min="0" value="0"></label><label>Aporte mensal (R$)<input name="ap" type="number" min="0" value="300"></label><label>Prazo (anos)<input name="anos" type="number" min="1" max="50" value="5"></label><label>Inflação anual (%)<input name="inf" type="number" step="0.1" value="4.5"></label><button class="btn">Simular</button></form></div>
  <div class="card scroll" id="sim"></div>
  <div class="card"><b>Conceitos rápidos</b>
  <p><b>Juros compostos:</b> o rendimento de cada mês passa a render também. Quanto maior o prazo, maior o efeito.</p>
  <p><b>Reserva de emergência:</b> dinheiro de liquidez imediata, em geral de 3 a 6 meses de despesas essenciais, antes de assumir riscos.</p>
  <p><b>Risco, liquidez e rentabilidade:</b> raramente se maximiza os três ao mesmo tempo. Confira taxas, imposto de renda e prazos de resgate de cada produto.</p>
  <p class="note">Esta versão não consulta taxas de mercado. As taxas abaixo são hipóteses que você pode alterar: confirme valores atuais em fontes oficiais como Banco Central e Tesouro Direto.</p></div>`;
}
function simular(f){
  const ini=+f.ini.value||0,ap=+f.ap.value||0,n=Math.round((+f.anos.value||1)*12),inf=+f.inf.value||0;
  const cen=[["Conservador",6],["Intermediário",9],["Otimista",12]];
  const linhas=cen.map(([nome,a])=>{const i=Math.pow(1+a/100,1/12)-1;let s=ini;for(let k=0;k<n;k++)s=s*(1+i)+ap;const tot=ini+ap*n,real=s/Math.pow(1+inf/100,n/12);return`<tr><td>${nome} (${a}% a.a.)</td><td>${R(tot)}</td><td>${R(s-tot)}</td><td><b>${R(s)}</b></td><td>${R(real)}</td></tr>`}).join("");
  $("#sim").innerHTML=`<table><tr><th>Cenário (hipótese)</th><th>Total aportado</th><th>Rendimento bruto</th><th>Saldo final bruto</th><th>Em valores de hoje</th></tr>${linhas}</table><p class="note">Valores brutos, sem imposto de renda nem taxas, e não garantidos. A coluna final desconta a inflação informada.</p>`;
}
function evo(){
  const ms=[...new Set(S.tx.map(x=>x.date.slice(0,7)))].sort();
  if(!ms.length)return`<h2>Minha Evolução</h2><p class="sub">Sua linha do tempo aparece conforme você registra dados.</p><div class="card k">Ainda não há registros. Adicione movimentações para ver sua evolução.</div>`;
  const a=stats(ms[0]),b=stats(ms[ms.length-1]),ev=[];
  ev.push([S.created,"Entrada na plataforma"]);
  const sorted=[...S.tx].sort((x,y)=>x.date.localeCompare(y.date));
  const r=sorted.find(x=>x.type==="r"),d=sorted.find(x=>x.type==="d");
  if(r)ev.push([r.date,"Primeira receita registrada: "+esc(r.desc)]);
  if(d)ev.push([d.date,"Primeira despesa registrada: "+esc(d.desc)]);
  const pos=ms.find(m=>stats(m).saldo>0);if(pos)ev.push([pos+"-01","Primeiro mês com saldo positivo ("+nomeMes(pos)+")"]);
  S.goals.forEach(g=>{ev.push([g.created||S.created,"Meta criada: "+esc(g.name)]);if(g.saved>=g.target)ev.push([hoje,"Meta atingida: "+esc(g.name)])});
  ev.sort((x,y)=>x[0].localeCompare(y[0]));
  const cmp=ms.length>1?`<table><tr><th></th><th>${nomeMes(ms[0])}</th><th>${nomeMes(ms[ms.length-1])}</th></tr><tr><td>Renda</td><td>${R(a.rec)}</td><td>${R(b.rec)}</td></tr><tr><td>Despesas de consumo</td><td>${R(a.cons)}</td><td>${R(b.cons)}</td></tr><tr><td>Investido</td><td>${R(a.inv)}</td><td>${R(b.inv)}</td></tr><tr><td>Taxa de economia</td><td>${a.taxa===null?"–":P(a.taxa)}</td><td>${b.taxa===null?"–":P(b.taxa)}</td></tr></table>`:`<p class="k">Registre dados de outro mês para comparar com o primeiro.</p>`;
  return`<h2>Minha Evolução</h2><p class="sub">Calculada só com o que você registrou. Não há histórico anterior ao seu cadastro.</p><div class="card"><b>Primeiro mês x mês mais recente</b>${cmp}</div><div class="card"><b>Linha do tempo</b><div class="tl" style="margin-top:12px">${ev.map(([dt,t])=>`<div><b>${dt.split("-").reverse().join("/")}</b><br>${t}</div>`).join("")}</div></div>`;
}
const LOGO="/img/logo.webp",LOGON="/img/logo-nav.webp";
let modoAuth="login",tela="home";
function home(){return`<div class="hero"><img class="hl" src="${LOGO}" alt="Equilibra – seu dinheiro em equilíbrio"><h2>Equilíbrio financeiro começa com organização.</h2><p class="sub">Registre o que entra e o que sai, acompanhe suas metas e entenda para onde vai o seu dinheiro, tudo em um só lugar.</p>
${apiOff?`<p class="note neg" role="alert" style="text-align:left">${MSG_OFF}</p>`:""}<div class="cta"><button class="btn" id="goin">Fazer login</button><button class="btn s" id="gocad">Cadastrar</button></div>
<div class="grid fe"><div class="card"><b>Controle de gastos</b><p class="k">Lance receitas e despesas por categoria e veja o saldo do mês atualizado na hora.</p></div><div class="card"><b>Saúde financeira</b><p class="k">Veja quanto da renda está comprometida e onde é possível economizar.</p></div><div class="card"><b>Metas</b><p class="k">Defina objetivos, acompanhe o progresso e saiba quanto guardar por mês.</p></div><div class="card"><b>Investimentos</b><p class="k">Simule aportes e cenários e entenda o básico antes de investir.</p></div></div>
<p class="note" style="max-width:560px;margin:0 auto;text-align:left">Os valores são digitados por você: o Equilibra não acessa sua conta bancária. Seus dados ficam guardados no servidor do Equilibra, ligados à sua conta.</p></div>`}
function auth(){if(tela==="home")return home();const c=modoAuth==="cad";return`<div class="card" style="max-width:400px;margin:6vh auto"><button class="btn s" id="volta">← Voltar</button><img src="${LOGON}" alt="Equilibra" style="display:block;width:150px;margin:6px auto 4px"><p class="k" style="text-align:center;margin:0 0 14px">Equilíbrio financeiro começa com organização.</p><p class="sub">${c?"Crie sua conta para ter um histórico só seu.":"Entre na sua conta."}</p><form id="fa" style="grid-template-columns:1fr">${c?'<label>Nome<input name="nome" required maxlength="50" autocomplete="name"></label>':""}<label>E-mail<input name="email" type="email" required autocomplete="email"></label><label>Senha${c?" (mínimo 8 caracteres)":""}<input name="senha" type="password" required minlength="${c?8:1}" autocomplete="${c?"new-password":"current-password"}"></label><button class="btn">${c?"Criar conta":"Entrar"}</button></form><p id="erro" class="neg" role="alert">${apiOff?MSG_OFF:""}</p><p><button class="btn s" id="troca">${c?"Já tenho conta":"Criar conta"}</button></p><p class="note">Seus dados ficam guardados no servidor do Equilibra, ligados à sua conta. Ainda não há recuperação de senha por e-mail.</p></div>`}
function bindAuth(){
  if(tela==="home"){$("#goin").onclick=()=>{modoAuth="login";tela="auth";view()};$("#gocad").onclick=()=>{modoAuth="cad";tela="auth";view()};return}
  $("#volta").onclick=()=>{tela="home";view()};
  $("#troca").onclick=()=>{modoAuth=modoAuth==="cad"?"login":"cad";view()};
  $("#fa").onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),em=f.get("email").trim().toLowerCase(),se=f.get("senha"),er=$("#erro");er.textContent="";
    try{const cad=modoAuth==="cad";if(cad&&se.length<8){er.textContent="A senha precisa ter ao menos 8 caracteres.";return}
      const r=await api("POST",cad?"/api/cadastro":"/api/login",cad?{nome:f.get("nome").trim(),email:em,senha:se}:{email:em,senha:se});
      const est=await api("GET","/api/estado");entrar(r.usuario,est)}
    catch(x){er.textContent=x.message||"Erro inesperado."}}}
function config(){const p=S.perfil||{},u={nome:API_NOME};
  const f=(n,l)=>`<label>${l}<input name="${n}" type="number" min="0" step="0.01" value="${p[n]??""}" placeholder="0,00"></label>`;
  return`<h2>Olá, ${esc(u.nome||"")}. Vamos começar?</h2><p class="sub">Informe valores aproximados do seu mês. Você pode salvar agora, completar depois e ajustar tudo em Movimentações.</p>
  <div class="card"><form id="fc">${f("renda","Quanto você ganha por mês (líquido)")}${f("outras","Outras rendas por mês")}${f("fixos","Gastos fixos por mês (aluguel, contas, escola)")}${f("variaveis","Gastos variáveis por mês (mercado, lazer, transporte)")}${f("parcelas","Parcelas e dívidas por mês")}${f("caixa","Dinheiro disponível hoje")}${f("reserva","Reserva de emergência já guardada")}<button class="btn">Salvar</button></form></div>
  <p class="note">Ao salvar, criamos lançamentos de ${nomeMes(hoje.slice(0,7))} com esses valores, marcados como “estimativa”, para alimentar o painel. Campos vazios são ignorados. <button class="btn s" data-go="painel">Pular por agora</button></p>`}
function reservaCard(){const p=S.perfil;
  if(!p)return`<div class="card">Ainda não sabemos quanto você ganha e gasta. <button class="btn" data-go="config">Informar agora</button></div>`;
  const g=(p.fixos||0)+(p.variaveis||0)+(p.parcelas||0);
  const rs=p.reserva!=null&&g>0?`Sua reserva cobre ${(p.reserva/g).toLocaleString("pt-BR",{maximumFractionDigits:1})} meses das despesas que você informou (referência comum: 3 a 6 meses).`:"";
  return p.caixa!=null||rs?`<div class="card"><div class="k">Dinheiro disponível informado</div><div class="v">${R(p.caixa||0)}</div><p>${rs} <button class="btn s" data-go="config">Editar minha renda e gastos</button></p></div>`:"";
}
function orcLinhas(s){const o=S.orc||{};return CATS.filter(c=>c!=="Investimentos"&&o[c]>0).map(c=>({c,l:o[c],g:s.por[c]||0,p:(s.por[c]||0)/o[c]*100}))}
function alertasOrc(s){const a=orcLinhas(s).filter(x=>x.p>=80).sort((x,y)=>y.p-x.p);if(!a.length)return"";
  return`<div class="card" role="status"><b>Atenção ao orçamento</b>${a.map(x=>`<p style="margin:6px 0 0"><b>${esc(x.c)}:</b> ${x.p>=100?"limite ultrapassado em "+R(x.g-x.l):"você já usou "+P(x.p)+" do limite"} (${R(x.g)} de ${R(x.l)}). Confira os lançamentos dessa categoria em Movimentações.</p>`).join("")}</div>`}
function orc(){const s=stats(mes),o=S.orc||{};
  const rows=CATS.filter(c=>c!=="Investimentos").map(c=>{const l=o[c]||0,g=s.por[c]||0,p=l>0?g/l*100:0;const st=l<=0?"Sem limite":p>=100?"Limite ultrapassado":p>=80?"Perto do limite":"Dentro do limite";
    return`<tr><td>${esc(c)}</td><td><input type="number" min="0" step="0.01" data-lim="${esc(c)}" value="${l||""}" aria-label="Limite de ${esc(c)}" placeholder="0,00" style="width:110px"></td><td>${R(g)}</td><td>${l>0?R(Math.max(0,l-g)):"–"}</td><td>${l>0?`<div class="bar" style="min-width:90px"><i style="width:${Math.min(100,p)}%;${p>=100?"background:var(--bad)":""}"></i></div>${P(p)} · `:""}<b>${st}</b></td></tr>`}).join("");
  const tl=Object.values(o).reduce((a,b)=>a+(+b||0),0);
  return`<h2>Orçamento</h2><p class="sub">Defina quanto pretende gastar em cada categoria. Os limites valem para todos os meses e comparam com as despesas já lançadas; investimentos ficam de fora.</p>
  <label style="max-width:180px;margin-bottom:12px">Mês<input type="month" id="mes" value="${mes}"></label>
  <div class="grid"><div class="card"><div class="k">Total planejado</div><div class="v">${R(tl)}</div></div><div class="card"><div class="k">Gasto no mês</div><div class="v">${R(s.cons)}</div></div><div class="card"><div class="k">Renda do mês</div><div class="v">${R(s.rec)}</div></div></div>
  ${s.rec>0&&tl>s.rec?`<p class="note" role="status">Seus limites somam mais que a renda lançada neste mês (${R(tl-s.rec)} a mais). Vale revisar os valores.</p>`:""}
  <div class="card scroll"><table><tr><th>Categoria</th><th>Limite (R$)</th><th>Gasto</th><th>Ainda pode gastar</th><th>Situação</th></tr>${rows}</table></div>`}
function wire(){document.querySelectorAll("form").forEach(f=>{const h=f.onsubmit;if(!h)return;f.onsubmit=e=>{if(e)e.preventDefault();return false};
  const run=ev=>{ev.preventDefault();if(f.reportValidity&&!f.reportValidity())return;h.call(f,{preventDefault(){},target:f})};
  f.querySelectorAll("button:not([type=button])").forEach(b=>{b.type="button";b.onclick=run});
  f.addEventListener("keydown",ev=>{if(ev.key==="Enter"&&ev.target.tagName==="INPUT")run(ev)})})}
function bind(){
  document.querySelectorAll("[data-go]").forEach(b=>b.onclick=()=>{page=b.dataset.go;view()});
  document.querySelectorAll("[data-lim]").forEach(i=>i.onchange=()=>{S.orc=S.orc||{};const v=Math.abs(+i.value)||0;if(v>0)S.orc[i.dataset.lim]=v;else delete S.orc[i.dataset.lim];save();view()});
  const fc=$("#fc");if(fc)fc.onsubmit=e=>{e.preventDefault();const f=new FormData(fc),p={};["renda","outras","fixos","variaveis","parcelas","caixa","reserva"].forEach(k=>{const v=f.get(k);p[k]=v===""?null:Math.abs(+v)});
    S.perfil=p;const m=hoje.slice(0,7);S.tx=S.tx.filter(x=>!(x.setup&&x.date.slice(0,7)===m));
    const add=(v,desc,type,cat,kind)=>{if(v>0)S.tx.push({id:Date.now()+Math.random(),desc,val:v,type,cat,date:hoje,kind,setup:1})};
    add(p.renda,"Renda mensal (estimativa)","r","Outros","fixa");add(p.outras,"Outras rendas (estimativa)","r","Outros","variável");add(p.fixos,"Gastos fixos (estimativa)","d","Contas básicas","fixa");add(p.variaveis,"Gastos variáveis (estimativa)","d","Outros","variável");add(p.parcelas,"Parcelas e dívidas (estimativa)","d","Dívidas e parcelas","parcelada");
    save();mes=hoje.slice(0,7);page="painel";view()};
  const m=$("#mes");if(m)m.onchange=e=>{mes=e.target.value||mes;view()};
  const fm=$("#fm");if(fm)fm.onsubmit=e=>{e.preventDefault();const f=new FormData(fm),o={desc:f.get("desc").trim(),val:Math.abs(+f.get("val")),type:f.get("type"),cat:f.get("cat"),date:f.get("date"),kind:f.get("kind")};
    if(!o.desc||!(o.val>0))return;
    if(edit){Object.assign(S.tx.find(x=>x.id===edit),o);edit=null}else S.tx.push({id:Date.now(),...o});save();view()};
  document.querySelectorAll("[data-e]").forEach(b=>b.onclick=()=>{edit=+b.dataset.e;view();scrollTo(0,0)});
  document.querySelectorAll("[data-x]").forEach(b=>b.onclick=()=>{if(confirm("Excluir esta movimentação?")){S.tx=S.tx.filter(x=>x.id!==+b.dataset.x);save();view()}});
  const bu=$("#busca");if(bu)bu.oninput=()=>document.querySelectorAll("tr[data-q]").forEach(t=>t.style.display=t.dataset.q.includes(bu.value.toLowerCase())?"":"none");
  const fg=$("#fg");if(fg)fg.onsubmit=e=>{e.preventDefault();const f=new FormData(fg);S.goals.push({id:Date.now(),name:f.get("name").trim(),target:+f.get("target"),saved:+f.get("saved")||0,deadline:f.get("deadline"),tipo:f.get("tipo"),created:hoje});save();view()};
  document.querySelectorAll("form[data-a]").forEach(fr=>fr.onsubmit=e=>{e.preventDefault();S.goals.find(g=>g.id===+fr.dataset.a).saved+=+fr.add.value;save();view()});
  document.querySelectorAll("[data-gx]").forEach(b=>b.onclick=()=>{if(confirm("Excluir esta meta?")){S.goals=S.goals.filter(g=>g.id!==+b.dataset.gx);save();view()}});
  const fs=$("#fs");if(fs){fs.onsubmit=e=>{e.preventDefault();simular(fs)};simular(fs);
    const s=stats(mes),sobra=s.rec-s.cons-s.inv;
    $("#cap").innerHTML=s.rec>0?(sobra>0?`Em ${nomeMes(mes)} sobraram ${R(sobra)} depois das despesas de consumo e dos aportes. Antes de investir, priorize despesas essenciais, dívidas caras e uma reserva de emergência. O valor a investir é uma escolha sua.`:`Neste mês não sobrou dinheiro depois das despesas. Foque em reorganizar o orçamento antes de investir.`):`Registre sua renda em Movimentações para estimar sua capacidade de investir.`}
}
document.querySelectorAll("nav button[data-p]").forEach(b=>b.onclick=()=>{page=b.dataset.p;edit=null;view()});
const dark=()=>{const t=document.documentElement.dataset.theme;return t?t==="dark":matchMedia("(prefers-color-scheme: dark)").matches};
const setTema=t=>{if(t){document.documentElement.dataset.theme=t;try{localStorage.setItem("folego_tema",t)}catch(e){}}$("#tema").textContent=dark()?"Modo claro":"Modo escuro"};
$("#tema").onclick=()=>setTema(dark()?"light":"dark");
try{setTema(localStorage.getItem("folego_tema"))}catch(e){setTema(null)}
$("#limpar").onclick=()=>{if(confirm("Apagar todos os dados desta conta?")){S=novo();save();page="config";view()}};
$("#sair").onclick=async()=>{try{await api("POST","/api/logout")}catch(e){}USER=null;S=null;modoAuth="login";tela="home";view()};
$("#csv").onclick=()=>{const rows=[["data","descricao","tipo","categoria","valor","natureza"],...S.tx.map(x=>[x.date,'"'+x.desc.replace(/"/g,'""')+'"',x.type==="r"?"receita":"despesa",x.cat,x.val.toFixed(2).replace(".",","),x.kind])];
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["\ufeff"+rows.map(r=>r.join(";")).join("\n")],{type:"text/csv"}));a.download="equilibra.csv";a.click()};
$("#navlogo").src=LOGON;
(async()=>{try{const r=await api("GET","/api/eu");const est=await api("GET","/api/estado");entrar(r.usuario,est)}catch(e){apiOff=!!e.off;view();nuv(e.status===401?"Entre para salvar no banco":"Servidor indisponível")}})();
