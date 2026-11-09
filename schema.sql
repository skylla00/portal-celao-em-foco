-- Rode este arquivo no "SQL Editor" do Neon. Pode rodar de novo sem problema:
-- tudo usa "IF NOT EXISTS" e não apaga nada.
-- Não existe tabela de usuários nem de senhas: o login é todo feito pelo Clerk.

CREATE TABLE IF NOT EXISTS postagens (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  titulo       TEXT NOT NULL,
  conteudo     TEXT NOT NULL,
  categoria    TEXT NOT NULL
               CHECK (categoria IN ('esportes','noticias','entrevistas','resenha-critica','opiniao','artes')),
  imagem       TEXT,            -- URL da imagem de resumo (capa 16:9, guardada no Vercel Blob)
  autor        TEXT NOT NULL,   -- nome gravado no dia da publicação (reserva)
  autor_id     TEXT NOT NULL,   -- id do usuário no Clerk (interno, não é exibido)
  autor_foto   TEXT,            -- foto gravada no dia da publicação (reserva)
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Imagem do FINAL da matéria (tamanho livre, diferente da capa)
ALTER TABLE postagens ADD COLUMN IF NOT EXISTS imagem_final TEXT;

CREATE INDEX IF NOT EXISTS postagens_criado_em_idx ON postagens (criado_em DESC);
CREATE INDEX IF NOT EXISTS postagens_autor_idx ON postagens (autor_id);

-- Perfil do jornalista: nome de exibição, apresentação e foto (no Vercel Blob).
-- O nome de USUÁRIO continua sendo o do Clerk e não muda.
CREATE TABLE IF NOT EXISTS perfis (
  autor_id       TEXT PRIMARY KEY,   -- id do usuário no Clerk
  nome_exibicao  TEXT NOT NULL,
  bio            TEXT NOT NULL DEFAULT '',
  foto           TEXT,               -- URL no Vercel Blob
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
