// ===========================================================
// WHATSAPP + TYPEBOT + UPSTASH REDIS
// ===========================================================

// Tempo que uma sessão do Typebot ficará salva no Redis.
// 24 horas.
const SESSION_TTL_SECONDS = 60 * 60 * 24;


// ===========================================================
// CONFIGURAÇÃO DO REDIS
// ===========================================================

function getRedisConfig() {
  const url =
    process.env.STORAGE_KV_REST_API_URL ||
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL;

  const token =
    process.env.STORAGE_KV_REST_API_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error(
      "Variáveis do Upstash Redis não encontradas."
    );
  }

  return {
    url: url.replace(/\/$/, ""),
    token,
  };
}


// ===========================================================
// EXECUTAR COMANDO NO REDIS
// ===========================================================

async function redisCommand(command) {
  const { url, token } = getRedisConfig();

  const response = await fetch(url, {
    method: "POST",

    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },

    body: JSON.stringify(command),
  });

  const responseText = await response.text();

  if (!response.ok) {
    console.error(
      "Erro Redis:",
      response.status,
      responseText
    );

    throw new Error(
      `Erro Redis: ${response.status}`
    );
  }

  let data;

  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error(
      "Resposta inválida do Redis."
    );
  }

  if (data?.error) {
    console.error(
      "Redis retornou erro:",
      data.error
    );

    throw new Error(
      `Redis: ${data.error}`
    );
  }

  return data?.result;
}


// ===========================================================
// CHAVE DA SESSÃO
// ===========================================================

function getSessionKey(from) {
  return `typebot_session:${from}`;
}


// ===========================================================
// BUSCAR SESSÃO
// ===========================================================

async function getSession(from) {
  const key = getSessionKey(from);

  const sessionId = await redisCommand([
    "GET",
    key,
  ]);

  if (!sessionId) {
    console.log(
      "Nenhuma sessão Typebot encontrada no Redis."
    );

    return null;
  }

  console.log(
    "Sessão Typebot recuperada do Redis:",
    sessionId
  );

  return sessionId;
}


// ===========================================================
// SALVAR SESSÃO
// ===========================================================

async function saveSession(from, sessionId) {
  const key = getSessionKey(from);

  await redisCommand([
    "SET",
    key,
    sessionId,
    "EX",
    SESSION_TTL_SECONDS.toString(),
  ]);

  console.log(
    "Sessão Typebot salva no Redis:",
    sessionId
  );
}


// ===========================================================
// APAGAR SESSÃO
// ===========================================================

async function deleteSession(from) {
  const key = getSessionKey(from);

  await redisCommand([
    "DEL",
    key,
  ]);

  console.log(
    "Sessão Typebot removida do Redis."
  );
}


// ===========================================================
// WEBHOOK PRINCIPAL
// ===========================================================

