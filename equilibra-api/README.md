# Equilibra

Site de organização financeira pessoal com API própria e banco SQLite.
Sem dependências externas: só o Node.js (versão 22.13 ou mais nova).

## Como rodar

```
npm start
```

Abra http://localhost:3000. O banco é criado sozinho em `data/equilibra.db`.

## Testes

```
npm test
```

São 15 testes da API: cadastro, login, sessão, isolamento entre usuários, validação
de dados, valores em centavos, proteção CSRF, bloqueio por tentativas e exclusão de conta.

## Variáveis de ambiente

| Variável   | Padrão               | Para que serve                                   |
|------------|----------------------|--------------------------------------------------|
| PORT       | 3000                 | Porta do servidor                                |
| DB_FILE    | ./data/equilibra.db  | Caminho do arquivo do banco                      |
| NODE_ENV   | (vazio)              | Use `production` para ativar cookie Secure e HSTS |

## Estrutura

- `server.js`: servidor, rotas da API, validação, autenticação e banco
- `public/index.html`: tela do site (arquivo único, já com a logo)
- `test/api.test.js`: testes automatizados

## API

Toda requisição que não é GET precisa do cabeçalho `X-Requested-With: equilibra`
e de `Content-Type: application/json`.

| Rota                | O que faz                                      |
|---------------------|------------------------------------------------|
| POST /api/cadastro  | Cria conta (nome, email, senha) e abre sessão  |
| POST /api/login     | Entra (email, senha)                           |
| POST /api/logout    | Encerra a sessão                               |
| GET  /api/eu        | Dados de quem está logado                      |
| GET  /api/estado    | Lançamentos, metas, perfil e orçamento do usuário |
| PUT  /api/estado    | Salva o estado inteiro do usuário (validado)   |
| DELETE /api/conta   | Apaga a conta e todos os dados (pede a senha)  |

Cada rota privada lê o usuário da sessão no servidor. Nenhuma rota aceita
o identificador de outro usuário, então um usuário só alcança os próprios dados.

## Colocar no ar com domínio próprio

1. Use um servidor que rode Node.js 22.13+ (VPS, Railway, Render ou similar). Hospedagem
   estática, como Netlify ou GitHub Pages, não serve: aqui há servidor e banco.
2. Defina `NODE_ENV=production` e coloque o site atrás de HTTPS (o cookie de sessão
   só funciona com HTTPS em produção). Proxies como Nginx, Caddy ou o próprio painel
   da hospedagem fazem isso.
3. Guarde o arquivo do banco em disco persistente e faça cópias de segurança dele.
4. No painel de DNS do seu domínio, aponte o domínio para o servidor (registro A ou
   CNAME, conforme a hospedagem indicar).

## Limitações conhecidas

- Não há recuperação de senha por e-mail (exige um serviço de envio de e-mail).
- O site envia o estado inteiro a cada alteração. Se a mesma conta for usada em dois
  aparelhos ao mesmo tempo, vale a última gravação.
- O bloqueio de tentativas de login fica na memória do processo e usa o IP de quem
  conecta. Atrás de um proxy, configure o proxy para limitar tentativas também.
- A política de segurança de conteúdo permite scripts inline, porque o site é um
  arquivo único.
- Valores ficam em centavos no banco, mas a tela ainda calcula com números comuns
  (podem aparecer diferenças de centavos em casos raros).
- Não foi feita revisão jurídica de LGPD nem política de privacidade.
- Faltam: despesas recorrentes, contas a vencer, parcelamentos, relatórios em PDF
  e botão de exclusão de conta na tela (a rota da API já existe).
