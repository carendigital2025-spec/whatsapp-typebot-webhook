const SESSION_TTL_SECONDS = 60 * 60 * 24;


// ===========================================================
// REDIS
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
    token
  };
}


async function redisCommand(command) {
  const { url, token } =
    getRedisConfig();

  const response =
    await fetch(url, {
      method: "POST",

      headers: {
        Authorization:
          `Bearer ${token}`,

        "Content-Type":
          "application/json"
      },

      body:
        JSON.stringify(command)
    });

  const responseText =
    await response.text();

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
    data =
      JSON.parse(responseText);
  } catch {
    throw new Error(
      "Resposta inválida do Redis."
    );
  }

  if (data?.error) {
    throw new Error(
      `Redis: ${data.error}`
    );
  }

  return data?.result;
}


// ===========================================================
// CRM
// ===========================================================

async function getCrmConversation(
  telefone
) {
  const registro =
    await redisCommand([
      "GET",
      `crm:conversation:${telefone}`
    ]);

  if (!registro) {
    return null;
  }

  try {
    return JSON.parse(registro);
  } catch {
    return null;
  }
}


async function saveCrmMessage({
  telefone,
  texto,
  direcao,
  nome = "",
  tipo = "text"
}) {
  if (!telefone || !texto) {
    return;
  }

  const agora =
    Date.now();

  const dataIso =
    new Date(
      agora
    ).toISOString();

  const mensagem = {
    telefone,
    texto,
    direcao,
    tipo,
    timestamp: agora,
    data: dataIso
  };

  await redisCommand([
    "RPUSH",
    `crm:messages:${telefone}`,
    JSON.stringify(
      mensagem
    )
  ]);

  await redisCommand([
    "LTRIM",
    `crm:messages:${telefone}`,
    "-100",
    "-1"
  ]);

  const existente =
    await getCrmConversation(
      telefone
    );

  const conversaAnterior =
    existente || {};

  const nomeAtual =
    nome ||
    conversaAnterior.nome ||
    telefone;

  const naoLidasAnteriores =
    Number(
      conversaAnterior.naoLidas ||
      0
    );

  const naoLidas =
    direcao === "entrada"
      ? naoLidasAnteriores + 1
      : naoLidasAnteriores;

  const conversa = {
    ...conversaAnterior,

    telefone,

    nome:
      nomeAtual,

    ultimaMensagem:
      texto,

    ultimaDirecao:
      direcao,

    ultimaData:
      dataIso,

    atualizadoEm:
      dataIso,

    timestamp:
      agora,

    naoLidas,

    status:
      conversaAnterior.status ||
      "novo",

    modoAtendimento:
      conversaAnterior.modoAtendimento ||
      "bot"
  };

  await redisCommand([
    "SET",
    `crm:conversation:${telefone}`,
    JSON.stringify(
      conversa
    )
  ]);

  await redisCommand([
    "ZADD",
    "crm:conversations",
    agora.toString(),
    telefone
  ]);
}


// ===========================================================
// TYPEBOT SESSION
// ===========================================================

function getSessionKey(from) {
  return `typebot_session:${from}`;
}


async function getSession(from) {
  const sessionId =
    await redisCommand([
      "GET",
      getSessionKey(from)
    ]);

  return sessionId || null;
}


async function saveSession(
  from,
  sessionId
) {
  await redisCommand([
    "SET",
    getSessionKey(from),
    sessionId,
    "EX",
    SESSION_TTL_SECONDS.toString()
  ]);
}


async function deleteSession(from) {
  await redisCommand([
    "DEL",
    getSessionKey(from)
  ]);
}


// ===========================================================
// WEBHOOK PRINCIPAL
// ===========================================================