export default async function handler(req, res) {

  // =========================================================
  // 1. VERIFICAÇÃO DO WEBHOOK PELA META
  // =========================================================

  if (req.method === "GET") {
    const mode =
      req.query["hub.mode"];

    const token =
      req.query["hub.verify_token"];

    const challenge =
      req.query["hub.challenge"];

    if (
      mode === "subscribe" &&
      token === process.env.WEBHOOK_VERIFY_TOKEN
    ) {
      console.log(
        "Webhook verificado com sucesso."
      );

      return res
        .status(200)
        .send(challenge);
    }

    console.log(
      "Falha na verificação do webhook."
    );

    return res
      .status(403)
      .send("Token inválido");
  }


  // =========================================================
  // 2. RECEBIMENTO DAS MENSAGENS DO WHATSAPP
  // =========================================================

  if (req.method === "POST") {
    try {

      const change =
        req.body
          ?.entry?.[0]
          ?.changes?.[0]
          ?.value;

      const message =
        change?.messages?.[0];


      // Ignora status e outros eventos
      if (!message) {
        return res
          .status(200)
          .send("EVENTO_RECEBIDO");
      }


      const from = message.from;

      let userMessage = "";


      // =====================================================
      // 3. MENSAGEM DIGITADA
      // =====================================================

      if (message.type === "text") {
        userMessage =
          message.text?.body || "";
      }


      // =====================================================
      // 4. RESPOSTA DE BOTÃO OU LISTA
      // =====================================================

      if (message.type === "interactive") {

        // ---------------------------------------------------
        // BOTÃO
        // ---------------------------------------------------

        if (
          message.interactive?.type ===
          "button_reply"
        ) {
          const buttonReply =
            message.interactive.button_reply;

          const buttonId =
            buttonReply?.id || "";

          if (
            buttonId.startsWith(
              "typebot_choice:"
            )
          ) {
            try {
              userMessage =
                decodeURIComponent(
                  buttonId.replace(
                    "typebot_choice:",
                    ""
                  )
                );
            } catch {
              userMessage =
                buttonReply?.title || "";
            }
          } else {
            userMessage =
              buttonReply?.title || "";
          }
        }


        // ---------------------------------------------------
        // LISTA
        // ---------------------------------------------------

        if (
          message.interactive?.type ===
          "list_reply"
        ) {
          userMessage =
            message.interactive
              .list_reply
              ?.title || "";
        }
      }


      // =====================================================
      // 5. TIPO NÃO SUPORTADO
      // =====================================================

      if (!userMessage) {
        console.log(
          "Tipo de mensagem ainda não suportado:",
          message.type
        );

        return res
          .status(200)
          .send("EVENTO_RECEBIDO");
      }


      console.log(
        "Mensagem recebida:",
        from,
        userMessage
      );


      // =====================================================
      // 6. BUSCA SESSÃO NO REDIS
      // =====================================================

      let sessionId =
        await getSession(from);

      let typebotResponse;


      // =====================================================
      // 7. NOVA CONVERSA
      // =====================================================

      if (!sessionId) {
        console.log(
          "Iniciando nova sessão no Typebot..."
        );

        typebotResponse =
          await startTypebot(
            userMessage
          );

        if (
          typebotResponse?.sessionId
        ) {
          sessionId =
            typebotResponse.sessionId;

          await saveSession(
            from,
            sessionId
          );

          console.log(
            "Nova sessão Typebot criada:",
            sessionId
          );
        }
      }


      // =====================================================
      // 8. CONTINUAR CONVERSA
      // =====================================================

      else {
        console.log(
          "Continuando sessão Typebot:",
          sessionId
        );

        try {
          typebotResponse =
            await continueTypebot(
              sessionId,
              userMessage
            );

          // Renova o tempo da sessão
          await saveSession(
            from,
            sessionId
          );

        } catch (error) {
          console.error(
            "Falha ao continuar sessão Typebot:",
            error
          );

          // Se a sessão expirou, remove e inicia outra.
          await deleteSession(from);

          console.log(
            "Tentando iniciar uma nova sessão Typebot..."
          );

          typebotResponse =
            await startTypebot(
              userMessage
            );

          if (
            typebotResponse?.sessionId
          ) {
            sessionId =
              typebotResponse.sessionId;

            await saveSession(
              from,
              sessionId
            );
          }
        }
      }


      // =====================================================
      // 9. PROCESSA RESPOSTA DO TYPEBOT
      // =====================================================

      await processTypebotResponse(
        typebotResponse,
        from
      );


      return res
        .status(200)
        .send("EVENTO_RECEBIDO");


    } catch (error) {

      console.error(
        "Erro ao processar webhook:",
        error
      );

      // A Meta deve receber 200 mesmo em erro interno.
      return res
        .status(200)
        .send("EVENTO_RECEBIDO");
    }
  }


  return res
    .status(405)
    .send("Método não permitido");
}


// ===========================================================
// 10. INICIAR CONVERSA NO TYPEBOT
// ===========================================================

