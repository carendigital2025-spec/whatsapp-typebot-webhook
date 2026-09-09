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
export default async function handler(req, res) {
  // ===========================================================
  // 1. PROTEÇÃO DA ROTA PELO LOGIN DO PAINEL
  // ===========================================================

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
    return res.status(401).json({
      ok: false,
      erro: "Não autorizado. Faça login no painel."
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
    Buffer.from(tokenRecebido);

  const esperado =
    Buffer.from(tokenEsperado);

  const autenticado =
    recebido.length === esperado.length &&
    crypto.timingSafeEqual(
      recebido,
      esperado
    );

  if (!autenticado) {
    return res.status(401).json({
      ok: false,
      erro: "Não autorizado. Faça login no painel."
    });
  }


  // ===========================================================
  // 2. ACEITA SOMENTE POST
  // ===========================================================

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      erro: "Método não permitido"
    });
  }


  try {

    // =========================================================
    // 3. RECEBE OS DADOS DO PAINEL
    // =========================================================

    const {
      campanha,
      template,
      contatos
    } = req.body || {};


    if (!campanha) {
      return res.status(400).json({
        ok: false,
        erro: "Nome da campanha não informado"
      });
    }


    if (!template) {
      return res.status(400).json({
        ok: false,
        erro: "Template não informado"
      });
    }


    if (
      !Array.isArray(contatos) ||
      contatos.length === 0
    ) {
      return res.status(400).json({
        ok: false,
        erro: "Nenhum contato válido recebido"
      });
    }


    // =========================================================
    // 4. TRAVA DE SEGURANÇA DO PRIMEIRO TESTE
    // =========================================================

    if (contatos.length !== 1) {
      return res.status(400).json({
        ok: false,
        erro:
          "Modo de teste ativo. Envie somente 1 contato por vez."
      });
    }


    // =========================================================
    // 5. PERMITE SOMENTE O TEMPLATE DA ADCRED NESTE TESTE
    // =========================================================

    if (
      template !== "consulta_fgts_adcred"
    ) {
      return res.status(400).json({
        ok: false,
        erro:
          "Neste teste somente o template consulta_fgts_adcred está autorizado."
      });
    }


    // =========================================================
    // 6. CONFERE VARIÁVEIS DA META
    // =========================================================

    if (!process.env.WHATSAPP_TOKEN) {
      return res.status(500).json({
        ok: false,
        erro:
          "WHATSAPP_TOKEN não configurado na Vercel."
      });
    }


    if (!process.env.PHONE_NUMBER_ID) {
      return res.status(500).json({
        ok: false,
        erro:
          "PHONE_NUMBER_ID não configurado na Vercel."
      });
    }


    const graphVersion =
      process.env.GRAPH_API_VERSION ||
      "v23.0";


    // =========================================================
    // 7. PEGA O ÚNICO CONTATO
    // =========================================================

    const contato =
      contatos[0];

    const telefone =
      String(
        contato?.telefone || ""
      ).replace(/\D/g, "");


    if (!telefone) {
      return res.status(400).json({
        ok: false,
        erro:
          "Telefone do contato não informado."
      });
    }


    // =========================================================
    // 8. URL DA CLOUD API
    // =========================================================

    const url =
      `https://graph.facebook.com/${graphVersion}/${process.env.PHONE_NUMBER_ID}/messages`;


    // =========================================================
    // 9. ENVIA O TEMPLATE APROVADO
    // =========================================================

    console.log(
      "Enviando template:",
      template,
      "para:",
      telefone
    );


    const respostaMeta =
      await fetch(
        url,
        {
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

              to:
                telefone,

              type:
                "template",

              template: {
                name:
                  "consulta_fgts_adcred",

                language: {
                  code:
                    "pt_BR"
                }
              }
            })
        }
      );


    const dadosMeta =
      await respostaMeta.json();


    // =========================================================
    // 10. ERRO DA META
    // =========================================================

    if (!respostaMeta.ok) {

      console.error(
        "Erro ao enviar template pela Meta:",
        JSON.stringify(
          dadosMeta
        )
      );


      return res
        .status(respostaMeta.status)
        .json({
          ok: false,

          erro:
            dadosMeta?.error?.message ||
            "A Meta recusou o envio do template.",

          codigoMeta:
            dadosMeta?.error?.code ||
            null,

          detalhes:
            dadosMeta
        });
    }


    // =========================================================
    // 11. ENVIO ACEITO
    // =========================================================

    const messageId =
      dadosMeta
        ?.messages
        ?.[0]
        ?.id ||
      null;
// Salva o vínculo entre a mensagem da Meta e a campanha
if (messageId) {
  await redisCommand([
    "SET",
    `campanha:mensagem:${messageId}`,
    JSON.stringify({
      campanha,
      template,
      telefone,
      status: "sent"
    })
  ]);
}
// Salva os contadores da campanha
await redisCommand([
  "SET",
  `campanha:status:${campanha}`,
  JSON.stringify({
    enviados: 1,
    entregues: 0,
    respondidos: 0,
    descadastrados: 0,
    atualizadoEm: new Date().toISOString()
  })
]);
    console.log(
      "Template enviado com sucesso.",
      "Message ID:",
      messageId
    );


    return res.status(200).json({
      ok: true,

      modo:
        "teste_real",

      campanha,

      template,

      quantidade:
        1,

      enviados:
        1,

      telefone,

      messageId,

      mensagem:
        "Mensagem de teste enviada com sucesso pela Meta."
    });


  } catch (error) {

    console.error(
      "Erro em send-campaign:",
      error
    );


    return res.status(500).json({
      ok: false,

      erro:
        "Erro interno ao enviar a campanha de teste.",

      detalhes:
        error?.message ||
        "Erro desconhecido"
    });
  }
}
