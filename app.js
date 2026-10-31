// URL do App da Web do Google Apps Script (termina em /exec). Veja o README.
// Deixe vazio para usar o modo demonstração (dados só neste navegador, sem e-mails).
// Outras páginas (ex.: amigos/index.html) definem window.GRUPO = { apiUrl, prefixo, evento } antes deste arquivo.
const GRUPO = window.GRUPO || {};
const API_URL = 'apiUrl' in GRUPO ? GRUPO.apiUrl : 'https://script.google.com/macros/s/AKfycbzewncunU9JZB5bXP7xJWf5mxeJhTTSDJZjCq75GZ8L4TcTu8-tzG1QRd8_YHPpukT_/exec';
// As páginas ficam no mesmo site e dividem o armazenamento do navegador: cada grupo usa o seu prefixo.
const PREFIXO = GRUPO.prefixo || 'amigo-secreto';

const $ = sel => document.querySelector(sel);
let estado = null;
let ocupado = false;

// ===== Código da família (guardado neste aparelho para não pedir toda vez) =====
const CHAVE_CODIGO = PREFIXO + '-codigo';
let codigoFamilia = lerCodigo();

function lerCodigo() {
  try { return localStorage.getItem(CHAVE_CODIGO) || ''; } catch { return ''; }
}

function salvarCodigo(codigo) {
  try {
    if (codigo) localStorage.setItem(CHAVE_CODIGO, codigo);
    else localStorage.removeItem(CHAVE_CODIGO);
  } catch { /* sem armazenamento: pede o código a cada visita */ }
}

class ErroCodigo extends Error {}

// ===== Comunicação com o backend =====
const api = API_URL ? {
  async estado() {
    return this.chamar('estado');
  },
  async chamar(action, dados = {}) {
    // text/plain evita a requisição "preflight" de CORS, que o Apps Script não aceita.
    return tratar(await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, codigo: codigoFamilia, ...dados }),
    }));
  },
} : criarApiDemo();

async function tratar(res) {
  if (!res.ok) throw new Error('Falha de conexão com o servidor.');
  const json = await res.json();
  if (json.codigoInvalido) throw new ErroCodigo(json.error);
  if (!json.ok) throw new Error(json.error);
  return json.data;
}

function bloquear(mensagem) {
  codigoFamilia = '';
  salvarCodigo('');
  estado = null;
  document.body.classList.add('bloqueado');
  const status = $('#status');
  status.textContent = '🔒 Acesso restrito';
  status.className = 'status';
  if (mensagem) toast(mensagem, true);
}

// ===== Renderização =====
function render() {
  if (!estado) return;
  const { sorteado, participantes, alimentos } = estado;

  document.body.classList.toggle('sorteado', sorteado);
  $('#evento').textContent = estado.evento;
  const status = $('#status');
  status.textContent = sorteado ? '🎉 Sorteio realizado' : 'Cadastro aberto';
  status.className = 'status ' + (sorteado ? 'status--sorteado' : 'status--aberto');

  $('#cont-participantes').textContent = participantes.length;
  $('#cont-alimentos').textContent = alimentos.length;

  $('#lista-participantes').innerHTML = participantes.length
    ? participantes.map(p => `
      <li class="pessoa">
        <div class="pessoa__avatar" aria-hidden="true">${esc(p.nome.charAt(0).toUpperCase())}</div>
        <div class="pessoa__info">
          <div class="pessoa__nome">${esc(p.nome)}</div>
          <div class="pessoa__email">${esc(p.email)}</div>
          ${p.desejos.length ? `<div class="pessoa__desejos">${p.desejos.map(d => `<span class="chip">${esc(d)}</span>`).join('')}</div>` : ''}
        </div>
        <div class="pessoa__acoes">
          <button class="editar" data-editar="${esc(p.id)}" title="Editar desejos de ${esc(p.nome)}" aria-label="Editar desejos de ${esc(p.nome)}">✏️</button>
          ${sorteado ? '' : `<button class="remover" data-remover-participante="${esc(p.id)}" title="Remover ${esc(p.nome)} (organizador)" aria-label="Remover ${esc(p.nome)}">✕</button>`}
        </div>
      </li>`).join('')
    : '<li class="lista__vazia">Ninguém cadastrado ainda. Seja o primeiro!</li>';

  const listaAlimentos = $('#lista-alimentos');
  listaAlimentos.hidden = sorteado;
  listaAlimentos.innerHTML = alimentos.length
    ? alimentos.map(a => `
      <li class="comida">
        <span class="comida__item">${esc(a.item)}</span>
        ${a.escolhidoPor
          ? `<span class="comida__dono">🙋 ${esc(a.escolhidoPor)} leva</span>
             <button class="btn-mini" data-soltar="${esc(a.id)}" title="Devolver ${esc(a.item)} para o sorteio">Soltar</button>`
          : `<button class="btn-mini btn-mini--levar" data-levar="${esc(a.id)}">🙋 Eu levo</button>`}
        <button class="remover" data-remover-alimento="${esc(a.id)}" title="Remover ${esc(a.item)}" aria-label="Remover ${esc(a.item)}">×</button>
      </li>`).join('')
    : '<li class="lista__vazia">Nenhum item na lista ainda.</li>';

  const divisao = $('#divisao-alimentos');
  divisao.hidden = !sorteado;
  if (sorteado) {
    divisao.innerHTML = participantes.map(p => {
      const itens = alimentos.filter(a => a.responsavel === p.nome);
      return `<div class="divisao__pessoa"><strong>${esc(p.nome)}</strong>${itens.length
        ? `<ul>${itens.map(a => `<li>${esc(a.item)}${a.escolhidoPor === p.nome ? ' 🙋' : ''}</li>`).join('')}</ul>`
        : '<span class="vazio">Nada desta vez</span>'}</div>`;
    }).join('');
  }

  renderMensagens(estado.mensagens || []);
  renderVotacao();

  $('#sorteio-aberto').hidden = sorteado;
  $('#sorteio-feito').hidden = !sorteado;
  if (sorteado) {
    $('#data-sorteio').textContent = new Date(estado.dataSorteio).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } else {
    const faltam = estado.minParticipantes - participantes.length;
    $('#resumo-sorteio').innerHTML = `<strong>${participantes.length}</strong> participante(s) e <strong>${alimentos.length}</strong> item(ns) de comida.`
      + (faltam > 0 ? ` Faltam pelo menos ${faltam} participante(s) para sortear.` : ' Tudo pronto quando o organizador quiser!');
  }
}

