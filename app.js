// URL do App da Web do Google Apps Script (termina em /exec). Veja o README.
// Deixe vazio para usar o modo demonstração (dados só neste navegador, sem e-mails).
const API_URL = 'https://script.google.com/macros/s/AKfycbzewncunU9JZB5bXP7xJWf5mxeJhTTSDJZjCq75GZ8L4TcTu8-tzG1QRd8_YHPpukT_/exec';

const $ = sel => document.querySelector(sel);
let estado = null;
let ocupado = false;
let desejos = [];

// ===== Código da família (guardado neste aparelho para não pedir toda vez) =====
const CHAVE_CODIGO = 'amigo-secreto-codigo';
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
        ${sorteado ? '' : `<button class="remover" data-remover-participante="${esc(p.id)}" title="Remover ${esc(p.nome)}" aria-label="Remover ${esc(p.nome)}">✕</button>`}
      </li>`).join('')
    : '<li class="lista__vazia">Ninguém cadastrado ainda. Seja o primeiro!</li>';

  const listaAlimentos = $('#lista-alimentos');
  listaAlimentos.hidden = sorteado;
  listaAlimentos.innerHTML = alimentos.length
    ? alimentos.map(a => `
      <li class="chip">${esc(a.item)}
        <button data-remover-alimento="${esc(a.id)}" title="Remover ${esc(a.item)}" aria-label="Remover ${esc(a.item)}">×</button>
      </li>`).join('')
    : '<li class="lista__vazia">Nenhum item na lista ainda.</li>';

  const divisao = $('#divisao-alimentos');
  divisao.hidden = !sorteado;
  if (sorteado) {
    divisao.innerHTML = participantes.map(p => {
      const itens = alimentos.filter(a => a.responsavel === p.nome).map(a => a.item);
      return `<div class="divisao__pessoa"><strong>${esc(p.nome)}</strong>${itens.length
        ? `<ul>${itens.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`
        : '<span class="vazio">Nada desta vez</span>'}</div>`;
    }).join('');
  }

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

function renderDesejos() {
  const caixa = $('#tags-desejos');
  caixa.querySelectorAll('.chip').forEach(c => c.remove());
  const input = $('#input-desejo');
  desejos.forEach((d, i) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `${esc(d)} <button type="button" data-remover-desejo="${i}" aria-label="Remover ${esc(d)}">×</button>`;
    caixa.insertBefore(chip, input);
  });
}

function addDesejosDoInput() {
  const input = $('#input-desejo');
  input.value.split(',').map(s => s.trim()).filter(Boolean).forEach(d => {
    if (desejos.length < 10 && !desejos.some(x => x.toLowerCase() === d.toLowerCase())) desejos.push(d);
  });
  input.value = '';
  renderDesejos();
}

// ===== Ações =====
async function executar(fn, sucesso) {
  if (ocupado) return;
  ocupado = true;
  document.querySelectorAll('button').forEach(b => { b.disabled = true; });
  try {
    const resultado = await fn();
    if (sucesso) toast(typeof sucesso === 'function' ? sucesso(resultado) : sucesso);
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
  }
});

$('#form-participante').addEventListener('submit', async e => {
  e.preventDefault();
  addDesejosDoInput();
  const form = e.target;
  const ok = await executar(async () => {
    estado = await api.chamar('addParticipante', {
      nome: form.nome.value, email: form.email.value, desejos,
    });
    render();
    return true;
  }, 'Cadastro feito! 🎄');
  if (ok) {
    form.reset();
    desejos = [];
    renderDesejos();
  }
});

$('#input-desejo').addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    addDesejosDoInput();
  } else if (e.key === 'Backspace' && !e.target.value && desejos.length) {
    desejos.pop();
    renderDesejos();
  }
});
$('#input-desejo').addEventListener('blur', addDesejosDoInput);
$('#tags-desejos').addEventListener('click', e => {
  const btn = e.target.closest('[data-remover-desejo]');
  if (btn) {
    desejos.splice(Number(btn.dataset.removerDesejo), 1);
    renderDesejos();
  } else {
    $('#input-desejo').focus();
  }
});

$('#lista-participantes').addEventListener('click', e => {
  const btn = e.target.closest('[data-remover-participante]');
  if (!btn) return;
  const p = estado.participantes.find(x => x.id === btn.dataset.removerParticipante);
  if (!p || !confirm(`Remover ${p.nome} do amigo secreto?`)) return;
  executar(async () => {
    estado = await api.chamar('removerParticipante', { id: p.id });
    render();
  }, `${p.nome} foi removido(a).`);
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
  const btn = e.target.closest('[data-remover-alimento]');
  if (!btn) return;
  executar(async () => {
    estado = await api.chamar('removerAlimento', { id: btn.dataset.removerAlimento });
    render();
  });
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
  const CHAVE = 'amigo-secreto-demo';
  const PIN = '1234';
  let db = { participantes: [], alimentos: [], sorteio: null };
  try { db = JSON.parse(localStorage.getItem(CHAVE)) || db; } catch { /* sem armazenamento */ }
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
      evento: 'Festas de Fim de Ano da Família',
      minParticipantes: 3,
      sorteado: !!db.sorteio,
      dataSorteio: db.sorteio && db.sorteio.data,
      participantes: db.participantes.map(p => {
        const [u, d] = p.email.split('@');
        return { id: p.id, nome: p.nome, email: `${u.slice(0, 2)}•••@${d}`, desejos: p.desejos };
      }),
      alimentos: db.alimentos.map(a => ({ id: a.id, item: a.item, responsavel: db.sorteio ? nomes[a.responsavelId] || '' : '' })),
    };
  };
  const enviar = p => {
    const amigo = db.participantes.find(x => x.id === db.sorteio.pares[p.id]);
    const itens = db.alimentos.filter(a => a.responsavelId === p.id).map(a => a.item);
    console.info(`📧 [demo] Para ${p.email}: seu amigo secreto é ${amigo.nome} (deseja: ${amigo.desejos.join(', ') || '—'}). Você leva: ${itens.join(', ') || 'nada'}.`);
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
    removerParticipante({ id: alvo }) {
      aberto();
      db.participantes = db.participantes.filter(p => p.id !== alvo);
    },
    addAlimento({ item }) {
      aberto();
      item = String(item).trim();
      if (!item) throw new Error('Informe o alimento.');
      if (db.alimentos.some(a => a.item.toLowerCase() === item.toLowerCase())) throw new Error('Este item já está na lista.');
      db.alimentos.push({ id: id(), item, responsavelId: '' });
    },
    removerAlimento({ id: alvo }) {
      aberto();
      db.alimentos = db.alimentos.filter(a => a.id !== alvo);
    },
    sortear({ pin: p }) {
      pin(p);
      aberto();
      if (db.participantes.length < 3) throw new Error('São necessários pelo menos 3 participantes.');
      const ordem = embaralhar(db.participantes.map(x => x.id));
      const pares = {};
      ordem.forEach((x, i) => { pares[x] = ordem[(i + 1) % ordem.length]; });
      const pessoas = embaralhar(db.participantes.map(x => x.id));
      embaralhar(db.alimentos).forEach((a, i) => { a.responsavelId = pessoas[i % pessoas.length]; });
      db.sorteio = { pares, data: new Date().toISOString() };
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
      return action === 'reenviar' ? extra : { ...publico(), ...extra };
    },
  };
}

// ===== Início =====
$('#aviso-demo').hidden = !!API_URL;
if (API_URL && !codigoFamilia) bloquear();
else carregar();
// Atualiza a lista de tempos em tempos para mostrar o que os outros adicionaram.
const podeAtualizar = () => !document.hidden && !ocupado && (codigoFamilia || !API_URL);
setInterval(() => { if (podeAtualizar()) carregar(true); }, 30000);
document.addEventListener('visibilitychange', () => { if (podeAtualizar()) carregar(true); });
