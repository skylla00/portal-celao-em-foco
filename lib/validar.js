// Validação dos dados enviados ao servidor. Roda SEMPRE no servidor.
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
  conteudo: 60000,
  // Cada imagem tem teto próprio. A Vercel aceita no máximo ~4,5 MB por requisição,
  // e uma postagem pode levar duas imagens (capa + final), então: 2 x 2.000.000 < 4,5 MB.
  imagemBase64: 2_000_000, // caracteres do data URI (~1,5 MB de imagem)
  imagemBytes: 1_600_000,
  fotoPerfilBase64: 600_000,
  fotoPerfilBytes: 420_000,
  nomeExibicao: 60,
  bio: 280,
  aviso: 2000, // caracteres do texto de um aviso do Mural
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
 * Valida uma imagem enviada como data URI.
 * Retorna { imagem: null } (campo ausente), { erro } ou { imagem: { tipo, extensao, buffer } }.
 */
function validarImagem(valor, { maxChars, maxBytes, rotulo }) {
  if (valor === undefined || valor === null || valor === '') return { imagem: null };
  if (typeof valor !== 'string') return { erro: `${rotulo} inválida.` };
  if (valor.length > maxChars) return { erro: `${rotulo} é grande demais.` };

  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(valor);
  if (!m) return { erro: `Formato de imagem não permitido em: ${rotulo}. Use JPG, PNG ou WebP.` };

  const buffer = Buffer.from(m[2], 'base64');
  if (buffer.length === 0 || buffer.length > maxBytes) {
    return { erro: `${rotulo} é grande demais.` };
  }
  const real = tipoReal(buffer);
  if (!real || real !== m[1]) {
    return { erro: `O arquivo enviado em "${rotulo}" não é uma imagem JPG, PNG ou WebP válida.` };
  }
  return { imagem: { tipo: real, extensao: TIPOS_IMAGEM[real], buffer } };
}

/**
 * Valida o corpo do POST de uma postagem.
 * Retorna { erro } ou { dados: { titulo, conteudo, categoria, imagem, imagemFinal } }
 * (imagem e imagemFinal: null ou { tipo, extensao, buffer }).
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

  const capa = validarImagem(corpo.imagem, {
    maxChars: LIMITES.imagemBase64,
    maxBytes: LIMITES.imagemBytes,
    rotulo: 'Imagem de resumo',
  });
  if (capa.erro) return { erro: capa.erro };

  const final = validarImagem(corpo.imagemFinal, {
    maxChars: LIMITES.imagemBase64,
    maxBytes: LIMITES.imagemBytes,
    rotulo: 'Imagem do final da matéria',
  });
  if (final.erro) return { erro: final.erro };

  return {
    dados: {
      titulo,
      conteudo,
      categoria: corpo.categoria,
      imagem: capa.imagem,
      imagemFinal: final.imagem,
    },
  };
}

/**
 * Valida o corpo do POST de um aviso do Mural: só texto puro (com emojis) e/ou UMA imagem.
 * Retorna { erro } ou { dados: { texto, imagem, largura, altura } }.
 * largura/altura vêm do navegador e só servem para reservar o espaço da imagem na tela.
 */
export function validarAviso(corpo) {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
    return { erro: 'Corpo da requisição inválido.' };
  }

  let texto = '';
  if (corpo.texto !== undefined && corpo.texto !== null) {
    if (typeof corpo.texto !== 'string') return { erro: 'Texto do aviso inválido.' };
    texto = limpar(corpo.texto)
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if ([...texto].length > LIMITES.aviso) {
      return { erro: `O aviso pode ter no máximo ${LIMITES.aviso} caracteres.` };
    }
  }

  const foto = validarImagem(corpo.imagem, {
    maxChars: LIMITES.imagemBase64,
    maxBytes: LIMITES.imagemBytes,
    rotulo: 'Imagem do aviso',
  });
  if (foto.erro) return { erro: foto.erro };

  if (!texto && !foto.imagem) return { erro: 'Escreva o aviso ou anexe uma imagem.' };

  const dimensao = (v) => (Number.isInteger(v) && v >= 1 && v <= 10000 ? v : null);
  const largura = foto.imagem ? dimensao(corpo.largura) : null;
  const altura = foto.imagem ? dimensao(corpo.altura) : null;

  return {
    dados: {
      texto,
      imagem: foto.imagem,
      largura: largura && altura ? largura : null,
      altura: largura && altura ? altura : null,
    },
  };
}

/**
 * Valida o corpo do PUT do perfil do jornalista.
 * - nome: qualquer texto (maiúsculas, acentos, espaços), 1 a 60 caracteres.
 * - bio: até 280 caracteres (pode ficar vazia).
 * - foto: data URI (troca) | undefined (mantém).  removerFoto: true apaga a foto.
 */
export function validarPerfil(corpo) {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
    return { erro: 'Corpo da requisição inválido.' };
  }

  if (typeof corpo.nome !== 'string') return { erro: 'Informe o nome de exibição.' };
  const nome = limpar(corpo.nome).replace(/\s+/g, ' ').trim();
  if (!nome) return { erro: 'O nome de exibição não pode ficar vazio.' };
  if (nome.length > LIMITES.nomeExibicao) {
    return { erro: `O nome pode ter no máximo ${LIMITES.nomeExibicao} caracteres.` };
  }

  let bio = '';
  if (corpo.bio !== undefined && corpo.bio !== null) {
    if (typeof corpo.bio !== 'string') return { erro: 'Texto de apresentação inválido.' };
    bio = limpar(corpo.bio).replace(/\r\n?/g, '\n').trim();
    if (bio.length > LIMITES.bio) {
      return { erro: `A apresentação pode ter no máximo ${LIMITES.bio} caracteres.` };
    }
  }

  const foto = validarImagem(corpo.foto, {
    maxChars: LIMITES.fotoPerfilBase64,
    maxBytes: LIMITES.fotoPerfilBytes,
    rotulo: 'Foto de perfil',
  });
  if (foto.erro) return { erro: foto.erro };

  return { dados: { nome, bio, foto: foto.imagem, removerFoto: corpo.removerFoto === true } };
}