// Só redesenha o chat quando chega algo novo, para não pular a rolagem de quem está lendo.
let assinaturaChat = null;
function renderMensagens(mensagens) {
  const assinatura = mensagens.map(m => m.id).join(',');
  if (assinatura === assinaturaChat) return;
  assinaturaChat = assinatura;

  const lista = $('#lista-mensagens');
  const estavaNoFim = lista.scrollHeight - lista.scrollTop - lista.clientHeight < 40;
  const meuNome = lerLocal(CHAVE_NOME).toLowerCase();
  lista.innerHTML = mensagens.length
    ? mensagens.map(m => {
      const hora = m.quando ? new Date(m.quando).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
      return `
      <li class="mensagem${m.nome.toLowerCase() === meuNome ? ' mensagem--minha' : ''}">
        <div class="mensagem__topo">
          <span class="mensagem__nome">${esc(m.nome)}</span>
          <span class="mensagem__hora">${esc(hora)}</span>
          <button class="mensagem__responder" data-responder="${esc(m.id)}" title="Responder a ${esc(m.nome)}" aria-label="Responder a ${esc(m.nome)}">↩️ Responder</button>
          <button class="mensagem__apagar" data-apagar-mensagem="${esc(m.id)}" title="Apagar (organizador)" aria-label="Apagar mensagem">✕</button>
        </div>
        ${m.resposta ? `<div class="mensagem__citacao">${m.resposta.apagada
          ? '<em>Mensagem apagada</em>'
          : `<strong>${esc(m.resposta.nome)}</strong> ${esc(m.resposta.texto)}`}</div>` : ''}
        <div class="mensagem__texto">${esc(m.texto)}</div>
      </li>`;
    }).join('')
    : '<li class="chat__vazio">Nenhum recado ainda. Que tal mandar um "Feliz Natal"? 🎄</li>';
  if (estavaNoFim) lista.scrollTop = lista.scrollHeight;
}

// ===== Votação do valor dos presentes =====
const CHAVE_VOTO = PREFIXO + '-voto';
let tokenVoto = lerLocal(CHAVE_VOTO);
let meuVoto = null; // { nome, voto } de quem abriu o link pessoal de votação

function renderVotacao() {
  const v = estado.votacao;
  const caixa = $('#votacao-conteudo');
  const aberta = !!(v && v.aberta);
  $('#form-abrir-votacao').hidden = aberta;
  $('#votacao-gerenciar').hidden = !aberta;

  const pedir = $('#form-pedir-voto');
  pedir.hidden = !aberta || !!meuVoto;
  if (!pedir.hidden && !pedir.contains(document.activeElement)) {
    pedir.pessoa.innerHTML = '<option value="">Não recebeu o link? Escolha seu nome…</option>'
      + estado.participantes.map(p => `<option value="${esc(p.id)}">${esc(p.nome)}</option>`).join('');
  }

  if (!v) {
    caixa.innerHTML = '<p class="dica">Ainda não há votação. Quando o organizador abrir, cada participante recebe um e-mail com um link para votar no valor do presente.</p>';
    return;
  }

  const total = v.opcoes.reduce((n, o) => n + o.nomes.length, 0);
  const podeVotar = aberta && meuVoto;
  const opcoes = v.opcoes.map((o, i) => {
    const pct = total ? Math.round(o.nomes.length / total * 100) : 0;
    const minha = meuVoto && meuVoto.voto === i;
    const tag = podeVotar ? 'button' : 'div';
    return `<li><${tag} class="votacao__opcao${minha ? ' votacao__opcao--minha' : ''}"${podeVotar ? ` type="button" data-votar="${i}"` : ''}>
      <span class="votacao__barra" style="width:${pct}%"></span>
      <span class="votacao__topo"><span>${minha ? '✅ ' : ''}${esc(o.rotulo)}</span><span>${o.nomes.length} voto(s)</span></span>
      ${o.nomes.length ? `<span class="votacao__nomes">${o.nomes.map(esc).join(', ')}</span>` : ''}
    </${tag}></li>`;
  }).join('');

  if (!aberta) {
    caixa.innerHTML = `<p class="dica">Votação encerrada. Valor combinado para o presente:</p>
      <p class="votacao__resultado">💰 ${esc(v.valorFinal)}</p>
      <ul class="votacao__opcoes">${opcoes}</ul>`;
    return;
  }

  const unanime = !v.faltam.length && v.opcoes.find(o => o.nomes.length === total);
  caixa.innerHTML = `
    <p class="dica">${podeVotar
      ? `Votando como <strong>${esc(meuVoto.nome)}</strong>. Toque na sua opção (dá para trocar depois):`
      : 'Para votar, toque no link que chegou no seu e-mail.'}</p>
    <ul class="votacao__opcoes">${opcoes}</ul>
    ${unanime ? `<p class="votacao__acordo">🎉 Todos concordaram com ${esc(unanime.rotulo)}! O organizador já pode encerrar.</p>` : ''}
    <p class="dica"><strong>${total} de ${total + v.faltam.length}</strong> já votaram.${v.faltam.length ? ` Faltam: ${v.faltam.map(esc).join(', ')}.` : ''}</p>`;

  const encerrar = $('#form-encerrar-votacao').opcao;
  if (document.activeElement !== encerrar) {
    const ordem = v.opcoes.map((o, i) => ({ ...o, i })).sort((a, b) => b.nomes.length - a.nomes.length);
    encerrar.innerHTML = ordem.map(o => `<option value="${o.i}">${esc(o.rotulo)} (${o.nomes.length} voto(s))</option>`).join('');
  }
}

