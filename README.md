# 🎄 Amigo Secreto & Ceia

Página para a família se cadastrar no amigo secreto (nome, e-mail e desejos), montar a lista de comidas da ceia e fazer o sorteio. Cada pessoa recebe **por e-mail** quem tirou e o que deve levar.

## Como funciona

| Parte | O que é |
|---|---|
| `index.html`, `style.css`, `app.js` | A página que todos acessam |
| `backend/Code.gs` | Código que roda no Google (Apps Script): guarda os dados numa Planilha Google, faz o sorteio e envia os e-mails pelo seu Gmail |

- O sorteio acontece **no servidor do Google**. O resultado do amigo secreto nunca aparece na página, nem para quem clicou no botão.
- **O e-mail do sorteio não traz nomes.** Ele só tem um link pessoal que abre o cartão "🎁 Revelar" na página. O cartão avisa se o link já tinha sido aberto antes, e assim a pessoa percebe se alguém espiou.
- As cópias desses e-mails na pasta **Enviados** de quem organiza vão para a **Lixeira** automaticamente, cerca de 1 minuto depois do envio. Os filtros do Gmail não funcionam em e-mails enviados, então é o próprio script que faz isso. Para ativar, execute uma vez a função `autorizarLimpeza` no editor.
- Ninguém tira a si mesmo, e todos dão e recebem exatamente um presente.
- **"🙋 Eu levo":** quem quiser levar uma comida específica toca no botão e escolhe o próprio nome. O item fica reservado para essa pessoa. Com **Soltar**, ele volta para o sorteio.
- No sorteio, as comidas escolhidas ficam com quem escolheu. As outras vão primeiro para quem tem menos itens, para que todos acabem com quantidades parecidas. A divisão aparece para todos na página, e quem escolheu o item aparece marcado com 🙋.
- **💬 Recadinhos:** um mini chat no fim da página que atualiza sozinho a cada 20 segundos. As mensagens ficam na aba *Mensagens* da planilha, e o organizador pode apagar qualquer uma com o PIN.
- **↩️ Responder:** cada recado tem um botão para responder. A resposta aparece com um trecho da mensagem original, e quem escreveu a original recebe um **e-mail** avisando quem respondeu e o quê. Como o nome no chat é digitado livremente, o aviso vai para o participante cadastrado com o mesmo nome (sem diferenciar maiúsculas e acentos) ou, se só houver um, com o mesmo primeiro nome. Ninguém é avisado quando responde a si mesmo, e cada pessoa recebe no máximo um aviso a cada 5 minutos.
- Depois do sorteio, o cadastro fica fechado. Se alguém perder o e-mail, pode pedir na própria página para reenviar.
- **Editar os desejos:** o ✏️ ao lado do nome envia um link pessoal para o e-mail da pessoa, válido por 6 horas. Só quem recebe o e-mail consegue editar. Antes do sorteio, o mesmo link permite sair do amigo secreto.
- Se alguém editar a lista **depois do sorteio**, quem tirou essa pessoa recebe um e-mail com a lista nova. O segredo continua guardado.
- O ✕ ao lado do nome remove outra pessoa e só funciona com o PIN do organizador.

**Segurança**
- A página pede um **código da família** antes de mostrar ou alterar qualquer coisa. Mande o código junto com o link.
- Depois de 5 PINs errados, o sorteio fica bloqueado por 15 minutos.
- Cada e-mail só pode pedir um reenvio a cada 10 minutos.
- O PIN e o código da família ficam **só no editor do Apps Script**. No GitHub, o `Code.gs` tem apenas os valores provisórios `troque-este-pin` e `troque-este-codigo`.

> Sem a `API_URL` configurada, a página abre em **modo demonstração**: os dados ficam só no seu navegador, nenhum e-mail é enviado (o resultado aparece no console, F12) e o PIN de teste é `1234`. Serve para conhecer a página antes de configurar.

---

## Passo a passo da configuração (uns 10 minutos)

