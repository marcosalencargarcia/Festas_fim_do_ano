/**
 * Amigo Secreto & Ceia de Fim de Ano — backend em Google Apps Script.
 *
 * Resumo da instalação (detalhes no README.md):
 *  1. Crie uma Planilha Google > Extensões > Apps Script > cole este arquivo.
 *  2. Troque o PIN_ORGANIZADOR e o CODIGO_FAMILIA abaixo (só no editor, nunca no GitHub).
 *  3. Execute a função "configurar" uma vez (autoriza o acesso e envia um e-mail de teste).
 *  4. Implantar > Nova implantação > App da Web
 *     (Executar como: Eu | Quem pode acessar: Qualquer pessoa).
 */

// ===== Configurações =====
// ID da planilha (o trecho entre /d/ e /edit no link). Vazio = planilha à qual o script está vinculado.
const PLANILHA_ID = '18u4HrPgxrmv8LWrZB64TsVd-qFQVN8Uu3fSnftGQ3RQ';
const PIN_ORGANIZADOR = 'troque-este-pin';
// Palavra combinada enviada à família junto com o link. Sem ela, a página não mostra nem altera nada.
const CODIGO_FAMILIA = 'troque-este-codigo';
const NOME_EVENTO = 'Festas de Fim de Ano da Família';
const MIN_PARTICIPANTES = 3;
// Endereço da página publicada (usado no link de edição enviado por e-mail).
const URL_PAGINA = 'https://marcosalencargarcia.github.io/Festas_fim_do_ano/';

const MAX_TENTATIVAS_PIN = 5;
const BLOQUEIO_PIN_SEG = 15 * 60;
const INTERVALO_REENVIO_SEG = 10 * 60;
const VALIDADE_LINK_SEG = 6 * 60 * 60; // máximo permitido pelo CacheService
const INTERVALO_LINK_SEG = 5 * 60;

const MAX_MENSAGENS = 50;
const INTERVALO_MENSAGEM_SEG = 3;

const ABA_PARTICIPANTES = 'Participantes';
const ABA_ALIMENTOS = 'Alimentos';
const ABA_MENSAGENS = 'Mensagens';
const PROP_SORTEIO = 'sorteio'; // JSON { pares: { idQuemDa: idQuemRecebe }, data }

// ===== Entrada HTTP =====
function doGet() {
  return json({ ok: false, error: 'Acesse pela página do amigo secreto.' });
}

function doPost(e) {
  let req = {};
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) { /* corpo inválido: cai na checagem do código abaixo */ }

  if (String(req.codigo || '') !== CODIGO_FAMILIA) {
    return json({ ok: false, error: 'Código da família incorreto.', codigoInvalido: true });
  }

  return responder(() => {
    if (req.action === 'estado') return estado();
    const acoes = {
      addParticipante, removerParticipante, addAlimento, removerAlimento,
      sortear, reenviar, desfazerSorteio,
      pedirLinkEdicao, abrirEdicao, salvarDesejos, removerMeuCadastro,
      escolherAlimento, soltarAlimento, enviarMensagem, apagarMensagem,
    };
    const acao = acoes[req.action];
    if (!acao) throw new Error('Ação desconhecida.');
    return comLock(() => acao(req));
  });
}