// Confere de quem é o link de votação guardado. Link velho (de outra votação) é esquecido em silêncio.
async function abrirVoto(avisar) {
  if (!tokenVoto) return;
  try {
    meuVoto = await api.chamar('abrirVoto', { token: tokenVoto });
    salvarLocal(CHAVE_VOTO, tokenVoto);
  } catch (err) {
    if (err instanceof ErroCodigo) return;
    meuVoto = null;
    tokenVoto = '';
    salvarLocal(CHAVE_VOTO, '');
    if (avisar) toast(err.message, true);
  }
  if (estado) render();
  if (avisar && meuVoto) $('#votacao').scrollIntoView({ behavior: 'smooth' });
}

// Campo de desejos: o que é digitado vira um chip ao apertar Enter (ou vírgula).
function criarCampoTags(caixa, input) {
  let itens = [];

  function desenhar() {
    caixa.querySelectorAll('.chip').forEach(c => c.remove());
    itens.forEach((d, i) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.innerHTML = `${esc(d)} <button type="button" data-remover-desejo="${i}" aria-label="Remover ${esc(d)}">×</button>`;
      caixa.insertBefore(chip, input);
    });
  }

  function confirmar() {
    input.value.split(',').map(s => s.trim()).filter(Boolean).forEach(d => {
      if (itens.length < 10 && !itens.some(x => x.toLowerCase() === d.toLowerCase())) itens.push(d);
    });
    input.value = '';
    desenhar();
  }

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      confirmar();
    } else if (e.key === 'Backspace' && !input.value && itens.length) {
      itens.pop();
      desenhar();
    }
  });
  input.addEventListener('blur', confirmar);
  caixa.addEventListener('click', e => {
    const btn = e.target.closest('[data-remover-desejo]');
    if (btn) {
      itens.splice(Number(btn.dataset.removerDesejo), 1);
      desenhar();
    } else {
      input.focus();
    }
  });

  return {
    confirmar,
    valores: () => itens.slice(),
    definir(lista) { itens = lista.slice(0, 10); desenhar(); },
  };
}

const campoDesejos = criarCampoTags($('#tags-desejos'), $('#input-desejo'));
const campoEdicao = criarCampoTags($('#tags-edicao'), $('#input-edicao'));

// ===== Ações =====
async function executar(fn, sucesso) {
  if (ocupado) return;
  ocupado = true;
  document.querySelectorAll('button').forEach(b => { b.disabled = true; });
  try {
    const resultado = await fn();
    const texto = typeof sucesso === 'function' ? sucesso(resultado) : sucesso;
    if (texto) toast(texto);
    return resultado;
  } catch (err) {
    if (err instanceof ErroCodigo) bloquear(err.message);
    else toast(err.message || 'Algo deu errado.', true);
  } finally {
    ocupado = false;
    document.querySelectorAll('button').forEach(b => { b.disabled = false; });
  }
}

async function carregar(silencioso) {
  try {
    estado = await api.estado();
    document.body.classList.remove('bloqueado');
    render();
    return true;
  } catch (err) {
    if (err instanceof ErroCodigo) bloquear(err.message);
    else if (!silencioso) toast('Não foi possível carregar os dados: ' + err.message, true);
    return false;
  }
}

$('#form-portao').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target;
  const botao = form.querySelector('button');
  codigoFamilia = form.codigo.value.trim();
  botao.disabled = true;
  const ok = await carregar();
  botao.disabled = false;
  if (ok) {
    salvarCodigo(codigoFamilia);
    form.reset();
    toast('Bem-vindo(a)! 🎄');
    abrirEdicao();
    mostrarRevelar();
    abrirVoto(votoDaUrl);
  }
});

$('#form-participante').addEventListener('submit', async e => {
  e.preventDefault();
  campoDesejos.confirmar();
  const form = e.target;
  const ok = await executar(async () => {
    estado = await api.chamar('addParticipante', {
      nome: form.nome.value, email: form.email.value, desejos: campoDesejos.valores(),
    });
    render();
    return true;
  }, 'Cadastro feito! 🎄');
  if (ok) {
    form.reset();
    campoDesejos.definir([]);
  }
});

