import { chavePublicaClerk } from '../lib/auth.js';
import { metodoNaoPermitido, responder } from '../lib/http.js';

// Entrega SÓ a chave PÚBLICA do Clerk (publishable key) para o frontend.
// Ela é feita para ser pública; a chave secreta nunca sai do servidor.
export default function handler(req, res) {
  if (req.method !== 'GET') return metodoNaoPermitido(res, ['GET']);

  const chave = chavePublicaClerk();
  if (!chave) return responder(res, 503, { erro: 'Autenticação não configurada.' });
  return responder(res, 200, { clerkPublishableKey: chave });
}
