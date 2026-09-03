const sessions = new Map();

export default async function handler(req, res) {
  // Verificação do webhook pela Meta
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (
      mode === "subscribe" &&
      token === process.env.WEBHOOK_VERIFY_TOKEN
    ) {
      return res.status(200).send(challenge);
    }

    return res.status(403).send("Token inválido");
  }

  // Recebimento de mensagens do WhatsApp
  if (req.method === "POST") {
    // Responde rapidamente à Meta
    res.status(200).send("EVENTO_RECEBIDO");

    try {
      const change =
        req.body?.entry?.[0]?.changes?.[0]?.value;

      const message = change?.messages?.[0];

      // Ignora eventos que não sejam mensagens recebidas
      if (!message) return;

      const from = message.from;

      let userMessage = "";

      if (message.type === "text") {
        userMessage = message.text?.body || "";
      } else if (message.type === "interactive") {
        userMessage =
          message.interactive?.button_reply?.title ||
          message.interactive?.list_reply?.title ||
          "";
      }

      if (!from || !userMessage) return;

      console.log("Mensagem recebida:", from, userMessage);

      let sessionId = sessions.get(from);
      let typebotResponse;

      // Se ainda não existe sessão, inicia o Typebot
      if (!sessionId) {
        const startResponse = await fetch(
          `https://typebot.co/api/v1/typebots/${process.env.TYPEBOT_ID}/startChat`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({}),
          }
        );

        typebotResponse = await startResponse.json();

        if (!startResponse.ok) {
          console.error("Erro startChat:", typebotResponse);
          return;
        }

        sessionId = typebotResponse.sessionId;
        sessions.set(from, sessionId);
      } else {
        // Continua a conversa existente
        const continueResponse = await fetch(
          `https://typebot.co/api/v1/sessions/${sessionId}/continueChat`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              message: userMessage,
            }),
          }
        );

        typebotResponse = await continueResponse.json();

        if (!continueResponse.ok) {
          console.error("Erro continueChat:", typebotResponse);
          sessions.delete(from);
          return;
        }
      }

      // Pega textos retornados pelo Typebot
      const messages = typebotResponse.messages || [];

      for (const msg of messages) {
        if (msg.type !== "text") continue;

        const text =
          msg.content?.richText
            ?.map((paragraph) =>
              paragraph.children
                ?.map((child) => child.text || "")
                .join("")
            )
            .join("\n") || "";

        if (!text) continue;

        await sendWhatsAppText(from, text);
      }
    } catch (error) {
      console.error("Erro webhook:", error);
    }

    return;
  }

  return res.status(405).send("Método não permitido");
}

async function sendWhatsAppText(to, body) {
  const response = await fetch(
    `https://graph.facebook.com/v26.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: {
          body,
        },
      }),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    console.error("Erro ao enviar WhatsApp:", data);
  } else {
    console.log("Mensagem enviada:", data);
  }
}
