import crypto from "crypto";

const MAX_CONTATOS_POR_CAMPANHA = 100;
const INTERVALO_ENTRE_ENVIOS_MS = 250;

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
// UTILIDADES
// ===========================================================

function aguardar(ms) {
  return new Promise(
    resolve =>
      setTimeout(resolve, ms)
  );
}


function normalizarTelefone(valor) {
  return String(valor || "")
    .replace(/\D/g, "");
}


// ===========================================================
// AUTENTICAÇÃO DO PAINEL
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

  // ---------------------------------------------------------
  // AUTENTICAÇÃO
  // ---------------------------------------------------------

  if (!autenticarPainel(req)) {
    return res
      .status(401)
      .json({
        ok: false,
        erro:
          "Não autorizado. Faça login no painel."
      });
  }


  // ---------------------------------------------------------
  // MÉTODO
  // ---------------------------------------------------------

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

    // -------------------------------------------------------
    // DADOS RECEBIDOS
    // -------------------------------------------------------

    const nomeCampanha =
      String(
        req.body?.campanha || ""
      ).trim();

    const nomeTemplate =
      String(
        req.body?.template || ""
      ).trim();

    const contatosRecebidos =
      Array.isArray(
        req.body?.contatos
      )
        ? req.body.contatos
        : [];


    // -------------------------------------------------------
    // VALIDAÇÕES
    // -------------------------------------------------------

    if (!nomeCampanha) {
      return res
        .status(400)
        .json({
          ok: false,
          erro:
            "Informe o nome da campanha."
        });
    }


    if (!nomeTemplate) {
      return res
        .status(400)
        .json({
          ok: false,
          erro:
            "Selecione um template."
        });
    }


    if (
      nomeTemplate !==
      "consulta_fgts_adcred"
    ) {
      return res
        .status(400)
        .json({
          ok: false,
          erro:
            "Template não autorizado para este envio."
        });
    }


    if (
      contatosRecebidos.length === 0
    ) {
      return res
        .status(400)
        .json({
          ok: false,
          erro:
            "Nenhum contato recebido."
        });
    }


    if (
      contatosRecebidos.length >
      MAX_CONTATOS_POR_CAMPANHA
    ) {
      return res
        .status(400)
        .json({
          ok: false,
          erro:
            `O limite atual é de ${MAX_CONTATOS_POR_CAMPANHA} contatos por campanha.`
        });
    }


    if (
      !process.env.WHATSAPP_TOKEN ||
      !process.env.PHONE_NUMBER_ID
    ) {
      return res
        .status(500)
        .json({
          ok: false,
          erro:
            "Configuração do WhatsApp incompleta."
        });
    }


    // -------------------------------------------------------
    // EVITA NOME DE CAMPANHA REPETIDO
    // -------------------------------------------------------

    const chaveStatus =
      `campanha:status:${nomeCampanha}`;

    const campanhaExistente =
      await redisCommand([
        "GET",
        chaveStatus
      ]);

    if (campanhaExistente) {
      return res
        .status(409)
        .json({
          ok: false,
          erro:
            "Já existe uma campanha com esse nome. Use outro nome."
        });
    }


    // -------------------------------------------------------
    // REMOVE DUPLICADOS
    // -------------------------------------------------------

    const telefonesVistos =
      new Set();

    const contatos = [];

    for (
      const contato of
      contatosRecebidos
    ) {
      const telefone =
        normalizarTelefone(
          contato?.telefone
        );

      if (!telefone) {
        continue;
      }

      if (
        telefonesVistos.has(
          telefone
        )
      ) {
        continue;
      }

      telefonesVistos.add(
        telefone
      );

      contatos.push({
        nome:
          String(
            contato?.nome || ""
          ).trim(),

        telefone
      });
    }


    if (
      contatos.length === 0
    ) {
      return res
        .status(400)
        .json({
          ok: false,
          erro:
            "Nenhum telefone válido para envio."
        });
    }


    // -------------------------------------------------------
    // STATUS INICIAL
    // -------------------------------------------------------

    const criadoEm =
      new Date().toISOString();

    const statusInicial = {
      campanha:
        nomeCampanha,

      template:
        nomeTemplate,

      total:
        contatos.length,

      enviados: 0,

      entregues: 0,

      respondidos: 0,

      descadastrados: 0,

      falhas: 0,

      ignorados: 0,

      criadoEm,

      atualizadoEm:
        criadoEm
    };


    await redisCommand([
      "SET",
      chaveStatus,
      JSON.stringify(
        statusInicial
      )
    ]);


    // -------------------------------------------------------
    // ENVIO
    // -------------------------------------------------------

    let enviados = 0;
    let falhas = 0;
    let ignorados = 0;

    const erros = [];
    const ignoradosDetalhes = [];


    const versaoGraph =
      process.env
        .GRAPH_API_VERSION ||
      "v23.0";


    const urlWhatsApp =
      `https://graph.facebook.com/${versaoGraph}/${process.env.PHONE_NUMBER_ID}/messages`;


    for (
      let indice = 0;
      indice < contatos.length;
      indice++
    ) {

      const contato =
        contatos[indice];

      const telefone =
        contato.telefone;


      // -----------------------------------------------------
      // VERIFICA DESCADASTRO ANTERIOR
      // -----------------------------------------------------

      try {
        const registroTelefone =
          await redisCommand([
            "GET",
            `campanha:telefone:${telefone}`
          ]);

        if (registroTelefone) {
          try {
            const dadosTelefone =
              JSON.parse(
                registroTelefone
              );

            if (
              dadosTelefone
                ?.descadastrado ===
              true
            ) {
              ignorados++;

              ignoradosDetalhes
                .push({
                  telefone,
                  motivo:
                    "Contato descadastrado."
                });

              continue;
            }

          } catch {
            // registro antigo inválido:
            // segue envio normalmente
          }
        }

      } catch (erro) {
        console.error(
          "Erro ao consultar descadastro:",
          erro
        );
      }


      // -----------------------------------------------------
      // ENVIA PARA META
      // -----------------------------------------------------

      try {
        const respostaMeta =
          await fetch(
            urlWhatsApp,
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
                      nomeTemplate,

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


        if (!respostaMeta.ok) {
          falhas++;

          erros.push({
            telefone,

            erro:
              dadosMeta
                ?.error
                ?.message ||
              "Falha no envio."
          });

          continue;
        }


        const messageId =
          dadosMeta
            ?.messages?.[0]
            ?.id;


        if (!messageId) {
          falhas++;

          erros.push({
            telefone,

            erro:
              "A Meta não retornou o ID da mensagem."
          });

          continue;
        }


        enviados++;


        // ---------------------------------------------------
        // MESSAGE ID -> CAMPANHA
        // ---------------------------------------------------

        await redisCommand([
          "SET",
          `campanha:mensagem:${messageId}`,
          JSON.stringify({
            campanha:
              nomeCampanha,

            template:
              nomeTemplate,

            telefone,

            status:
              "sent",

            criadoEm:
              new Date()
                .toISOString()
          })
        ]);


        // ---------------------------------------------------
        // TELEFONE -> CAMPANHA
        // ---------------------------------------------------

        await redisCommand([
          "SET",
          `campanha:telefone:${telefone}`,
          JSON.stringify({
            campanha:
              nomeCampanha,

            template:
              nomeTemplate,

            telefone,

            nome:
              contato.nome,

            messageId,

            respondido:
              false,

            descadastrado:
              false,

            criadoEm:
              new Date()
                .toISOString()
          })
        ]);


        // ---------------------------------------------------
        // ATUALIZA ENVIADOS SEM APAGAR ENTREGA/RESPOSTA
        // ---------------------------------------------------

        const registroAtual =
          await redisCommand([
            "GET",
            chaveStatus
          ]);

        if (registroAtual) {
          try {
            const statusAtual =
              JSON.parse(
                registroAtual
              );

            statusAtual.enviados =
              enviados;

            statusAtual.falhas =
              falhas;

            statusAtual.ignorados =
              ignorados;

            statusAtual.atualizadoEm =
              new Date()
                .toISOString();

            await redisCommand([
              "SET",
              chaveStatus,
              JSON.stringify(
                statusAtual
              )
            ]);

          } catch {
            // segue campanha
          }
        }


      } catch (erroEnvio) {

        falhas++;

        erros.push({
          telefone,

          erro:
            erroEnvio?.message ||
            "Erro inesperado no envio."
        });
      }


      // -----------------------------------------------------
      // PEQUENO INTERVALO ENTRE ENVIOS
      // -----------------------------------------------------

      if (
        indice <
        contatos.length - 1
      ) {
        await aguardar(
          INTERVALO_ENTRE_ENVIOS_MS
        );
      }
    }


    // -------------------------------------------------------
    // STATUS FINAL
    // -------------------------------------------------------

    const registroFinal =
      await redisCommand([
        "GET",
        chaveStatus
      ]);

    let statusFinal =
      statusInicial;

    if (registroFinal) {
      try {
        statusFinal =
          JSON.parse(
            registroFinal
          );
      } catch {
        statusFinal =
          statusInicial;
      }
    }


    statusFinal.total =
      contatos.length;

    statusFinal.enviados =
      enviados;

    statusFinal.falhas =
      falhas;

    statusFinal.ignorados =
      ignorados;

    statusFinal.finalizadoEm =
      new Date()
        .toISOString();

    statusFinal.atualizadoEm =
      statusFinal.finalizadoEm;


    await redisCommand([
      "SET",
      chaveStatus,
      JSON.stringify(
        statusFinal
      )
    ]);


    // -------------------------------------------------------
    // SE NADA FOI ENVIADO
    // -------------------------------------------------------

    if (
      enviados === 0 &&
      falhas > 0
    ) {
      return res
        .status(400)
        .json({
          ok: false,

          erro:
            "Nenhuma mensagem foi enviada.",

          campanha:
            nomeCampanha,

          total:
            contatos.length,

          enviados,

          falhas,

          ignorados,

          erros,

          ignoradosDetalhes
        });
    }


    // -------------------------------------------------------
    // SUCESSO
    // -------------------------------------------------------

    return res
      .status(200)
      .json({
        ok: true,

        campanha:
          nomeCampanha,

        template:
          nomeTemplate,

        quantidade:
          contatos.length,

        enviados,

        falhas,

        ignorados,

        erros,

        ignoradosDetalhes
      });


  } catch (erro) {

    console.error(
      "Erro send-campaign:",
      erro
    );

    return res
      .status(500)
      .json({
        ok: false,

        erro:
          erro?.message ||
          "Erro interno ao enviar campanha."
      });
  }
}