function responder(fn) {
  try {
    return json({ ok: true, data: fn() });
  } catch (err) {
    return json({ ok: false, error: err.message });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
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
  const desejos = limparDesejos(req.desejos);

  if (!nome) throw new Error('Informe o nome.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('E-mail inválido.');
  if (lerParticipantes().some(p => p.email === email)) throw new Error('Este e-mail já está cadastrado.');

  abaParticipantes().appendRow([Utilities.getUuid(), celula(nome), email, celula(desejos.join('\n')), new Date()]);
  return estado();
}

// Só o organizador remove outras pessoas; cada um pode sair sozinho pelo link de edição.
function removerParticipante(req) {
  exigirPin(req.pin);
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
  const alimento = lerAlimentos().find(a => a.id === String(req.id));
  const dono = alimento && lerParticipantes().find(p => p.id === alimento.escolhidoPor);
  if (dono) throw new Error(`${dono.nome} já escolheu levar este item. Solte-o antes de remover.`);
  removerLinhaPorId(abaAlimentos(), String(req.id));
  return estado();
}

// "Eu levo": a pessoa reserva o item para si. O sorteio respeita essa escolha.
function escolherAlimento(req) {
  exigirCadastroAberto();
  const pessoa = lerParticipantes().find(p => p.id === String(req.participanteId));
  if (!pessoa) throw new Error('Escolha um participante cadastrado.');
  const alimento = lerAlimentos().find(a => a.id === String(req.id));
  if (!alimento) throw new Error('Este item não está mais na lista.');
  const dono = lerParticipantes().find(p => p.id === alimento.escolhidoPor);
  if (dono && dono.id !== pessoa.id) throw new Error(`${dono.nome} já vai levar este item.`);

  const sh = abaAlimentos();
  sh.getRange(linhaPorId(sh, alimento.id), 5).setValue(pessoa.id);
  return estado();
}

function soltarAlimento(req) {
  exigirCadastroAberto();
  const sh = abaAlimentos();
  sh.getRange(linhaPorId(sh, String(req.id)), 5).clearContent();
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

  // Alimentos: quem escolheu ("Eu levo") fica com o item. O resto vai, um a um, para quem
  // tem menos itens até então (empate decidido ao acaso), equilibrando o total de cada um.
  const sh = abaAlimentos();
  const dados = sh.getDataRange().getValues();
  const contagem = {};
  participantes.forEach(p => { contagem[p.id] = 0; });
  const livres = [];
  dados.forEach((r, i) => {
    if (i === 0 || !r[0]) return;
    const dono = String(r[4] || '');
    if (dono in contagem) {
      r[2] = dono;
      contagem[dono]++;
    } else {
      livres.push(i);
    }
  });
  embaralhar(livres).forEach(linha => {
    const candidatos = embaralhar(Object.keys(contagem));
    const escolhido = candidatos.reduce((menor, id) => (contagem[id] < contagem[menor] ? id : menor));
    dados[linha][2] = escolhido;
    contagem[escolhido]++;
  });
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

  // Limita os reenvios para ninguém lotar a caixa de um parente (nem gastar a cota do Gmail).
  const cache = CacheService.getScriptCache();
  const chave = 'reenvio:' + email;
  if (cache.get(chave)) throw new Error('Já reenviamos para este e-mail há pouco. Aguarde 10 minutos.');
  enviarResultado(quem, participantes, sorteio.pares, lerAlimentos());
  cache.put(chave, '1', INTERVALO_REENVIO_SEG);
  return { enviado: true };
}

function desfazerSorteio(req) {
  exigirPin(req.pin);
  PropertiesService.getScriptProperties().deleteProperty(PROP_SORTEIO);
  const sh = abaAlimentos();
  if (sh.getLastRow() > 1) sh.getRange(2, 3, sh.getLastRow() - 1, 1).clearContent();
  return estado();
}

// ===== Edição dos próprios desejos (link pessoal enviado por e-mail) =====
function pedirLinkEdicao(req) {
  const p = lerParticipantes().find(x => x.id === String(req.id));
  if (!p) throw new Error('Participante não encontrado.');

  const cache = CacheService.getScriptCache();
  if (cache.get('link:' + p.id)) throw new Error('Um link acabou de ser enviado para este e-mail. Aguarde 5 minutos.');

  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  cache.put('edicao:' + token, p.id, VALIDADE_LINK_SEG);
  cache.put('link:' + p.id, '1', INTERVALO_LINK_SEG);

  const link = URL_PAGINA + '?editar=' + token;
  MailApp.sendEmail({
    to: p.email,
    subject: `✏️ Editar seus desejos — ${NOME_EVENTO}`,
    htmlBody: moldura(`Olá, ${esc(p.nome)}! ✏️`, `
      <p style="margin:0 0 16px">Use o botão abaixo para editar a sua lista de desejos.</p>
      <p style="margin:0 0 16px"><a href="${esc(link)}" style="display:inline-block;background:#14532d;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Editar meus desejos</a></p>
      <p style="margin:0;font-size:13px;color:#666">O link vale por 6 horas. Se não foi você que pediu, é só ignorar este e-mail.</p>`),
    name: 'Amigo Secreto da Família',
  });
  return { enviado: true };
}

function abrirEdicao(req) {
  const p = participantePorToken(req.token);
  return { nome: p.nome, desejos: p.desejos };
}

function salvarDesejos(req) {
  const p = participantePorToken(req.token);
  const desejos = limparDesejos(req.desejos);
  const sh = abaParticipantes();
  sh.getRange(linhaPorId(sh, p.id), 4).setValue(celula(desejos.join('\n')));

  // Depois do sorteio, avisa só quem tirou esta pessoa. O segredo continua guardado.
  let avisado = false;
  const sorteio = lerSorteio();
  if (sorteio) {
    const idQuemTirou = Object.keys(sorteio.pares).find(id => sorteio.pares[id] === p.id);
    const quemTirou = lerParticipantes().find(x => x.id === idQuemTirou);
    if (quemTirou) {
      enviarDesejosAtualizados(quemTirou, p.nome, desejos);
      avisado = true;
    }
  }
  return Object.assign(estado(), { avisado });
}

function removerMeuCadastro(req) {
  exigirCadastroAberto();
  const p = participantePorToken(req.token);
  removerLinhaPorId(abaParticipantes(), p.id);
  CacheService.getScriptCache().remove('edicao:' + String(req.token));
  return estado();
}

// ===== Mini chat =====
function enviarMensagem(req) {
  const nome = texto(req.nome, 40);
  const mensagem = texto(req.texto, 300);
  if (!nome) throw new Error('Informe seu nome.');
  if (!mensagem) throw new Error('Escreva uma mensagem.');

  // Evita mensagens repetidas por clique duplo ou alguém apertando Enter sem parar.
  const cache = CacheService.getScriptCache();
  const chave = 'msg:' + nome.toLowerCase();
  if (cache.get(chave)) throw new Error('Calma! Espere uns segundos para mandar outra mensagem.');
  cache.put(chave, '1', INTERVALO_MENSAGEM_SEG);

  abaMensagens().appendRow([Utilities.getUuid(), celula(nome), celula(mensagem), new Date()]);
  return estado();
}

function apagarMensagem(req) {
  exigirPin(req.pin);
  removerLinhaPorId(abaMensagens(), String(req.id));
  return estado();
}

function participantePorToken(token) {
  const id = CacheService.getScriptCache().get('edicao:' + String(token || ''));
  const p = id && lerParticipantes().find(x => x.id === id);
  if (!p) throw new Error('Este link de edição expirou ou não é válido. Peça um novo na página.');
  return p;
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
      id: a.id,
      item: a.item,
      escolhidoPor: nomes[a.escolhidoPor] || '',
      responsavel: sorteio ? (nomes[a.responsavelId] || '') : '',
    })),
    mensagens: lerMensagens(),
  };
}

