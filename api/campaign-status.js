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

  return {
    url,
    token
  };
}


async function redisCommand(command) {
  const { url, token } =
    getRedisConfig();

  if (!url || !token) {
    throw new Error(
      "Configuração do Redis não encontrada."
    );
  }

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

  if (!resposta.ok) {
    throw new Error(
      dados?.error ||
      "Erro ao acessar Redis."
    );
  }

  return dados.result;
}


// ===========================================================
// AUTENTICAÇÃO
// ===========================================================

function autenticarPainel(req) {
  const cookies =
    req.headers.cookie || "";

  const cookieSessao =
    cookies
      .split(";")
      .map(cookie =>
        cookie.trim()
      )
      .find(cookie =>
        cookie.startsWith(
          "panel_session="
        )
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


  const bufferRecebido =
    Buffer.from(tokenRecebido);

  const bufferEsperado =
    Buffer.from(tokenEsperado);


  if (
    bufferRecebido.length !==
    bufferEsperado.length
  ) {
    return false;
  }


  return crypto.timingSafeEqual(
    bufferRecebido,
    bufferEsperado
  );
}


// ===========================================================
// HANDLER
// ===========================================================

export default async function handler(
  req,
  res
) {

  if (!autenticarPainel(req)) {
    return res
      .status(401)
      .json({
        ok: false,
        erro:
          "Não autorizado. Faça login no painel."
      });
  }


  if (req.method !== "GET") {
    return res
      .status(405)
      .json({
        ok: false,
        erro:
          "Método não permitido."
      });
  }


  try {

    const campanha =
      String(
        req.query?.campanha || ""
      ).trim();


    if (!campanha) {
      return res
        .status(400)
        .json({
          ok: false,
          erro:
            "Informe a campanha."
        });
    }


    const registro =
      await redisCommand([
        "GET",
        `campanha:status:${campanha}`
      ]);


    if (!registro) {
      return res
        .status(404)
        .json({
          ok: false,
          erro:
            "Campanha não encontrada."
        });
    }


    let status;

    try {
      status =
        JSON.parse(registro);
    } catch {
      return res
        .status(500)
        .json({
          ok: false,
          erro:
            "Status da campanha inválido."
        });
    }


    return res
      .status(200)
      .json({
        ok: true,

        campanha,

        template:
          status.template || "",

        total:
          Number(
            status.total || 0
          ),

        enviados:
          Number(
            status.enviados || 0
          ),

        entregues:
          Number(
            status.entregues || 0
          ),

        respondidos:
          Number(
            status.respondidos || 0
          ),

        descadastrados:
          Number(
            status.descadastrados || 0
          ),

        falhas:
          Number(
            status.falhas || 0
          ),

        ignorados:
          Number(
            status.ignorados || 0
          ),

        criadoEm:
          status.criadoEm || null,

        finalizadoEm:
          status.finalizadoEm || null,

        atualizadoEm:
          status.atualizadoEm || null
      });


  } catch (erro) {

    console.error(
      "Erro campaign-status:",
      erro
    );

    return res
      .status(500)
      .json({
        ok: false,
        erro:
          erro?.message ||
          "Erro interno."
      });
  }
}