$('#lista-participantes').addEventListener('click', e => {
  const editar = e.target.closest('[data-editar]');
  if (editar) {
    const p = estado.participantes.find(x => x.id === editar.dataset.editar);
    if (!p || !confirm(`Enviar para o e-mail de ${p.nome} (${p.email}) um link para editar os desejos?`)) return;
    executar(() => api.chamar('pedirLinkEdicao', { id: p.id }),
      `Link enviado para ${p.email}. Abra o e-mail e toque em "Editar meus desejos" (vale por 6 horas).`);
    return;
  }

  // Remover outra pessoa é tarefa do organizador; cada um sai sozinho pelo link de edição.
  const btn = e.target.closest('[data-remover-participante]');
  if (!btn) return;
  const p = estado.participantes.find(x => x.id === btn.dataset.removerParticipante);
  if (!p) return;
  const pin = prompt(`Remover ${p.nome} do amigo secreto?\n\nDigite o PIN do organizador.\n(Para sair você mesmo, use o ✏️ e o link que chega no seu e-mail.)`);
  if (!pin) return;
  executar(async () => {
    estado = await api.chamar('removerParticipante', { id: p.id, pin });
    render();
  }, `${p.nome} foi removido(a).`);
});

// ===== Edição dos próprios desejos (link do e-mail) =====
let tokenEdicao = '';
let tokenRevelar = '';
let votoDaUrl = false;

// Os links dos e-mails trazem ?editar=<token> ou ?ver=<token>: guarda o token e limpa o endereço,
// para ele não ficar no histórico nem ser copiado junto com o link da página.
(function lerTokensDaUrl() {
  const params = new URLSearchParams(location.search);
  tokenEdicao = params.get('editar') || '';
  tokenRevelar = params.get('ver') || '';
  if (params.get('votar')) {
    tokenVoto = params.get('votar');
    votoDaUrl = true;
  }
  if (!tokenEdicao && !tokenRevelar && !votoDaUrl) return;
  params.delete('editar');
  params.delete('ver');
  params.delete('votar');
  const resto = params.toString();
  history.replaceState(null, '', location.pathname + (resto ? '?' + resto : '') + location.hash);
})();

// ===== Revelar o amigo secreto (link do e-mail do sorteio) =====
function mostrarRevelar() {
  if (!tokenRevelar) return;
  $('#revelar-antes').hidden = false;
  $('#revelar-depois').hidden = true;
  $('#painel-revelar').hidden = false;
  $('#painel-revelar').scrollIntoView({ behavior: 'smooth' });
}

$('#botao-revelar').addEventListener('click', async () => {
  const r = await executar(() => api.chamar('revelar', { token: tokenRevelar }));
  if (!r) return;
  const aviso = $('#revelar-aviso');
  if (r.abertoEm) {
    const quando = new Date(r.abertoEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    aviso.textContent = `⚠️ Este link foi aberto pela primeira vez em ${quando}. Se não foi você, alguém pode ter espiado: avise o organizador.`;
    aviso.className = 'revelar__aviso revelar__aviso--alerta';
  } else {
    aviso.textContent = '✅ Primeira vez que este link é aberto: ninguém espiou! 🤫';
    aviso.className = 'revelar__aviso';
  }
  $('#revelar-nome').textContent = r.nome;
  $('#revelar-amigo').textContent = `🎁 ${r.amigo}`;
  const valor = estado && estado.votacao && estado.votacao.valorFinal;
  $('#revelar-valor').hidden = !valor;
  $('#revelar-valor').textContent = valor ? `💰 Valor combinado do presente: ${valor}` : '';
  $('#revelar-desejos').innerHTML = r.desejos.length
    ? r.desejos.map(d => `<li>${esc(d)}</li>`).join('')
    : '<li>Não deixou sugestões. Capriche na surpresa!</li>';
  $('#revelar-itens').innerHTML = r.itens.length
    ? r.itens.map(i => `<li>${esc(i)}</li>`).join('')
    : '<li>Nenhum item ficou com você desta vez. 😉</li>';
  $('#revelar-antes').hidden = true;
  $('#revelar-depois').hidden = false;
});

$('#fechar-revelar').addEventListener('click', () => {
  tokenRevelar = '';
  $('#painel-revelar').hidden = true;
});

async function abrirEdicao() {
  if (!tokenEdicao) return;
  const dados = await executar(() => api.chamar('abrirEdicao', { token: tokenEdicao }));
  if (!dados) {
    tokenEdicao = '';
    return;
  }
  $('#edicao-nome').textContent = dados.nome;
  campoEdicao.definir(dados.desejos);
  $('#painel-edicao').hidden = false;
  $('#painel-edicao').scrollIntoView({ behavior: 'smooth' });
}

function fecharEdicao() {
  tokenEdicao = '';
  $('#painel-edicao').hidden = true;
}

$('#form-edicao').addEventListener('submit', e => {
  e.preventDefault();
  campoEdicao.confirmar();
  executar(async () => {
    const r = await api.chamar('salvarDesejos', { token: tokenEdicao, desejos: campoEdicao.valores() });
    estado = r;
    render();
    return r;
  }, r => r.avisado
    ? 'Desejos salvos! Quem tirou você recebeu a lista nova por e-mail. 🤫'
    : 'Desejos salvos! 🎁');
});

$('#fechar-edicao').addEventListener('click', fecharEdicao);

$('#remover-meu-cadastro').addEventListener('click', async () => {
  if (!confirm('Remover o seu cadastro do amigo secreto?')) return;
  const ok = await executar(async () => {
    estado = await api.chamar('removerMeuCadastro', { token: tokenEdicao });
    render();
    return true;
  }, 'Seu cadastro foi removido.');
  if (ok) fecharEdicao();
});

$('#form-alimento').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target;
  const ok = await executar(async () => {
    estado = await api.chamar('addAlimento', { item: form.item.value });
    render();
    return true;
  });
  if (ok) {
    form.reset();
    form.item.focus();
  }
});

