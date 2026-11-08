-- Rode este arquivo UMA vez no "SQL Editor" do Neon.
-- Não existe tabela de usuários nem de senhas: o login é todo feito pelo Clerk.

CREATE TABLE IF NOT EXISTS postagens (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  titulo      TEXT NOT NULL,
  conteudo    TEXT NOT NULL,
  categoria   TEXT NOT NULL
              CHECK (categoria IN ('esportes','noticias','entrevistas','resenha-critica','opiniao','artes')),
  imagem      TEXT,            -- URL da imagem de resumo (guardada no Vercel Blob)
  autor       TEXT NOT NULL,   -- nome exibido nos créditos
  autor_id    TEXT NOT NULL,   -- id do usuário no Clerk (interno, não é exibido)
  autor_foto  TEXT,            -- foto do perfil no Clerk (créditos do jornalista)
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS postagens_criado_em_idx ON postagens (criado_em DESC);