// ===== E-mail =====
function enviarResultado(quem, participantes, pares, alimentos) {
  const amigo = participantes.find(p => p.id === pares[quem.id]);
  if (!amigo) throw new Error('Par não encontrado para ' + quem.nome);
  const meusItens = alimentos.filter(a => a.responsavelId === quem.id).map(a => a.item);

  MailApp.sendEmail({
    to: quem.email,
    subject: `🎁 Seu amigo secreto — ${NOME_EVENTO}`,
    htmlBody: moldura(`Olá, ${esc(quem.nome)}! 🎄`, `
      <p style="margin:0 0 4px">Seu amigo secreto é:</p>
      <p style="font-size:26px;font-weight:bold;color:#b91c1c;margin:0 0 16px">🎁 ${esc(amigo.nome)}</p>
      <strong>Gostaria de ganhar:</strong>
      ${listaHtml(amigo.desejos, 'Não deixou sugestões — capriche na surpresa!')}
      <hr style="border:0;border-top:1px solid #eadfc8;margin:20px 0">
      <strong>🍗 Você vai levar para a ceia:</strong>
      ${listaHtml(meusItens, 'Nenhum item ficou com você desta vez. 😉')}
      <p style="margin:24px 0 0;font-size:13px;color:#666">Guarde segredo! 🤫 Este e-mail foi enviado só para você.</p>`),
    name: 'Amigo Secreto da Família',
  });
}

function enviarDesejosAtualizados(quem, nomeAmigo, desejos) {
  MailApp.sendEmail({
    to: quem.email,
    subject: `🎁 Seu amigo secreto atualizou a lista de desejos — ${NOME_EVENTO}`,
    htmlBody: moldura(`Olá, ${esc(quem.nome)}! 🎁`, `
      <p style="margin:0 0 16px"><strong>${esc(nomeAmigo)}</strong>, o seu amigo secreto, atualizou a lista de desejos:</p>
      ${listaHtml(desejos, 'A lista ficou vazia — capriche na surpresa!')}
      <p style="margin:24px 0 0;font-size:13px;color:#666">Guarde segredo! 🤫 Este e-mail foi enviado só para você.</p>`),
    name: 'Amigo Secreto da Família',
  });
}

