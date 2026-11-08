import { exigirJornalista } from '../lib/auth.js';
import { metodoNaoPermitido, responder } from '../lib/http.js';

// GET /api/sessao
// Confirma, NO SERVIDOR, que quem chamou é um jornalista. O frontend usa isso só para
// decidir o que mostrar; quem protege a publicação de verdade é o POST /api/postagens.
export default async function handler(req, res) {
  if (req.method !== 'GET') return metodoNaoPermitido(res, ['GET']);

  const auth = await exigirJornalista(req);
  if (!auth.ok) return responder(res, auth.status, { erro: auth.erro });
  return responder(res, 200, { papel: 'jornalista', nome: auth.nome, foto: auth.foto });
}
