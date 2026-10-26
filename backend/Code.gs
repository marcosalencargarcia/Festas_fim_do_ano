/**
 * Amigo Secreto & Ceia de Fim de Ano — backend em Google Apps Script.
 *
 * Resumo da instalação (detalhes no README.md):
 *  1. Crie uma Planilha Google > Extensões > Apps Script > cole este arquivo.
 *  2. Troque o PIN_ORGANIZADOR abaixo.
 *  3. Execute a função "configurar" uma vez (autoriza o acesso e envia um e-mail de teste).
 *  4. Implantar > Nova implantação > App da Web
 *     (Executar como: Eu | Quem pode acessar: Qualquer pessoa).
 */

// ===== Configurações =====
// ID da planilha (o trecho entre /d/ e /edit no link). Vazio = planilha à qual o script está vinculado.
const PLANILHA_ID = '18u4HrPgxrmv8LWrZB64TsVd-qFQVN8Uu3fSnftGQ3RQ';
const PIN_ORGANIZADOR = 'troque-este-pin';
const NOME_EVENTO = 'Festas de Fim de Ano da Família';
const MIN_PARTICIPANTES = 3;

const ABA_PARTICIPANTES = 'Participantes';
const ABA_ALIMENTOS = 'Alimentos';
const PROP_SORTEIO = 'sorteio'; // JSON { pares: { idQuemDa: idQuemRecebe }, data }

// ===== Entrada HTTP =====
function doGet() {
  return responder(() => estado());
}

function doPost(e) {
  return responder(() => {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const acoes = {
      addParticipante, removerParticipante, addAlimento, removerAlimento,
      sortear, reenviar, desfazerSorteio,
    };
    const acao = acoes[req.action];
    if (!acao) throw new Error('Ação desconhecida.');
    return comLock(() => acao(req));
  });
}

function responder(fn) {
  let saida;
  try {
    saida = { ok: true, data: fn() };
  } catch (err) {
    saida = { ok: false, error: err.message };
  }
  return ContentService.createTextOutput(JSON.stringify(saida))
    .setMimeType(ContentService.MimeType.JSON);
}

function comLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ===== Ações =====
function addParticipante(req) {
  exigirCadastroAberto();
  const nome = texto(req.nome, 60);
  const email = texto(req.email, 120).toLowerCase();
  const desejos = (Array.isArray(req.desejos) ? req.desejos : [])
    .map(d => texto(d, 100)).filter(Boolean).slice(0, 10);

  if (!nome) throw new Error('Informe o nome.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('E-mail inválido.');
  if (lerParticipantes().some(p => p.email === email)) throw new Error('Este e-mail já está cadastrado.');

  abaParticipantes().appendRow([Utilities.getUuid(), celula(nome), email, celula(desejos.join('\n')), new Date()]);
  return estado();
}

function removerParticipante(req) {
  exigirCadastroAberto();
  removerLinhaPorId(abaParticipantes(), String(req.id));
  return estado();
}

function addAlimento(req) {
  exigirCadastroAberto();
  const item = texto(req.item, 80);
  if (!item) throw new Error('Informe o alimento.');
  if (lerAlimentos().some(a => a.item.toLowerCase() === item.toLowerCase())) {
    throw new Error('Este item já está na lista.');
  }
  abaAlimentos().appendRow([Utilities.getUuid(), celula(item), '', new Date()]);
  return estado();
}

function removerAlimento(req) {
  exigirCadastroAberto();
  removerLinhaPorId(abaAlimentos(), String(req.id));
  return estado();
}

function sortear(req) {
  exigirPin(req.pin);
  exigirCadastroAberto();

  const participantes = lerParticipantes();
  if (participantes.length < MIN_PARTICIPANTES) {
    throw new Error(`São necessários pelo menos ${MIN_PARTICIPANTES} participantes.`);
  }
  if (MailApp.getRemainingDailyQuota() < participantes.length) {
    throw new Error('A cota diária de e-mails do Gmail não é suficiente. Tente novamente amanhã.');
  }

  // Amigo secreto: embaralha e fecha um único ciclo (cada um tira o próximo da fila),
  // assim ninguém tira a si mesmo e todos dão e recebem exatamente um presente.
  const ordem = embaralhar(participantes.map(p => p.id));
  const pares = {};
  ordem.forEach((id, i) => { pares[id] = ordem[(i + 1) % ordem.length]; });

  // Alimentos: rodízio sobre itens e pessoas em ordem aleatória, o mais equilibrado possível.
  const sh = abaAlimentos();
  const dados = sh.getDataRange().getValues();
  const pessoas = embaralhar(participantes.map(p => p.id));
  const linhas = embaralhar(dados.map((_, i) => i).filter(i => i > 0 && dados[i][0]));
  linhas.forEach((linha, i) => { dados[linha][2] = pessoas[i % pessoas.length]; });
  if (dados.length > 1) {
    sh.getRange(2, 3, dados.length - 1, 1).setValues(dados.slice(1).map(r => [r[2]]));
  }

  PropertiesService.getScriptProperties()
    .setProperty(PROP_SORTEIO, JSON.stringify({ pares, data: new Date().toISOString() }));

  const alimentos = lerAlimentos();
  const falhas = [];
  participantes.forEach(p => {
    try {
      enviarResultado(p, participantes, pares, alimentos);
    } catch (err) {
      falhas.push(p.nome);
    }
  });

  return Object.assign(estado(), { envio: { total: participantes.length, falhas } });
}

function reenviar(req) {
  const sorteio = lerSorteio();
  if (!sorteio) throw new Error('O sorteio ainda não foi realizado.');
  const email = texto(req.email, 120).toLowerCase();
  const participantes = lerParticipantes();
  const quem = participantes.find(p => p.email === email);
  if (!quem) throw new Error('Este e-mail não está entre os participantes.');
  enviarResultado(quem, participantes, sorteio.pares, lerAlimentos());
  return { enviado: true };
}

function desfazerSorteio(req) {
  exigirPin(req.pin);
  PropertiesService.getScriptProperties().deleteProperty(PROP_SORTEIO);
  const sh = abaAlimentos();
  if (sh.getLastRow() > 1) sh.getRange(2, 3, sh.getLastRow() - 1, 1).clearContent();
  return estado();
}

// ===== Estado público (nunca inclui os pares do amigo secreto) =====
function estado() {
  const sorteio = lerSorteio();
  const participantes = lerParticipantes();
  const nomes = {};
  participantes.forEach(p => { nomes[p.id] = p.nome; });

  return {
    evento: NOME_EVENTO,
    minParticipantes: MIN_PARTICIPANTES,
    sorteado: !!sorteio,
    dataSorteio: sorteio ? sorteio.data : null,
    participantes: participantes.map(p => ({
      id: p.id, nome: p.nome, email: mascarar(p.email), desejos: p.desejos,
    })),
    alimentos: lerAlimentos().map(a => ({
      id: a.id, item: a.item, responsavel: sorteio ? (nomes[a.responsavelId] || '') : '',
    })),
  };
}

// ===== E-mail =====
function enviarResultado(quem, participantes, pares, alimentos) {
  const amigo = participantes.find(p => p.id === pares[quem.id]);
  if (!amigo) throw new Error('Par não encontrado para ' + quem.nome);
  const meusItens = alimentos.filter(a => a.responsavelId === quem.id).map(a => a.item);

  const desejosHtml = amigo.desejos.length
    ? '<ul style="margin:8px 0 0;padding-left:20px">' + amigo.desejos.map(d => `<li>${esc(d)}</li>`).join('') + '</ul>'
    : '<p style="margin:8px 0 0;color:#666">Não deixou sugestões — capriche na surpresa!</p>';
  const itensHtml = meusItens.length
    ? '<ul style="margin:8px 0 0;padding-left:20px">' + meusItens.map(i => `<li>${esc(i)}</li>`).join('') + '</ul>'
    : '<p style="margin:8px 0 0;color:#666">Nenhum item ficou com você desta vez. 😉</p>';

  const htmlBody = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:auto;color:#1d2b22">
    <div style="background:#14532d;color:#fff;padding:24px;border-radius:12px 12px 0 0;text-align:center">
      <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#f5d27a">${esc(NOME_EVENTO)}</div>
      <h1 style="margin:8px 0 0;font-size:22px">Olá, ${esc(quem.nome)}! 🎄</h1>
    </div>
    <div style="background:#fffaf0;padding:24px;border:1px solid #eadfc8;border-top:0;border-radius:0 0 12px 12px">
      <p style="margin:0 0 4px">Seu amigo secreto é:</p>
      <p style="font-size:26px;font-weight:bold;color:#b91c1c;margin:0 0 16px">🎁 ${esc(amigo.nome)}</p>
      <strong>Gostaria de ganhar:</strong>
      ${desejosHtml}
      <hr style="border:0;border-top:1px solid #eadfc8;margin:20px 0">
      <strong>🍗 Você vai levar para a ceia:</strong>
      ${itensHtml}
      <p style="margin:24px 0 0;font-size:13px;color:#666">Guarde segredo! 🤫 Este e-mail foi enviado só para você.</p>
    </div>
  </div>`;

  MailApp.sendEmail({
    to: quem.email,
    subject: `🎁 Seu amigo secreto — ${NOME_EVENTO}`,
    htmlBody,
    name: 'Amigo Secreto da Família',
  });
}

// ===== Planilha =====
function abaParticipantes() {
  return aba(ABA_PARTICIPANTES, ['id', 'nome', 'email', 'desejos', 'criadoEm']);
}

function abaAlimentos() {
  return aba(ABA_ALIMENTOS, ['id', 'item', 'responsavelId', 'criadoEm']);
}

function aba(nome, cabecalho) {
  const ss = PLANILHA_ID ? SpreadsheetApp.openById(PLANILHA_ID) : SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(nome);
  if (!sh) {
    sh = ss.insertSheet(nome);
    sh.appendRow(cabecalho);
    sh.setFrozenRows(1);
  }
  return sh;
}

function linhasComId(sh) {
  return sh.getDataRange().getValues().slice(1).filter(r => r[0]);
}

function lerParticipantes() {
  return linhasComId(abaParticipantes()).map(r => ({
    id: String(r[0]),
    nome: String(r[1]),
    email: String(r[2]).toLowerCase(),
    desejos: String(r[3] || '').split('\n').map(s => s.trim()).filter(Boolean),
  }));
}

function lerAlimentos() {
  return linhasComId(abaAlimentos()).map(r => ({
    id: String(r[0]), item: String(r[1]), responsavelId: String(r[2] || ''),
  }));
}

function removerLinhaPorId(sh, id) {
  const valores = sh.getDataRange().getValues();
  for (let i = 1; i < valores.length; i++) {
    if (String(valores[i][0]) === id) {
      sh.deleteRow(i + 1);
      return;
    }
  }
  throw new Error('Registro não encontrado (talvez já tenha sido removido).');
}

function lerSorteio() {
  const bruto = PropertiesService.getScriptProperties().getProperty(PROP_SORTEIO);
  return bruto ? JSON.parse(bruto) : null;
}

// ===== Utilidades =====
function exigirCadastroAberto() {
  if (lerSorteio()) throw new Error('O sorteio já foi realizado — o cadastro está fechado.');
}

function exigirPin(pin) {
  if (String(pin || '') !== PIN_ORGANIZADOR) throw new Error('PIN do organizador incorreto.');
}

function texto(valor, max) {
  return String(valor == null ? '' : valor).trim().slice(0, max);
}

// Evita que um texto começando com "=" vire fórmula na planilha.
function celula(valor) {
  return /^[=+\-@]/.test(valor) ? "'" + valor : valor;
}

function embaralhar(lista) {
  const a = lista.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function mascarar(email) {
  const [usuario, dominio] = email.split('@');
  return usuario.slice(0, 2) + '•••@' + (dominio || '');
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Execute UMA vez pelo editor: cria as abas, pede autorização e envia um e-mail de teste para você. */
function configurar() {
  abaParticipantes();
  abaAlimentos();
  const eu = Session.getEffectiveUser().getEmail();
  MailApp.sendEmail(eu, `Teste — ${NOME_EVENTO}`, 'Tudo certo! O sistema do amigo secreto já consegue enviar e-mails. 🎄');
  Logger.log('Pronto! Abas criadas e e-mail de teste enviado para ' + eu);
}