function moldura(titulo, conteudo) {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:auto;color:#1d2b22">
    <div style="background:#14532d;color:#fff;padding:24px;border-radius:12px 12px 0 0;text-align:center">
      <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#f5d27a">${esc(NOME_EVENTO)}</div>
      <h1 style="margin:8px 0 0;font-size:22px">${titulo}</h1>
    </div>
    <div style="background:#fffaf0;padding:24px;border:1px solid #eadfc8;border-top:0;border-radius:0 0 12px 12px">
      ${conteudo}
    </div>
  </div>`;
}

function listaHtml(itens, textoVazio) {
  return itens.length
    ? '<ul style="margin:8px 0 0;padding-left:20px">' + itens.map(i => `<li>${esc(i)}</li>`).join('') + '</ul>'
    : `<p style="margin:8px 0 0;color:#666">${textoVazio}</p>`;
}

// ===== Planilha =====
function abaParticipantes() {
  return aba(ABA_PARTICIPANTES, ['id', 'nome', 'email', 'desejos', 'criadoEm']);
}

function abaAlimentos() {
  const sh = aba(ABA_ALIMENTOS, ['id', 'item', 'responsavelId', 'criadoEm', 'escolhidoPor']);
  // Planilhas criadas antes do "Eu levo" não têm a 5ª coluna no cabeçalho.
  if (sh.getRange(1, 5).getValue() !== 'escolhidoPor') sh.getRange(1, 5).setValue('escolhidoPor');
  return sh;
}

function abaMensagens() {
  return aba(ABA_MENSAGENS, ['id', 'nome', 'texto', 'criadoEm']);
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
    id: String(r[0]), item: String(r[1]), responsavelId: String(r[2] || ''), escolhidoPor: String(r[4] || ''),
  }));
}

function lerMensagens() {
  return linhasComId(abaMensagens()).slice(-MAX_MENSAGENS).map(r => ({
    id: String(r[0]), nome: String(r[1]), texto: String(r[2]),
    quando: r[3] instanceof Date ? r[3].toISOString() : '',
  }));
}

function linhaPorId(sh, id) {
  const valores = sh.getDataRange().getValues();
  for (let i = 1; i < valores.length; i++) {
    if (String(valores[i][0]) === id) return i + 1;
  }
  throw new Error('Registro não encontrado (talvez já tenha sido removido).');
}

function removerLinhaPorId(sh, id) {
  sh.deleteRow(linhaPorId(sh, id));
}

function lerSorteio() {
  const bruto = PropertiesService.getScriptProperties().getProperty(PROP_SORTEIO);
  return bruto ? JSON.parse(bruto) : null;
}

// ===== Utilidades =====
function exigirCadastroAberto() {
  if (lerSorteio()) throw new Error('O sorteio já foi realizado — o cadastro está fechado.');
}

// Após MAX_TENTATIVAS_PIN erros seguidos, bloqueia o PIN por BLOQUEIO_PIN_SEG (contra quem tenta adivinhar).
function exigirPin(pin) {
  const cache = CacheService.getScriptCache();
  const falhas = Number(cache.get('falhasPin') || 0);
  if (falhas >= MAX_TENTATIVAS_PIN) {
    throw new Error('Muitas tentativas de PIN erradas. Aguarde 15 minutos e tente de novo.');
  }
  if (String(pin || '') !== PIN_ORGANIZADOR) {
    cache.put('falhasPin', String(falhas + 1), BLOQUEIO_PIN_SEG);
    throw new Error('PIN do organizador incorreto.');
  }
  cache.remove('falhasPin');
}

function texto(valor, max) {
  return String(valor == null ? '' : valor).trim().slice(0, max);
}

function limparDesejos(lista) {
  return (Array.isArray(lista) ? lista : []).map(d => texto(d, 100)).filter(Boolean).slice(0, 10);
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
  abaMensagens();
  const eu = Session.getEffectiveUser().getEmail();
  MailApp.sendEmail(eu, `Teste — ${NOME_EVENTO}`, 'Tudo certo! O sistema do amigo secreto já consegue enviar e-mails. 🎄');
  Logger.log('Pronto! Abas criadas e e-mail de teste enviado para ' + eu);
}
