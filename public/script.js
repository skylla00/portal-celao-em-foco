/* ==========================================================
   Portal Celao em Foco — script.js
   - Lê as postagens da API e monta os cartões (usa os <template> do index.html).
   - Abre uma matéria na página de leitura.
   - Rotas por hash: #login, #jornalista, #editor e #mural (diretoria).
   - Login pelo Clerk. A SEGURANÇA REAL fica na API (servidor): aqui o JS só
     decide o que mostrar. Não há senha nem usuário guardados neste arquivo.
   ========================================================== */
'use strict';

(() => {
  document.body.classList.add('js');

  const CATEGORIAS = {
    esportes: 'Esportes',
    noticias: 'Notícias',
    entrevistas: 'Entrevistas',
    'resenha-critica': 'Resenha Crítica',
    opiniao: 'Opinião',
  };
  const DICA = 'celao-jornalista'; // só uma dica de interface ("tentar restaurar a sessão"). NÃO autoriza nada.

  const estado = {
    postagens: [],
    erroLista: false,
    jornalista: null, // { papel, nome, bio, foto } da equipe logada — preenchido só depois que o SERVIDOR confirma o papel
    avisos: [], // avisos do Mural
    erroAvisos: false,
    composer: null, // formulário de novo aviso (criado uma vez e reaproveitado, para não perder o texto digitado)
    imagemAviso: null, // { dados, largura, altura } da imagem anexada ao novo aviso
    artes: [],
    erroArtes: false,
    imagemArte: null,
    enviandoArte: false,
    visitante: false, // jornalista olhando o site "como visitante"
    categoriaNova: 'noticias',
    leituraCategoria: 'noticias',
    imagem: null, // data URI da imagem de resumo já ajustada (16:9)
    imagemFinal: null, // data URI da imagem do final da matéria (proporção original)
    fotoNova: null, // foto de perfil escolhida e ainda não salva (data URI)
    removerFoto: false,
    excluindo: null, // { tipo: 'postagem' | 'aviso' | 'arte', item } que está na janela de confirmação
    clerkPromessa: null,
    pronto: null, // promessa: postagens carregadas
    sessaoPronta: null, // promessa: tentativa de restaurar sessão terminou
  };

  const $ = (seletor, raiz = document) => raiz.querySelector(seletor);
  const campo = (raiz, nome) => raiz.querySelector(`[data-campo="${nome}"]`);
  const modoEdicao = () => Boolean(estado.jornalista) && !estado.visitante;
  // Cada papel enxerga só o que é dele (e a API confere de novo no servidor):
  const ehJornalista = () => modoEdicao() && estado.jornalista.papel === 'jornalista'; // matérias
  const ehDiretoria = () => modoEdicao() && estado.jornalista.papel === 'diretoria'; // avisos do Mural
  const rotaInicial = () => (estado.jornalista?.papel === 'diretoria' ? '#mural' : '#noticias');

  /* ---------- utilidades ---------- */
  class ErroApi extends Error {
    constructor(status, mensagem) {
      super(mensagem);
      this.status = status;
    }
  }

  function lembrar(valor) {
    try {
      if (valor) localStorage.setItem(DICA, '1');
      else localStorage.removeItem(DICA);
    } catch {
      /* armazenamento indisponível: tudo bem */
    }
  }
  function temDica() {
    try {
      return localStorage.getItem(DICA) === '1';
    } catch {
      return false;
    }
  }

  const formatarData = (iso) =>
    new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

  // Hora do aviso, como no WhatsApp: "14:32", "ontem 14:32" ou "09/11 14:32" (com o ano, se for de outro ano)
  function formatarHoraAviso(iso) {
    const d = new Date(iso);
    const agora = new Date();
    const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === agora.toDateString()) return hora;
    const ontem = new Date(agora);
    ontem.setDate(agora.getDate() - 1);
    if (d.toDateString() === ontem.toDateString()) return `ontem ${hora}`;
    const opcoes = { day: '2-digit', month: '2-digit' };
    if (d.getFullYear() !== agora.getFullYear()) opcoes.year = 'numeric';
    return `${d.toLocaleDateString('pt-BR', opcoes)} ${hora}`;
  }

  function dimensoesDaImagem(dataUri) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ largura: img.naturalWidth, altura: img.naturalHeight });
      img.onerror = () => reject(new Error('Não foi possível usar esta imagem.'));
      img.src = dataUri;
    });
  }

  function definirImagem(img, url, alt) {
    if (!img) return;
    if (url) {
      img.src = url;
      img.alt = alt || '';
      img.hidden = false;
    } else {
      img.removeAttribute('src');
      img.alt = '';
    }
  }

  /* ---------- Leitor de Markdown (feito à mão, SEM biblioteca e SEM innerHTML) ----------
     Tudo vira nós do DOM criados por createElement/textContent, então HTML escrito no
     texto aparece como texto e nunca é executado.
     Entende: # e ## (subtítulo), ### e #### (subtítulo menor), > citação, listas (- * + e 1.),
     --- (linha), **negrito**, *itálico*, `código`, [texto](https://link) e ![alt](https://imagem).
     Links aceitam http/https; imagens só https. */
  const URL_LINK = /^https?:\/\/\S+$/i;
  const URL_IMAGEM = /^https:\/\/\S+$/i;
  // grupos: 1 escape | 2-3 imagem | 4-5 link | 6 **negrito** | 7 __negrito__ | 8 *itálico* | 9 _itálico_ | 10 `código`
  const INLINE =
    /\\([\\`*_[\]()!#>-])|!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)|\[([^\]]+)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)|\*\*([^\s*](?:[^*]*?[^\s*])?)\*\*|__([^\s_](?:[^_]*?[^\s_])?)__|\*([^\s*](?:[^*]*?[^\s*])?)\*|_([^\s_](?:[^_]*?[^\s_])?)_(?!\w)|`([^`]+)`/g;

  function criarImagemTexto(alt, url) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = alt;
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    return img;
  }

  function inline(alvo, texto, simples = false) {
    let fim = 0;
    let m;
    const re = new RegExp(INLINE.source, 'g'); // um objeto novo por chamada (a função se chama dentro dela mesma)
    while ((m = re.exec(texto))) {
      if (m.index > fim) alvo.append(document.createTextNode(texto.slice(fim, m.index)));
      fim = m.index + m[0].length;

      if (m[1] !== undefined) {
        alvo.append(document.createTextNode(m[1]));
      } else if (m[3] !== undefined) {
        if (!simples && URL_IMAGEM.test(m[3])) alvo.append(criarImagemTexto(m[2], m[3]));
        else alvo.append(document.createTextNode(m[0]));
      } else if (m[5] !== undefined) {
        if (!simples && URL_LINK.test(m[5])) {
          const a = document.createElement('a');
          a.href = m[5];
          a.target = '_blank';
          a.rel = 'noopener noreferrer nofollow';
          inline(a, m[4], true);
          alvo.append(a);
        } else {
          alvo.append(document.createTextNode(m[0]));
        }
      } else if (m[6] !== undefined || m[7] !== undefined) {
        const el = document.createElement('strong');
        inline(el, m[6] ?? m[7], simples);
        alvo.append(el);
      } else if (m[8] !== undefined || m[9] !== undefined) {
        // "_" no meio de uma palavra (snake_case) não vira itálico
        if (m[9] !== undefined && m.index > 0 && /\w/.test(texto[m.index - 1])) {
          alvo.append(document.createTextNode(m[0]));
        } else {
          const el = document.createElement('em');
          inline(el, m[8] ?? m[9], simples);
          alvo.append(el);
        }
      } else if (m[10] !== undefined) {
        const el = document.createElement('code');
        el.textContent = m[10];
        alvo.append(el);
      }
    }
    if (fim < texto.length) alvo.append(document.createTextNode(texto.slice(fim)));
  }

  const RE_TITULO = /^(#{1,4})\s+(.+?)\s*$/;
  const RE_LINHA = /^\s*([-*_])(\s*\1){2,}\s*$/;
  const RE_LISTA = /^\s*[-*+]\s+(.*)$/;
  const RE_NUMERADA = /^\s*\d+[.)]\s+(.*)$/;
  const RE_IMAGEM_SOZINHA = /^\s*!\[([^\]]*)\]\(\s*(https:\/\/[^)\s]+)(?:\s+"[^"]*")?\s*\)\s*$/;
  const inicioDeBloco = (l) =>
    RE_TITULO.test(l) || RE_LINHA.test(l) || l.startsWith('>') || RE_LISTA.test(l) || RE_NUMERADA.test(l) || RE_IMAGEM_SOZINHA.test(l);

  function montarTexto(alvo, texto) {
    alvo.replaceChildren();
    const linhas = String(texto).replace(/\r\n?/g, '\n').split('\n');
    let i = 0;
    while (i < linhas.length) {
      const linha = linhas[i];
      if (!linha.trim()) {
        i++;
        continue;
      }
      let m;

      if ((m = RE_TITULO.exec(linha))) {
        const el = document.createElement(m[1].length <= 2 ? 'h3' : 'h4');
        inline(el, m[2]);
        alvo.append(el);
        i++;
      } else if (RE_LINHA.test(linha)) {
        alvo.append(document.createElement('hr'));
        i++;
      } else if (linha.startsWith('>')) {
        const el = document.createElement('blockquote');
        const partes = [];
        while (i < linhas.length && linhas[i].startsWith('>')) partes.push(linhas[i++].replace(/^>\s?/, ''));
        inline(el, partes.join(' '));
        alvo.append(el);
      } else if (RE_LISTA.test(linha) || RE_NUMERADA.test(linha)) {
        const numerada = RE_NUMERADA.test(linha);
        const regra = numerada ? RE_NUMERADA : RE_LISTA;
        const lista = document.createElement(numerada ? 'ol' : 'ul');
        while (i < linhas.length && (m = regra.exec(linhas[i]))) {
          const li = document.createElement('li');
          inline(li, m[1]);
          lista.append(li);
          i++;
        }
        alvo.append(lista);
      } else if ((m = RE_IMAGEM_SOZINHA.exec(linha))) {
        const fig = document.createElement('figure');
        fig.append(criarImagemTexto(m[1], m[2]));
        if (m[1].trim()) {
          const legenda = document.createElement('figcaption');
          legenda.textContent = m[1];
          fig.append(legenda);
        }
        alvo.append(fig);
        i++;
      } else {
        const el = document.createElement('p');
        let primeira = true;
        while (i < linhas.length && linhas[i].trim() && (primeira || !inicioDeBloco(linhas[i]))) {
          if (!primeira) el.append(document.createElement('br'));
          inline(el, linhas[i].trim());
          primeira = false;
          i++;
        }
        alvo.append(el);
      }
    }
  }

  /* ---------- API ---------- */
  async function api(caminho, opcoes = {}, autenticado = false) {
    const headers = { Accept: 'application/json', ...(opcoes.headers || {}) };
    if (autenticado) {
      const clerk = await carregarClerk();
      const token = clerk.session ? await clerk.session.getToken() : null;
      if (!token) throw new ErroApi(401, 'Sua sessão expirou. Entre novamente.');
      headers.Authorization = `Bearer ${token}`;
    }
    const resposta = await fetch(caminho, { ...opcoes, headers });
    let corpo = null;
    try {
      corpo = await resposta.json();
    } catch {
      /* resposta sem JSON */
    }
    if (!resposta.ok) throw new ErroApi(resposta.status, corpo?.erro || 'Algo deu errado. Tente novamente.');
    return corpo;
  }

  /* ---------- Clerk (carrega só quando alguém precisa entrar) ---------- */
  function hostDoClerk(chave) {
    // A chave pública é "pk_test_" ou "pk_live_" + base64("dominio$")
    return atob(chave.split('_').slice(2).join('_')).replace(/\$$/, '');
  }

  function carregarClerk() {
    if (estado.clerkPromessa) return estado.clerkPromessa;
    estado.clerkPromessa = (async () => {
      const { clerkPublishableKey: chave } = await api('/api/config');
      if (!chave) throw new Error('config');
      if (!window.Clerk) {
        await new Promise((ok, falha) => {
          const s = document.createElement('script');
          s.async = true;
          s.crossOrigin = 'anonymous';
          s.dataset.clerkPublishableKey = chave;
          s.src = `https://${hostDoClerk(chave)}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`;
          s.onload = ok;
          s.onerror = () => falha(new Error('script'));
          document.head.append(s);
        });
      }
      await window.Clerk.load();
      return window.Clerk;
    })().catch((erro) => {
      estado.clerkPromessa = null;
      throw erro;
    });
    return estado.clerkPromessa;
  }

  // Pergunta ao SERVIDOR se esta sessão é de um jornalista.
  async function verificarJornalista() {
    const dados = await api('/api/sessao', {}, true);
    estado.jornalista = { papel: dados.papel, nome: dados.nome, bio: dados.bio || '', foto: dados.foto || null };
    lembrar(true);
    atualizarBarra();
  }

  async function restaurarSessao() {
    const rotaSecreta = /^#(login|jornalista|editor|mural)/.test(location.hash);
    if (!temDica() && !rotaSecreta) return;
    try {
      const clerk = await carregarClerk();
      if (clerk.session) await verificarJornalista();
      else lembrar(false);
    } catch (erro) {
      if (erro.status === 401 || erro.status === 403) lembrar(false);
    }
    renderizar();
    if (ehDiretoria() && location.hash === '#mural') mostrarSite('mural');
  }

  /* ---------- Postagens públicas ---------- */
  async function carregarPostagens() {
    try {
      const dados = await api('/api/postagens');
      estado.postagens = Array.isArray(dados.postagens) ? dados.postagens : [];
      estado.erroLista = false;
    } catch {
      estado.erroLista = true;
    }
    renderizar();
  }

  function criarCartao(modelo, p) {
    const no = modelo.content.cloneNode(true);
    no.querySelector('article').dataset.id = p.id;
    $('.btn-excluir', no).hidden = !ehJornalista(); // lixeira: só para jornalista
    campo(no, 'link').href = `#post-${p.id}`;
    definirImagem(campo(no, 'banner'), p.imagem, `Banner da matéria: ${p.titulo}`);
    campo(no, 'titulo').textContent = p.titulo;
    campo(no, 'categoria').textContent = CATEGORIAS[p.categoria] || '';
    campo(no, 'nome-jornalista').textContent = p.autor;
    campo(no, 'data-publicacao').textContent = formatarData(p.criadoEm);
    const foto = campo(no, 'foto-jornalista');
    if (p.autorFoto) definirImagem(foto, p.autorFoto, `Foto de ${p.autor}`);
    else foto.hidden = true;
    return no;
  }

  /* ---------- Avisos do Mural ---------- */
  async function carregarAvisos() {
    try {
      const dados = await api('/api/avisos');
      estado.avisos = Array.isArray(dados.avisos) ? dados.avisos : [];
      estado.erroAvisos = false;
    } catch {
      estado.erroAvisos = true;
    }
    renderizar();
  }

  async function carregarArtes() {
    try {
      const dados = await api('/api/artes');
      estado.artes = Array.isArray(dados.artes) ? dados.artes : [];
      estado.erroArtes = false;
    } catch {
      estado.erroArtes = true;
    }
    renderizar();
  }

  function criarArte(modelo, arte) {
    const no = modelo.content.cloneNode(true);
    const artigo = no.querySelector('article');
    artigo.dataset.id = arte.id;
    $('.btn-excluir', no).hidden = !ehJornalista();
    const imagem = campo(no, 'imagem-arte');
    if (arte.imagemLargura && arte.imagemAltura) {
      imagem.width = arte.imagemLargura;
      imagem.height = arte.imagemAltura;
    }
    definirImagem(imagem, arte.imagem, arte.legenda || `Arte publicada por ${arte.autor}`);
    const legenda = campo(no, 'legenda-arte');
    legenda.textContent = arte.legenda;
    legenda.hidden = !arte.legenda;
    campo(no, 'autor-arte').textContent = arte.autor;
    const data = campo(no, 'data-arte');
    data.textContent = formatarData(arte.criadoEm);
    data.dateTime = arte.criadoEm;
    return no;
  }

  function renderizarArtes() {
    const lista = $('#lista-artes');
    lista.replaceChildren();
    $('#btn-enviar-arte').hidden = !ehJornalista();
    const modelo = $('#modelo-arte');
    for (const arte of estado.artes) lista.append(criarArte(modelo, arte));

    const vazio = lista.nextElementSibling;
    if (vazio?.classList.contains('vazio')) {
      vazio.dataset.padrao ??= vazio.textContent;
      vazio.textContent = estado.erroArtes
        ? 'Não foi possível carregar as artes agora. Tente novamente mais tarde.'
        : vazio.dataset.padrao;
    }
  }

  function iniciarEnvioArte() {
    const dialogo = $('#dialogo-arte');
    const form = $('#form-arte');
    const previa = $('.arte-previa', form);
    const imgPrevia = $('img', previa);
    const mensagem = campo(form, 'mensagem-arte');
    const botaoPublicar = campo(form, 'publicar-arte');
    const botaoCancelar = $('#btn-cancelar-arte');
    const avisar = (texto, tipo = 'erro') => {
      mensagem.textContent = texto;
      mensagem.className = `mensagem ${tipo}`;
      mensagem.hidden = !texto;
    };
    const limpar = () => {
      estado.imagemArte = null;
      form.reset();
      imgPrevia.removeAttribute('src');
      previa.hidden = true;
      avisar('');
    };

    $('#btn-enviar-arte').addEventListener('click', () => {
      if (!ehJornalista()) return;
      dialogo.showModal();
      form.imagem.focus();
    });
    botaoCancelar.addEventListener('click', () => dialogo.close());
    dialogo.addEventListener('close', limpar);
    dialogo.addEventListener('cancel', (evento) => {
      if (estado.enviandoArte) evento.preventDefault();
    });

    form.imagem.addEventListener('change', async () => {
      const arquivo = form.imagem.files[0];
      if (!arquivo) return;
      avisar('');
      try {
        const dados = await prepararImagemFinal(arquivo);
        const dimensoes = await dimensoesDaImagem(dados);
        estado.imagemArte = { dados, ...dimensoes };
        imgPrevia.src = dados;
        previa.hidden = false;
      } catch (erro) {
        estado.imagemArte = null;
        form.imagem.value = '';
        imgPrevia.removeAttribute('src');
        previa.hidden = true;
        avisar(erro.message || 'Não foi possível usar esta imagem.');
      }
    });

    form.addEventListener('submit', async (evento) => {
      evento.preventDefault();
      if (!estado.imagemArte) return avisar('Escolha a imagem da arte.');

      estado.enviandoArte = true;
      botaoPublicar.disabled = true;
      botaoCancelar.disabled = true;
      botaoPublicar.textContent = 'Publicando…';
      avisar('');
      try {
        const dados = await api(
          '/api/artes',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              legenda: form.legenda.value.trim(),
              imagem: estado.imagemArte.dados,
              largura: estado.imagemArte.largura,
              altura: estado.imagemArte.altura,
            }),
          },
          true,
        );
        estado.artes.unshift(dados.arte);
        renderizar();
        dialogo.close();
      } catch (erro) {
        avisar(
          erro.status === 401
            ? 'Sua sessão expirou. Entre novamente e tente publicar a arte.'
            : erro.message || 'Não foi possível publicar a arte agora.',
        );
      } finally {
        estado.enviandoArte = false;
        botaoPublicar.disabled = false;
        botaoCancelar.disabled = false;
        botaoPublicar.textContent = 'Publicar arte';
      }
    });
  }

  function criarAviso(modelo, a) {
    const no = modelo.content.cloneNode(true);
    const artigo = no.querySelector('article');
    artigo.dataset.id = a.id;
    $('.btn-excluir', no).hidden = !ehDiretoria();
    campo(no, 'autor').textContent = a.autor;
    const foto = campo(no, 'foto');
    const inicial = campo(no, 'inicial');
    if (a.autorFoto) {
      definirImagem(foto, a.autorFoto, `Foto de ${a.autor}`);
    } else {
      foto.hidden = true;
      inicial.textContent = ((a.autor || '').trim()[0] || '?').toUpperCase();
      inicial.hidden = false;
    }
    campo(no, 'texto').textContent = a.texto; // texto puro: nunca interpretado como HTML
    const imagem = campo(no, 'imagem');
    if (a.imagem) {
      if (a.imagemLargura && a.imagemAltura) {
        imagem.width = a.imagemLargura; // reserva o espaço (sem "pulo" quando a imagem carrega)
        imagem.height = a.imagemAltura;
      }
      definirImagem(imagem, a.imagem, 'Imagem do aviso');
    }
    const hora = campo(no, 'hora');
    hora.textContent = formatarHoraAviso(a.criadoEm);
    hora.dateTime = a.criadoEm;
    hora.title = new Date(a.criadoEm).toLocaleString('pt-BR');
    return no;
  }

  // Formulário de novo aviso (conta "diretoria"): criado uma vez e reaproveitado
  function obterComposer() {
    if (estado.composer) return estado.composer;
    const form = $('#modelo-novo-aviso').content.firstElementChild.cloneNode(true);
    const aviso = (texto, tipo = 'erro') => {
      const caixa = campo(form, 'mensagem');
      caixa.textContent = texto;
      caixa.className = `mensagem ${tipo}`;
      caixa.hidden = !texto;
    };
    const previa = campo(form, 'previa');
    const imgPrevia = $('img', previa);
    const remover = $('[data-acao="remover-imagem"]', form);
    const limparImagem = () => {
      estado.imagemAviso = null;
      form.imagem.value = '';
      imgPrevia.removeAttribute('src');
      previa.hidden = true;
      remover.hidden = true;
    };

    form.imagem.addEventListener('change', async () => {
      const arquivo = form.imagem.files[0];
      if (!arquivo) return;
      aviso('');
      try {
        const dados = await prepararImagemFinal(arquivo); // sem formato fixo: mantém a proporção
        const { largura, altura } = await dimensoesDaImagem(dados);
        estado.imagemAviso = { dados, largura, altura };
        imgPrevia.src = dados;
        previa.hidden = false;
        remover.hidden = false;
      } catch (erro) {
        limparImagem();
        aviso(erro.message || 'Não foi possível usar esta imagem.');
      }
    });
    remover.addEventListener('click', limparImagem);

    form.addEventListener('submit', async (evento) => {
      evento.preventDefault();
      const texto = form.texto.value.trim();
      if (!texto && !estado.imagemAviso) return aviso('Escreva o aviso ou anexe uma imagem.');
      const botao = campo(form, 'publicar');
      botao.disabled = true;
      botao.textContent = 'Publicando…';
      aviso('');
      try {
        const img = estado.imagemAviso;
        const dados = await api(
          '/api/avisos',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              texto,
              imagem: img?.dados,
              largura: img?.largura,
              altura: img?.altura,
            }),
          },
          true,
        );
        estado.avisos.unshift(dados.aviso);
        form.texto.value = '';
        limparImagem();
        renderizar();
      } catch (erro) {
        aviso(
          erro.status === 401
            ? 'Sua sessão expirou. Entre de novo pelo endereço de login (em outra aba) e publique outra vez; o texto foi mantido.'
            : erro.message || 'Não foi possível publicar agora.',
        );
      } finally {
        botao.disabled = false;
        botao.textContent = 'Publicar';
      }
    });

    form.limpar = () => {
      form.reset();
      limparImagem();
      aviso('');
    };
    estado.composer = form;
    return form;
  }

  function renderizarAvisos() {
    const lista = $('#lista-mural');
    lista.replaceChildren();
    if (ehDiretoria()) lista.append(obterComposer());
    const modelo = $('#modelo-aviso');
    for (const a of estado.avisos) lista.append(criarAviso(modelo, a));

    const vazio = lista.nextElementSibling;
    if (vazio?.classList.contains('vazio')) {
      vazio.dataset.padrao ??= vazio.textContent;
      vazio.textContent = estado.erroAvisos
        ? 'Não foi possível carregar os avisos agora. Tente novamente mais tarde.'
        : vazio.dataset.padrao;
    }
  }

  function renderizar() {
    $('#mural').hidden = !ehDiretoria();
    renderizarAvisos();
    renderizarArtes();
    const modelo = $('#modelo-cartao-postagem');
    const novo = $('#modelo-nova-postagem');
    for (const slug of Object.keys(CATEGORIAS)) {
      const lista = $(`#lista-${slug}`);
      lista.replaceChildren();

      // Jornalista: o botão "Criar nova postagem" ocupa o lugar de "Nenhuma postagem ainda"
      if (ehJornalista()) {
        const botao = novo.content.cloneNode(true);
        campo(botao, 'novo').dataset.categoria = slug;
        lista.append(botao);
      }
      for (const p of estado.postagens.filter((x) => x.categoria === slug)) {
        lista.append(criarCartao(modelo, p));
      }

      const vazio = lista.nextElementSibling;
      if (vazio?.classList.contains('vazio')) {
        vazio.dataset.padrao ??= vazio.textContent;
        vazio.textContent = estado.erroLista
          ? 'Não foi possível carregar as postagens agora. Tente novamente mais tarde.'
          : vazio.dataset.padrao;
      }
    }
  }

  /* ---------- Leitura de uma matéria ---------- */
  function abrirPostagem(id) {
    const p = estado.postagens.find((x) => x.id === id);
    if (!p) {
      location.replace('#noticias');
      return;
    }
    const leitura = $('#leitura');
    campo(leitura, 'titulo').textContent = p.titulo;
    campo(leitura, 'nome-jornalista').textContent = p.autor;
    campo(leitura, 'data-publicacao').textContent = formatarData(p.criadoEm);
    const foto = campo(leitura, 'foto-jornalista');
    if (p.autorFoto) definirImagem(foto, p.autorFoto, `Foto de ${p.autor}`);
    else foto.hidden = true;
    const bio = campo(leitura, 'bio-jornalista');
    bio.textContent = p.autorBio || '';
    bio.hidden = !p.autorBio;
    const banner = campo(leitura, 'banner');
    banner.hidden = !p.imagem;
    definirImagem(banner, p.imagem, `Banner da matéria: ${p.titulo}`);
    montarTexto(campo(leitura, 'conteudo'), p.conteudo);
    // imagem do final: sempre depois do texto, no tamanho dela
    const figuraFinal = campo(leitura, 'figura-final');
    figuraFinal.hidden = !p.imagemFinal;
    definirImagem(campo(leitura, 'imagem-final'), p.imagemFinal, `Imagem do final da matéria: ${p.titulo}`);

    estado.leituraCategoria = p.categoria;
    leitura.setAttribute('aria-label', p.titulo);
    leitura.hidden = false;
    irParaTopico(leitura);
    marcarAtivo(p.categoria);
    // a leitura começa no topo da matéria (cabeçalho e menu ficam para cima, é só rolar de volta)
    window.scrollTo({ top: Math.max(0, leitura.getBoundingClientRect().top + window.scrollY - 8), behavior: 'instant' });
  }

  /* ---------- Navegação: aba ativa acompanha a rolagem lateral ---------- */
  // A página inteira rola (nada é fixo). O painel só rola para o lado; a altura dele
  // acompanha o tópico aberto, para não sobrar espaço em branco embaixo.
  const painelTopicos = () => $('#painel-topicos');

  function irParaTopico(topico) {
    const painel = painelTopicos();
    const esquerda = topico.getBoundingClientRect().left - painel.getBoundingClientRect().left + painel.scrollLeft;
    painel.scrollTo({ left: esquerda, top: 0, behavior: 'instant' });
  }

  function ajustarAltura() {
    const painel = painelTopicos();
    const leitura = $('#leitura');
    const ativo = $('nav a.ativo');
    const topico = !leitura.hidden ? leitura : ativo ? $(ativo.getAttribute('href')) : $('#mural');
    if (topico && !topico.hidden && topico.offsetHeight) painel.style.height = `${topico.offsetHeight}px`;
  }

  function marcarAtivo(id) {
    const link = $(`nav a[href="#${id}"]`);
    const mudou = !link?.classList.contains('ativo');
    document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('ativo', a === link));
    ajustarAltura();
    if (link && mudou) {
      // só rola o menu para o lado (nunca a página para cima/baixo)
      const lista = link.closest('ul');
      const alvo = link.offsetLeft - (lista.clientWidth - link.offsetWidth) / 2;
      lista.scrollTo({ left: alvo, behavior: 'smooth' });
    }
  }

  function observarTopicos() {
    const raiz = painelTopicos();
    let esperando = false;
    // qual tópico está na tela = posição da rolagem lateral
    raiz.addEventListener(
      'scroll',
      () => {
        if (esperando) return;
        esperando = true;
        requestAnimationFrame(() => {
          esperando = false;
          if (!$('#leitura').hidden) return;
          const lista = [...raiz.querySelectorAll('.topico:not(#leitura):not([hidden])')];
          const i = Math.round(raiz.scrollLeft / raiz.clientWidth);
          const topico = lista[Math.min(Math.max(i, 0), lista.length - 1)];
          if (topico) marcarAtivo(topico.id);
        });
      },
      { passive: true },
    );
    // quando o conteúdo muda de altura (postagens carregando, imagens, tela girando), reajusta
    if ('ResizeObserver' in window) {
      const medidor = new ResizeObserver(ajustarAltura);
      raiz.querySelectorAll('.topico').forEach((t) => medidor.observe(t));
    }
    window.addEventListener('resize', ajustarAltura);
  }

  /* ---------- Telas cheias: login e editor ---------- */
  function telaCheia(qual) {
    document.body.classList.toggle('modo-tela-cheia', Boolean(qual));
    $('#tela-login').hidden = qual !== 'login';
    $('#tela-editor').hidden = qual !== 'editor';
    if (qual !== 'editor') $('#tela-editor').replaceChildren();
  }

  function atualizarBarra() {
    const barra = $('#barra-jornalista');
    barra.hidden = !estado.jornalista;
    barra.setAttribute('aria-label', estado.jornalista?.papel === 'diretoria' ? 'Área da diretoria' : 'Área do jornalista');
    if (estado.jornalista) {
      campo(barra, 'nome-jornalista').textContent = estado.jornalista.nome;
      pintarAvatar(campo(barra, 'foto-perfil'), campo(barra, 'inicial'), estado.jornalista.foto, estado.jornalista.nome);
    } else {
      fecharMenuPerfil();
    }
    $('#btn-visitante').textContent = estado.visitante ? 'Voltar ao modo jornalista' : 'Ver site público';
  }

  /* ---------- Perfil do jornalista (foto + nome + bio) ---------- */
  const inicialDe = (nome) => ((nome || '').trim()[0] || '?').toUpperCase();

  // Mostra a foto; sem foto, mostra a inicial do nome num círculo.
  function pintarAvatar(img, inicial, foto, nome) {
    inicial.textContent = inicialDe(nome);
    if (foto) {
      img.src = foto;
      img.alt = '';
      img.hidden = false;
      inicial.hidden = true;
    } else {
      img.removeAttribute('src');
      img.hidden = true;
      inicial.hidden = false;
    }
  }

  function atualizarPreviaPerfil() {
    const menu = $('#menu-perfil');
    const foto = estado.removerFoto ? null : estado.fotoNova || estado.jornalista?.foto || null;
    pintarAvatar(campo(menu, 'foto-menu'), campo(menu, 'inicial-menu'), foto, $('#perfil-nome').value);
    $('#btn-remover-foto').hidden = !foto;
  }

  function contarBio() {
    const n = $('#perfil-bio').value.length;
    $('#bio-contador').textContent = `${n}/280`;
  }

  function mensagemPerfil(texto, tipo = 'erro') {
    const caixa = $('#perfil-msg');
    caixa.textContent = texto;
    caixa.className = `mensagem ${tipo}`;
    caixa.hidden = !texto;
  }

  function abrirMenuPerfil() {
    if (!estado.jornalista) return;
    estado.fotoNova = null;
    estado.removerFoto = false;
    $('#perfil-nome').value = estado.jornalista.nome;
    $('#perfil-bio').value = estado.jornalista.bio || '';
    $('#arquivo-foto').value = '';
    mensagemPerfil('');
    contarBio();
    atualizarPreviaPerfil();
    $('#menu-perfil').hidden = false;
    $('#btn-perfil').setAttribute('aria-expanded', 'true');
    $('#perfil-nome').focus();
  }

  function fecharMenuPerfil(devolverFoco = false) {
    const menu = $('#menu-perfil');
    if (menu.hidden) return;
    menu.hidden = true;
    $('#btn-perfil').setAttribute('aria-expanded', 'false');
    if (devolverFoco) $('#btn-perfil').focus();
  }

  async function salvarPerfil(evento) {
    evento.preventDefault();
    const nome = $('#perfil-nome').value.replace(/\s+/g, ' ').trim();
    const bio = $('#perfil-bio').value.trim();
    if (!nome) return mensagemPerfil('O nome de exibição não pode ficar vazio.');

    const botao = $('#btn-perfil-salvar');
    botao.disabled = true;
    botao.textContent = 'Salvando…';
    mensagemPerfil('');
    try {
      const dados = await api(
        '/api/perfil',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nome,
            bio,
            foto: estado.fotoNova || undefined,
            removerFoto: estado.removerFoto && !estado.fotoNova,
          }),
        },
        true,
      );
      estado.jornalista = { papel: estado.jornalista.papel, nome: dados.perfil.nome, bio: dados.perfil.bio || '', foto: dados.perfil.foto || null };
      atualizarBarra();
      fecharMenuPerfil(true);
      carregarPostagens(); // as matérias antigas passam a mostrar o novo nome/foto
    } catch (erro) {
      mensagemPerfil(erro.status === 401 ? 'Sua sessão expirou. Entre novamente.' : erro.message || 'Não foi possível salvar o perfil agora.');
    } finally {
      botao.disabled = false;
      botao.textContent = 'Salvar';
    }
  }

  function iniciarPerfil() {
    $('#btn-perfil').addEventListener('click', () => ($('#menu-perfil').hidden ? abrirMenuPerfil() : fecharMenuPerfil(true)));
    $('#btn-perfil-cancelar').addEventListener('click', () => fecharMenuPerfil(true));
    $('#menu-perfil').addEventListener('submit', salvarPerfil);
    $('#btn-foto-perfil').addEventListener('click', () => $('#arquivo-foto').click());
    $('#perfil-nome').addEventListener('input', atualizarPreviaPerfil);
    $('#perfil-bio').addEventListener('input', contarBio);
    $('#btn-remover-foto').addEventListener('click', () => {
      estado.fotoNova = null;
      estado.removerFoto = true;
      $('#arquivo-foto').value = '';
      atualizarPreviaPerfil();
    });
    $('#arquivo-foto').addEventListener('change', async (evento) => {
      const arquivo = evento.target.files[0];
      if (!arquivo) return;
      mensagemPerfil('');
      try {
        estado.fotoNova = await prepararFoto(arquivo);
        estado.removerFoto = false;
        atualizarPreviaPerfil();
      } catch (erro) {
        mensagemPerfil(erro.message || 'Não foi possível usar esta imagem.');
      }
    });
    // fecha ao clicar fora ou apertar Esc (o que não foi salvo é descartado)
    document.addEventListener('click', (evento) => {
      if (!evento.target.closest('.perfil-caixa')) fecharMenuPerfil();
    });
    document.addEventListener('keydown', (evento) => {
      if (evento.key === 'Escape') fecharMenuPerfil(true);
    });
  }

  /* ---------- Excluir matéria, arte ou aviso; a API confere a permissão no servidor ---------- */
  async function excluirItem() {
    const alvo = estado.excluindo;
    if (!alvo) return;
    const { tipo, item: p } = alvo;
    const rota = tipo === 'aviso' ? '/api/avisos' : tipo === 'arte' ? '/api/artes' : '/api/postagens';
    const remover = () => {
      if (tipo === 'aviso') estado.avisos = estado.avisos.filter((x) => x.id !== p.id);
      else if (tipo === 'arte') estado.artes = estado.artes.filter((x) => x.id !== p.id);
      else estado.postagens = estado.postagens.filter((x) => x.id !== p.id);
      renderizar();
    };
    const botao = $('#excluir-confirmar');
    const erro = $('#excluir-erro');
    botao.disabled = true;
    botao.textContent = 'Excluindo…';
    erro.hidden = true;
    try {
      await api(`${rota}?id=${encodeURIComponent(p.id)}`, { method: 'DELETE' }, true);
      remover();
      $('#dialogo-excluir').close();
    } catch (e) {
      if (e.status === 404) {
        remover();
        $('#dialogo-excluir').close();
      } else {
        erro.textContent = e.status === 401 ? 'Sua sessão expirou. Entre novamente.' : e.message || 'Não foi possível excluir agora.';
        erro.hidden = false;
      }
    } finally {
      botao.disabled = false;
      botao.textContent = 'Sim, excluir';
    }
  }

  function iniciarExclusao() {
    const janela = $('#dialogo-excluir');
    document.addEventListener('click', (evento) => {
      const botao = evento.target.closest('.btn-excluir');
      if (!botao) return;
      const id = botao.closest('[data-id]')?.dataset.id;
      let alvo = null;
      if (botao.closest('.aviso')) {
        const a = ehDiretoria() && estado.avisos.find((x) => x.id === id);
        if (a) alvo = { tipo: 'aviso', item: a };
      } else if (botao.closest('.cartao-arte')) {
        const arte = ehJornalista() && estado.artes.find((x) => x.id === id);
        if (arte) alvo = { tipo: 'arte', item: arte };
      } else {
        const p = ehJornalista() && estado.postagens.find((x) => x.id === id);
        if (p) alvo = { tipo: 'postagem', item: p };
      }
      if (!alvo) return;
      estado.excluindo = alvo;
      const aviso = alvo.tipo === 'aviso';
      const arte = alvo.tipo === 'arte';
      const resumo = aviso
        ? alvo.item.texto.slice(0, 80) || 'o aviso com imagem'
        : arte
          ? alvo.item.legenda || 'esta arte'
          : `"${alvo.item.titulo}"`;
      if (typeof janela.showModal !== 'function') {
        // navegador muito antigo, sem <dialog>: usa a confirmação simples
        if (window.confirm(`Excluir ${resumo}? Esta ação não pode ser desfeita.`)) excluirItem();
        return;
      }
      $('#excluir-titulo').textContent = aviso
        ? 'Excluir este aviso?'
        : arte
          ? 'Excluir esta arte?'
          : 'Excluir esta matéria?';
      $('#excluir-texto').textContent = aviso
        ? `${resumo}${alvo.item.texto.length > 80 ? '…' : ''} será apagado do Mural, junto com a imagem. Esta ação não pode ser desfeita.`
        : arte
          ? `${resumo} será apagada da galeria, junto com a imagem. Esta ação não pode ser desfeita.`
          : `${resumo} será apagada do portal, junto com as imagens. Esta ação não pode ser desfeita.`;
      $('#excluir-erro').hidden = true;
      janela.showModal();
    });
    $('#excluir-confirmar').addEventListener('click', excluirItem);
    janela.addEventListener('close', () => {
      estado.excluindo = null;
    });
  }

  function mostrarSite(hash) {
    telaCheia(null);
    const leitura = $('#leitura');
    if (hash.startsWith('post-')) {
      estado.pronto.then(() => abrirPostagem(hash.slice(5)));
      return;
    }
    leitura.hidden = true;
    const alvo = hash ? document.getElementById(hash) : null;
    const valido = alvo?.classList.contains('topico') && alvo.id !== 'leitura' && !alvo.hidden;
    const topico = valido ? alvo : $('#noticias');
    irParaTopico(topico);
    marcarAtivo(topico.id);
    window.scrollTo({ top: 0, behavior: 'instant' }); // o link da aba pula a página: volta para o topo
  }

  async function mostrarLogin() {
    await estado.sessaoPronta;
    if (estado.jornalista) return location.replace(rotaInicial());
    telaCheia('login');
    $('#login-erro').hidden = true;
    $('#login-usuario').focus();
  }

  async function entrarComoJornalista() {
    await estado.sessaoPronta;
    location.replace(estado.jornalista ? rotaInicial() : '#login');
  }

  async function mostrarEditor() {
    await estado.sessaoPronta;
    if (!estado.jornalista) return location.replace('#login');
    if (estado.jornalista.papel !== 'jornalista') return location.replace(rotaInicial()); // o editor de matérias é só do jornalista
    abrirEditor();
  }

  async function rotear() {
    const hash = location.hash.slice(1);
    const rota = hash.split('/')[0];
    if (rota === 'login') return mostrarLogin();
    if (rota === 'jornalista') return entrarComoJornalista();
    if (rota === 'editor') return mostrarEditor();
    return mostrarSite(hash);
  }

  /* ---------- Login ---------- */
  function mensagemLogin(texto) {
    const caixa = $('#login-erro');
    caixa.textContent = texto;
    caixa.hidden = !texto;
  }

  function traduzirErroLogin(erro) {
    const codigo = erro?.errors?.[0]?.code || '';
    if (/identifier_not_found|password_incorrect|strategy_for_user_invalid|form_param/.test(codigo)) {
      return 'Usuário ou senha incorretos.';
    }
    if (erro?.status === 429 || codigo === 'too_many_requests') {
      return 'Muitas tentativas. Aguarde um pouco e tente de novo.';
    }
    if (erro instanceof ErroApi && erro.status === 403) return 'Esta conta não tem permissão de acesso.';
    if (erro instanceof ErroApi && erro.status === 401) return 'Não foi possível confirmar a sessão. Tente entrar de novo.';
    if (erro instanceof ErroApi) return erro.message;
    return 'Não foi possível iniciar o login agora. Verifique a conexão e tente novamente.';
  }

  async function entrar(evento) {
    evento.preventDefault();
    const usuario = $('#login-usuario').value.trim();
    const senha = $('#login-senha').value;
    if (!usuario || !senha) return mensagemLogin('Informe o usuário e a senha.');

    const botao = $('#btn-entrar');
    botao.disabled = true;
    botao.textContent = 'Entrando…';
    mensagemLogin('');
    try {
      const clerk = await carregarClerk();
      if (!clerk.session) {
        const tentativa = await clerk.client.signIn.create({ identifier: usuario, password: senha });
        if (tentativa.status !== 'complete') {
          throw new ErroApi(0, 'Esta conta exige uma verificação extra que ainda não é suportada aqui.');
        }
        await clerk.setActive({ session: tentativa.createdSessionId });
      }
      await verificarJornalista(); // o servidor confirma o papel (jornalista ou diretoria)
      $('#login-senha').value = '';
      estado.visitante = false;
      renderizar();
      location.hash = rotaInicial();
    } catch (erro) {
      // Entrou no Clerk, mas a conta não tem papel nenhum (nem jornalista nem diretoria): encerra a sessão
      if (erro instanceof ErroApi && erro.status === 403) {
        try {
          await window.Clerk?.signOut();
        } catch {
          /* ignora */
        }
      }
      mensagemLogin(traduzirErroLogin(erro));
    } finally {
      botao.disabled = false;
      botao.textContent = 'Entrar';
    }
  }

  async function sair() {
    try {
      await window.Clerk?.signOut();
    } catch {
      /* ignora */
    }
    estado.jornalista = null;
    estado.visitante = false;
    estado.composer?.limpar?.();
    lembrar(false);
    fecharMenuPerfil();
    atualizarBarra();
    renderizar();
    location.hash = '#noticias';
  }

  /* ---------- Editor de postagem ---------- */
  const TIPOS_IMAGEM = ['image/jpeg', 'image/png', 'image/webp'];

  async function carregarBitmap(arquivo) {
    if ('createImageBitmap' in window) {
      try {
        return await createImageBitmap(arquivo);
      } catch {
        /* tenta o jeito antigo */
      }
    }
    const url = URL.createObjectURL(arquivo);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // Reduz a imagem no navegador e devolve um JPEG em data URI que cabe no limite do servidor.
  //  - cobrir: true  -> recorta no tamanho exato largura x altura (capa 16:9, foto de perfil quadrada)
  //  - cobrir: false -> mantém a proporção original, só limitando o maior lado a maxLado
  async function gerarJpeg(arquivo, { cobrir, largura, altura, maxLado, limite }) {
    if (!TIPOS_IMAGEM.includes(arquivo.type)) throw new Error('Use uma imagem JPG, PNG ou WebP.');
    if (arquivo.size > 15 * 1024 * 1024) throw new Error('A imagem original é grande demais (máximo de 15 MB).');
    const bitmap = await carregarBitmap(arquivo);
    const bw = bitmap.width;
    const bh = bitmap.height;

    let L = largura;
    let A = altura;
    let escala;
    if (cobrir) {
      escala = Math.max(L / bw, A / bh);
    } else {
      escala = Math.min(1, maxLado / Math.max(bw, bh));
      L = Math.max(1, Math.round(bw * escala));
      A = Math.max(1, Math.round(bh * escala));
    }
    const canvas = document.createElement('canvas');
    canvas.width = L;
    canvas.height = A;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; // PNG com fundo transparente fica sobre branco
    ctx.fillRect(0, 0, L, A);
    ctx.drawImage(bitmap, (L - bw * escala) / 2, (A - bh * escala) / 2, bw * escala, bh * escala);

    for (const qualidade of [0.85, 0.72, 0.58, 0.45]) {
      const dados = canvas.toDataURL('image/jpeg', qualidade);
      if (dados.length <= limite) return dados;
    }
    throw new Error('Esta imagem ficou pesada demais mesmo depois de reduzida. Tente uma imagem menor.');
  }

  // Imagem de resumo (capa): recortada em 16:9, 1280x720.
  const prepararImagem = (arquivo) =>
    gerarJpeg(arquivo, { cobrir: true, largura: 1280, altura: 720, limite: 1_900_000 });
  // Imagem do final da matéria: sem formato fixo (só limita o maior lado a 1600 px).
  const prepararImagemFinal = (arquivo) =>
    gerarJpeg(arquivo, { cobrir: false, maxLado: 1600, limite: 1_900_000 });
  // Foto de perfil: quadrada 256x256 (aparece redonda).
  const prepararFoto = (arquivo) =>
    gerarJpeg(arquivo, { cobrir: true, largura: 256, altura: 256, limite: 550_000 });

  function abrirEditor() {
    const tela = $('#tela-editor');
    tela.replaceChildren($('#modelo-editor').content.cloneNode(true));
    telaCheia('editor');
    const form = $('form', tela);
    form.categoria.value = estado.categoriaNova in CATEGORIAS ? estado.categoriaNova : 'noticias';
    estado.imagem = null;
    estado.imagemFinal = null;

    const previa = campo(form, 'previa');
    const imgPrevia = $('img', previa);
    const textoPrevia = $('p', previa);
    const remover = $('[data-acao="remover-imagem"]', form);
    const mensagem = campo(form, 'mensagem');
    const aviso = (texto, tipo = 'erro') => {
      mensagem.textContent = texto;
      mensagem.className = `mensagem ${tipo}`;
      mensagem.hidden = !texto;
    };
    const limparImagem = () => {
      estado.imagem = null;
      form.imagem.value = '';
      imgPrevia.hidden = true;
      imgPrevia.removeAttribute('src');
      textoPrevia.hidden = false;
      previa.classList.remove('tem-imagem');
      remover.hidden = true;
    };

    form.imagem.addEventListener('change', async () => {
      const arquivo = form.imagem.files[0];
      if (!arquivo) return;
      aviso('');
      try {
        estado.imagem = await prepararImagem(arquivo);
        imgPrevia.src = estado.imagem;
        imgPrevia.hidden = false;
        textoPrevia.hidden = true;
        previa.classList.add('tem-imagem');
        remover.hidden = false;
      } catch (erro) {
        limparImagem();
        aviso(erro.message || 'Não foi possível usar esta imagem.');
      }
    });
    remover.addEventListener('click', limparImagem);

    // Imagem do FINAL da matéria (tamanho livre)
    const caixaFinal = campo(form, 'previa-final');
    const imgFinal = $('img', caixaFinal);
    const removerFinal = $('[data-acao="remover-final"]', form);
    const limparFinal = () => {
      estado.imagemFinal = null;
      form.imagemFinal.value = '';
      imgFinal.hidden = true;
      imgFinal.removeAttribute('src');
      caixaFinal.hidden = true;
      removerFinal.hidden = true;
    };
    form.imagemFinal.addEventListener('change', async () => {
      const arquivo = form.imagemFinal.files[0];
      if (!arquivo) return;
      aviso('');
      try {
        estado.imagemFinal = await prepararImagemFinal(arquivo);
        imgFinal.src = estado.imagemFinal;
        imgFinal.hidden = false;
        caixaFinal.hidden = false;
        removerFinal.hidden = false;
      } catch (erro) {
        limparFinal();
        aviso(erro.message || 'Não foi possível usar esta imagem.');
      }
    });
    removerFinal.addEventListener('click', limparFinal);

    // "Anexar arquivo .md": o texto do arquivo entra no campo de conteúdo, exatamente como está.
    // Se o arquivo começar com "# Título" e o título ainda estiver vazio, essa linha vira o título.
    form.arquivoMd.addEventListener('change', async () => {
      const arquivo = form.arquivoMd.files[0];
      form.arquivoMd.value = '';
      if (!arquivo) return;
      if (!/\.(md|markdown|txt)$/i.test(arquivo.name)) return aviso('Escolha um arquivo com final .md');
      if (arquivo.size > 300 * 1024) return aviso('O arquivo é grande demais (máximo de 300 KB).');
      try {
        let texto = (await arquivo.text()).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
        const m = /^\s*#\s+(.+?)[ \t]*(?:\n|$)/.exec(texto);
        if (m && !form.titulo.value.trim()) {
          form.titulo.value = m[1].slice(0, 140);
          texto = texto.slice(m[0].length);
        }
        texto = texto.trim();
        if (texto.length > 60000) return aviso('O texto do arquivo passa de 60.000 caracteres.');
        form.conteudo.value = texto;
        aviso(`Arquivo "${arquivo.name}" carregado. Revise o texto e clique em Publicar.`, 'ok');
      } catch {
        aviso('Não foi possível ler este arquivo.');
      }
    });

    $('[data-acao="cancelar"]', form).addEventListener('click', () => {
      location.hash = `#${estado.categoriaNova in CATEGORIAS ? estado.categoriaNova : 'noticias'}`;
    });

    form.addEventListener('submit', async (evento) => {
      evento.preventDefault();
      const titulo = form.titulo.value.trim();
      const conteudo = form.conteudo.value.trim();
      const categoria = form.categoria.value;
      if (!titulo) return aviso('Escreva o título da postagem.');
      if (!conteudo) return aviso('Escreva o conteúdo da reportagem.');
      if (!(categoria in CATEGORIAS)) return aviso('Escolha uma categoria.');

      const botao = campo(form, 'publicar');
      botao.disabled = true;
      botao.textContent = 'Publicando…';
      aviso('');
      try {
        const dados = await api(
          '/api/postagens',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              titulo,
              conteudo,
              categoria,
              imagem: estado.imagem || undefined,
              imagemFinal: estado.imagemFinal || undefined,
            }),
          },
          true,
        );
        estado.postagens.unshift(dados.postagem);
        renderizar();
        location.hash = `#${categoria}`;
      } catch (erro) {
        if (erro.status === 401) {
          aviso('Sua sessão expirou. Entre de novo pelo endereço de login (em outra aba) e publique outra vez — o texto desta tela foi mantido.');
        } else {
          aviso(erro.message || 'Não foi possível publicar agora.');
        }
        botao.disabled = false;
        botao.textContent = 'Publicar';
      }
    });

    form.titulo.focus();
  }

  /* ---------- Início ---------- */
  function iniciar() {
    $('#form-login').addEventListener('submit', entrar);
    $('#btn-sair').addEventListener('click', sair);
    iniciarPerfil();
    iniciarExclusao();
    iniciarEnvioArte();
    $('#btn-visitante').addEventListener('click', () => {
      estado.visitante = !estado.visitante;
      atualizarBarra();
      renderizar();
    });
    $('#btn-voltar').addEventListener('click', () => {
      location.hash = `#${estado.leituraCategoria}`;
    });
    document.addEventListener('click', (evento) => {
      const botao = evento.target.closest('.cartao-novo');
      if (!botao) return;
      estado.categoriaNova = botao.dataset.categoria;
      location.hash = '#editor';
    });
    window.addEventListener('hashchange', rotear);

    observarTopicos();
    marcarAtivo('noticias');
    estado.pronto = carregarPostagens();
    carregarAvisos();
    carregarArtes();
    estado.sessaoPronta = restaurarSessao();
    rotear();
  }

  iniciar();
})();