export default async function handler(
  req,
  res
) {

  if (req.method === "GET") {
    const mode =
      req.query["hub.mode"];

    const token =
      req.query[
        "hub.verify_token"
      ];

    const challenge =
      req.query[
        "hub.challenge"
      ];

    if (
      mode === "subscribe" &&
      token ===
        process.env
          .WEBHOOK_VERIFY_TOKEN
    ) {
      return res
        .status(200)
        .send(challenge);
    }

    return res
      .status(403)
      .send("Token inválido");
  }


  if (req.method === "POST") {
    try {
      const change =
        req.body
          ?.entry?.[0]
          ?.changes?.[0]
          ?.value;

      const message =
        change
          ?.messages?.[0];

      if (!message) {
        return res
          .status(200)
          .send(
            "EVENTO_RECEBIDO"
          );
      }

      const from =
        message.from;

      const nomePerfil =
        change
          ?.contacts?.[0]
          ?.profile?.name ||
        "";

      let userMessage = "";


      // TEXTO
      if (
        message.type ===
        "text"
      ) {
        userMessage =
          message.text
            ?.body ||
          "";
      }


      // BOTÃO / LISTA
      if (
        message.type ===
        "interactive"
      ) {
        if (
          message.interactive
            ?.type ===
          "button_reply"
        ) {
          const buttonReply =
            message
              .interactive
              .button_reply;

          const buttonId =
            buttonReply?.id ||
            "";

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
                buttonReply?.title ||
                "";
            }
          } else {
            userMessage =
              buttonReply?.title ||
              "";
          }
        }

        if (
          message.interactive
            ?.type ===
          "list_reply"
        ) {
          userMessage =
            message
              .interactive
              .list_reply
              ?.title ||
            "";
        }
      }


      if (!userMessage) {
        return res
          .status(200)
          .send(
            "EVENTO_RECEBIDO"
          );
      }


      // SALVA NO CRM
      try {
        await saveCrmMessage({
          telefone:
            from,

          texto:
            userMessage,

          direcao:
            "entrada",

          nome:
            nomePerfil,

          tipo:
            message.type
        });
      } catch (erroCrm) {
        console.error(
          "Erro CRM:",
          erroCrm
        );
      }


      // =====================================================
      // VERIFICAR SE HUMANO ASSUMIU
      // =====================================================

      const conversaAtual =
        await getCrmConversation(
          from
        );

      const modoAtendimento =
        conversaAtual
          ?.modoAtendimento ||
        "bot";


      if (
        modoAtendimento ===
        "humano"
      ) {
        console.log(
          "Atendimento humano ativo para:",
          from
        );

        return res
          .status(200)
          .send(
            "EVENTO_RECEBIDO"
          );
      }


      // =====================================================
      // COMANDO REINICIAR
      // =====================================================

      if (
        userMessage
          .trim()
          .toLowerCase() ===
        "reiniciar"
      ) {
        await deleteSession(
          from
        );

        const typebotResponse =
          await startTypebot(
            ""
          );

        if (
          typebotResponse
            ?.sessionId
        ) {
          await saveSession(
            from,
            typebotResponse
              .sessionId
          );
        }

        await processTypebotResponse(
          typebotResponse,
          from
        );

        return res
          .status(200)
          .send(
            "EVENTO_RECEBIDO"
          );
      }


      // =====================================================
      // TYPEBOT
      // =====================================================

      let sessionId =
        await getSession(
          from
        );

      let typebotResponse;

      if (!sessionId) {
        typebotResponse =
          await startTypebot(
            userMessage
          );

        if (
          typebotResponse
            ?.sessionId
        ) {
          sessionId =
            typebotResponse
              .sessionId;

          await saveSession(
            from,
            sessionId
          );
        }

      } else {
        try {
          typebotResponse =
            await continueTypebot(
              sessionId,
              userMessage
            );

          await saveSession(
            from,
            sessionId
          );

        } catch (error) {
          console.error(
            "Falha ao continuar sessão Typebot:",
            error
          );

          await deleteSession(
            from
          );

          typebotResponse =
            await startTypebot(
              userMessage
            );

          if (
            typebotResponse
              ?.sessionId
          ) {
            sessionId =
              typebotResponse
                .sessionId;

            await saveSession(
              from,
              sessionId
            );
          }
        }
      }


      await processTypebotResponse(
        typebotResponse,
        from
      );

      return res
        .status(200)
        .send(
          "EVENTO_RECEBIDO"
        );

    } catch (error) {
      console.error(
        "Erro webhook:",
        error
      );

      return res
        .status(200)
        .send(
          "EVENTO_RECEBIDO"
        );
    }
  }


  return res
    .status(405)
    .send(
      "Método não permitido"
    );
}


