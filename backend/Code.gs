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
// Nome que aparece como remetente dos e-mails.
const NOME_REMETENTE = 'Amigo Secreto da Família';
const MIN_PARTICIPANTES = 3;
// Endereço da página publicada (usado no link de edição enviado por e-mail).
const URL_PAGINA = 'https://marcosalencargarcia.github.io/Festas_fim_do_ano/';
// Assuntos dos e-mails do sorteio. As cópias deles em "Enviados" vão para a lixeira automaticamente.
const ASSUNTO_RESULTADO = `🎁 O sorteio foi feito! — ${NOME_EVENTO}`;
const ASSUNTO_ATUALIZACAO = `🎁 Seu amigo secreto atualizou a lista de desejos — ${NOME_EVENTO}`;

const MAX_TENTATIVAS_PIN = 5;
const BLOQUEIO_PIN_SEG = 15 * 60;
const INTERVALO_REENVIO_SEG = 10 * 60;
const VALIDADE_LINK_SEG = 6 * 60 * 60; // máximo permitido pelo CacheService
const INTERVALO_LINK_SEG = 5 * 60;

const MAX_MENSAGENS = 50;
const INTERVALO_MENSAGEM_SEG = 3;
// Cada pessoa recebe no máximo um aviso de resposta a cada 5 minutos (evita lotar a caixa dela).
const INTERVALO_AVISO_RESPOSTA_SEG = 5 * 60;

