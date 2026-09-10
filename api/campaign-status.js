import crypto from "crypto";

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
    throw new Error(
      `Erro Redis: ${response.status}`
    );
  }

  const data =
    JSON.parse(responseText);

  if (data?.error) {
    throw new Error(
      `Redis: ${data.error}`
    );
  }

  return data?.result;
}


// ===========================================================
// ROTA PRINCIPAL
// ===========================================================

export default async function handler(req, res) {

  // =========================================================
  // 1. PROTEÇÃO PELO LOGIN DO PAINEL
  // =========================================================

  const cookies =
    req.headers.cookie || "";

  const cookieSessao =
    cookies
      .split(";")
      .map(cookie => cookie.trim())
      .find(cookie =>
        cookie.startsWith(
          "panel_session="
        )
      );

  if (
    !cookieSessao ||
    !process.env.PANEL_PASSWORD
  ) {
    return res.status(401).json({
      ok: false,
      erro:
        "Não autorizado. Faça login no painel."
    });
  }

  const tokenRecebido =
    cookieSessao.substring(
      "panel_session=".length
    );

  const tokenEsperado =
    crypto
      .createHmac(
        "sha256",
        process.env.PANEL_PASSWORD
      )
      .update(
        "adcred-painel-autorizado"
      )
      .digest("hex");

  const recebido =
    Buffer.from(
      tokenRecebido
    );

  const esperado =
    Buffer.from(
      tokenEsperado
    );

  const autenticado =
    recebido.length === esperado.length &&
    crypto.timingSafeEqual(
      recebido,
      esperado
    );

  if (!autenticado) {
    return res.status(401).json({
      ok: false,
      erro:
        "Não autorizado. Faça login no painel."
    });
  }


  // =========================================================
  // 2. SOMENTE GET
  // =========================================================

  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      erro:
        "Método não permitido"
    });
  }


  // =========================================================
  // 3. BUSCA STATUS DA CAMPANHA
  // =========================================================

  try {
    const campanha =
      String(
        req.query?.campanha || ""
      ).trim();

    if (!campanha) {
      return res.status(400).json({
        ok: false,
        erro:
          "Nome da campanha não informado"
      });
    }

    const registro =
      await redisCommand([
        "GET",
        `campanha:status:${campanha}`
      ]);

    if (!registro) {
      return res.status(200).json({
        ok: true,
        campanha,
        enviados: 0,
        entregues: 0,
        respondidos: 0,
        descadastrados: 0
      });
    }

    const statusCampanha =
      JSON.parse(registro);

    return res.status(200).json({
      ok: true,

      campanha,

      enviados:
        Number(
          statusCampanha.enviados || 0
        ),

      entregues:
        Number(
          statusCampanha.entregues || 0
        ),

      respondidos:
        Number(
          statusCampanha.respondidos || 0
        ),

      descadastrados:
        Number(
          statusCampanha.descadastrados || 0
        ),

      atualizadoEm:
        statusCampanha.atualizadoEm ||
        null
    });

  } catch (error) {
    console.error(
      "Erro em campaign-status:",
      error
    );

    return res.status(500).json({
      ok: false,
      erro:
        "Erro interno ao consultar status da campanha"
    });
  }
}
