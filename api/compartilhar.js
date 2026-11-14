import { conectar } from '../lib/db.js';
import { metodoNaoPermitido } from '../lib/http.js';
import { CATEGORIAS } from '../lib/validar.js';

// GET /p/123  (a Vercel reescreve para /api/compartilhar?id=123 — veja o vercel.json)
//
// Devolve uma página mínima com as tags Open Graph da matéria (título, descrição e capa).
// É isso que WhatsApp, Instagram, Facebook, X etc. leem para montar a prévia do link.
// Os robôs dessas redes não executam JavaScript e ignoram o "#", por isso o site normal
// (/#post-123) não serve para prévia: cada matéria precisa de um endereço próprio.
// Quem é pessoa de verdade é levada na hora para o site (/#post-123).
// Só LÊ o banco: não grava nada e funciona para matérias antigas e novas.

const NOME_SITE = 'Portal Celao em Foco';
const DESCRICAO_PADRAO = 'Nossa escola, nossas vozes: Por uma educação antirracista';
const BANNER_PADRAO = '/banner-portal-celao-em-foco.png';

const ehBlob = (url) => typeof url === 'string' && /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i.test(url);

// Todo texto que vai para dentro do HTML passa por aqui (título e texto vêm de pessoas)
const escapar = (texto) =>
  String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// Endereço do próprio site (para montar links completos, que as redes exigem)
function enderecoBase(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (proto !== 'https' && proto !== 'http') return 'https://localhost';
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host)) return 'https://localhost';
  return `${proto}://${host}`;
}

// Tira a marcação do texto e pega o começo, para servir de descrição da prévia
function resumo(conteudo, limite = 160) {
  const limpo = String(conteudo || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // imagens
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links: fica só o texto
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '') // títulos, citações e listas
    .replace(/^\s*---+\s*$/gm, ' ')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (limpo.length <= limite) return limpo;
  return `${limpo.slice(0, limite).replace(/\s+\S*$/, '')}…`;
}

function pagina({ base, titulo, descricao, imagem, larguraImagem, alturaImagem, url, destino, publicadoEm }) {
  const t = escapar(titulo);
  const d = escapar(descricao);
  const meta = [
    `<meta property="og:site_name" content="${escapar(NOME_SITE)}">`,
    `<meta property="og:locale" content="pt_BR">`,
    `<meta property="og:type" content="${publicadoEm ? 'article' : 'website'}">`,
    `<meta property="og:title" content="${t}">`,
    `<meta property="og:description" content="${d}">`,
    `<meta property="og:url" content="${escapar(url)}">`,
    `<meta property="og:image" content="${escapar(imagem)}">`,
    larguraImagem ? `<meta property="og:image:width" content="${larguraImagem}">` : '',
    alturaImagem ? `<meta property="og:image:height" content="${alturaImagem}">` : '',
    publicadoEm ? `<meta property="article:published_time" content="${escapar(publicadoEm)}">` : '',
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${t}">`,
    `<meta name="twitter:description" content="${d}">`,
    `<meta name="twitter:image" content="${escapar(imagem)}">`,
  ]
    .filter(Boolean)
    .join('\n  ');

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${t} — ${escapar(NOME_SITE)}</title>
  <meta name="description" content="${d}">
  <link rel="canonical" href="${escapar(url)}">
  ${meta}
  <meta http-equiv="refresh" content="0; url=${escapar(destino)}">
  <script>location.replace(${JSON.stringify(destino).replace(/</g, '\\u003c')});</script>
</head>
<body>
  <p><a href="${escapar(destino)}">Abrir no ${escapar(NOME_SITE)}</a></p>
</body>
</html>`;
}

function enviar(res, status, html, cache) {
  res.status(status);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', cache);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(html);
}

// Matéria que não existe (ou foi apagada): prévia do próprio portal e volta para o início
function naoEncontrada(res, base) {
  const html = pagina({
    base,
    titulo: NOME_SITE,
    descricao: DESCRICAO_PADRAO,
    imagem: `${base}${BANNER_PADRAO}`,
    url: `${base}/`,
    destino: '/',
  });
  return enviar(res, 404, html, 'no-store');
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return metodoNaoPermitido(res, ['GET', 'HEAD']);

  const base = enderecoBase(req);
  const id = String(req.query?.id ?? '');
  if (!/^\d{1,18}$/.test(id)) return naoEncontrada(res, base);

  try {
    const sql = conectar();
    const linhas = await sql`
      SELECT titulo, conteudo, categoria, imagem, imagem_final, criado_em
      FROM postagens
      WHERE id = ${id}`;
    const p = linhas[0];
    // mesmas regras da listagem do site: matéria sem título/texto ou de categoria que não existe mais não aparece
    if (!p || !p.titulo?.trim() || !p.conteudo?.trim() || !CATEGORIAS.includes(p.categoria)) {
      return naoEncontrada(res, base);
    }

    // capa (16:9, 1280x720) → imagem do final da matéria → banner do portal
    const capa = ehBlob(p.imagem);
    const final = !capa && ehBlob(p.imagem_final);
    const imagem = capa ? p.imagem : final ? p.imagem_final : `${base}${BANNER_PADRAO}`;

    const html = pagina({
      base,
      titulo: p.titulo.trim(),
      descricao: resumo(p.conteudo) || DESCRICAO_PADRAO,
      imagem,
      larguraImagem: capa ? 1280 : null,
      alturaImagem: capa ? 720 : null,
      url: `${base}/p/${id}`,
      destino: `/#post-${id}`,
      publicadoEm: new Date(p.criado_em).toISOString(),
    });
    // 5 min de cache na Vercel: aguenta uma matéria compartilhada por muita gente sem sobrecarregar o banco
    return enviar(res, 200, html, 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600');
  } catch (e) {
    console.error('Falha ao montar a prévia de compartilhamento:', e?.name || 'erro');
    // Se o banco falhar, ainda entrega uma página que leva a pessoa à matéria no site
    const html = pagina({
      base,
      titulo: NOME_SITE,
      descricao: DESCRICAO_PADRAO,
      imagem: `${base}${BANNER_PADRAO}`,
      url: `${base}/p/${id}`,
      destino: `/#post-${id}`,
    });
    return enviar(res, 500, html, 'no-store');
  }
}