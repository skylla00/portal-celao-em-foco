// Validação dos dados de uma postagem. Roda SEMPRE no servidor.
// (O frontend também valida, mas só para dar resposta rápida ao usuário.)

export const CATEGORIAS = [
  'esportes',
  'noticias',
  'entrevistas',
  'resenha-critica',
  'opiniao',
  'artes',
];

export const LIMITES = {
  titulo: 140,
  conteudo: 20000,
  imagemBase64: 4_000_000, // caracteres do data URI (~3 MB de imagem)
  imagemBytes: 3 * 1024 * 1024,
};

const TIPOS_IMAGEM = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// Confere os primeiros bytes do arquivo (não confia só no tipo declarado)
function tipoReal(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf.length > 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (
    buf.length > 12 &&
    buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buf.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

// Remove caracteres de controle (menos quebra de linha e tab)
function limpar(texto) {
  return texto.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

/**
 * Valida o corpo do POST.
 * Retorna { erro } ou { dados: { titulo, conteudo, categoria, imagem: null | { tipo, extensao, buffer } } }
 */
export function validarPostagem(corpo) {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
    return { erro: 'Corpo da requisição inválido.' };
  }

  if (typeof corpo.titulo !== 'string') return { erro: 'Informe o título.' };
  const titulo = limpar(corpo.titulo).replace(/\s+/g, ' ').trim();
  if (!titulo) return { erro: 'O título não pode ficar vazio.' };
  if (titulo.length > LIMITES.titulo) {
    return { erro: `O título pode ter no máximo ${LIMITES.titulo} caracteres.` };
  }

  if (typeof corpo.conteudo !== 'string') return { erro: 'Informe o conteúdo.' };
  const conteudo = limpar(corpo.conteudo).replace(/\r\n?/g, '\n').trim();
  if (!conteudo) return { erro: 'O conteúdo não pode ficar vazio.' };
  if (conteudo.length > LIMITES.conteudo) {
    return { erro: `O conteúdo pode ter no máximo ${LIMITES.conteudo} caracteres.` };
  }

  if (typeof corpo.categoria !== 'string' || !CATEGORIAS.includes(corpo.categoria)) {
    return { erro: 'Categoria inválida.' };
  }

  let imagem = null;
  if (corpo.imagem !== undefined && corpo.imagem !== null && corpo.imagem !== '') {
    if (typeof corpo.imagem !== 'string') return { erro: 'Imagem inválida.' };
    if (corpo.imagem.length > LIMITES.imagemBase64) {
      return { erro: 'A imagem é grande demais (máximo de cerca de 3 MB).' };
    }
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(corpo.imagem);
    if (!m) return { erro: 'Formato de imagem não permitido. Use JPG, PNG ou WebP.' };

    const buffer = Buffer.from(m[2], 'base64');
    if (buffer.length === 0 || buffer.length > LIMITES.imagemBytes) {
      return { erro: 'A imagem é grande demais (máximo de 3 MB).' };
    }
    const real = tipoReal(buffer);
    if (!real || real !== m[1]) {
      return { erro: 'O arquivo enviado não é uma imagem JPG, PNG ou WebP válida.' };
    }
    imagem = { tipo: real, extensao: TIPOS_IMAGEM[real], buffer };
  }

  return { dados: { titulo, conteudo, categoria: corpo.categoria, imagem } };
}
