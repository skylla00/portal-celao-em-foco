/* ==========================================================
   Portal Celao em Foco — script.js
   - Lê as postagens da API e monta os cartões (usa os <template> do index.html).
   - Abre uma matéria na página de leitura.
   - Rotas secretas por hash: #login, #jornalista, #editor.
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
    artes: 'Artes',
  };
  const DICA = 'celao-jornalista'; // só uma dica de interface ("tentar restaurar a sessão"). NÃO autoriza nada.

  const estado = {
    postagens: [],
    erroLista: false,
    jornalista: null, // { nome, foto } — preenchido só depois que o SERVIDOR confirma o papel
    visitante: false, // jornalista olhando o site "como visitante"
    categoriaNova: 'noticias',
    leituraCategoria: 'noticias',
    imagem: null, // data URI da imagem de resumo já ajustada (16:9)
    clerkPromessa: null,
    pronto: null, // promessa: postagens carregadas
    sessaoPronta: null, // promessa: tentativa de restaurar sessão terminou
  };

  const $ = (seletor, raiz = document) => raiz.querySelector(seletor);
  const campo = (raiz, nome) => raiz.querySelector(`[data-campo="${nome}"]`);
  const modoEdicao = () => Boolean(estado.jornalista) && !estado.visitante;

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

  // Monta o texto da matéria SEM innerHTML (evita injeção de HTML).
  // Parágrafos separados por linha em branco; "## " = subtítulo; "> " = citação.
  function montarTexto(alvo, texto) {
    alvo.replaceChildren();
    for (const bloco of texto.split(/\n{2,}/)) {
      const linhas = bloco.split('\n');
      let el;
      if (bloco.startsWith('## ')) {
        el = document.createElement('h3');
        el.textContent = bloco.slice(3).replace(/\n/g, ' ');
      } else if (linhas.every((l) => l.startsWith('>'))) {
        el = document.createElement('blockquote');
        el.textContent = linhas.map((l) => l.replace(/^>\s?/, '')).join(' ');
      } else {
        el = document.createElement('p');
        linhas.forEach((linha, i) => {
          if (i) el.append(document.createElement('br'));
          el.append(document.createTextNode(linha));
        });
      }
      alvo.append(el);
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
    estado.jornalista = { nome: dados.nome, foto: dados.foto };
    lembrar(true);
    atualizarBarra();
  }

  async function restaurarSessao() {
    const rotaSecreta = /^#(login|jornalista|editor)/.test(location.hash);
    if (!temDica() && !rotaSecreta) return;
    try {
      const clerk = await carregarClerk();
      if (clerk.session) await verificarJornalista();
      else lembrar(false);
    } catch (erro) {
      if (erro.status === 401 || erro.status === 403) lembrar(false);
    }
    renderizar();
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

  function renderizar() {
    const modelo = $('#modelo-cartao-postagem');
    const novo = $('#modelo-nova-postagem');
    for (const slug of Object.keys(CATEGORIAS)) {
      const lista = $(`#lista-${slug}`);
      lista.replaceChildren();

      // Jornalista: o botão "Criar nova postagem" ocupa o lugar de "Nenhuma postagem ainda"
      if (modoEdicao()) {
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
    const banner = campo(leitura, 'banner');
    banner.hidden = !p.imagem;
    definirImagem(banner, p.imagem, `Banner da matéria: ${p.titulo}`);
    montarTexto(campo(leitura, 'conteudo'), p.conteudo);

    estado.leituraCategoria = p.categoria;
    leitura.setAttribute('aria-label', p.titulo);
    leitura.hidden = false;
    leitura.scrollTop = 0;
    leitura.scrollIntoView({ inline: 'start', block: 'nearest', behavior: 'instant' });
    marcarAtivo(p.categoria);
  }

  /* ---------- Navegação: aba ativa acompanha a rolagem lateral ---------- */
  function marcarAtivo(id) {
    document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('ativo', a.getAttribute('href') === `#${id}`));
    $(`nav a[href="#${id}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }

  function observarTopicos() {
    const raiz = $('#painel-topicos');
    const observador = new IntersectionObserver(
      (entradas) => {
        for (const e of entradas) if (e.isIntersecting) marcarAtivo(e.target.id);
      },
      { root: raiz, threshold: 0.6 },
    );
    raiz.querySelectorAll('.topico:not(#leitura)').forEach((t) => observador.observe(t));
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
    if (estado.jornalista) campo(barra, 'nome-jornalista').textContent = estado.jornalista.nome;
    $('#btn-visitante').textContent = estado.visitante ? 'Voltar ao modo jornalista' : 'Ver site público';
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
    const valido = alvo?.classList.contains('topico') && alvo.id !== 'leitura';
    const topico = valido ? alvo : $('#mural');
    topico.scrollIntoView({ inline: 'start', block: 'nearest', behavior: 'instant' });
    marcarAtivo(topico.id);
  }

  async function mostrarLogin() {
    await estado.sessaoPronta;
    if (estado.jornalista) return location.replace('#noticias');
    telaCheia('login');
    $('#login-erro').hidden = true;
    $('#login-usuario').focus();
  }

  async function entrarComoJornalista() {
    await estado.sessaoPronta;
    location.replace(estado.jornalista ? '#noticias' : '#login');
  }

  async function mostrarEditor() {
    await estado.sessaoPronta;
    if (!estado.jornalista) return location.replace('#login');
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
    if (erro instanceof ErroApi && erro.status === 403) return 'Esta conta não tem permissão de jornalista.';
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
      await verificarJornalista(); // o servidor confirma o papel de jornalista
      $('#login-senha').value = '';
      estado.visitante = false;
      renderizar();
      location.hash = '#noticias';
    } catch (erro) {
      // Entrou no Clerk, mas não é jornalista: encerra a sessão
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
    lembrar(false);
    atualizarBarra();
    renderizar();
    location.hash = '#mural';
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

  // Recorta no formato 16:9 e reduz para 1280x720 (JPEG), para a imagem ficar leve.
  async function prepararImagem(arquivo) {
    if (!TIPOS_IMAGEM.includes(arquivo.type)) throw new Error('Use uma imagem JPG, PNG ou WebP.');
    if (arquivo.size > 15 * 1024 * 1024) throw new Error('A imagem original é grande demais (máximo de 15 MB).');
    const bitmap = await carregarBitmap(arquivo);
    const L = 1280;
    const A = 720;
    const escala = Math.max(L / bitmap.width, A / bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = L;
    canvas.height = A;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, L, A);
    ctx.drawImage(bitmap, (L - bitmap.width * escala) / 2, (A - bitmap.height * escala) / 2, bitmap.width * escala, bitmap.height * escala);
    let dados = canvas.toDataURL('image/jpeg', 0.85);
    if (dados.length > 2_800_000) dados = canvas.toDataURL('image/jpeg', 0.65);
    return dados;
  }

  function abrirEditor() {
    const tela = $('#tela-editor');
    tela.replaceChildren($('#modelo-editor').content.cloneNode(true));
    telaCheia('editor');
    const form = $('form', tela);
    form.categoria.value = estado.categoriaNova in CATEGORIAS ? estado.categoriaNova : 'noticias';
    estado.imagem = null;

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
            body: JSON.stringify({ titulo, conteudo, categoria, imagem: estado.imagem || undefined }),
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
    marcarAtivo('mural');
    estado.pronto = carregarPostagens();
    estado.sessaoPronta = restaurarSessao();
    rotear();
  }

  iniciar();
})();
