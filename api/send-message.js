import crypto from "crypto";

// ===========================================================
// AUTENTICAÇÃO DO PAINEL
// ===========================================================

function usuarioAutenticado(req) {
  const cookies = req.headers.cookie || "";

  const cookieSessao = cookies
    .split(";")
    .map(cookie => cookie.trim())
    .find(cookie =>
      cookie.startsWith("panel_session=")
    );

  if (
    !cookieSessao ||
    !process.env.PANEL_PASSWORD
  ) {
    return false;
  }

  const tokenRecebido =
    cookieSessao.substring(
      "panel_session=".length
    );

  const tokenEsperado = crypto
    .createHmac(
      "sha256",
      process.env.PANEL_PASSWORD
    )
    .update(
      "adcred-painel-autorizado"
    )
    .digest("hex");

  const recebido =
    Buffer.from(tokenRecebido);

  const esperado =
    Buffer.from(tokenEsperado);

  if (
    recebido.length !==
    esperado.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    recebido,
    esperado
  );
}


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
      "Variáveis do Redis não encontradas."
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

  const resposta =
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

  const dados =
    await resposta.json();

  if (!resposta.ok || dados?.error) {
    throw new Error(
      dados?.error ||
      "Erro ao acessar Redis."
    );
  }

  return dados?.result;
}


// ===========================================================
// SALVAR MENSAGEM ENVIADA NO CRM
// ===========================================================

async function salvarMensagemCrm(
  telefone,
  texto
) {
  const agora = Date.now();
  const dataIso =
    new Date(agora).toISOString();

  const mensagem = {
    telefone,
    texto,
    direcao: "saida",
    tipo: "text",
    timestamp: agora,
    data: dataIso
  };

  await redisCommand([
    "RPUSH",
    `crm:messages:${telefone}`,
    JSON.stringify(mensagem)
  ]);

  await redisCommand([
    "LTRIM",
    `crm:messages:${telefone}`,
    "-100",
    "-1"
  ]);

  let conversa = null;

  const existente =
    await redisCommand([
      "GET",
      `crm:conversation:${telefone}`
    ]);

  if (existente) {
    try {
      conversa =
        JSON.parse(existente);
    } catch {
      conversa = null;
    }
  }

  conversa = {
    ...(conversa || {}),
    telefone,
    ultimaMensagem: texto,
    ultimaData: dataIso,
    timestamp: agora
  };

  await redisCommand([
    "SET",
    `crm:conversation:${telefone}`,
    JSON.stringify(conversa)
  ]);

  await redisCommand([
    "ZADD",
    "crm:conversations",
    agora.toString(),
    telefone
  ]);
}


// ===========================================================
// ROTA PRINCIPAL
// ===========================================================

export default async function handler(
  req,
  res
) {
  if (!usuarioAutenticado(req)) {
    return res
      .status(401)
      .json({
        ok: false,
        erro:
          "Não autorizado. Faça login no painel."
      });
  }

  if (req.method !== "POST") {
    return res
      .status(405)
      .json({
        ok: false,
        erro:
          "Método não permitido."
      });
  }

  try {
    const telefone =
      String(
        req.body?.telefone || ""
      ).trim();

    const texto =
      String(
        req.body?.texto || ""
      ).trim();

    if (!telefone || !texto) {
      return res
        .status(400)
        .json({
          ok: false,
          erro:
            "Telefone e mensagem são obrigatórios."
        });
    }

    const url =
      `https://graph.facebook.com/${process.env.GRAPH_API_VERSION}/${process.env.PHONE_NUMBER_ID}/messages`;

    const resposta =
      await fetch(url, {
        method: "POST",

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

            to: telefone,

            type: "text",

            text: {
              preview_url: false,
              body: texto
            }
          })
      });

    const dados =
      await resposta.json();

    if (!resposta.ok) {
      console.error(
        "Erro Meta:",
        JSON.stringify(dados)
      );

      return res
        .status(resposta.status)
        .json({
          ok: false,
          erro:
            "Não foi possível enviar a mensagem.",
          detalhes: dados
        });
    }

    await salvarMensagemCrm(
      telefone,
      texto
    );

    return res
      .status(200)
      .json({
        ok: true,
        mensagem:
          "Mensagem enviada com sucesso.",
        meta: dados
      });

  } catch (erro) {
    console.error(
      "Erro send-message:",
      erro
    );

    return res
      .status(500)
      .json({
        ok: false,
        erro:
          "Erro interno ao enviar mensagem."
      });
  }
}
