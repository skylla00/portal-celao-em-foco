import { neon } from '@neondatabase/serverless';

// Cria a conexão HTTP com o Neon. A DATABASE_URL vem das variáveis de ambiente da Vercel.
export function conectar() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL não configurada');
  return neon(url);
}
