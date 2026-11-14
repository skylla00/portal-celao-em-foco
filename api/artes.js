import { del, put } from '@vercel/blob';
import { exigirJornalista } from '../lib/auth.js';
import { conectar } from '../lib/db.js';
import { lerJson, metodoNaoPermitido, responder } from '../lib/http.js';
import { obterPerfil } from '../lib/perfil.js';
import { validarArte } from '../lib/validar.js';

const ehBlob = (url) => typeof url === 'string' && /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i.test(url);

function formatar(linha) {
  return {
    id: String(linha.id),
    legenda: linha.legenda || '',
    imagem: linha.imagem,
    imagemLargura: linha.imagem_largura || null,
    imagemAltura: linha.imagem_altura || null,
    autor: linha.autor,
    autorFoto: linha.autor_foto || null,
    criadoEm: new Date(linha.criado_em).toISOString(),
  };
}

export default async function handler(req, res) {
  if (req.method === 'GET') return listar(res);
  if (req.method === 'POST') return criar(req, res);
  if (req.method === 'PUT') return editar(req, res);
  if (req.method === 'DELETE') return excluir(req, res);
  return metodoNaoPermitido(res, ['GET', 'POST', 'PUT', 'DELETE']);
}

async function listar(res) {
  try {
    const sql = conectar();
    const linhas = await sql`
      SELECT a.id, a.legenda, a.imagem, a.imagem_largura, a.imagem_altura, a.criado_em,
             COALESCE(f.nome_exibicao, a.autor) AS autor,
             COALESCE(f.foto, a.autor_foto) AS autor_foto
      FROM artes a
      LEFT JOIN perfis f ON f.autor_id = a.autor_id
      ORDER BY a.criado_em DESC, a.id DESC
      LIMIT 200`;
    return responder(res, 200, { artes: linhas.map(formatar) });
  } catch (erro) {
    console.error('Falha ao listar artes:', erro?.name || 'erro');
    return responder(res, 500, { erro: 'Não foi possível carregar as artes agora.' });
  }
}

async function criar(req, res) {
  const auth = await exigirJornalista(req);
  if (!auth.ok) return responder(res, auth.status, { erro: auth.erro });

  const corpo = lerJson(req);
  if (!corpo) return responder(res, 400, { erro: 'Envie os dados em JSON.' });
  const { erro, dados } = validarArte(corpo);
  if (erro) return responder(res, 400, { erro });

  let urlImagem = null;
  try {
    const sql = conectar();
    const perfil = await obterPerfil(sql, auth);
    const blob = await put(`artes/img.${dados.imagem.extensao}`, dados.imagem.buffer, {
      access: 'public',
      addRandomSuffix: true,
      contentType: dados.imagem.tipo,
    });
    urlImagem = blob.url;

    const linhas = await sql`
      INSERT INTO artes (legenda, imagem, imagem_largura, imagem_altura, autor, autor_id, autor_foto)
      VALUES (${dados.legenda}, ${urlImagem}, ${dados.largura}, ${dados.altura},
              ${perfil.nome}, ${auth.userId}, ${perfil.foto})
      RETURNING id, legenda, imagem, imagem_largura, imagem_altura, autor, autor_foto, criado_em`;
    return responder(res, 201, { arte: formatar(linhas[0]) });
  } catch (e) {
    console.error('Falha ao publicar arte:', e?.name || 'erro');
    if (urlImagem) {
      try {
        await del(urlImagem);
      } catch {
        /* ignora */
      }
    }
    return responder(res, 500, { erro: 'Não foi possível publicar a arte agora. Tente novamente.' });
  }
}

async function editar(req, res) {
  const auth = await exigirJornalista(req);
  if (!auth.ok) return responder(res, auth.status, { erro: auth.erro });

  const id = String(req.query?.id ?? '');
  if (!/^\d{1,18}$/.test(id)) return responder(res, 400, { erro: 'Arte inválida.' });

  const corpo = lerJson(req);
  if (!corpo) return responder(res, 400, { erro: 'Envie os dados em JSON.' });
  const { erro, dados } = validarArte(corpo, { imagemObrigatoria: false });
  if (erro) return responder(res, 400, { erro });

  let urlImagem = null;
  try {
    const sql = conectar();
    const atuais = await sql`SELECT imagem FROM artes WHERE id = ${id}`;
    if (!atuais.length) return responder(res, 404, { erro: 'Esta arte não existe mais.' });

    if (dados.imagem) {
      const blob = await put(`artes/img.${dados.imagem.extensao}`, dados.imagem.buffer, {
        access: 'public',
        addRandomSuffix: true,
        contentType: dados.imagem.tipo,
      });
      urlImagem = blob.url;
    }

    const linhas = await sql`
      WITH alterada AS (
        UPDATE artes
        SET legenda = ${dados.legenda},
            imagem = COALESCE(${urlImagem}::text, imagem),
            imagem_largura = CASE
              WHEN ${urlImagem}::text IS NOT NULL THEN ${dados.largura}
              ELSE imagem_largura
            END,
            imagem_altura = CASE
              WHEN ${urlImagem}::text IS NOT NULL THEN ${dados.altura}
              ELSE imagem_altura
            END
        WHERE id = ${id}
        RETURNING *
      )
      SELECT a.id, a.legenda, a.imagem, a.imagem_largura, a.imagem_altura, a.criado_em,
             COALESCE(f.nome_exibicao, a.autor) AS autor,
             COALESCE(f.foto, a.autor_foto) AS autor_foto
      FROM alterada a
      LEFT JOIN perfis f ON f.autor_id = a.autor_id`;
    if (!linhas.length) {
      if (urlImagem) {
        try {
          await del(urlImagem);
        } catch {
          /* ignora */
        }
      }
      return responder(res, 404, { erro: 'Esta arte não existe mais.' });
    }

    if (atuais[0].imagem !== linhas[0].imagem && ehBlob(atuais[0].imagem)) {
      try {
        await del(atuais[0].imagem);
      } catch {
        /* a arte já foi atualizada; uma imagem antiga órfã não impede a edição */
      }
    }
    return responder(res, 200, { arte: formatar(linhas[0]) });
  } catch (e) {
    console.error('Falha ao editar arte:', e?.name || 'erro');
    if (urlImagem) {
      try {
        await del(urlImagem);
      } catch {
        /* ignora */
      }
    }
    return responder(res, 500, { erro: 'Não foi possível editar a arte agora. Tente novamente.' });
  }
}

async function excluir(req, res) {
  const auth = await exigirJornalista(req);
  if (!auth.ok) return responder(res, auth.status, { erro: auth.erro });

  const id = String(req.query?.id ?? '');
  if (!/^\d{1,18}$/.test(id)) return responder(res, 400, { erro: 'Arte inválida.' });

  try {
    const sql = conectar();
    const apagadas = await sql`DELETE FROM artes WHERE id = ${id} RETURNING imagem`;
    if (!apagadas.length) return responder(res, 404, { erro: 'Esta arte não existe mais.' });

    if (ehBlob(apagadas[0].imagem)) {
      try {
        await del(apagadas[0].imagem);
      } catch {
        /* a arte já saiu do site: não é grave */
      }
    }
    return responder(res, 200, { ok: true });
  } catch (e) {
    console.error('Falha ao excluir arte:', e?.name || 'erro');
    return responder(res, 500, { erro: 'Não foi possível excluir a arte agora. Tente novamente.' });
  }
}