$('#lista-alimentos').addEventListener('click', e => {
  const levar = e.target.closest('[data-levar]');
  if (levar) return abrirDialogoLevar(levar.dataset.levar);

  const soltar = e.target.closest('[data-soltar]');
  if (soltar) {
    const a = estado.alimentos.find(x => x.id === soltar.dataset.soltar);
    if (!a || !confirm(`Devolver "${a.item}" para o sorteio? (${a.escolhidoPor} não vai mais levar)`)) return;
    executar(async () => {
      estado = await api.chamar('soltarAlimento', { id: a.id });
      render();
    }, `"${a.item}" voltou para o sorteio.`);
    return;
  }

  const btn = e.target.closest('[data-remover-alimento]');
  if (!btn) return;
  executar(async () => {
    estado = await api.chamar('removerAlimento', { id: btn.dataset.removerAlimento });
    render();
  });
});

// ===== "Eu levo": escolher o próprio nome para um item =====
const CHAVE_EU = PREFIXO + '-eu';
let itemParaLevar = null;

function abrirDialogoLevar(idItem) {
  itemParaLevar = estado.alimentos.find(a => a.id === idItem);
  if (!itemParaLevar) return;
  if (!estado.participantes.length) {
    toast('Cadastre-se no amigo secreto primeiro para escolher um item.', true);
    return;
  }
  const form = $('#form-levar');
  const eu = lerLocal(CHAVE_EU);
  form.pessoa.innerHTML = '<option value="">Escolha seu nome…</option>'
    + estado.participantes.map(p => `<option value="${esc(p.id)}"${p.id === eu ? ' selected' : ''}>${esc(p.nome)}</option>`).join('');
  $('#levar-item').textContent = `“${itemParaLevar.item}”`;
  $('#dialogo-levar').showModal();
}

$('#form-levar').addEventListener('submit', e => {
  if (!e.submitter || e.submitter.value !== 'ok') return; // Cancelar: o <dialog> só fecha
  const pessoa = estado.participantes.find(p => p.id === e.target.pessoa.value);
  const item = itemParaLevar;
  if (!pessoa || !item) return;
  salvarLocal(CHAVE_EU, pessoa.id);
  executar(async () => {
    estado = await api.chamar('escolherAlimento', { id: item.id, participanteId: pessoa.id });
    render();
  }, `Combinado! ${pessoa.nome} leva ${item.item}. 🙋`);
});

// ===== Mini chat =====
const CHAVE_NOME = PREFIXO + '-nome';
$('#form-chat').nome.value = lerLocal(CHAVE_NOME);
let respondendoA = null;

function responderMensagem(m) {
  respondendoA = m;
  $('#respondendo-nome').textContent = m ? m.nome : '';
  $('#respondendo-texto').textContent = m ? m.texto : '';
  $('#chat-respondendo').hidden = !m;
  if (m) $('#form-chat').texto.focus();
}

$('#cancelar-resposta').addEventListener('click', () => responderMensagem(null));

$('#form-chat').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target;
  const nome = form.nome.value.trim();
  salvarLocal(CHAVE_NOME, nome);
  const ok = await executar(async () => {
    estado = await api.chamar('enviarMensagem', {
      nome, texto: form.texto.value, respondeA: respondendoA ? respondendoA.id : '',
    });
    assinaturaChat = null; // força redesenhar para marcar a mensagem como "minha"
    render();
    const lista = $('#lista-mensagens');
    lista.scrollTop = lista.scrollHeight;
    return estado;
  }, r => (r.avisado ? `Resposta enviada! ${r.avisado} vai receber um aviso por e-mail. 💬` : ''));
  if (ok) {
    form.texto.value = '';
    responderMensagem(null);
    form.texto.focus();
  }
});

$('#lista-mensagens').addEventListener('click', e => {
  const responder = e.target.closest('[data-responder]');
  if (responder) {
    const m = (estado.mensagens || []).find(x => x.id === responder.dataset.responder);
    if (m) responderMensagem(m);
    return;
  }

  const btn = e.target.closest('[data-apagar-mensagem]');
  if (!btn) return;
  const pin = prompt('Apagar esta mensagem? Digite o PIN do organizador.');
  if (!pin) return;
  executar(async () => {
    estado = await api.chamar('apagarMensagem', { id: btn.dataset.apagarMensagem, pin });
    render();
  }, 'Mensagem apagada.');
});

$('#votacao').addEventListener('click', e => {
  const btn = e.target.closest('[data-votar]');
  if (!btn || !meuVoto) return;
  const opcao = Number(btn.dataset.votar);
  const rotulo = estado.votacao.opcoes[opcao].rotulo;
  executar(async () => {
    estado = await api.chamar('votar', { token: tokenVoto, opcao });
    meuVoto.voto = opcao;
    render();
  }, `Voto registrado: ${rotulo} 🗳️`);
});

$('#form-pedir-voto').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target;
  const p = estado.participantes.find(x => x.id === form.pessoa.value);
  if (!p || !confirm(`Enviar o link de votação para o e-mail de ${p.nome} (${p.email})?`)) return;
  const ok = await executar(() => api.chamar('reenviarVoto', { id: p.id }),
    `Link enviado para ${p.email}. Abra o e-mail e toque em "Votar agora".`);
  if (ok) form.reset();
});

