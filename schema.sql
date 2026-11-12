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

-- Avisos do Mural (só a conta com papel "diretoria" publica): texto puro com emojis e/ou uma imagem.
CREATE TABLE IF NOT EXISTS avisos (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  texto           TEXT NOT NULL DEFAULT '',
  imagem          TEXT,              -- URL no Vercel Blob
  imagem_largura  INTEGER,           -- só para reservar o espaço da imagem na tela
  imagem_altura   INTEGER,
  autor           TEXT NOT NULL,     -- nome gravado no dia da publicação (reserva)
  autor_id        TEXT NOT NULL,     -- id do usuário no Clerk (interno, não é exibido)
  autor_foto      TEXT,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS avisos_criado_em_idx ON avisos (criado_em DESC);

-- Artes da galeria: conteúdo independente das matérias e das categorias do jornal.
CREATE TABLE IF NOT EXISTS artes (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  legenda          TEXT NOT NULL DEFAULT '',
  imagem           TEXT NOT NULL,        -- URL da imagem no Vercel Blob
  imagem_largura   INTEGER,
  imagem_altura    INTEGER,
  autor            TEXT NOT NULL,
  autor_id         TEXT NOT NULL,
  autor_foto       TEXT,
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  postagem_legada_id BIGINT UNIQUE        -- impede duplicação da migração de antigas artes
);
CREATE INDEX IF NOT EXISTS artes_criado_em_idx ON artes (criado_em DESC);

-- Importa para a galeria as artes que antes eram matérias na categoria "artes".
-- A coluna única torna a migração segura para rodar novamente.
INSERT INTO artes (legenda, imagem, autor, autor_id, autor_foto, criado_em, postagem_legada_id)
SELECT titulo, COALESCE(imagem, imagem_final), autor, autor_id, autor_foto, criado_em, id
FROM postagens
WHERE categoria = 'artes'
  AND COALESCE(imagem, imagem_final) IS NOT NULL
ON CONFLICT (postagem_legada_id) DO NOTHING;
