import { put } from '@vercel/blob';
import { exigirJornalista } from '../lib/auth.js';
import { conectar } from '../lib/db.js';
import { lerJson, metodoNaoPermitido, responder } from '../lib/http.js';
import { CATEGORIAS, validarPostagem } from '../lib/validar.js';

const COLUNAS_PUBLICAS = 'id, titulo, conteudo, categoria, imagem, autor, autor_foto, criado_em';

// Formato devolvido ao site (não inclui autor_id, que é interno)
function formatar(linha) {
  return {
    id: String(linha.id),
    titulo: linha.titulo,
    conteudo: linha.conteudo,
    categoria: linha.categoria,
    imagem: linha.imagem || null,
    autor: linha.autor,
    autorFoto: linha.autor_foto || null,
    criadoEm: new Date(linha.criado_em).toISOString(),
  };
}

export default async function handler(req, res) {
  if (req.method === 'GET') return listar(res);
  if (req.method === 'POST') return criar(req, res);
  return metodoNaoPermitido(res, ['GET', 'POST']);
}

// GET /api/postagens — público, sem login. Mais recentes primeiro.
async function listar(res) {
  try {
    const sql = conectar();
    const linhas = await sql`
      SELECT id, titulo, conteudo, categoria, imagem, autor, autor_foto, criado_em
      FROM postagens
      ORDER BY criado_em DESC, id DESC
      LIMIT 200`;

    const validas = linhas
      .filter(
        (l) =>
          l.titulo?.trim() && l.conteudo?.trim() && CATEGORIAS.includes(l.categoria),
      )
      .map(formatar);

    return responder(res, 200, { postagens: validas });
  } catch (erro) {
    console.error('Falha ao listar postagens:', erro?.name || 'erro');
    return responder(res, 500, { erro: 'Não foi possível carregar as postagens agora.' });
  }
}

// POST /api/postagens — só jornalista autenticado.
async function criar(req, res) {
  // 1 e 2) sessão do Clerk + papel de jornalista
  const auth = await exigirJornalista(req);
  if (!auth.ok) return responder(res, auth.status, { erro: auth.erro });

  // 3) validação de todos os campos
  const corpo = lerJson(req);
  if (!corpo) return responder(res, 400, { erro: 'Envie os dados em JSON.' });
  const { erro, dados } = validarPostagem(corpo);
  if (erro) return responder(res, 400, { erro });

  try {
    // Imagem: vai para o Vercel Blob; no banco fica só o endereço (URL).
    let urlImagem = null;
    if (dados.imagem) {
      const blob = await put(`postagens/resumo.${dados.imagem.extensao}`, dados.imagem.buffer, {
        access: 'public',
        addRandomSuffix: true,
        contentType: dados.imagem.tipo,
      });
      urlImagem = blob.url;
    }

    // 4) grava no PostgreSQL (Neon)
    const sql = conectar();
    const linhas = await sql`
      INSERT INTO postagens (titulo, conteudo, categoria, imagem, autor, autor_id, autor_foto)
      VALUES (${dados.titulo}, ${dados.conteudo}, ${dados.categoria}, ${urlImagem},
              ${auth.nome}, ${auth.userId}, ${auth.foto})
      RETURNING id, titulo, conteudo, categoria, imagem, autor, autor_foto, criado_em`;

    // 5) resposta
    return responder(res, 201, { postagem: formatar(linhas[0]) });
  } catch (e) {
    console.error('Falha ao criar postagem:', e?.name || 'erro');
    return responder(res, 500, { erro: 'Não foi possível publicar agora. Tente novamente.' });
  }
}