// ===========================================================
// TYPEBOT START
// ===========================================================

async function startTypebot(
  userMessage
) {
  const url =
    `https://typebot.co/api/v1/typebots/${process.env.TYPEBOT_ID}/startChat`;

  const response =
    await fetch(
      url,
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({
            message:
              userMessage
          })
      }
    );

  const responseText =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `Erro Typebot startChat: ${response.status}`
    );
  }

  return JSON.parse(
    responseText
  );
}


// ===========================================================
// TYPEBOT CONTINUE
// ===========================================================

async function continueTypebot(
  sessionId,
  userMessage
) {
  const url =
    `https://typebot.co/api/v1/sessions/${sessionId}/continueChat`;

  const response =
    await fetch(
      url,
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({
            message:
              userMessage
          })
      }
    );

  const responseText =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `Erro Typebot continueChat: ${response.status}`
    );
  }

  return JSON.parse(
    responseText
  );
}


// ===========================================================
// PROCESSAR TYPEBOT
// ===========================================================

async function processTypebotResponse(
  typebotResponse,
  to
) {
  if (!typebotResponse) {
    return;
  }

  const messages =
    typebotResponse.messages ||
    [];

  const input =
    typebotResponse.input ||
    null;


  for (const message of messages) {

    if (
      message.type ===
      "text"
    ) {
      const text =
        extractTypebotText(
          message
        );

      if (!text.trim()) {
        continue;
      }

      await sendWhatsAppText(
        to,
        text
      );

      try {
        await saveCrmMessage({
          telefone:
            to,

          texto:
            text,

          direcao:
            "saida",

          tipo:
            "typebot"
        });
      } catch {}

      continue;
    }


    if (
      message.type ===
      "video"
    ) {
      const videoUrl =
        extractTypebotVideoUrl(
          message
        );

      if (!videoUrl) {
        continue;
      }

      try {
        await sendWhatsAppVideo(
          to,
          videoUrl
        );

        try {
          await saveCrmMessage({
            telefone:
              to,

            texto:
              "Vídeo enviado",

            direcao:
              "saida",

            tipo:
              "video"
          });
        } catch {}

      } catch {
        await sendWhatsAppText(
          to,
          videoUrl
        );

        try {
          await saveCrmMessage({
            telefone:
              to,

            texto:
              videoUrl,

            direcao:
              "saida",

            tipo:
              "text"
          });
        } catch {}
      }
    }
  }


  if (!input) {
    return;
  }


  if (
    input.type ===
      "choice input" &&
    Array.isArray(
      input.items
    ) &&
    input.items.length > 0
  ) {
    await sendWhatsAppButtons(
      to,
      input.items
    );

    return;
  }


  if (
    input.type ===
    "text input"
  ) {
    const placeholder =
      input
        .options
        ?.labels
        ?.placeholder ||
      "Digite sua resposta:";

    await sendWhatsAppText(
      to,
      placeholder
    );

    try {
      await saveCrmMessage({
        telefone:
          to,

        texto:
          placeholder,

        direcao:
          "saida",

        tipo:
          "typebot"
      });
    } catch {}
  }
}


// ===========================================================
// EXTRAIR TEXTO
// ===========================================================

function extractTypebotText(
  message
) {
  if (
    typeof message
      ?.content ===
    "string"
  ) {
    return message.content;
  }

  if (
    typeof message
      ?.content
      ?.text ===
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
        typeof paragraph
          ?.text ===
        "string"
      ) {
        return paragraph.text;
      }

      if (
        Array.isArray(
          paragraph
            ?.children
        )
      ) {
        return paragraph
          .children
          .map(
            (child) =>
              child?.text ||
              ""
          )
          .join("");
      }

      return "";
    })
    .join("\n");
}


// ===========================================================
// VÍDEO
// ===========================================================

function extractTypebotVideoUrl(
  message
) {
  const content =
    message?.content;

  const candidatos = [
    content?.url,
    content?.src,
    content?.videoUrl,
    content?.video?.url,
    content?.media?.url,
    content?.file?.url,
    message?.url
  ];

  for (
    const candidato of
    candidatos
  ) {
    if (
      typeof candidato ===
        "string" &&
      isHttpUrl(
        candidato
      )
    ) {
      return candidato.trim();
    }
  }

  return findFirstHttpUrl(
    content
  );
}


