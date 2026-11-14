import { del, put } from '@vercel/blob';
import { exigirJornalista } from '../lib/auth.js';
import { conectar } from '../lib/db.js';
import { lerJson, metodoNaoPermitido, responder } from '../lib/http.js';
import { obterPerfil } from '../lib/perfil.js';
import { CATEGORIAS, validarPostagem } from '../lib/validar.js';

const ehBlob = (url) => typeof url === 'string' && /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i.test(url);

// Formato devolvido ao site (não inclui autor_id, que é interno)
function formatar(linha) {
  return {
    id: String(linha.id),
    titulo: linha.titulo,
    conteudo: linha.conteudo,
    categoria: linha.categoria,
    imagem: linha.imagem || null,
    imagemFinal: linha.imagem_final || null,
    autor: linha.autor,
    autorFoto: linha.autor_foto || null,
    autorBio: linha.autor_bio || '',
    criadoEm: new Date(linha.criado_em).toISOString(),
    fixado: Boolean(linha.fixado_em),
    fixadoEm: linha.fixado_em ? new Date(linha.fixado_em).toISOString() : null,
  };
}

export default async function handler(req, res) {
  if (req.method === 'GET') return listar(res);
  if (req.method === 'POST') return criar(req, res);
  if (req.method === 'PATCH') return fixar(req, res);
  if (req.method === 'DELETE') return excluir(req, res);
  return metodoNaoPermitido(res, ['GET', 'POST', 'PATCH', 'DELETE']);
}

