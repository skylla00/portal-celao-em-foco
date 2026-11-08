// Funções pequenas para as rotas da API (handlers clássicos da Vercel: (req, res)).

export function responder(res, status, dados) {
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(JSON.stringify(dados));
}

export function metodoNaoPermitido(res, permitidos) {
  res.setHeader('Allow', permitidos.join(', '));
  responder(res, 405, { erro: 'Método não permitido.' });
}

// A Vercel já converte JSON em objeto (req.body). Aqui só garantimos o formato.
export function lerJson(req) {
  const tipo = String(req.headers['content-type'] || '');
  if (!tipo.toLowerCase().startsWith('application/json')) return null;
  let corpo = req.body;
  if (Buffer.isBuffer(corpo)) corpo = corpo.toString('utf8');
  if (typeof corpo === 'string') {
    try {
      corpo = JSON.parse(corpo);
    } catch {
      return null;
    }
  }
  return corpo && typeof corpo === 'object' ? corpo : null;
}

// O Clerk espera um objeto Request padrão (Fetch API). Montamos um só com os cabeçalhos.
export function paraRequestPadrao(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost')
    .split(',')[0]
    .trim();
  const ignorar = new Set(['content-length', 'transfer-encoding', 'connection', 'expect', 'upgrade']);
  const headers = new Headers();
  for (const [nome, valor] of Object.entries(req.headers)) {
    if (valor === undefined || ignorar.has(nome)) continue;
    if (Array.isArray(valor)) valor.forEach((v) => headers.append(nome, v));
    else headers.set(nome, valor);
  }
  return new Request(`${proto}://${host}${req.url}`, { method: req.method, headers });
}