function findFirstHttpUrl(
  value
) {
  if (
    typeof value ===
    "string"
  ) {
    const texto =
      value.trim();

    return isHttpUrl(
      texto
    )
      ? texto
      : "";
  }

  if (
    !value ||
    typeof value !==
      "object"
  ) {
    return "";
  }

  if (
    Array.isArray(value)
  ) {
    for (
      const item of value
    ) {
      const encontrado =
        findFirstHttpUrl(
          item
        );

      if (encontrado) {
        return encontrado;
      }
    }

    return "";
  }

  for (
    const key of
    Object.keys(value)
  ) {
    const encontrado =
      findFirstHttpUrl(
        value[key]
      );

    if (encontrado) {
      return encontrado;
    }
  }

  return "";
}


function isHttpUrl(value) {
  return (
    typeof value ===
      "string" &&
    (
      value.startsWith(
        "https://"
      ) ||
      value.startsWith(
        "http://"
      )
    )
  );
}


// ===========================================================
// BOTÕES
// ===========================================================

function getChoiceText(
  item,
  index
) {
  if (
    typeof item ===
    "string"
  ) {
    return item;
  }

  const valores = [
    item?.content,
    item?.label,
    item?.value,
    item?.text,
    item?.name
  ];

  for (
    const valor of valores
  ) {
    if (
      typeof valor ===
        "string" &&
      valor.trim()
    ) {
      return valor.trim();
    }
  }

  return `Opção ${index + 1}`;
}


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

        return {
          type:
            "reply",

          reply: {
            id:
              "typebot_choice:" +
              encodeURIComponent(
                originalText
              ),

            title:
              originalText.substring(
                0,
                20
              )
          }
        };
      }
    );

  const url =
    `https://graph.facebook.com/${process.env.GRAPH_API_VERSION}/${process.env.PHONE_NUMBER_ID}/messages`;

  const response =
    await fetch(
      url,
      {
        method:
          "POST",

        headers: {
          Authorization:
            `Bearer ${process.env.WHATSAPP_TOKEN}`,

          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({
            messaging_product:
              "whatsapp",

            recipient_type:
              "individual",

            to,

            type:
              "interactive",

            interactive: {
              type:
                "button",

              body: {
                text:
                  "Escolha uma das opções abaixo:"
              },

              action: {
                buttons
              }
            }
          })
      }
    );

  const data =
    await response.json();

  if (!response.ok) {
    throw new Error(
      "Falha ao enviar botões pelo WhatsApp"
    );
  }

  return data;
}


// ===========================================================
// ENVIAR VÍDEO
// ===========================================================

async function sendWhatsAppVideo(
  to,
  videoUrl
) {
  const url =
    `https://graph.facebook.com/${process.env.GRAPH_API_VERSION}/${process.env.PHONE_NUMBER_ID}/messages`;

  const response =
    await fetch(
      url,
      {
        method:
          "POST",

        headers: {
          Authorization:
            `Bearer ${process.env.WHATSAPP_TOKEN}`,

          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({
            messaging_product:
              "whatsapp",

            recipient_type:
              "individual",

            to,

            type:
              "video",

            video: {
              link:
                videoUrl
            }
          })
      }
    );

  const responseText =
    await response.text();

  let data;

  try {
    data =
      JSON.parse(
        responseText
      );
  } catch {
    data = {
      raw:
        responseText
    };
  }

  if (!response.ok) {
    throw new Error(
      `Falha ao enviar vídeo: ${response.status}`
    );
  }

  return data;
}


// ===========================================================
// ENVIAR TEXTO
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
        method:
          "POST",

        headers: {
          Authorization:
            `Bearer ${process.env.WHATSAPP_TOKEN}`,

          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({
            messaging_product:
              "whatsapp",

            recipient_type:
              "individual",

            to,

            type:
              "text",

            text: {
              preview_url:
                false,

              body:
                text
            }
          })
      }
    );

  const data =
    await response.json();

  if (!response.ok) {
    throw new Error(
      "Falha ao enviar mensagem pelo WhatsApp"
    );
  }

  return data;
}
