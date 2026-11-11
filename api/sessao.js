import { exigirEquipe } from '../lib/auth.js';
import { conectar } from '../lib/db.js';
import { metodoNaoPermitido, responder } from '../lib/http.js';
import { obterPerfil } from '../lib/perfil.js';

// GET /api/sessao
// Confirma, NO SERVIDOR, que quem chamou é da equipe (jornalista ou diretoria) e devolve o papel e o perfil.
// O frontend usa isso só para decidir o que mostrar; quem protege publicar, excluir
// e editar o perfil de verdade são as próprias rotas (cada uma confere o papel no servidor).
export default async function handler(req, res) {
  if (req.method !== 'GET') return metodoNaoPermitido(res, ['GET']);

  const auth = await exigirEquipe(req);
  if (!auth.ok) return responder(res, auth.status, { erro: auth.erro });

  let sql = null;
  try {
    sql = conectar();
  } catch {
    /* sem banco: o perfil cai no padrão */
  }
  const perfil = sql ? await obterPerfil(sql, auth) : { nome: auth.usuario, bio: '', foto: null };
  return responder(res, 200, { papel: auth.papel, nome: perfil.nome, bio: perfil.bio, foto: perfil.foto });
}