async function startTypebot(userMessage) {

  const url =
    `https://typebot.co/api/v1/typebots/${process.env.TYPEBOT_ID}/startChat`;

  console.log(
    "Chamando Typebot startChat..."
  );


  const response =
    await fetch(
      url,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          message: userMessage,
        }),
      }
    );


  const responseText =
    await response.text();


  if (!response.ok) {
    console.error(
      "Erro Typebot startChat:",
      response.status,
      responseText
    );

    throw new Error(
      `Erro Typebot startChat: ${response.status}`
    );
  }


  let data;

  try {
    data =
      JSON.parse(
        responseText
      );
  } catch {
    console.error(
      "Resposta inválida do Typebot:",
      responseText
    );

    throw new Error(
      "Resposta inválida do Typebot"
    );
  }


  console.log(
    "Typebot startChat respondeu com sucesso."
  );

  return data;
}


// ===========================================================
// 11. CONTINUAR CONVERSA NO TYPEBOT
// ===========================================================

async function continueTypebot(
  sessionId,
  userMessage
) {

  const url =
    `https://typebot.co/api/v1/sessions/${sessionId}/continueChat`;

  console.log(
    "Chamando Typebot continueChat..."
  );


  const response =
    await fetch(
      url,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          message: userMessage,
        }),
      }
    );


  const responseText =
    await response.text();


  if (!response.ok) {
    console.error(
      "Erro Typebot continueChat:",
      response.status,
      responseText
    );

    throw new Error(
      `Erro Typebot continueChat: ${response.status}`
    );
  }


  let data;

  try {
    data =
      JSON.parse(
        responseText
      );
  } catch {
    console.error(
      "Resposta inválida do Typebot:",
      responseText
    );

    throw new Error(
      "Resposta inválida do Typebot"
    );
  }


  console.log(
    "Typebot continueChat respondeu com sucesso."
  );

  return data;
}


// ===========================================================
// 12. PROCESSAR RESPOSTA DO TYPEBOT
// ===========================================================

async function processTypebotResponse(
  typebotResponse,
  to
) {

  if (!typebotResponse) {
    console.log(
      "Typebot não retornou resposta."
    );

    return;
  }


  const messages =
    typebotResponse.messages || [];

  const input =
    typebotResponse.input || null;


  console.log(
    "Quantidade de mensagens do Typebot:",
    messages.length
  );
console.log(
  "MESSAGES COMPLETAS DO TYPEBOT:",
  JSON.stringify(messages)
);

  // =========================================================
  // 13. ENVIA MENSAGENS DE TEXTO
  // =========================================================

  for (const message of messages) {

    if (message.type !== "text") {
      continue;
    }


    const text =
      extractTypebotText(
        message
      );


    if (!text.trim()) {
      continue;
    }


    console.log(
      "Enviando resposta para WhatsApp:",
      text
    );


    await sendWhatsAppText(
      to,
      text
    );
  }


  // =========================================================
  // 14. TYPEBOT NÃO AGUARDA RESPOSTA
  // =========================================================

  if (!input) {
    console.log(
      "Typebot não está aguardando nova resposta."
    );

    return;
  }


  console.log(
    "Typebot aguardando resposta:",
    JSON.stringify(input)
  );


  // =========================================================
  // 15. CHOICE INPUT = BOTÕES
  // =========================================================

  if (
    input.type === "choice input" &&
    Array.isArray(input.items) &&
    input.items.length > 0
  ) {

    console.log(
      "Choice input detectado."
    );


    await sendWhatsAppButtons(
      to,
      input.items
    );


    return;
  }


  // =========================================================
  // 16. TEXT INPUT = NOME, CPF E OUTRAS RESPOSTAS DIGITADAS
  // =========================================================

  if (input.type === "text input") {

    const placeholder =
      input.options?.labels?.placeholder ||
      "Digite sua resposta:";

    console.log(
      "Text input detectado. Enviando instrução:",
      placeholder
    );

    await sendWhatsAppText(
      to,
      placeholder
    );

    return;
  }


  // =========================================================
  // 16.1 OUTROS TIPOS DE INPUT
  // =========================================================

  console.log(
    "Tipo de input ainda não tratado:",
    input.type
  );
}


// ===========================================================
// 17. EXTRAIR TEXTO DO TYPEBOT
// ===========================================================

