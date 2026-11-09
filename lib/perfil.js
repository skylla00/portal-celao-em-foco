// Perfil do jornalista (nome de exibição, apresentação e foto).
// O nome de USUÁRIO (do Clerk) é a identidade de verdade e nunca muda aqui:
// o perfil fica numa tabela própria, ligada ao id do usuário no Clerk.

/**
 * Devolve { nome, bio, foto } do jornalista.
 * Sem perfil salvo, o nome de exibição começa igual ao nome de usuário.
 * Se o banco falhar (ex.: tabela ainda não criada), usa só os dados do Clerk,
 * para o login nunca quebrar por causa do perfil.
 */
export async function obterPerfil(sql, auth) {
  const padrao = { nome: auth.usuario, bio: '', foto: null };
  try {
    const linhas = await sql`
      SELECT nome_exibicao, bio, foto FROM perfis WHERE autor_id = ${auth.userId} LIMIT 1`;
    const p = linhas[0];
    if (!p) return padrao;
    return {
      nome: p.nome_exibicao || padrao.nome,
      bio: p.bio || '',
      foto: p.foto || null, // só a foto enviada pelo site (guardada no Blob)
    };
  } catch (erro) {
    console.error('Falha ao ler perfil:', erro?.name || 'erro');
    return padrao;
  }
}