$('#form-abrir-votacao').addEventListener('submit', e => {
  e.preventDefault();
  const form = e.target;
  // Número sozinho vira euro ("20" fica "20 €"); o que já tem texto fica como foi escrito.
  const opcoes = form.opcoes.value.split(',').map(s => s.trim()).filter(Boolean)
    .map(o => (/^\d+$/.test(o) ? `${o} €` : o));
  if (opcoes.length < 2) return toast('Informe pelo menos 2 opções, separadas por vírgula.', true);
  const n = estado.participantes.length;
  if (!confirm(`Abrir a votação com as opções:\n\n${opcoes.join('\n')}\n\n${n} e-mail(s) serão enviados.`)) return;
  executar(async () => {
    const r = await api.chamar('abrirVotacao', { opcoes, pin: form.pin.value });
    estado = r;
    meuVoto = null; // o link guardado era da votação anterior
    tokenVoto = '';
    salvarLocal(CHAVE_VOTO, '');
    form.reset();
    render();
    return r.envio;
  }, envio => envio.falhas.length
    ? `Votação aberta, mas falhou o envio para: ${envio.falhas.join(', ')}. Eles podem pedir o link na página.`
    : `🗳️ Votação aberta! ${envio.total} e-mail(s) enviados.`);
});

$('#form-lembrar-votacao').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target;
  const ok = await executar(() => api.chamar('lembrarVotacao', { pin: form.pin.value }),
    r => `Lembrete enviado para ${r.total} pessoa(s).${r.falhas.length ? ` Falhou para: ${r.falhas.join(', ')}.` : ''}`);
  if (ok) form.reset();
});

$('#form-encerrar-votacao').addEventListener('submit', e => {
  e.preventDefault();
  const form = e.target;
  const opcao = Number(form.opcao.value);
  const v = estado.votacao;
  const rotulo = v.opcoes[opcao].rotulo;
  const faltam = v.faltam.length ? `\n\nAinda não votaram: ${v.faltam.join(', ')}.` : '';
  if (!confirm(`Encerrar a votação com o valor ${rotulo}?${faltam}\n\nTodos recebem um e-mail com o valor combinado.`)) return;
  executar(async () => {
    estado = await api.chamar('encerrarVotacao', { opcao, pin: form.pin.value });
    form.reset();
    render();
  }, `Votação encerrada: ${rotulo}. Todos foram avisados por e-mail. 💰`);
});

$('#form-sortear').addEventListener('submit', e => {
  e.preventDefault();
  const form = e.target;
  const n = estado.participantes.length;
  if (!confirm(`Realizar o sorteio agora?\n\n• ${n} e-mails serão enviados\n• O cadastro e a lista de comidas serão fechados`)) return;
  executar(async () => {
    const r = await api.chamar('sortear', { pin: form.pin.value });
    estado = r;
    form.reset();
    render();
    return r.envio;
  }, envio => envio.falhas.length
    ? `Sorteio feito, mas falhou o envio para: ${envio.falhas.join(', ')}. Use "Reenviar".`
    : `🎉 Sorteio feito! ${envio.total} e-mails enviados.`);
});

$('#form-reenviar').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target;
  const ok = await executar(() => api.chamar('reenviar', { email: form.email.value }), 'E-mail reenviado! Confira sua caixa de entrada (e o spam).');
  if (ok) form.reset();
});

$('#form-desfazer').addEventListener('submit', e => {
  e.preventDefault();
  const form = e.target;
  if (!confirm('Desfazer o sorteio? O resultado atual será descartado.')) return;
  executar(async () => {
    estado = await api.chamar('desfazerSorteio', { pin: form.pin.value });
    form.reset();
    render();
  }, 'Sorteio desfeito. O cadastro está aberto novamente.');
});

// ===== Utilidades =====
function lerLocal(chave) {
  try { return localStorage.getItem(chave) || ''; } catch { return ''; }
}