const ABA_PARTICIPANTES = 'Participantes';
const ABA_ALIMENTOS = 'Alimentos';
const ABA_MENSAGENS = 'Mensagens';
const PROP_SORTEIO = 'sorteio'; // JSON { pares: { idQuemDa: idQuemRecebe }, data }
// JSON { opcoes: [rótulos], votos: { idParticipante: índice }, tokens: { idParticipante: token },
//        aberta, valorFinal, criadaEm }
const PROP_VOTACAO = 'votacao';
const MAX_OPCOES_VOTACAO = 6;

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
    return json({ ok: false, error: 'Código de acesso incorreto.', codigoInvalido: true });
  }

  return responder(() => {
    if (req.action === 'estado') return estado();
    const acoes = {
      addParticipante, removerParticipante, addAlimento, removerAlimento,
      sortear, reenviar, desfazerSorteio,
      pedirLinkEdicao, abrirEdicao, salvarDesejos, removerMeuCadastro,
      escolherAlimento, soltarAlimento, enviarMensagem, apagarMensagem,
      revelar, abrirVotacao, abrirVoto, votar, reenviarVoto, lembrarVotacao, encerrarVotacao,
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

  const id = Utilities.getUuid();
  abaParticipantes().appendRow([id, celula(nome), email, celula(desejos.join('\n')), new Date()]);

  // Quem chega com a votação do valor aberta também recebe o seu link para votar.
  const votacao = lerVotacao();
  if (votacao && votacao.aberta) {
    votacao.tokens[id] = novoToken();
    salvarVotacao(votacao);
    try {
      enviarConviteVotacao({ id, nome, email }, votacao);
    } catch (err) {
      console.warn('Convite da votação não enviado: ' + err.message);
    }
  }
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
  // Itens repetidos são permitidos (ex.: dois "Refrigerante 2L"); cada um tem o seu "Eu levo".
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

  // Cada pessoa recebe um link pessoal para ver o resultado; "vistos" guarda a 1ª abertura.
  const links = {};
  participantes.forEach(p => { links[p.id] = novoToken(); });
  PropertiesService.getScriptProperties().setProperty(PROP_SORTEIO, JSON.stringify({
    pares, links, vistos: {}, data: new Date().toISOString(),
  }));

  const falhas = [];
  participantes.forEach(p => {
    try {
      enviarResultado(p, links[p.id]);
    } catch (err) {
      falhas.push(p.nome);
    }
  });
  agendarLimpezaEnviados();

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
  enviarResultado(quem, sorteio.links[quem.id]);
  cache.put(chave, '1', INTERVALO_REENVIO_SEG);
  agendarLimpezaEnviados();
  return { enviado: true };
}

// Página "Revelar": mostra o resultado a quem abriu o link do e-mail e registra a 1ª abertura,
// para a pessoa perceber se alguém abriu o link antes dela.
function revelar(req) {
  const sorteio = lerSorteio();
  if (!sorteio) throw new Error('O sorteio ainda não foi realizado.');
  const token = String(req.token || '');
  const id = token && Object.keys(sorteio.links).find(k => sorteio.links[k] === token);
  const participantes = lerParticipantes();
  const quem = id && participantes.find(p => p.id === id);
  const amigo = quem && participantes.find(p => p.id === sorteio.pares[quem.id]);
  if (!amigo) throw new Error('Este link não é válido. Peça um novo em "Reenviar meu resultado".');

  const abertoEm = sorteio.vistos[id] || null;
  if (!abertoEm) {
    sorteio.vistos[id] = new Date().toISOString();
    PropertiesService.getScriptProperties().setProperty(PROP_SORTEIO, JSON.stringify(sorteio));
  }
  return {
    nome: quem.nome,
    amigo: amigo.nome,
    desejos: amigo.desejos,
    itens: lerAlimentos().filter(a => a.responsavelId === quem.id).map(a => a.item),
    abertoEm,
  };
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

  const token = novoToken();
  cache.put('edicao:' + token, p.id, VALIDADE_LINK_SEG);
  cache.put('link:' + p.id, '1', INTERVALO_LINK_SEG);

  const link = URL_PAGINA + '?editar=' + token;
  MailApp.sendEmail({
    to: p.email,
    subject: `✏️ Editar seus desejos — ${NOME_EVENTO}`,
    htmlBody: moldura(`Olá, ${esc(p.nome)}! ✏️`, `
      <p style="margin:0 0 16px">Use o botão abaixo para editar a sua lista de desejos.</p>
      ${botaoHtml(link, 'Editar meus desejos')}
      <p style="margin:0;font-size:13px;color:#666">O link vale por 6 horas. Se não foi você que pediu, é só ignorar este e-mail.</p>`),
    name: NOME_REMETENTE,
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
      enviarDesejosAtualizados(quemTirou, sorteio.links[quemTirou.id]);
      agendarLimpezaEnviados();
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

  // Resposta: guarda o id da mensagem original e avisa o autor dela por e-mail.
  const original = req.respondeA ? lerTodasMensagens().find(m => m.id === String(req.respondeA)) : null;
  if (req.respondeA && !original) throw new Error('A mensagem que você quer responder não existe mais.');

  abaMensagens().appendRow([
    Utilities.getUuid(), celula(nome), celula(mensagem), new Date(), original ? original.id : '',
  ]);
  const avisado = original ? avisarResposta(original, nome, mensagem) : '';
  return Object.assign(estado(), { avisado });
}

// O nome do chat é digitado livremente, então procura o participante com o mesmo nome
// (ou, se só houver um, com o mesmo primeiro nome). Devolve o nome de quem foi avisado.
function avisarResposta(original, nomeQuemResponde, resposta) {
  const autor = normalizarNome(original.nome);
  if (!autor || autor === normalizarNome(nomeQuemResponde)) return '';

  const participantes = lerParticipantes();
  let dono = participantes.find(p => normalizarNome(p.nome) === autor);
  if (!dono) {
    const mesmoPrimeiroNome = participantes.filter(p => normalizarNome(p.nome).split(' ')[0] === autor.split(' ')[0]);
    if (mesmoPrimeiroNome.length === 1) dono = mesmoPrimeiroNome[0];
  }
  if (!dono) return '';

  const cache = CacheService.getScriptCache();
  const chave = 'avisoResposta:' + dono.id;
  if (cache.get(chave) || MailApp.getRemainingDailyQuota() < 1) return '';

  try {
    MailApp.sendEmail({
      to: dono.email,
      subject: `💬 ${nomeQuemResponde} respondeu seu recado — ${NOME_EVENTO}`,
      htmlBody: moldura(`Olá, ${esc(dono.nome)}! 💬`, `
        <p style="margin:0 0 12px"><strong>${esc(nomeQuemResponde)}</strong> respondeu a sua mensagem nos Recadinhos:</p>
        <div style="margin:0 0 8px;padding:8px 12px;border-left:3px solid #c9b88f;color:#666;font-size:14px;white-space:pre-wrap">${esc(original.texto)}</div>
        <div style="margin:0 0 16px;padding:10px 14px;background:#e3efe6;border-radius:8px;white-space:pre-wrap">${esc(resposta)}</div>
        ${botaoHtml(URL_PAGINA + '#recadinhos', '💬 Ver a conversa')}
        <p style="margin:0;font-size:13px;color:#666">Você recebe no máximo um aviso destes a cada 5 minutos.</p>`),
      name: NOME_REMETENTE,
    });
  } catch (err) {
    console.warn('Aviso de resposta não enviado: ' + err.message);
    return '';
  }
  cache.put(chave, '1', INTERVALO_AVISO_RESPOSTA_SEG);
  return dono.nome;
}

function normalizarNome(nome) {
  return String(nome || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function apagarMensagem(req) {
  exigirPin(req.pin);
  removerLinhaPorId(abaMensagens(), String(req.id));
  return estado();
}

// ===== Votação do valor dos presentes =====
// Cada participante vota por um link pessoal enviado por e-mail, então ninguém vota duas vezes
// nem no lugar de outra pessoa. O voto pode ser trocado enquanto a votação estiver aberta.
function abrirVotacao(req) {
  exigirPin(req.pin);
  const atual = lerVotacao();
  if (atual && atual.aberta) throw new Error('Já existe uma votação aberta. Encerre-a antes de abrir outra.');

  const opcoes = [];
  (Array.isArray(req.opcoes) ? req.opcoes : []).map(o => texto(o, 30)).filter(Boolean).forEach(o => {
    if (!opcoes.some(x => x.toLowerCase() === o.toLowerCase())) opcoes.push(o);
  });
  if (opcoes.length < 2) throw new Error('Informe pelo menos 2 opções de valor.');
  if (opcoes.length > MAX_OPCOES_VOTACAO) throw new Error(`Use no máximo ${MAX_OPCOES_VOTACAO} opções.`);

  const participantes = lerParticipantes();
  if (!participantes.length) throw new Error('Ainda não há participantes para votar.');
  if (MailApp.getRemainingDailyQuota() < participantes.length) {
    throw new Error('A cota diária de e-mails do Gmail não é suficiente. Tente novamente amanhã.');
  }

  const votacao = { opcoes, votos: {}, tokens: {}, aberta: true, valorFinal: '', criadaEm: new Date().toISOString() };
  participantes.forEach(p => { votacao.tokens[p.id] = novoToken(); });
  salvarVotacao(votacao);

  const falhas = [];
  participantes.forEach(p => {
    try {
      enviarConviteVotacao(p, votacao);
    } catch (err) {
      falhas.push(p.nome);
    }
  });
  return Object.assign(estado(), { envio: { total: participantes.length, falhas } });
}

function abrirVoto(req) {
  const { votacao, p } = votantePorToken(req.token);
  const voto = votacao.votos[p.id];
  return { nome: p.nome, voto: voto == null ? null : voto };
}

function votar(req) {
  const { votacao, p } = votantePorToken(req.token);
  if (!votacao.aberta) throw new Error('A votação já foi encerrada.');
  const opcao = Number(req.opcao);
  if (!(opcao >= 0 && opcao < votacao.opcoes.length)) throw new Error('Escolha uma das opções.');
  votacao.votos[p.id] = opcao;
  salvarVotacao(votacao);
  return estado();
}

function reenviarVoto(req) {
  const votacao = lerVotacao();
  if (!votacao || !votacao.aberta) throw new Error('Não há votação aberta.');
  const p = lerParticipantes().find(x => x.id === String(req.id));
  if (!p) throw new Error('Participante não encontrado.');

  const cache = CacheService.getScriptCache();
  const chave = 'voto:' + p.id;
  if (cache.get(chave)) throw new Error('O link acabou de ser enviado para este e-mail. Aguarde 5 minutos.');
  if (!votacao.tokens[p.id]) {
    votacao.tokens[p.id] = novoToken();
    salvarVotacao(votacao);
  }
  enviarConviteVotacao(p, votacao);
  cache.put(chave, '1', INTERVALO_LINK_SEG);
  return { enviado: true, email: mascarar(p.email) };
}

// Manda um lembrete só para quem ainda não votou.
function lembrarVotacao(req) {
  exigirPin(req.pin);
  const votacao = lerVotacao();
  if (!votacao || !votacao.aberta) throw new Error('Não há votação aberta.');
  const faltam = lerParticipantes().filter(p => votacao.votos[p.id] == null);
  if (!faltam.length) throw new Error('Todo mundo já votou! 🎉');

  let mudou = false;
  const falhas = [];
  faltam.forEach(p => {
    if (!votacao.tokens[p.id]) {
      votacao.tokens[p.id] = novoToken();
      mudou = true;
    }
    try {
      enviarConviteVotacao(p, votacao, true);
    } catch (err) {
      falhas.push(p.nome);
    }
  });
  if (mudou) salvarVotacao(votacao);
  return { total: faltam.length, falhas };
}

function encerrarVotacao(req) {
  exigirPin(req.pin);
  const votacao = lerVotacao();
  if (!votacao || !votacao.aberta) throw new Error('Não há votação aberta.');
  const opcao = Number(req.opcao);
  if (!(opcao >= 0 && opcao < votacao.opcoes.length)) throw new Error('Escolha o valor combinado.');

  votacao.aberta = false;
  votacao.valorFinal = votacao.opcoes[opcao];
  salvarVotacao(votacao);

  const falhas = [];
  lerParticipantes().forEach(p => {
    try {
      MailApp.sendEmail({
        to: p.email,
        subject: `💰 Valor do presente combinado: ${votacao.valorFinal} — ${NOME_EVENTO}`,
        htmlBody: moldura(`Olá, ${esc(p.nome)}! 💰`, `
          <p style="margin:0 0 12px">A votação terminou. O valor combinado para o presente do amigo secreto é:</p>
          <p style="margin:0 0 16px;font-size:28px;font-weight:bold;color:#b91c1c;text-align:center">${esc(votacao.valorFinal)}</p>
          ${botaoHtml(URL_PAGINA + '#votacao', 'Ver a votação')}`),
        name: NOME_REMETENTE,
      });
    } catch (err) {
      falhas.push(p.nome);
    }
  });
  return Object.assign(estado(), { envio: { falhas } });
}

function votantePorToken(token) {
  const votacao = lerVotacao();
  if (!votacao) throw new Error('Não há votação no momento.');
  const t = String(token || '');
  const id = t && Object.keys(votacao.tokens).find(k => votacao.tokens[k] === t);
  const p = id && lerParticipantes().find(x => x.id === id);
  if (!p) throw new Error('Este link de votação não é válido. Peça um novo na página.');
  return { votacao, p };
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
    votacao: votacaoPublica(participantes),
  };
}

// Mostra quem votou em quê (a ideia é a família chegar a um acordo), mas nunca os links.
function votacaoPublica(participantes) {
  const v = lerVotacao();
  if (!v) return null;
  return {
    aberta: v.aberta,
    valorFinal: v.valorFinal,
    opcoes: v.opcoes.map((rotulo, i) => ({
      rotulo,
      nomes: participantes.filter(p => v.votos[p.id] === i).map(p => p.nome),
    })),
    faltam: participantes.filter(p => v.votos[p.id] == null).map(p => p.nome),
  };
}

// ===== E-mail =====
// Os e-mails do sorteio não trazem o nome do amigo secreto: assim a cópia que fica na conta
// de quem envia não revela nada. O resultado só aparece na página, pelo link pessoal.
function enviarResultado(quem, token) {
  MailApp.sendEmail({
    to: quem.email,
    subject: ASSUNTO_RESULTADO,
    htmlBody: moldura(`Olá, ${esc(quem.nome)}! 🎄`, `
      <p style="margin:0 0 16px">O sorteio do amigo secreto foi feito! Toque no botão para descobrir quem você tirou e o que vai levar para a ceia.</p>
      ${botaoHtml(linkRevelar(token), '🎁 Descobrir meu amigo secreto')}
      <p style="margin:0;font-size:13px;color:#666">Guarde este e-mail: o link vale até a festa. Ele é só seu, não encaminhe para ninguém. 🤫</p>`),
    name: NOME_REMETENTE,
  });
}

function enviarDesejosAtualizados(quem, token) {
  MailApp.sendEmail({
    to: quem.email,
    subject: ASSUNTO_ATUALIZACAO,
    htmlBody: moldura(`Olá, ${esc(quem.nome)}! 🎁`, `
      <p style="margin:0 0 16px">O seu amigo secreto atualizou a lista de desejos. Toque no botão para ver a lista nova.</p>
      ${botaoHtml(linkRevelar(token), '🎁 Ver a lista atualizada')}
      <p style="margin:0;font-size:13px;color:#666">Guarde segredo! 🤫</p>`),
    name: NOME_REMETENTE,
  });
}

function enviarConviteVotacao(p, votacao, lembrete) {
  MailApp.sendEmail({
    to: p.email,
    subject: (lembrete ? '⏰ Falta o seu voto: ' : '🗳️ Vote no ') + `valor do presente — ${NOME_EVENTO}`,
    htmlBody: moldura(`Olá, ${esc(p.nome)}! 🗳️`, `
      <p style="margin:0 0 12px">${lembrete
        ? 'O pessoal ainda está esperando o seu voto sobre o valor do presente do amigo secreto.'
        : 'Vamos combinar juntos quanto cada um vai gastar no presente do amigo secreto. A ideia é todo mundo concordar!'}</p>
      <p style="margin:0 0 6px">As opções são:</p>
      <ul style="margin:0 0 16px;padding-left:20px">${votacao.opcoes.map(o => `<li>${esc(o)}</li>`).join('')}</ul>
      ${botaoHtml(URL_PAGINA + '?votar=' + votacao.tokens[p.id], '🗳️ Votar agora')}
      <p style="margin:0;font-size:13px;color:#666">O link é só seu. Você pode trocar o voto enquanto a votação estiver aberta.</p>`),
    name: NOME_REMETENTE,
  });
}

function linkRevelar(token) {
  return URL_PAGINA + '?ver=' + token;
}

function botaoHtml(link, rotulo) {
  return `<p style="margin:0 0 16px"><a href="${esc(link)}" style="display:inline-block;background:#14532d;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">${rotulo}</a></p>`;
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

// ===== Limpeza da pasta "Enviados" =====
// Os filtros do Gmail não agem sobre e-mails enviados, então o próprio script move essas cópias
// para a lixeira. Espera 1 minuto depois do envio, o tempo de o Gmail indexar as mensagens.
function agendarLimpezaEnviados() {
  try {
    removerGatilhosLimpeza();
    ScriptApp.newTrigger('limparEnviados').timeBased().after(60 * 1000).create();
  } catch (err) {
    // Sem a autorização de autorizarLimpeza() o e-mail sai normalmente; só a cópia fica em "Enviados".
    console.warn('Limpeza de Enviados não agendada: ' + err.message);
  }
}

function limparEnviados() {
  removerGatilhosLimpeza();
  const eu = Session.getEffectiveUser().getEmail().toLowerCase();
  const assuntos = [ASSUNTO_RESULTADO, ASSUNTO_ATUALIZACAO];
  // Só mexe em mensagens enviadas por mim com exatamente esses assuntos (respostas da família ficam).
  GmailApp.search('in:sent subject:(sorteio OR atualizou) newer_than:60d').forEach(thread => {
    thread.getMessages().forEach(m => {
      if (assuntos.includes(m.getSubject()) && m.getFrom().toLowerCase().includes(eu) && !m.isInTrash()) {
        m.moveToTrash();
      }
    });
  });
}

function removerGatilhosLimpeza() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'limparEnviados')
    .forEach(t => ScriptApp.deleteTrigger(t));
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
  const sh = aba(ABA_MENSAGENS, ['id', 'nome', 'texto', 'criadoEm', 'respondeA']);
  // Planilhas criadas antes das respostas não têm a 5ª coluna no cabeçalho.
  if (sh.getRange(1, 5).getValue() !== 'respondeA') sh.getRange(1, 5).setValue('respondeA');
  return sh;
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

function lerTodasMensagens() {
  return linhasComId(abaMensagens()).map(r => ({
    id: String(r[0]), nome: String(r[1]), texto: String(r[2]),
    quando: r[3] instanceof Date ? r[3].toISOString() : '',
    respondeA: String(r[4] || ''),
  }));
}

// As últimas mensagens, cada resposta com um trecho da original (mesmo que ela já seja antiga).
function lerMensagens() {
  const todas = lerTodasMensagens();
  const porId = {};
  todas.forEach(m => { porId[m.id] = m; });
  return todas.slice(-MAX_MENSAGENS).map(m => {
    const original = m.respondeA && porId[m.respondeA];
    return {
      id: m.id, nome: m.nome, texto: m.texto, quando: m.quando,
      resposta: m.respondeA ? (original ? { id: original.id, nome: original.nome, texto: original.texto.slice(0, 120) } : { apagada: true }) : null,
    };
  });
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

function lerVotacao() {
  const bruto = PropertiesService.getScriptProperties().getProperty(PROP_VOTACAO);
  return bruto ? JSON.parse(bruto) : null;
}

function salvarVotacao(votacao) {
  PropertiesService.getScriptProperties().setProperty(PROP_VOTACAO, JSON.stringify(votacao));
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

function novoToken() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
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

/** Execute UMA vez pelo editor: autoriza o script a mover os e-mails do sorteio de "Enviados" para a lixeira. */
function autorizarLimpeza() {
  limparEnviados();
  Logger.log('Pronto! Os e-mails do sorteio vão sair da pasta Enviados automaticamente.');
}
