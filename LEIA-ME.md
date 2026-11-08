# Portal Celao em Foco — guia de configuração (Vercel + Clerk + Neon + Blob)

Nada aqui foi configurado por mim: serviços externos, chaves e deploy ficam com você.
**Nunca** coloque chaves secretas no código, no README, em commits ou em prints.

## Estrutura do projeto

```
public/            ← site público (a Vercel serve só esta pasta)
  index.html  style.css  script.js  logo.svg
api/               ← rotas serverless da Vercel
  postagens.js     GET (público) e POST (só jornalista)
  sessao.js        GET: confirma no servidor se a sessão é de jornalista
  config.js        GET: entrega só a chave PÚBLICA do Clerk
lib/               ← código compartilhado da API (não fica público)
  auth.js  db.js  http.js  validar.js
schema.sql         ← tabela do Neon (rode uma vez)
package.json  vercel.json  .env.example  .gitignore
```

## 1. Comandos no seu computador

```bash
npm install @clerk/backend @neondatabase/serverless @vercel/blob
```

Isso grava as versões atuais no `package.json`. Não precisa de mais nada (sem build).

Para testar localmente (opcional): `npm i -g vercel`, depois `vercel link`, `vercel env pull .env.local` e `vercel dev`.

## 2. Vercel (projeto e domínio)

1. Suba esta pasta para um repositório no GitHub (o `.gitignore` já protege `.env*`).
2. Na Vercel: **Add New → Project →** importe o repositório. Framework: **Other**. Não precisa de Build Command (o `vercel.json` já aponta `public` como saída).
3. Anote o domínio (`https://SEU-PROJETO.vercel.app`).

## 3. Neon (banco)

1. No projeto da Vercel: **Storage → Create Database → Neon** (Marketplace) e conecte ao projeto. A variável `DATABASE_URL` é criada sozinha.
2. Abra o **SQL Editor** do Neon e rode o conteúdo de `schema.sql`.

## 4. Vercel Blob (imagens de resumo)

1. **Storage → Create → Blob**, com acesso **público**, e conecte ao projeto. As variáveis do Blob (`BLOB_READ_WRITE_TOKEN`) são criadas sozinhas.
2. As imagens ficam no Blob; no banco guarda-se só o endereço (URL).

## 5. Clerk (login)

1. Crie um aplicativo no Clerk. Em **User & authentication**, ligue **Username** (e/ou e-mail) e **Password**.
2. Em **Restrictions**, deixe o cadastro **restrito/por convite**, para estranhos não criarem conta.
3. Em **Users → Create user**: crie a conta do jornalista (a senha do Clerk precisa de pelo menos 8 caracteres, então "senha" não serve).
4. Abra esse usuário e, em **Public metadata**, coloque:
   ```json
   { "role": "jornalista" }
   ```
   Sem isso, o servidor responde 403 e a pessoa não consegue publicar.
5. Em **API keys**, copie a chave pública (`pk_...`) e a secreta (`sk_...`).
6. Domínio: uma instância *Development* do Clerk funciona em endereços `.vercel.app`. Uma instância *Production* normalmente exige um domínio próprio. Confira na documentação do Clerk.

## 6. Variáveis de ambiente (Vercel → Settings → Environment Variables)

| Nome | Valor | Onde aparece |
|---|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_...` (pública) | servidor entrega ao site via `/api/config` |
| `CLERK_SECRET_KEY` | `sk_...` (secreta) | só no servidor |
| `DATABASE_URL` | criada pela integração do Neon | só no servidor |
| `BLOB_READ_WRITE_TOKEN` | criada pela integração do Blob | só no servidor |
| `CLERK_AUTHORIZED_PARTIES` *(opcional)* | `https://SEU-PROJETO.vercel.app` | reforço extra do Clerk |

Depois de cadastrar ou mudar variáveis: **Deployments → Redeploy**.

## 7. Como entrar na área do jornalista

Digite o endereço completo com `#login` no final: `https://SEU-PROJETO.vercel.app/#login`.
O item "Login" existe no menu, mas fica escondido por CSS. A proteção de verdade está no servidor (sessão do Clerk + papel `jornalista`), não no esconderijo.

## 8. O que testar (nesta ordem)

| Teste | Esperado | Se falhar |
|---|---|---|
| Abrir o site sem `#login` | Menu com 7 abas, sem "Login"; abas vazias dizem "Nenhuma postagem ainda" | Mensagem "Não foi possível carregar as postagens": confira `DATABASE_URL` e se rodou o `schema.sql` |
| `GET /api/postagens` no navegador | `{"postagens":[]}` | 500: variável do Neon ou tabela ausente |
| `/#login` com senha errada | "Usuário ou senha incorretos." | — |
| `/#login` com a conta jornalista | Vai para a página Notícias com a faixa "Área do jornalista" e o botão "Criar nova postagem" no lugar do texto vazio | "Não foi possível iniciar o login": chave `pk_` ausente ou domínio não aceito pelo Clerk. "Sem permissão de jornalista": falta o `role` nos metadados |
| Conta do Clerk **sem** `role` | Recusada com 403, sem ver o botão | — |
| Criar postagem com e sem imagem | Aparece na categoria escolhida, com banner 16:9 | Erro ao publicar com imagem: confira o Blob (token e acesso público) |
| Abrir o site em aba anônima | Matéria visível sem login, e nenhum botão de postar | — |
| `POST /api/postagens` sem login (ex.: `curl -X POST`) | 401 | — |
| `/#editor` sem login | Volta para `/#login` | — |

## 9. Observações importantes

- **O que eu não pude testar**: Clerk, Neon e Blob reais. Testei o código com versões simuladas deles. A parte do Clerk no navegador usa `clerk.client.signIn.create`, `setActive` e `session.getToken` do `clerk-js@6`: se aparecer erro nessa etapa, mande a mensagem do console (sem chaves).
- **GitHub Pages**: não executa API nem banco, então login e publicação **não funcionam lá**. O site em si abre, mas sem postagens. O caminho é a Vercel.
- **Mural de avisos**: continua como antes (sem publicação). Esta entrega cobre as postagens das 6 categorias.
- Limite de 4,5 MB por requisição na Vercel: a imagem é reduzida no navegador para 1280×720 (JPEG) antes de enviar.
