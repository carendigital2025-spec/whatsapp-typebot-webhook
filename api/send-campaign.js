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
    await fetch(
      url,
      {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${token}`,

          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify(command)
      }
    );


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
// PEQUENA PAUSA ENTRE OS ENVIOS
// ===========================================================

function aguardar(ms) {

  return new Promise(
    resolve =>
      setTimeout(resolve, ms)
  );

}


// ===========================================================
// HANDLER
// ===========================================================

export default async function handler(req, res) {


  // =========================================================
  // 1. PROTEÇÃO DA ROTA PELO LOGIN DO PAINEL
  // =========================================================

  const cookies =
    req.headers.cookie ||
    "";


  const cookieSessao =
    cookies
      .split(";")
      .map(
        cookie =>
          cookie.trim()
      )
      .find(
        cookie =>
          cookie.startsWith(
            "panel_session="
          )
      );


  if (
    !cookieSessao ||
    !process.env.PANEL_PASSWORD
  ) {

    return res
      .status(401)
      .json({
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
    recebido.length ===
      esperado.length &&
    crypto.timingSafeEqual(
      recebido,
      esperado
    );


  if (!autenticado) {

    return res
      .status(401)
      .json({
        ok: false,
        erro:
          "Não autorizado. Faça login no painel."
      });

  }


  // =========================================================
  // 2. ACEITA SOMENTE POST
  // =========================================================

  if (
    req.method !==
    "POST"
  ) {

    return res
      .status(405)
      .json({
        ok: false,
        erro:
          "Método não permitido"
      });

  }


  try {


    // =======================================================
    // 3. RECEBE OS DADOS DO PAINEL
    // =======================================================

    const {
      campanha,
      template,
      contatos
    } =
      req.body ||
      {};


    const nomeCampanha =
      String(
        campanha ||
        ""
      ).trim();


    const nomeTemplate =
      String(
        template ||
        ""
      ).trim();


    if (!nomeCampanha) {

      return res
        .status(400)
        .json({
          ok: false,
          erro:
            "Nome da campanha não informado"
        });

    }


    if (!nomeTemplate) {

      return res
        .status(400)
        .json({
          ok: false,
          erro:
            "Template não informado"
        });

    }


    if (
      !Array.isArray(contatos) ||
      contatos.length === 0
    ) {

      return res
        .status(400)
        .json({
          ok: false,
          erro:
            "Nenhum contato válido recebido"
        });

    }


    // =======================================================
    // 4. TEMPLATE AUTORIZADO
    // =======================================================

    if (
      nomeTemplate !==
      "consulta_fgts_adcred"
    ) {

      return res
        .status(400)
        .json({
          ok: false,
          erro:
            "Somente o template consulta_fgts_adcred está autorizado neste envio."
        });

    }


    // =======================================================
    // 5. CONFERE VARIÁVEIS DA META
    // =======================================================

    if (
      !process.env.WHATSAPP_TOKEN
    ) {

      return res
        .status(500)
        .json({
          ok: false,
          erro:
            "WHATSAPP_TOKEN não configurado na Vercel."
        });

    }


    if (
      !process.env.PHONE_NUMBER_ID
    ) {

      return res
        .status(500)
        .json({
          ok: false,
          erro:
            "PHONE_NUMBER_ID não configurado na Vercel."
        });

    }


    const graphVersion =
      process.env.GRAPH_API_VERSION ||
      "v23.0";


    const url =
      `https://graph.facebook.com/${graphVersion}/${process.env.PHONE_NUMBER_ID}/messages`;


    // =======================================================
    // 6. NORMALIZA E REMOVE TELEFONES REPETIDOS
    // =======================================================

    const contatosPreparados =
      [];


    const telefonesVistos =
      new Set();


    for (
      const contato of contatos
    ) {

      const telefone =
        String(
          contato?.telefone ||
          ""
        )
          .replace(
            /\D/g,
            ""
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


      contatosPreparados.push({
        nome:
          String(
            contato?.nome ||
            ""
          ),

        telefone
      });

    }


    if (
      contatosPreparados.length ===
      0
    ) {

      return res
        .status(400)
        .json({
          ok: false,
          erro:
            "Nenhum telefone válido foi recebido."
        });

    }


    // =======================================================
    // 7. CRIA O STATUS INICIAL DA CAMPANHA
    // =======================================================

    const chaveStatusCampanha =
      `campanha:status:${nomeCampanha}`;


    await redisCommand([
      "SET",
      chaveStatusCampanha,
      JSON.stringify({
        enviados: 0,
        entregues: 0,
        respondidos: 0,
        descadastrados: 0,
        atualizadoEm:
          new Date().toISOString()
      })
    ]);


    // =======================================================
    // 8. ENVIA OS CONTATOS
    // =======================================================

    let enviados =
      0;


    let falhas =
      0;


    const erros =
      [];


    for (
      const contato of contatosPreparados
    ) {

      const telefone =
        contato.telefone;


      try {

        console.log(
          "Enviando template:",
          nomeTemplate,
          "para:",
          telefone
        );


        const respostaMeta =
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


        if (
          !respostaMeta.ok
        ) {

          falhas++;


          console.error(
            "Erro ao enviar template pela Meta:",
            telefone,
            JSON.stringify(
              dadosMeta
            )
          );


          erros.push({
            telefone,

            codigoMeta:
              dadosMeta
                ?.error
                ?.code ||
              null,

            erro:
              dadosMeta
                ?.error
                ?.message ||
              "A Meta recusou o envio."
          });


          continue;

        }


        const messageId =
          dadosMeta
            ?.messages
            ?.[0]
            ?.id ||
          null;


        enviados++;


        // ===================================================
        // 9. VÍNCULO MESSAGE ID -> CAMPANHA
        // ===================================================

        if (messageId) {

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
                "sent"
            })
          ]);

        }


        // ===================================================
        // 10. VÍNCULO TELEFONE -> CAMPANHA
        //
        // Este vínculo permitirá ao webhook descobrir
        // de qual campanha veio uma resposta recebida.
        // ===================================================

        await redisCommand([
          "SET",
          `campanha:telefone:${telefone}`,
          JSON.stringify({
            campanha:
              nomeCampanha,

            template:
              nomeTemplate,

            telefone,

            messageId,

            respondido:
              false,

            descadastrado:
              false,

            criadoEm:
              new Date().toISOString()
          })
        ]);


        // ===================================================
        // 11. ATUALIZA QUANTIDADE DE ENVIADOS
        // ===================================================

        const registroStatus =
          await redisCommand([
            "GET",
            chaveStatusCampanha
          ]);


        let statusCampanha = {
          enviados: 0,
          entregues: 0,
          respondidos: 0,
          descadastrados: 0
        };


        if (registroStatus) {

          try {

            statusCampanha =
              JSON.parse(
                registroStatus
              );

          } catch {

            statusCampanha = {
              enviados: 0,
              entregues: 0,
              respondidos: 0,
              descadastrados: 0
            };

          }

        }


        statusCampanha.enviados =
          enviados;


        statusCampanha.atualizadoEm =
          new Date().toISOString();


        await redisCommand([
          "SET",
          chaveStatusCampanha,
          JSON.stringify(
            statusCampanha
          )
        ]);


        /*
          Pequeno intervalo entre os contatos.
          Não é uma forma de contornar limites da Meta;
          apenas evita que esta função dispare todas as
          requisições simultaneamente.
        */

        await aguardar(
          250
        );


      } catch (erroContato) {

        falhas++;


        console.error(
          "Erro ao processar contato:",
          telefone,
          erroContato
        );


        erros.push({
          telefone,
          codigoMeta:
            null,
          erro:
            erroContato
              ?.message ||
            "Erro desconhecido"
        });

      }

    }


    // =======================================================
    // 12. GARANTE O STATUS FINAL DA CAMPANHA
    // =======================================================

    const registroFinal =
      await redisCommand([
        "GET",
        chaveStatusCampanha
      ]);


    let statusFinal = {
      enviados,
      entregues: 0,
      respondidos: 0,
      descadastrados: 0
    };


    if (registroFinal) {

      try {

        statusFinal =
          JSON.parse(
            registroFinal
          );

      } catch {
        // mantém os valores padrão
      }

    }


    statusFinal.enviados =
      enviados;


    statusFinal.atualizadoEm =
      new Date().toISOString();


    await redisCommand([
      "SET",
      chaveStatusCampanha,
      JSON.stringify(
        statusFinal
      )
    ]);


    // =======================================================
    // 13. RETORNO PARA O PAINEL
    // =======================================================

    if (
      enviados === 0
    ) {

      return res
        .status(400)
        .json({
          ok: false,

          campanha:
            nomeCampanha,

          template:
            nomeTemplate,

          quantidade:
            contatosPreparados.length,

          enviados:
            0,

          falhas,

          erros,

          erro:
            "Nenhuma mensagem da campanha foi aceita pela Meta."
        });

    }


    return res
      .status(200)
      .json({
        ok: true,

        modo:
          "campanha",

        campanha:
          nomeCampanha,

        template:
          nomeTemplate,

        quantidade:
          contatosPreparados.length,

        enviados,

        falhas,

        erros,

        mensagem:
          falhas > 0
            ? `Campanha processada. ${enviados} enviada(s) e ${falhas} com falha.`
            : `Campanha enviada com sucesso para ${enviados} contato(s).`
      });


  } catch (error) {

    console.error(
      "Erro em send-campaign:",
      error
    );


    return res
      .status(500)
      .json({
        ok: false,

        erro:
          "Erro interno ao enviar a campanha.",

        detalhes:
          error?.message ||
          "Erro desconhecido"
      });

  }

}
