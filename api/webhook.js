const sessions = new Map();

export default async function handler(req, res) {
  // =========================================================
  // 1. VERIFICAÇÃO DO WEBHOOK PELA META
  // =========================================================
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (
      mode === "subscribe" &&
      token === process.env.WEBHOOK_VERIFY_TOKEN
    ) {
      console.log("Webhook verificado com sucesso.");
      return res.status(200).send(challenge);
    }

    console.log("Falha na verificação do webhook.");
    return res.status(403).send("Token inválido");
  }

  // =========================================================
  // 2. RECEBIMENTO DAS MENSAGENS DO WHATSAPP
  // =========================================================
  if (req.method === "POST") {
    try {
      const change =
        req.body?.entry?.[0]?.changes?.[0]?.value;

      const message = change?.messages?.[0];

      // Ignora eventos que não sejam mensagens recebidas
      if (!message) {
        return res.status(200).send("EVENTO_RECEBIDO");
      }

      const from = message.from;

      let userMessage = "";

      // =====================================================
      // 3. IDENTIFICA O TIPO DA MENSAGEM
      // =====================================================

      // Mensagem digitada
      if (message.type === "text") {
        userMessage =
          message.text?.body || "";
      }

      // Resposta de botão ou lista
      if (message.type === "interactive") {
        // Botão
        if (
          message.interactive?.type ===
          "button_reply"
        ) {
          const buttonReply =
            message.interactive.button_reply;

          const buttonId =
            buttonReply?.id || "";

          // Se for botão criado pelo Typebot,
          // recupera o valor original da opção.
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

        // Lista
        if (
          message.interactive?.type ===
          "list_reply"
        ) {
          userMessage =
            message.interactive
              .list_reply?.title || "";
        }
      }

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
      // 4. VERIFICA SE JÁ EXISTE SESSÃO DO TYPEBOT
      // =====================================================

      let sessionId =
        sessions.get(from);

      let typebotResponse;

      // -----------------------------------------------------
      // NOVA CONVERSA
      // -----------------------------------------------------

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

          sessions.set(
            from,
            sessionId
          );

          console.log(
            "Nova sessão Typebot criada:",
            sessionId
          );
        }
      }

      // -----------------------------------------------------
      // CONTINUAR CONVERSA
      // -----------------------------------------------------

      else {
        console.log(
          "Continuando sessão Typebot:",
          sessionId
        );

        typebotResponse =
          await continueTypebot(
            sessionId,
            userMessage
          );
      }

      // =====================================================
      // 5. PROCESSA RESPOSTA DO TYPEBOT
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

      // Mesmo em caso de erro,
      // responde 200 para a Meta.
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
// 6. INICIAR CONVERSA NO TYPEBOT
// ===========================================================

async function startTypebot(
  userMessage
) {
  const url =
    `https://typebot.co/api/v1/typebots/${process.env.TYPEBOT_ID}/startChat`;

  console.log(
    "Chamando Typebot startChat..."
  );

  const response =
    await fetch(url, {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json",
      },

      body: JSON.stringify({
        message: userMessage,
      }),
    });

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
      JSON.parse(responseText);
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
// 7. CONTINUAR CONVERSA NO TYPEBOT
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
    await fetch(url, {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json",
      },

      body: JSON.stringify({
        message: userMessage,
      }),
    });

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
      JSON.parse(responseText);
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
// 8. PROCESSAR RESPOSTA DO TYPEBOT
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

  // =========================================================
  // 9. ENVIA AS MENSAGENS DE TEXTO
  // =========================================================

  for (const message of messages) {
    if (message.type !== "text") {
      continue;
    }

    const text =
      extractTypebotText(message);

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
  // 10. VERIFICA SE O TYPEBOT AGUARDA UMA RESPOSTA
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
  // 11. CHOICE INPUT = BOTÕES DO WHATSAPP
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
  // 12. INPUT DE TEXTO, NOME, CPF ETC.
  // =========================================================

  console.log(
    "Typebot aguardando resposta digitada pelo usuário."
  );
}


// ===========================================================
// 13. EXTRAIR TEXTO DAS MENSAGENS DO TYPEBOT
// ===========================================================

function extractTypebotText(
  message
) {
  if (
    typeof message?.content ===
    "string"
  ) {
    return message.content;
  }

  if (
    typeof message?.content?.text ===
    "string"
  ) {
    return message.content.text;
  }

  const richText =
    message?.content?.richText;

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
        return paragraph.children
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
// 14. IDENTIFICAR TEXTO DA OPÇÃO DO TYPEBOT
// ===========================================================

function getChoiceText(
  item,
  index
) {
  if (
    typeof item === "string"
  ) {
    return item;
  }

  const possibleValues = [
    item?.content,
    item?.label,
    item?.value,
    item?.text,
    item?.name,
  ];

  for (
    const value of possibleValues
  ) {
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
// 15. ENVIAR BOTÕES DO TYPEBOT PELO WHATSAPP
// ===========================================================

async function sendWhatsAppButtons(
  to,
  items
) {
  // WhatsApp permite no máximo
  // 3 botões de resposta.
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

        // WhatsApp permite até
        // 20 caracteres no título.
        const buttonTitle =
          originalText
            .substring(0, 20);

        // Guardamos o texto original
        // no ID para enviar ao Typebot
        // quando o cliente clicar.
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
    await fetch(url, {
      method: "POST",

      headers: {
        Authorization:
          `Bearer ${process.env.WHATSAPP_TOKEN}`,

        "Content-Type":
          "application/json",
      },

      body: JSON.stringify({
        messaging_product:
          "whatsapp",

        recipient_type:
          "individual",

        to: to,

        type: "interactive",

        interactive: {
          type: "button",

          body: {
            text:
              "Escolha uma das opções abaixo:",
          },

          action: {
            buttons: buttons,
          },
        },
      }),
    });

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
// 16. ENVIAR TEXTO PELO WHATSAPP
// ===========================================================

async function sendWhatsAppText(
  to,
  text
) {
  const url =
    `https://graph.facebook.com/${process.env.GRAPH_API_VERSION}/${process.env.PHONE_NUMBER_ID}/messages`;

  const response =
    await fetch(url, {
      method: "POST",

      headers: {
        Authorization:
          `Bearer ${process.env.WHATSAPP_TOKEN}`,

        "Content-Type":
          "application/json",
      },

      body: JSON.stringify({
        messaging_product:
          "whatsapp",

        recipient_type:
          "individual",

        to: to,

        type: "text",

        text: {
          preview_url: false,
          body: text,
        },
      }),
    });

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
