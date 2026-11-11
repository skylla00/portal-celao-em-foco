import { createClerkClient } from '@clerk/backend';
import { paraRequestPadrao } from './http.js';

// Papéis que existem no site. Ficam em "Public metadata" do usuário no Clerk: { "role": "..." }
//  - jornalista: publica e exclui matérias nas 6 categorias
//  - diretoria:  publica e exclui avisos do Mural
export const JORNALISTA = 'jornalista';
export const DIRETORIA = 'diretoria';

export function chavePublicaClerk() {
  return process.env.CLERK_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || '';
}

/**
 * Segurança REAL das áreas restritas.
 * 1) valida o token de sessão do Clerk (enviado em "Authorization: Bearer ...");
 * 2) busca o usuário no Clerk e confere se publicMetadata.role está entre os papéis permitidos.
 *
 * Retorna { ok: true, userId, usuario, papel } ou { ok: false, status, erro }.
 */
export async function exigirPapel(req, permitidos) {
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
    const papel = usuario.publicMetadata?.role;
    if (typeof papel !== 'string' || !permitidos.includes(papel)) {
      return { ok: false, status: 403, erro: 'Esta conta não tem permissão para esta ação.' };
    }

    // Nome de USUÁRIO do Clerk: é a identidade de verdade (não muda e não aparece no site).
    // O nome de exibição vem da tabela "perfis" (lib/perfil.js) e começa igual a este.
    const nomeUsuario =
      usuario.username ||
      [usuario.firstName, usuario.lastName].filter(Boolean).join(' ') ||
      'Equipe';
    return { ok: true, userId, usuario: nomeUsuario, papel };
  } catch (erro) {
    console.error('Falha ao validar sessão:', erro?.name || 'erro');
    return { ok: false, status: 500, erro: 'Não foi possível validar a sessão agora.' };
  }
}

export const exigirJornalista = (req) => exigirPapel(req, [JORNALISTA]);
export const exigirDiretoria = (req) => exigirPapel(req, [DIRETORIA]);
// Qualquer pessoa da equipe (jornalista ou diretoria): login e perfil
export const exigirEquipe = (req) => exigirPapel(req, [JORNALISTA, DIRETORIA]);
