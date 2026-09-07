import crypto from "crypto";


// ===========================================================
// AUTENTICAÇÃO DO PAINEL
// ===========================================================

function usuarioAutenticado(req) {

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
      "Variáveis do Redis não configuradas."
    );
  }

  return {
    url: url.replace(/\/$/, ""),
    token
  };
}


// ===========================================================
// EXECUTAR COMANDO NO REDIS
// ===========================================================

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

      body: JSON.stringify(
        command
      )
    });

  const texto =
    await resposta.text();

  if (!resposta.ok) {
    console.error(
      "Erro Redis:",
      resposta.status,
      texto
    );

    throw new Error(
      "Erro ao consultar Redis."
    );
  }

  let dados;

  try {
    dados = JSON.parse(texto);
  } catch {
    throw new Error(
      "Resposta inválida do Redis."
    );
  }

  if (dados?.error) {
    throw new Error(
      `Redis: ${dados.error}`
    );
  }

  return dados?.result;
}


// ===========================================================
// ROTA PRINCIPAL
// ===========================================================

export default async function handler(
  req,
  res
) {

  if (!usuarioAutenticado(req)) {

    return res.status(401).json({
      ok: false,
      erro:
        "Não autorizado. Faça login no painel."
    });
  }


  if (req.method !== "GET") {

    return res.status(405).json({
      ok: false,
      erro:
        "Método não permitido"
    });
  }


  try {

    const telefone =
      String(
        req.query?.telefone || ""
      )
        .replace(/\D/g, "");


    // =======================================================
    // BUSCAR MENSAGENS DE UM CLIENTE
    // =======================================================

    if (telefone) {

      const chaveMensagens =
        `crm:messages:${telefone}`;

      const registros =
        await redisCommand([
          "LRANGE",
          chaveMensagens,
          "0",
          "99"
        ]);

      const mensagens =
        Array.isArray(registros)
          ? registros
              .map(item => {
                try {
                  return JSON.parse(item);
                } catch {
                  return null;
                }
              })
              .filter(Boolean)
          : [];

      return res.status(200).json({
        ok: true,
        telefone,
        mensagens
      });
    }


    // =======================================================
    // LISTAR CONVERSAS
    // =======================================================

    const telefones =
      await redisCommand([
        "ZREVRANGE",
        "crm:conversations",
        "0",
        "99"
      ]);

    if (
      !Array.isArray(telefones) ||
      telefones.length === 0
    ) {

      return res.status(200).json({
        ok: true,
        conversations: []
      });
    }


    const conversations = [];


    for (const numero of telefones) {

      const registro =
        await redisCommand([
          "GET",
          `crm:conversation:${numero}`
        ]);

      if (!registro) {
        continue;
      }

      try {

        const conversa =
          JSON.parse(registro);

        conversations.push(
          conversa
        );

      } catch (erro) {

        console.error(
          "Conversa inválida no Redis:",
          numero
        );
      }
    }


    return res.status(200).json({
      ok: true,
      conversations
    });


  } catch (erro) {

    console.error(
      "Erro em conversations:",
      erro
    );

    return res.status(500).json({
      ok: false,
      erro:
        "Erro ao carregar as conversas."
    });
  }
}