// GET /api/postagens — público, sem login. Mais recentes primeiro.
// Nome, foto e bio vêm do PERFIL ATUAL do autor (se mudar o nome, as matérias antigas
// mudam junto). Se o autor nunca editou o perfil, vale o que foi gravado na postagem.
async function listar(res) {
  try {
    const sql = conectar();
    let linhas;
    try {
      // Fixadas primeiro (a fixada mais recentemente vem antes); o resto, por data.
      // Assim uma matéria antiga fixada não fica de fora do LIMIT.
      linhas = await sql`
        SELECT p.id, p.titulo, p.conteudo, p.categoria, p.imagem, p.imagem_final, p.criado_em, p.fixado_em,
               COALESCE(f.nome_exibicao, p.autor) AS autor,
               COALESCE(f.foto, p.autor_foto)     AS autor_foto,
               f.bio                              AS autor_bio
        FROM postagens p
        LEFT JOIN perfis f ON f.autor_id = p.autor_id
        ORDER BY (p.fixado_em IS NULL), p.fixado_em DESC, p.criado_em DESC, p.id DESC
        LIMIT 200`;
    } catch {
      // Reserva: se o SQL novo (schema.sql) ainda não foi rodado no Neon, o site
      // continua mostrando as matérias com a consulta antiga.
      linhas = await sql`
        SELECT id, titulo, conteudo, categoria, imagem, autor, autor_foto, criado_em
        FROM postagens
        ORDER BY criado_em DESC, id DESC
        LIMIT 200`;
    }

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

async function enviarImagem(pasta, imagem) {
  if (!imagem) return null;
  const blob = await put(`${pasta}/img.${imagem.extensao}`, imagem.buffer, {
    access: 'public',
    addRandomSuffix: true,
    contentType: imagem.tipo,
  });
  return blob.url;
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

  const enviadas = [];
  try {
    const sql = conectar();
    const perfil = await obterPerfil(sql, auth);

    // Imagens: vão para o Vercel Blob; no banco ficam só os endereços (URLs).
    const urlImagem = await enviarImagem('postagens', dados.imagem);
    if (urlImagem) enviadas.push(urlImagem);
    const urlFinal = await enviarImagem('postagens', dados.imagemFinal);
    if (urlFinal) enviadas.push(urlFinal);

    // 4) grava no PostgreSQL (Neon)
    const linhas = await sql`
      WITH nova AS (
        INSERT INTO postagens (titulo, conteudo, categoria, imagem, imagem_final, autor, autor_id, autor_foto)
        VALUES (${dados.titulo}, ${dados.conteudo}, ${dados.categoria}, ${urlImagem}, ${urlFinal},
                ${perfil.nome}, ${auth.userId}, ${perfil.foto})
        RETURNING *
      )
      SELECT p.id, p.titulo, p.conteudo, p.categoria, p.imagem, p.imagem_final, p.criado_em,
             COALESCE(f.nome_exibicao, p.autor) AS autor,
             COALESCE(f.foto, p.autor_foto)     AS autor_foto,
             f.bio                              AS autor_bio
      FROM nova p
      LEFT JOIN perfis f ON f.autor_id = p.autor_id`;

    // 5) resposta
    return responder(res, 201, { postagem: formatar(linhas[0]) });
  } catch (e) {
    console.error('Falha ao criar postagem:', e?.name || 'erro');
    // Não deixa imagens órfãs no Blob se o banco falhou
    for (const url of enviadas) {
      try {
        await del(url);
      } catch {
        /* ignora */
      }
    }
    return responder(res, 500, { erro: 'Não foi possível publicar agora. Tente novamente.' });
  }
}

// PATCH /api/postagens?id=123  corpo: { "fixado": true | false } — só jornalista autenticado.
// Fixar guarda o momento (fixado_em); desafixar volta para NULL. Repetir a mesma ação não muda nada.
async function fixar(req, res) {
  const auth = await exigirJornalista(req);
  if (!auth.ok) return responder(res, auth.status, { erro: auth.erro });

  const id = String(req.query?.id ?? '');
  if (!/^\d{1,18}$/.test(id)) return responder(res, 400, { erro: 'Postagem inválida.' });

  const corpo = lerJson(req);
  if (!corpo || typeof corpo.fixado !== 'boolean') {
    return responder(res, 400, { erro: 'Informe se a matéria deve ficar fixada.' });
  }

  try {
    const sql = conectar();
    const linhas = await sql`
      UPDATE postagens
      SET fixado_em = CASE WHEN ${corpo.fixado}::boolean THEN COALESCE(fixado_em, NOW()) ELSE NULL END
      WHERE id = ${id}
      RETURNING fixado_em`;
    if (!linhas.length) return responder(res, 404, { erro: 'Esta postagem não existe mais.' });

    return responder(res, 200, {
      fixado: Boolean(linhas[0].fixado_em),
      fixadoEm: linhas[0].fixado_em ? new Date(linhas[0].fixado_em).toISOString() : null,
    });
  } catch (e) {
    console.error('Falha ao fixar postagem:', e?.name || 'erro');
    return responder(res, 500, { erro: 'Não foi possível fixar agora. Tente novamente.' });
  }
}

// DELETE /api/postagens?id=123 — só jornalista autenticado.
async function excluir(req, res) {
  const auth = await exigirJornalista(req);
  if (!auth.ok) return responder(res, auth.status, { erro: auth.erro });

  const id = String(req.query?.id ?? '');
  if (!/^\d{1,18}$/.test(id)) return responder(res, 400, { erro: 'Postagem inválida.' });

  try {
    const sql = conectar();
    const apagadas = await sql`
      DELETE FROM postagens WHERE id = ${id} RETURNING imagem, imagem_final`;
    if (!apagadas.length) return responder(res, 404, { erro: 'Esta postagem não existe mais.' });

    // Apaga as imagens do Blob (se falhar, a matéria já saiu do site: não é grave)
    for (const url of [apagadas[0].imagem, apagadas[0].imagem_final]) {
      if (!ehBlob(url)) continue;
      try {
        await del(url);
      } catch {
        /* ignora */
      }
    }
    return responder(res, 200, { ok: true });
  } catch (e) {
    console.error('Falha ao excluir postagem:', e?.name || 'erro');
    return responder(res, 500, { erro: 'Não foi possível excluir agora. Tente novamente.' });
  }
}