function salvarLocal(chave, valor) {
  try { localStorage.setItem(chave, valor); } catch { /* sem armazenamento: só não lembra */ }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let timerToast;
function toast(msg, erro = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast toast--visivel' + (erro ? ' toast--erro' : '');
  clearTimeout(timerToast);
  timerToast = setTimeout(() => { el.className = 'toast'; }, erro ? 6000 : 4000);
}

// ===== Modo demonstração (sem backend) =====
// Imita o backend usando o armazenamento do navegador. Os "e-mails" vão para o console.
function criarApiDemo() {
  const CHAVE = PREFIXO + '-demo';
  const PIN = '1234';
  let db = { participantes: [], alimentos: [], mensagens: [], sorteio: null, votacao: null };
  try { db = JSON.parse(localStorage.getItem(CHAVE)) || db; } catch { /* sem armazenamento */ }
  db.mensagens = db.mensagens || [];
  const salvar = () => { try { localStorage.setItem(CHAVE, JSON.stringify(db)); } catch { /* ignora */ } };
  const id = () => Math.random().toString(36).slice(2, 10);
  const aberto = () => { if (db.sorteio) throw new Error('O sorteio já foi realizado — o cadastro está fechado.'); };
  const pin = p => { if (p !== PIN) throw new Error('PIN do organizador incorreto.'); };
  const embaralhar = lista => {
    const a = lista.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const publico = () => {
    const nomes = Object.fromEntries(db.participantes.map(p => [p.id, p.nome]));
    return {
      evento: GRUPO.evento || 'Festas de Fim de Ano da Família',
      minParticipantes: 3,
      sorteado: !!db.sorteio,
      dataSorteio: db.sorteio && db.sorteio.data,
      participantes: db.participantes.map(p => {
        const [u, d] = p.email.split('@');
        return { id: p.id, nome: p.nome, email: `${u.slice(0, 2)}•••@${d}`, desejos: p.desejos };
      }),
      alimentos: db.alimentos.map(a => ({
        id: a.id, item: a.item, escolhidoPor: nomes[a.escolhidoPor] || '',
        responsavel: db.sorteio ? nomes[a.responsavelId] || '' : '',
      })),
      votacao: db.votacao && {
        aberta: db.votacao.aberta,
        valorFinal: db.votacao.valorFinal,
        opcoes: db.votacao.opcoes.map((rotulo, i) => ({
          rotulo, nomes: db.participantes.filter(p => db.votacao.votos[p.id] === i).map(p => p.nome),
        })),
        faltam: db.participantes.filter(p => db.votacao.votos[p.id] == null).map(p => p.nome),
      },
      mensagens: db.mensagens.slice(-50).map(m => {
        const o = m.respondeA && db.mensagens.find(x => x.id === m.respondeA);
        return {
          ...m,
          resposta: m.respondeA ? (o ? { id: o.id, nome: o.nome, texto: o.texto.slice(0, 120) } : { apagada: true }) : null,
        };
      }),
    };
  };
  const enviar = p => {
    console.info(`📧 [demo] Para ${p.email}: o sorteio foi feito! Link: ${location.pathname}?ver=demo-ver-${p.id}`);
  };

  const convidar = p => {
    console.info(`📧 [demo] Para ${p.email}: vote no valor do presente: ${location.pathname}?votar=demo-voto-${p.id}`);
  };
  const votante = token => {
    const p = db.votacao && db.participantes.find(x => 'demo-voto-' + x.id === token);
    if (!p) throw new Error('Este link de votação não é válido. Peça um novo na página.');
    return p;
  };
  const votacaoAberta = () => {
    if (!db.votacao || !db.votacao.aberta) throw new Error('Não há votação aberta.');
    return db.votacao;
  };

  const porToken = token => {
    const p = db.participantes.find(x => 'demo-' + x.id === token);
    if (!p) throw new Error('Este link de edição expirou ou não é válido. Peça um novo na página.');
    return p;
  };

  const acoes = {
    addParticipante({ nome, email, desejos: lista }) {
      aberto();
      nome = String(nome).trim();
      email = String(email).trim().toLowerCase();
      if (!nome) throw new Error('Informe o nome.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('E-mail inválido.');
      if (db.participantes.some(p => p.email === email)) throw new Error('Este e-mail já está cadastrado.');
      db.participantes.push({ id: id(), nome, email, desejos: lista.slice(0, 10) });
    },
    removerParticipante({ id: alvo, pin: p }) {
      pin(p);
      aberto();
      db.participantes = db.participantes.filter(x => x.id !== alvo);
    },
    pedirLinkEdicao({ id: alvo }) {
      const p = db.participantes.find(x => x.id === alvo);
      if (!p) throw new Error('Participante não encontrado.');
      console.info(`📧 [demo] Link de edição para ${p.email}: ${location.pathname}?editar=demo-${p.id}`);
      return { enviado: true };
    },
    abrirEdicao({ token }) {
      const p = porToken(token);
      return { nome: p.nome, desejos: p.desejos };
    },
    salvarDesejos({ token, desejos: lista }) {
      const p = porToken(token);
      p.desejos = lista.slice(0, 10);
      return { avisado: !!db.sorteio };
    },
    removerMeuCadastro({ token }) {
      aberto();
      const p = porToken(token);
      db.participantes = db.participantes.filter(x => x.id !== p.id);
    },
    addAlimento({ item }) {
      aberto();
      item = String(item).trim();
      if (!item) throw new Error('Informe o alimento.');
      db.alimentos.push({ id: id(), item, responsavelId: '' });
    },
    removerAlimento({ id: alvo }) {
      aberto();
      db.alimentos = db.alimentos.filter(a => a.id !== alvo);
    },
    escolherAlimento({ id: alvo, participanteId }) {
      aberto();
      const a = db.alimentos.find(x => x.id === alvo);
      if (!a || !db.participantes.some(p => p.id === participanteId)) throw new Error('Item ou participante não encontrado.');
      a.escolhidoPor = participanteId;
    },
    soltarAlimento({ id: alvo }) {
      aberto();
      const a = db.alimentos.find(x => x.id === alvo);
      if (a) a.escolhidoPor = '';
    },
    enviarMensagem({ nome, texto, respondeA }) {
      nome = String(nome).trim().slice(0, 40);
      texto = String(texto).trim().slice(0, 300);
      if (!nome || !texto) throw new Error('Informe seu nome e a mensagem.');
      const original = respondeA && db.mensagens.find(m => m.id === respondeA);
      if (respondeA && !original) throw new Error('A mensagem que você quer responder não existe mais.');
      db.mensagens.push({ id: id(), nome, texto, quando: new Date().toISOString(), respondeA: original ? original.id : '' });
      // Mesma regra do backend (simplificada): avisa o participante com o mesmo nome do autor.
      const dono = original && original.nome.toLowerCase() !== nome.toLowerCase()
        && db.participantes.find(p => p.nome.toLowerCase() === original.nome.toLowerCase());
      if (dono) console.info(`📧 [demo] Para ${dono.email}: ${nome} respondeu seu recado: "${texto}"`);
      return { avisado: dono ? dono.nome : '' };
    },
    apagarMensagem({ id: alvo, pin: p }) {
      pin(p);
      db.mensagens = db.mensagens.filter(m => m.id !== alvo);
    },
    abrirVotacao({ opcoes, pin: p }) {
      pin(p);
      if (db.votacao && db.votacao.aberta) throw new Error('Já existe uma votação aberta. Encerre-a antes de abrir outra.');
      opcoes = [...new Set(opcoes.map(o => String(o).trim().slice(0, 30)).filter(Boolean))];
      if (opcoes.length < 2 || opcoes.length > 6) throw new Error('Informe de 2 a 6 opções de valor.');
      if (!db.participantes.length) throw new Error('Ainda não há participantes para votar.');
      db.votacao = { opcoes, votos: {}, aberta: true, valorFinal: '' };
      db.participantes.forEach(convidar);
      return { envio: { total: db.participantes.length, falhas: [] } };
    },
    abrirVoto({ token }) {
      const p = votante(token);
      const voto = db.votacao.votos[p.id];
      return { nome: p.nome, voto: voto == null ? null : voto };
    },
    votar({ token, opcao }) {
      const p = votante(token);
      if (!db.votacao.aberta) throw new Error('A votação já foi encerrada.');
      db.votacao.votos[p.id] = opcao;
    },
    reenviarVoto({ id: alvo }) {
      votacaoAberta();
      const p = db.participantes.find(x => x.id === alvo);
      if (!p) throw new Error('Participante não encontrado.');
      convidar(p);
      return { enviado: true };
    },
    lembrarVotacao({ pin: p }) {
      pin(p);
      const v = votacaoAberta();
      const faltam = db.participantes.filter(x => v.votos[x.id] == null);
      if (!faltam.length) throw new Error('Todo mundo já votou! 🎉');
      faltam.forEach(convidar);
      return { total: faltam.length, falhas: [] };
    },
    encerrarVotacao({ opcao, pin: p }) {
      pin(p);
      const v = votacaoAberta();
      v.aberta = false;
      v.valorFinal = v.opcoes[opcao];
      console.info(`📧 [demo] Para todos: valor combinado ${v.valorFinal}`);
    },
    sortear({ pin: p }) {
      pin(p);
      aberto();
      if (db.participantes.length < 3) throw new Error('São necessários pelo menos 3 participantes.');
      const ordem = embaralhar(db.participantes.map(x => x.id));
      const pares = {};
      ordem.forEach((x, i) => { pares[x] = ordem[(i + 1) % ordem.length]; });
      // Mesma regra do backend: escolhas respeitadas, o resto vai para quem tem menos itens.
      const contagem = Object.fromEntries(db.participantes.map(x => [x.id, 0]));
      const livres = [];
      db.alimentos.forEach(a => {
        if (a.escolhidoPor in contagem) {
          a.responsavelId = a.escolhidoPor;
          contagem[a.escolhidoPor]++;
        } else {
          livres.push(a);
        }
      });
      embaralhar(livres).forEach(a => {
        const escolhido = embaralhar(Object.keys(contagem)).reduce((menor, x) => (contagem[x] < contagem[menor] ? x : menor));
        a.responsavelId = escolhido;
        contagem[escolhido]++;
      });
      db.sorteio = { pares, vistos: {}, data: new Date().toISOString() };
      db.participantes.forEach(enviar);
      return { envio: { total: db.participantes.length, falhas: [] } };
    },
    reenviar({ email }) {
      if (!db.sorteio) throw new Error('O sorteio ainda não foi realizado.');
      const p = db.participantes.find(x => x.email === String(email).trim().toLowerCase());
      if (!p) throw new Error('Este e-mail não está entre os participantes.');
      enviar(p);
      return { enviado: true };
    },
    revelar({ token }) {
      if (!db.sorteio) throw new Error('O sorteio ainda não foi realizado.');
      const quem = db.participantes.find(x => 'demo-ver-' + x.id === token);
      const amigo = quem && db.participantes.find(x => x.id === db.sorteio.pares[quem.id]);
      if (!amigo) throw new Error('Este link não é válido. Peça um novo em "Reenviar meu resultado".');
      const abertoEm = db.sorteio.vistos[quem.id] || null;
      if (!abertoEm) db.sorteio.vistos[quem.id] = new Date().toISOString();
      return {
        nome: quem.nome, amigo: amigo.nome, desejos: amigo.desejos,
        itens: db.alimentos.filter(a => a.responsavelId === quem.id).map(a => a.item), abertoEm,
      };
    },
    desfazerSorteio({ pin: p }) {
      pin(p);
      db.sorteio = null;
      db.alimentos.forEach(a => { a.responsavelId = ''; });
    },
  };

  return {
    async estado() { return publico(); },
    async chamar(action, dados = {}) {
      const extra = acoes[action](dados);
      salvar();
      const soResultado = ['reenviar', 'pedirLinkEdicao', 'abrirEdicao', 'revelar', 'abrirVoto', 'reenviarVoto', 'lembrarVotacao'];
      return soResultado.includes(action) ? extra : { ...publico(), ...extra };
    },
  };
}

// ===== Início =====
$('#aviso-demo').hidden = !!API_URL;
if (API_URL && !codigoFamilia) bloquear();
else carregar().then(ok => { if (ok) { abrirEdicao(); mostrarRevelar(); abrirVoto(votoDaUrl); } });
// Atualiza a lista de tempos em tempos para mostrar o que os outros adicionaram.
const podeAtualizar = () => !document.hidden && !ocupado && (codigoFamilia || !API_URL);
setInterval(() => { if (podeAtualizar()) carregar(true); }, 20000);
document.addEventListener('visibilitychange', () => { if (podeAtualizar()) carregar(true); });
