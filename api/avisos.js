import { del, put } from '@vercel/blob';
import { exigirDiretoria } from '../lib/auth.js';
import { conectar } from '../lib/db.js';
import { lerJson, metodoNaoPermitido, responder } from '../lib/http.js';
import { obterPerfil } from '../lib/perfil.js';
import { validarAviso } from '../lib/validar.js';

const ehBlob = (url) => typeof url === 'string' && /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i.test(url);

// Formato devolvido ao site (não inclui autor_id, que é interno)
function formatar(l) {
  return {
    id: String(l.id),
    texto: l.texto || '',
    imagem: l.imagem || null,
    imagemLargura: l.imagem_largura || null,
    imagemAltura: l.imagem_altura || null,
    autor: l.autor,
    autorFoto: l.autor_foto || null,
    criadoEm: new Date(l.criado_em).toISOString(),
  };
}

// Avisos do Mural. Leitura é pública; criar e excluir é só para a conta com papel "diretoria".
export default async function handler(req, res) {
  if (req.method === 'GET') return listar(res);
  if (req.method === 'POST') return criar(req, res);
  if (req.method === 'DELETE') return excluir(req, res);
  return metodoNaoPermitido(res, ['GET', 'POST', 'DELETE']);
}

// GET /api/avisos — público. Mais recentes primeiro.
// Nome e foto vêm do PERFIL ATUAL de quem postou (se mudar o nome, os avisos antigos mudam junto).
async function listar(res) {
  try {
    const sql = conectar();
    const linhas = await sql`
      SELECT a.id, a.texto, a.imagem, a.imagem_largura, a.imagem_altura, a.criado_em,
             COALESCE(f.nome_exibicao, a.autor) AS autor,
             COALESCE(f.foto, a.autor_foto)     AS autor_foto
      FROM avisos a
      LEFT JOIN perfis f ON f.autor_id = a.autor_id
      ORDER BY a.criado_em DESC, a.id DESC
      LIMIT 100`;
    return responder(res, 200, { avisos: linhas.map(formatar) });
  } catch (erro) {
    console.error('Falha ao listar avisos:', erro?.name || 'erro');
    return responder(res, 500, { erro: 'Não foi possível carregar os avisos agora.' });
  }
}

// POST /api/avisos — só diretoria.
async function criar(req, res) {
  const auth = await exigirDiretoria(req);
  if (!auth.ok) return responder(res, auth.status, { erro: auth.erro });

  const corpo = lerJson(req);
  if (!corpo) return responder(res, 400, { erro: 'Envie os dados em JSON.' });
  const { erro, dados } = validarAviso(corpo);
  if (erro) return responder(res, 400, { erro });

  let urlImagem = null;
  try {
    const sql = conectar();
    const perfil = await obterPerfil(sql, auth);

    if (dados.imagem) {
      const blob = await put(`avisos/img.${dados.imagem.extensao}`, dados.imagem.buffer, {
        access: 'public',
        addRandomSuffix: true,
        contentType: dados.imagem.tipo,
      });
      urlImagem = blob.url;
    }

    const linhas = await sql`
      INSERT INTO avisos (texto, imagem, imagem_largura, imagem_altura, autor, autor_id, autor_foto)
      VALUES (${dados.texto}, ${urlImagem}, ${dados.largura}, ${dados.altura},
              ${perfil.nome}, ${auth.userId}, ${perfil.foto})
      RETURNING id, texto, imagem, imagem_largura, imagem_altura, autor, autor_foto, criado_em`;

    return responder(res, 201, { aviso: formatar(linhas[0]) });
  } catch (e) {
    console.error('Falha ao criar aviso:', e?.name || 'erro');
    if (urlImagem) {
      try {
        await del(urlImagem);
      } catch {
        /* ignora */
      }
    }
    return responder(res, 500, { erro: 'Não foi possível publicar o aviso agora. Tente novamente.' });
  }
}

// DELETE /api/avisos?id=123 — só diretoria.
async function excluir(req, res) {
  const auth = await exigirDiretoria(req);
  if (!auth.ok) return responder(res, auth.status, { erro: auth.erro });

  const id = String(req.query?.id ?? '');
  if (!/^\d{1,18}$/.test(id)) return responder(res, 400, { erro: 'Aviso inválido.' });

  try {
    const sql = conectar();
    const apagados = await sql`DELETE FROM avisos WHERE id = ${id} RETURNING imagem`;
    if (!apagados.length) return responder(res, 404, { erro: 'Este aviso não existe mais.' });

    if (ehBlob(apagados[0].imagem)) {
      try {
        await del(apagados[0].imagem);
      } catch {
        /* o aviso já saiu do site: não é grave */
      }
    }
    return responder(res, 200, { ok: true });
  } catch (e) {
    console.error('Falha ao excluir aviso:', e?.name || 'erro');
    return responder(res, 500, { erro: 'Não foi possível excluir agora. Tente novamente.' });
  }
}
