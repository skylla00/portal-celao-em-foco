import { del, put } from '@vercel/blob';
import { exigirEquipe } from '../lib/auth.js';
import { conectar } from '../lib/db.js';
import { lerJson, metodoNaoPermitido, responder } from '../lib/http.js';
import { obterPerfil } from '../lib/perfil.js';
import { validarPerfil } from '../lib/validar.js';

const ehBlob = (url) => typeof url === 'string' && /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i.test(url);

// PUT /api/perfil — só equipe autenticada (jornalista ou diretoria), e só o PRÓPRIO perfil
// (o id vem da sessão do Clerk no servidor, nunca do corpo da requisição).
export default async function handler(req, res) {
  if (req.method !== 'PUT') return metodoNaoPermitido(res, ['PUT']);

  const auth = await exigirEquipe(req);
  if (!auth.ok) return responder(res, auth.status, { erro: auth.erro });

  const corpo = lerJson(req);
  if (!corpo) return responder(res, 400, { erro: 'Envie os dados em JSON.' });
  const { erro, dados } = validarPerfil(corpo);
  if (erro) return responder(res, 400, { erro });

  try {
    const sql = conectar();
    const atual = (await sql`SELECT foto FROM perfis WHERE autor_id = ${auth.userId} LIMIT 1`)[0];

    let foto = atual?.foto || null;
    if (dados.foto) {
      const blob = await put(`perfis/foto.${dados.foto.extensao}`, dados.foto.buffer, {
        access: 'public',
        addRandomSuffix: true,
        contentType: dados.foto.tipo,
      });
      foto = blob.url;
    } else if (dados.removerFoto) {
      foto = null;
    }

    await sql`
      INSERT INTO perfis (autor_id, nome_exibicao, bio, foto, atualizado_em)
      VALUES (${auth.userId}, ${dados.nome}, ${dados.bio}, ${foto}, NOW())
      ON CONFLICT (autor_id) DO UPDATE
        SET nome_exibicao = EXCLUDED.nome_exibicao,
            bio = EXCLUDED.bio,
            foto = EXCLUDED.foto,
            atualizado_em = NOW()`;

    // Apaga a foto antiga do Blob (se trocou ou removeu). Falha aqui não é grave.
    if (atual?.foto && atual.foto !== foto && ehBlob(atual.foto)) {
      try {
        await del(atual.foto);
      } catch {
        /* ignora */
      }
    }

    const perfil = await obterPerfil(sql, auth);
    return responder(res, 200, { perfil });
  } catch (e) {
    console.error('Falha ao salvar perfil:', e?.name || 'erro');
    return responder(res, 500, { erro: 'Não foi possível salvar o perfil agora. Tente novamente.' });
  }
}
