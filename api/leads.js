import crypto from "crypto";

// ===========================================================
// ADCRED - LISTAGEM DE LEADS
// ===========================================================

// Endpoint protegido pelo mesmo login do painel.
// Retorna os leads cadastrados pela página de captação.

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
    throw new Error("Configuração do Redis não encontrada.");
  }

  return {
    url: url.replace(/\/$/, ""),
    token
  };
}


// ===========================================================
// COMANDO REDIS
// ===========================================================

async function redisCommand(command) {
  const { url, token } = getRedisConfig();

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command)
  });

  if (!response.ok) {
    const texto = await response.text();

    throw new Error(
      `Erro Redis: ${response.status} ${texto}`
    );
  }

  const data = await response.json();

  return data?.result;
}


// ===========================================================
// AUTENTICAÇÃO DO PAINEL
// ===========================================================

function verificarAutenticacao(req) {
  const cookies = req.headers.cookie || "";

  const cookieSessao = cookies
    .split(";")
    .map(cookie => cookie.trim())
    .find(cookie =>
      cookie.startsWith("panel_session=")
    );

  if (!cookieSessao || !process.env.PANEL_PASSWORD) {
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
    .update("adcred-painel-autorizado")
    .digest("hex");

  try {
    const bufferRecebido =
      Buffer.from(tokenRecebido, "utf8");

    const bufferEsperado =
      Buffer.from(tokenEsperado, "utf8");

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

  } catch {
    return false;
  }
}


// ===========================================================
// PARSE SEGURO
// ===========================================================

function parseJsonSeguro(valor) {
  if (!valor) return null;

  try {
    return JSON.parse(valor);
  } catch {
    return null;
  }
}


// ===========================================================
// HANDLER
// ===========================================================

export default async function handler(req, res) {

  // ---------------------------------------------------------
  // AUTENTICAÇÃO
  // ---------------------------------------------------------

  if (!verificarAutenticacao(req)) {
    return res.status(401).json({
      ok: false,
      erro: "Não autorizado. Faça login no painel."
    });
  }


  // ---------------------------------------------------------
  // SOMENTE GET
  // ---------------------------------------------------------

  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);

    return res.status(405).json({
      ok: false,
      erro: "Método não permitido."
    });
  }


  try {

    // -------------------------------------------------------
    // BUSCAR TELEFONES DO ÍNDICE GERAL
    // Mais recentes primeiro.
    // -------------------------------------------------------

    const telefones =
      await redisCommand([
        "ZREVRANGE",
        "leads:todos",
        0,
        499
      ]);


    if (
      !Array.isArray(telefones) ||
      telefones.length === 0
    ) {
      return res.status(200).json({
        ok: true,
        total: 0,
        ativos: 0,
        descadastrados: 0,
        leads: []
      });
    }


    // -------------------------------------------------------
    // BUSCAR DADOS DE CADA LEAD
    // -------------------------------------------------------

    const leads = [];

    for (const telefone of telefones) {

      const leadRaw =
        await redisCommand([
          "GET",
          `lead:${telefone}`
        ]);

      const lead =
        parseJsonSeguro(leadRaw);

      if (!lead) {
        continue;
      }


      // -----------------------------------------------------
      // VERIFICAR DESCADASTRO TAMBÉM NO REGISTRO DE CAMPANHA
      // -----------------------------------------------------

      const campanhaTelefoneRaw =
        await redisCommand([
          "GET",
          `campanha:telefone:${telefone}`
        ]);

      const campanhaTelefone =
        parseJsonSeguro(
          campanhaTelefoneRaw
        );

      const descadastrado =
        lead.status === "descadastrado" ||
        campanhaTelefone?.descadastrado === true;


      leads.push({
        nome:
          lead.nome || "",

        telefone:
          lead.telefone || telefone,

        status:
          descadastrado
            ? "descadastrado"
            : "ativo",

        origem:
          lead.origem || "",

        consentimento:
          lead.consentimento === true,

        versaoConsentimento:
          lead.versaoConsentimento || "",

        consentimentoEm:
          lead.consentimentoEm || null,

        ultimoConsentimentoEm:
          lead.ultimoConsentimentoEm || null,

        criadoEm:
          lead.criadoEm || null,

        atualizadoEm:
          lead.atualizadoEm || null
      });
    }


    // -------------------------------------------------------
    // CONTADORES
    // -------------------------------------------------------

    const ativos =
      leads.filter(
        lead => lead.status === "ativo"
      ).length;

    const descadastrados =
      leads.filter(
        lead =>
          lead.status === "descadastrado"
      ).length;


    // -------------------------------------------------------
    // RESPOSTA
    // -------------------------------------------------------

    return res.status(200).json({
      ok: true,

      total:
        leads.length,

      ativos,

      descadastrados,

      leads
    });


  } catch (erro) {

    console.error(
      "Erro ao listar leads:",
      erro
    );


    return res.status(500).json({
      ok: false,
      erro:
        "Não foi possível carregar os leads."
    });
  }
}
