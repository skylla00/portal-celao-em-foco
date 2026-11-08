import { createClerkClient } from '@clerk/backend';
import { paraRequestPadrao } from './http.js';

const PAPEL_JORNALISTA = 'jornalista';

export function chavePublicaClerk() {
  return process.env.CLERK_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || '';
}

/**
 * Segurança REAL da área do jornalista.
 * 1) valida o token de sessão do Clerk (enviado em "Authorization: Bearer ...");
 * 2) busca o usuário no Clerk e confere o papel em publicMetadata.role === "jornalista".
 *
 * Retorna { ok: true, userId, nome, foto } ou { ok: false, status, erro }.
 */
export async function exigirJornalista(req) {
  const secretKey = process.env.CLERK_SECRET_KEY;
  const publishableKey = chavePublicaClerk();
  if (!secretKey || !publishableKey) {
    return { ok: false, status: 500, erro: 'Autenticação não configurada no servidor.' };
  }

  try {
    const clerk = createClerkClient({ secretKey, publishableKey });

    const opcoes = {};
    const partes = (process.env.CLERK_AUTHORIZED_PARTIES || '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (partes.length) opcoes.authorizedParties = partes;

    const estado = await clerk.authenticateRequest(paraRequestPadrao(req), opcoes);
    if (!estado.isAuthenticated) {
      return { ok: false, status: 401, erro: 'Sessão ausente ou expirada. Entre novamente.' };
    }

    const { userId } = estado.toAuth();
    if (!userId) return { ok: false, status: 401, erro: 'Sessão inválida.' };

    const usuario = await clerk.users.getUser(userId);
    if (usuario.publicMetadata?.role !== PAPEL_JORNALISTA) {
      return { ok: false, status: 403, erro: 'Esta conta não tem permissão de jornalista.' };
    }

    const nome =
      [usuario.firstName, usuario.lastName].filter(Boolean).join(' ') ||
      usuario.username ||
      'Jornalista';
    return { ok: true, userId, nome, foto: usuario.imageUrl || null };
  } catch (erro) {
    console.error('Falha ao validar sessão:', erro?.name || 'erro');
    return { ok: false, status: 500, erro: 'Não foi possível validar a sessão agora.' };
  }
}
