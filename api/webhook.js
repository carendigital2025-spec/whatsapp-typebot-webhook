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

      if (message.type === "text") {
        userMessage = message.text?.body || "";
      }

      if (message.type === "interactive") {
        if (message.interactive?.type === "button_reply") {
          userMessage =
            message.interactive.button_reply?.title || "";
        }

        if (message.interactive?.type === "list_reply") {
          userMessage =
            message.interactive.list_reply?.title || "";
        }
      }

      if (!userMessage) {
        console.log(
          "Tipo de mensagem ainda não suportado:",
          message.type
        );

        return res.status(200).send("EVENTO_RECEBIDO");
      }

      console.log(
        "Mensagem recebida:",
        from,
        userMessage
      );

      // =====================================================
      // 4. VERIFICA SE JÁ EXISTE SESSÃO DO TYPEBOT
      // =====================================================

      let sessionId = sessions.get(from);
      let typebotResponse;

      if (!sessionId) {
        console.log("Iniciando nova sessão no Typebot...");

        typebotResponse = await startTypebot(
          userMessage
        );

        if (typebotResponse?.sessionId) {
          sessionId = typebotResponse.sessionId;

          sessions.set(
            from,
            sessionId
          );

          console.log(
            "Nova sessão Typebot criada:",
            sessionId
          );
        }
      } else {
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
      // 5. ENVIA AS RESPOSTAS DO TYPEBOT PARA O WHATSAPP
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

      // Mesmo em caso de erro, responde 200 para a Meta
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
// INICIAR CONVERSA NO TYPEBOT
// ===========================================================

async function startTypebot(userMessage) {
  const url =
    `https://typebot.co/api/v1/typebots/${process.env.TYPEBOT_ID}/startChat`;

  console.log(
    "Chamando Typebot startChat..."
  );

  const response = await fetch(
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
    data = JSON.parse(responseText);
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
// CONTINUAR CONVERSA NO TYPEBOT
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

  const response = await fetch(
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
    data = JSON.parse(responseText);
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
// PROCESSAR RESPOSTA DO TYPEBOT
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

  // ---------------------------------------------------------
  // ENVIA AS MENSAGENS DE TEXTO
  // ---------------------------------------------------------

  for (const message of messages) {
    if (message.type === "text") {
      const text =
        message.content?.richText
          ?.map((paragraph) =>
            paragraph.children
              ?.map(
                (child) =>
                  child.text || ""
              )
              .join("")
          )
          .join("\n") || "";

      if (text.trim()) {
        console.log(
          "Enviando resposta para WhatsApp:",
          text
        );

        await sendWhatsAppText(
          to,
          text
        );
      }
    }
  }

  // ---------------------------------------------------------
  // TYPEBOT AGUARDANDO RESPOSTA DO CLIENTE
  // ---------------------------------------------------------

  if (input) {
    console.log(
      "Typebot aguardando resposta:",
      JSON.stringify(input)
    );
  }
}


// ===========================================================
// ENVIAR TEXTO PELO WHATSAPP
// ===========================================================

async function sendWhatsAppText(
  to,
  text
) {
  const url =
    `https://graph.facebook.com/${process.env.GRAPH_API_VERSION}/${process.env.PHONE_NUMBER_ID}/messages`;

  const response = await fetch(
    url,
    {
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

   
