import crypto from "crypto";


// ===========================================================
// CONFIGURAÇÕES
// ===========================================================

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
// PAUSA ENTRE ENVIOS
// ===========================================================

function aguardar(ms) {
  return new Promise(
    resolve =>
      setTimeout(resolve, ms)
  );
}


// ===========================================================
// NORMALIZAR TELEFONE
// ===========================================================

function normalizarTelefone(valor) {
  return String(
    valor ||
    ""
  )
    .replace(/\D/g, "")
    .trim();
}


// ===========================================================
// VERIFICAR LOGIN DO PAINEL
// ===========================================================

function autenticarPainel(req) {
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
    Buffer.from(
      tokenRecebido
    );

  const esperado =
    Buffer.from(
      tokenEsperado
    );

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
// HANDLER PRINCIPAL
// ===========================================================

export default async function handler(
  req,
  res
) {

  // =========================================================
  // AUTENTICAÇÃO
  // =========================================================

  if (!autenticarPainel(req)) {
    return res
      .status(401)
      .json({
        ok: false,
        erro:
          "Não autorizado. Faça login no painel."
      });
  }


  // =========================================================
  // SOMENTE POST
  // =========================================================

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

    // =======================================================
    // DADOS RECEBIDOS DO PAINEL
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
            "Digite o nome da campanha."
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
      !Array.isArray(contatos) ||
      contatos.length === 0
    ) {
      return res
        .status(400)
        .json({
          ok: false,
          erro:
            "Nenhum contato válido recebido."
        });
    }


    // =======================================================
    // TEMPLATE PERMITIDO
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
            "Somente o template consulta_fgts_adcred está autorizado."
        });
    }


    // =======================================================
    // VARIÁVEIS META
    // =======================================================

    if (
      !process.env.WHATSAPP_TOKEN
    ) {
      return res
        .status(500)
        .json({
          ok: false,
          erro:
            "WHATSAPP_TOKEN não configurado."
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
            "PHONE_NUMBER_ID não configurado."
        });
    }


    // =======================================================
    // PREPARA CONTATOS
    // =======================================================

    const contatosPreparados =
      [];

    const telefonesVistos =
      new Set();


    for (
      const contato of contatos
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


      contatosPreparados.push({
        nome:
          String(
            contato?.nome ||
            ""
          ).trim(),

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
            "Nenhum telefone válido encontrado."
        });
    }


    // =======================================================
    // LIMITE DE SEGURANÇA
    // =======================================================

    if (
      contatosPreparados.length >
      MAX_CONTATOS_POR_CAMPANHA
    ) {
      return res
        .status(400)
        .json({
          ok: false,

          erro:
            `Esta versão aceita até ${MAX_CONTATOS_POR_CAMPANHA} contatos por campanha.`
        });
    }


    // =======================================================
    // CAMPANHA NÃO PODE USAR NOME JÁ EXISTENTE
    // =======================================================

    const chaveStatusCampanha =
      `campanha:status:${nomeCampanha}`;


    const campanhaExistente =
      await redisCommand([
        "GET",
        chaveStatusCampanha
      ]);


    if (campanhaExistente) {
      return res
        .status(409)
        .json({
          ok: false,

          erro:
            "Já existe uma campanha com esse nome. Digite um nome novo para evitar misturar os contadores."
        });
    }


    // =======================================================
    // CRIA STATUS INICIAL
    // =======================================================

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
    // GRAPH API
    // =======================================================

    const graphVersion =
      process.env.GRAPH_API_VERSION ||
      "v23.0";


    const url =
      `https://graph.facebook.com/${graphVersion}/${process.env.PHONE_NUMBER_ID}/messages`;


    // =======================================================
    // CONTADORES
    // =======================================================

    let enviados =
      0;

    let falhas =
      0;

    let ignorados =
      0;


    const erros =
      [];

    const ignoradosDetalhes =
      [];


    // =======================================================
    // ENVIA CONTATO POR CONTATO
    // =======================================================

    for (
      const contato of
      contatosPreparados
    ) {

      const telefone =
        contato.telefone;


      try {

        // ===================================================
        // VERIFICA SE O CONTATO JÁ PEDIU DESCADASTRO
        // ===================================================

        const vinculoAnterior =
          await redisCommand([
            "GET",
            `campanha:telefone:${telefone}`
          ]);


        if (vinculoAnterior) {
          try {
            const dadosAnteriores =
              JSON.parse(
                vinculoAnterior
              );

            if (
              dadosAnteriores
                ?.descadastrado ===
              true
            ) {
              ignorados++;

              ignoradosDetalhes.push({
                telefone,
                motivo:
                  "Contato já solicitou descadastro."
              });

              console.log(
                "Campanha - contato ignorado por descadastro:",
                telefone
              );

              continue;
            }

          } catch {
            // Se o registro anterior estiver inválido,
            // continua normalmente.
          }
        }


        // ===================================================
        // ENVIA TEMPLATE
        // ===================================================

        console.log(
          "Campanha - enviando para:",
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


        // ===================================================
        // META RECUSOU
        // ===================================================

        if (!respostaMeta.ok) {
          falhas++;

          const mensagemErro =
            dadosMeta
              ?.error
              ?.message ||
            "A Meta recusou o envio.";


          console.error(
            "Campanha - erro Meta:",
            telefone,
            mensagemErro
          );


          erros.push({
            telefone,

            codigo:
              dadosMeta
                ?.error
                ?.code ||
              null,

            erro:
              mensagemErro
          });


          await aguardar(
            INTERVALO_ENTRE_ENVIOS_MS
          );

          continue;
        }


        // ===================================================
        // ENVIO ACEITO
        // ===================================================

        const messageId =
          dadosMeta
            ?.messages
            ?.[0]
            ?.id ||
          null;


        enviados++;


        console.log(
          "Campanha - envio aceito:",
          telefone,
          messageId
        );


        // ===================================================
        // MESSAGE ID -> CAMPANHA
        //
        // Necessário para contabilizar ENTREGA.
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
                "sent",

              criadoEm:
                new Date().toISOString()
            })
          ]);
        }


        // ===================================================
        // TELEFONE -> CAMPANHA
        //
        // Necessário para RESPONDIDOS e DESCADASTRADOS.
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

            nome:
              contato.nome,

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
        // PEQUENO INTERVALO
        // ===================================================

        await aguardar(
          INTERVALO_ENTRE_ENVIOS_MS
        );


      } catch (erroContato) {

        falhas++;


        console.error(
          "Campanha - erro ao processar contato:",
          telefone,
          erroContato
        );


        erros.push({
          telefone,

          codigo:
            null,

          erro:
            erroContato
              ?.message ||
            "Erro desconhecido."
        });


        await aguardar(
          INTERVALO_ENTRE_ENVIOS_MS
        );
      }
    }


    // =======================================================
    // ATUALIZA ENVIADOS SEM APAGAR ENTREGA / RESPOSTA
    // =======================================================

    const statusAtualRegistro =
      await redisCommand([
        "GET",
        chaveStatusCampanha
      ]);


    let statusAtual = {
      enviados: 0,
      entregues: 0,
      respondidos: 0,
      descadastrados: 0
    };


    if (statusAtualRegistro) {
      try {
        statusAtual =
          JSON.parse(
            statusAtualRegistro
          );
      } catch {
        // mantém os valores padrão
      }
    }


    statusAtual.enviados =
      enviados;


    statusAtual.atualizadoEm =
      new Date().toISOString();


    await redisCommand([
      "SET",
      chaveStatusCampanha,
      JSON.stringify(
        statusAtual
      )
    ]);


    // =======================================================
    // NENHUM ENVIO ACEITO
    // =======================================================

    if (enviados === 0) {
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

          enviados,

          falhas,

          ignorados,

          erros,

          ignoradosDetalhes,

          erro:
            "Nenhuma mensagem da campanha foi aceita pela Meta."
        });
    }


    // =======================================================
    // RETORNO PARA O PAINEL
    // =======================================================

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

        ignorados,

        erros,

        ignoradosDetalhes,

        mensagem:
          falhas > 0 ||
          ignorados > 0
            ? `Campanha concluída: ${enviados} enviada(s), ${falhas} falha(s) e ${ignorados} ignorado(s).`
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
          "Erro desconhecido."
      });
  }
}
