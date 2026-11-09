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
 * Retorna { ok: true, userId, usuario } ou { ok: false, status, erro }.
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

    // Nome de USUÁRIO do Clerk: é a identidade de verdade (não muda e não aparece no site).
    // O nome de exibição vem da tabela "perfis" (lib/perfil.js) e começa igual a este.
    const nomeUsuario =
      usuario.username ||
      [usuario.firstName, usuario.lastName].filter(Boolean).join(' ') ||
      'Jornalista';
    return { ok: true, userId, usuario: nomeUsuario };
  } catch (erro) {
    console.error('Falha ao validar sessão:', erro?.name || 'erro');
    return { ok: false, status: 500, erro: 'Não foi possível validar a sessão agora.' };
  }
}
