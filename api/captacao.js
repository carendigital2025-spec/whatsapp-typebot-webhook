// ===========================================================
// ADCRED - CAPTAÇÃO DE LEADS
// ===========================================================


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
// EXECUTAR COMANDO NO REDIS
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
// NORMALIZAR TELEFONE
// Aceita números brasileiros de qualquer DDD.
// ===========================================================

function normalizarTelefone(valor) {
  let telefone = String(valor || "")
    .replace(/\D/g, "");

  // Número já contendo o código do Brasil 55.
  if (
    telefone.startsWith("55") &&
    (telefone.length === 12 ||
      telefone.length === 13)
  ) {
    return telefone;
  }

  // Número brasileiro com DDD.
  if (
    telefone.length === 10 ||
    telefone.length === 11
  ) {
    return "55" + telefone;
  }

  return "";
}


// ===========================================================
// LIMPAR TEXTO
// ===========================================================

function limparTexto(valor, limite = 200) {
  return String(valor || "")
    .trim()
    .replace(/\s+/g, " ")
    .substring(0, limite);
}


// ===========================================================
// RESPOSTA JSON
// ===========================================================

function responder(res, status, dados) {
  return res
    .status(status)
    .json(dados);
}


// ===========================================================
// HANDLER PRINCIPAL
// ===========================================================