### 1. Criar a planilha e o script
1. A planilha já existe: [Amigo Secreto 2026](https://docs.google.com/spreadsheets/d/18u4HrPgxrmv8LWrZB64TsVd-qFQVN8Uu3fSnftGQ3RQ/edit). O ID dela já está em `PLANILHA_ID` no `Code.gs`.
   - Para usar outra planilha, troque o `PLANILHA_ID` pelo trecho entre `/d/` e `/edit` do link dela.
2. Abra a planilha e vá em **Extensões → Apps Script**. Também funciona criar um projeto avulso em <https://script.new>.
3. Apague o conteúdo do arquivo `Código.gs` e cole **todo** o conteúdo de [`backend/Code.gs`](backend/Code.gs).
4. No topo do arquivo, troque:
   - `PIN_ORGANIZADOR`: uma senha só sua, necessária para sortear ou desfazer o sorteio.
   - `CODIGO_FAMILIA`: a palavra que você manda para a família junto com o link.
   - `NOME_EVENTO`: aparece no e-mail e na página, se quiser personalizar.
5. Clique em 💾 **Salvar**.

### 2. Autorizar (uma vez)
1. Na barra de cima, escolha a função **`configurar`** e clique em **▶ Executar**.
2. O Google vai pedir autorização. Escolha sua conta, clique em **Avançado → Acessar (não seguro)** e depois em **Permitir**. O aviso aparece porque o script é seu e não passou pela verificação do Google, o que é normal.
3. Você vai receber um e-mail de teste, e a planilha ganha as abas **Participantes** e **Alimentos**.

### 3. Publicar como App da Web
1. Clique em **Implantar → Nova implantação**.
2. Na engrenagem ⚙, escolha **App da Web**.
3. Preencha:
   - **Executar como:** *Eu (seu e-mail)*
   - **Quem pode acessar:** *Qualquer pessoa*
4. Clique em **Implantar** e copie a **URL do app da Web**. Ela termina em `/exec`.

### 4. Ligar a página ao script
Abra o `app.js` e cole a URL na primeira linha:

```js
const API_URL = 'https://script.google.com/macros/s/AKfy.../exec';
```

### 5. Colocar a página no ar (para a família acessar pelo celular)
Escolha uma opção gratuita:
- **Netlify:** crie uma conta em <https://app.netlify.com/drop> e arraste a pasta do projeto. Você recebe um link para mandar no grupo da família.
- **GitHub Pages:** suba os arquivos num repositório e ative *Settings → Pages*.

> A pasta `backend/` pode ir junto sem problema, desde que o `Code.gs` do repositório continue com os valores provisórios. Os valores reais ficam só no editor do Apps Script.

---

## No dia do sorteio
1. Confira na página se todos estão cadastrados e se a lista de comidas está completa.
2. Digite o PIN do organizador e clique em **Realizar sorteio**.
3. Pronto: cada um recebe o e-mail. Avise a família para olhar também a caixa de **spam**.

## Dicas e observações
- **Alterou o `Code.gs` depois de publicar?** Ao colar no editor, mantenha as linhas do `PIN_ORGANIZADOR` e do `CODIGO_FAMILIA` com os valores reais. Depois vá em **Implantar → Gerenciar implantações → ✏ Editar → Versão: Nova versão → Implantar**. Assim a URL continua a mesma.
- **Quer trocar o código da família?** Mude o `CODIGO_FAMILIA` no editor e publique uma nova versão como acima. Quem já tinha entrado vai precisar digitar o código novo.
- **Limite do Gmail:** cerca de 100 e-mails por dia em contas comuns, mais que suficiente para a família.
- **Precisa refazer o sorteio?** Na página, abra *Área do organizador → Desfazer sorteio* (pede o PIN). Um novo sorteio envia novos e-mails para todos.
- **Sobre o sigilo:** os pares ficam guardados nas *Propriedades do script*, não na planilha. Assim você, como dono, também não vê o resultado sem querer. Só evite fuçar em *Configurações do projeto → Propriedades do script*. 😉