function extractTypebotText(message) {

  if (
    typeof message?.content ===
    "string"
  ) {
    return message.content;
  }


  if (
    typeof message
      ?.content?.text ===
    "string"
  ) {
    return message
      .content
      .text;
  }


  const richText =
    message
      ?.content
      ?.richText;


  if (!Array.isArray(richText)) {
    return "";
  }


  return richText
    .map((paragraph) => {

      if (
        typeof paragraph ===
        "string"
      ) {
        return paragraph;
      }


      if (
        typeof paragraph?.text ===
        "string"
      ) {
        return paragraph.text;
      }


      if (
        Array.isArray(
          paragraph?.children
        )
      ) {
        return paragraph
          .children
          .map(
            (child) =>
              child?.text || ""
          )
          .join("");
      }


      return "";
    })
    .join("\n");
}


// ===========================================================
// 18. IDENTIFICAR TEXTO DA OPÇÃO
// ===========================================================

function getChoiceText(item, index) {

  if (typeof item === "string") {
    return item;
  }


  const possibleValues = [
    item?.content,
    item?.label,
    item?.value,
    item?.text,
    item?.name,
  ];


  for (const value of possibleValues) {

    if (
      typeof value === "string" &&
      value.trim()
    ) {
      return value.trim();
    }
  }


  return `Opção ${index + 1}`;
}


// ===========================================================
// 19. ENVIAR BOTÕES PELO WHATSAPP
// ===========================================================

async function sendWhatsAppButtons(
  to,
  items
) {

  const choices =
    items.slice(0, 3);


  const buttons =
    choices.map(
      (item, index) => {

        const originalText =
          getChoiceText(
            item,
            index
          );


        // WhatsApp: título máximo de 20 caracteres.
        const buttonTitle =
          originalText.substring(
            0,
            20
          );


        const buttonId =
          "typebot_choice:" +
          encodeURIComponent(
            originalText
          );


        return {
          type: "reply",

          reply: {
            id: buttonId,
            title: buttonTitle,
          },
        };
      }
    );


  console.log(
    "Botões preparados:",
    JSON.stringify(buttons)
  );


  const url =
    `https://graph.facebook.com/${process.env.GRAPH_API_VERSION}/${process.env.PHONE_NUMBER_ID}/messages`;


  const response =
    await fetch(
      url,
      {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${process.env.WHATSAPP_TOKEN}`,

          "Content-Type":
            "application/json",
        },


        body:
          JSON.stringify({
            messaging_product:
              "whatsapp",

            recipient_type:
              "individual",

            to: to,

            type:
              "interactive",

            interactive: {
              type:
                "button",

              body: {
                text:
                  "Escolha uma das opções abaixo:",
              },

              action: {
                buttons:
                  buttons,
              },
            },
          }),
      }
    );


  const data =
    await response.json();


  if (!response.ok) {
    console.error(
      "Erro ao enviar botões WhatsApp:",
      JSON.stringify(data)
    );


    throw new Error(
      "Falha ao enviar botões pelo WhatsApp"
    );
  }


  console.log(
    "Botões enviados com sucesso para o WhatsApp."
  );


  return data;
}


// ===========================================================
// 20. ENVIAR TEXTO PELO WHATSAPP
// ===========================================================

async function sendWhatsAppText(
  to,
  text
) {

  const url =
    `https://graph.facebook.com/${process.env.GRAPH_API_VERSION}/${process.env.PHONE_NUMBER_ID}/messages`;


  const response =
    await fetch(
      url,
      {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${process.env.WHATSAPP_TOKEN}`,

          "Content-Type":
            "application/json",
        },


        body:
          JSON.stringify({
            messaging_product:
              "whatsapp",

            recipient_type:
              "individual",

            to: to,

            type:
              "text",

            text: {
              preview_url:
                false,

              body:
                text,
            },
          }),
      }
    );


  const data =
    await response.json();


  if (!response.ok) {
    console.error(
      "Erro ao enviar mensagem WhatsApp:",
      JSON.stringify(data)
    );


    throw new Error(
      "Falha ao enviar mensagem pelo WhatsApp"
    );
  }


  console.log(
    "Mensagem enviada com sucesso para o WhatsApp."
  );


  return data;
}