export default async function handler(req, res) {

  // ---------------------------------------------------------
  // SOMENTE POST
  // ---------------------------------------------------------

  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);

    return responder(
      res,
      405,
      {
        ok: false,
        erro: "Método não permitido."
      }
    );
  }


  try {

    // -------------------------------------------------------
    // RECEBER DADOS
    // -------------------------------------------------------

    const {
      nome,
      telefone,
      consentimento,
      origem,
      versaoConsentimento
    } = req.body || {};


    // -------------------------------------------------------
    // VALIDAR NOME
    // -------------------------------------------------------

    const nomeLimpo =
      limparTexto(nome, 100);

    if (nomeLimpo.length < 2) {
      return responder(
        res,
        400,
        {
          ok: false,
          erro: "Informe um nome válido."
        }
      );
    }


    // -------------------------------------------------------
    // VALIDAR TELEFONE
    // -------------------------------------------------------

    const telefoneNormalizado =
      normalizarTelefone(telefone);

    if (!telefoneNormalizado) {
      return responder(
        res,
        400,
        {
          ok: false,
          erro:
            "Informe um número de WhatsApp válido com DDD."
        }
      );
    }


    // -------------------------------------------------------
    // VALIDAR CONSENTIMENTO
    // -------------------------------------------------------

    if (consentimento !== true) {
      return responder(
        res,
        400,
        {
          ok: false,
          erro:
            "É necessário autorizar o contato para continuar."
        }
      );
    }


    // -------------------------------------------------------
    // DADOS DO CADASTRO
    // -------------------------------------------------------

    const origemLimpa =
      limparTexto(
        origem || "pagina_captacao",
        100
      );

    const versaoLimpa =
      limparTexto(
        versaoConsentimento || "v1",
        50
      );

    const agora =
      new Date().toISOString();


    // -------------------------------------------------------
    // CHAVES DO REDIS
    // -------------------------------------------------------

    const chaveLead =
      `lead:${telefoneNormalizado}`;

    const chaveCampanhaTelefone =
      `campanha:telefone:${telefoneNormalizado}`;


    // -------------------------------------------------------
    // VERIFICAR DESCADASTRO JÁ REGISTRADO
    // -------------------------------------------------------

    const campanhaTelefoneRaw =
      await redisCommand([
        "GET",
        chaveCampanhaTelefone
      ]);

    if (campanhaTelefoneRaw) {
      try {
        const campanhaTelefone =
          JSON.parse(campanhaTelefoneRaw);

        if (
          campanhaTelefone?.descadastrado === true
        ) {
          return responder(
            res,
            409,
            {
              ok: false,
              descadastrado: true,
              erro:
                "Este número possui um pedido de descadastro registrado. Entre em contato com o atendimento caso queira reativar seu cadastro."
            }
          );
        }

      } catch (erro) {
        console.error(
          "Erro ao interpretar registro da campanha:",
          erro
        );
      }
    }


    // -------------------------------------------------------
    // VERIFICAR SE O LEAD JÁ EXISTE
    // -------------------------------------------------------

    const leadExistenteRaw =
      await redisCommand([
        "GET",
        chaveLead
      ]);

    if (leadExistenteRaw) {
      try {
        const leadExistente =
          JSON.parse(leadExistenteRaw);

        // Não reativa automaticamente um lead
        // marcado como descadastrado.
        if (
          leadExistente?.status === "descadastrado"
        ) {
          return responder(
            res,
            409,
            {
              ok: false,
              descadastrado: true,
              erro:
                "Este número possui um pedido de descadastro registrado. Entre em contato com o atendimento caso queira reativar seu cadastro."
            }
          );
        }


        // ---------------------------------------------------
        // ATUALIZAR LEAD EXISTENTE
        // ---------------------------------------------------

        const atualizado = {
          ...leadExistente,

          nome:
            nomeLimpo,

          telefone:
            telefoneNormalizado,

          origem:
            origemLimpa,

          consentimento:
            true,

          versaoConsentimento:
            versaoLimpa,

          ultimoConsentimentoEm:
            agora,

          atualizadoEm:
            agora,

          status:
            "ativo"
        };


        await redisCommand([
          "SET",
          chaveLead,
          JSON.stringify(atualizado)
        ]);


        // Índice geral.
        await redisCommand([
          "ZADD",
          "leads:todos",
          Date.now(),
          telefoneNormalizado
        ]);


        // Índice de ativos.
        await redisCommand([
          "ZADD",
          "leads:ativos",
          Date.now(),
          telefoneNormalizado
        ]);


        // ---------------------------------------------------
        // HISTÓRICO DO NOVO CONSENTIMENTO
        // ---------------------------------------------------

        const registroConsentimento = {
          telefone:
            telefoneNormalizado,

          nome:
            nomeLimpo,

          consentimento:
            true,

          origem:
            origemLimpa,

          versaoConsentimento:
            versaoLimpa,

          registradoEm:
            agora
        };


        await redisCommand([
          "LPUSH",
          `lead:consentimentos:${telefoneNormalizado}`,
          JSON.stringify(registroConsentimento)
        ]);


        await redisCommand([
          "LTRIM",
          `lead:consentimentos:${telefoneNormalizado}`,
          0,
          49
        ]);


        console.log(
          "Lead existente atualizado:",
          telefoneNormalizado
        );


        return responder(
          res,
          200,
          {
            ok: true,
            novo: false,
            mensagem:
              "Cadastro atualizado com sucesso."
          }
        );

      } catch (erro) {
        console.error(
          "Erro ao interpretar lead existente:",
          erro
        );
      }
    }


    // -------------------------------------------------------
    // CRIAR NOVO LEAD
    // -------------------------------------------------------

    const novoLead = {
      nome:
        nomeLimpo,

      telefone:
        telefoneNormalizado,

      status:
        "ativo",

      origem:
        origemLimpa,

      consentimento:
        true,

      versaoConsentimento:
        versaoLimpa,

      consentimentoEm:
        agora,

      ultimoConsentimentoEm:
        agora,

      criadoEm:
        agora,

      atualizadoEm:
        agora
    };


    // -------------------------------------------------------
    // SALVAR LEAD
    // -------------------------------------------------------

    await redisCommand([
      "SET",
      chaveLead,
      JSON.stringify(novoLead)
    ]);


    // -------------------------------------------------------
    // ÍNDICE GERAL
    // -------------------------------------------------------

    await redisCommand([
      "ZADD",
      "leads:todos",
      Date.now(),
      telefoneNormalizado
    ]);


    // -------------------------------------------------------
    // ÍNDICE DE ATIVOS
    // -------------------------------------------------------

    await redisCommand([
      "ZADD",
      "leads:ativos",
      Date.now(),
      telefoneNormalizado
    ]);


    // -------------------------------------------------------
    // HISTÓRICO DO CONSENTIMENTO
    // -------------------------------------------------------

    const registroConsentimento = {
      telefone:
        telefoneNormalizado,

      nome:
        nomeLimpo,

      consentimento:
        true,

      origem:
        origemLimpa,

      versaoConsentimento:
        versaoLimpa,

      registradoEm:
        agora
    };


    await redisCommand([
      "LPUSH",
      `lead:consentimentos:${telefoneNormalizado}`,
      JSON.stringify(registroConsentimento)
    ]);


    // Mantém os 50 registros de consentimento
    // mais recentes daquele telefone.
    await redisCommand([
      "LTRIM",
      `lead:consentimentos:${telefoneNormalizado}`,
      0,
      49
    ]);


    // -------------------------------------------------------
    // SUCESSO
    // -------------------------------------------------------

    console.log(
      "Novo lead captado:",
      telefoneNormalizado
    );


    return responder(
      res,
      201,
      {
        ok: true,
        novo: true,
        mensagem:
          "Cadastro realizado com sucesso."
      }
    );


  } catch (erro) {

    console.error(
      "Erro no endpoint de captação:",
      erro
    );


    return responder(
      res,
      500,
      {
        ok: false,
        erro:
          "Não foi possível realizar o cadastro agora. Tente novamente."
      }
    );
  }
}
