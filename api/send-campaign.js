import crypto from "crypto";

// ===========================================================
// CONFIGURAÇÃO DE LOTES
// ===========================================================

// Cada chamada da API processa no máximo 25 contatos.
// Campanhas maiores serão divididas automaticamente pelo painel.
const MAX_CONTATOS_POR_LOTE = 25;

// Limite total da campanha.
const MAX_CONTATOS_POR_CAMPANHA = 500;

// Intervalo pequeno entre mensagens dentro do lote.
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


function numeroInteiroSeguro(
  valor,
  padrao
) {
  const numero =
    Number(valor);

  if (
    !Number.isInteger(numero) ||
    numero < 1
  ) {
    return padrao;
  }

  return numero;
}


function parseJsonSeguro(
  valor,
  padrao = null
) {
  if (!valor) {
    return padrao;
  }

  try {
    return JSON.parse(valor);
  } catch {
    return padrao;
  }
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

  const bufferRecebido =
    Buffer.from(
      tokenRecebido
    );

  const bufferEsperado =
    Buffer.from(
      tokenEsperado
    );

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
// STATUS DA CAMPANHA
// ===========================================================

async function lerStatusCampanha(
  chaveStatus
) {
  const registro =
    await redisCommand([
      "GET",
      chaveStatus
    ]);

  return parseJsonSeguro(
    registro,
    null
  );
}


async function salvarStatusCampanha(
  chaveStatus,
  status
) {
  await redisCommand([
    "SET",
    chaveStatus,
    JSON.stringify(status)
  ]);
}


async function atualizarContadoresCampanha(
  chaveStatus,
  {
    enviadosSomar = 0,
    falhasSomar = 0,
    ignoradosSomar = 0,
    loteNumero = null,
    totalLotes = null,
    finalizado = false
  } = {}
) {
  const statusAtual =
    await lerStatusCampanha(
      chaveStatus
    );

  if (!statusAtual) {
    throw new Error(
      "Status da campanha não encontrado."
    );
  }

  statusAtual.enviados =
    Number(
      statusAtual.enviados || 0
    ) +
    enviadosSomar;

  statusAtual.falhas =
    Number(
      statusAtual.falhas || 0
    ) +
    falhasSomar;

  statusAtual.ignorados =
    Number(
      statusAtual.ignorados || 0
    ) +
    ignoradosSomar;

  if (
    loteNumero !== null
  ) {
    statusAtual.loteAtual =
      loteNumero;
  }

  if (
    totalLotes !== null
  ) {
    statusAtual.totalLotes =
      totalLotes;
  }

  statusAtual.atualizadoEm =
    new Date()
      .toISOString();

  if (finalizado) {
    statusAtual.finalizadoEm =
      statusAtual.atualizadoEm;

    statusAtual.processando =
      false;
  }

  await salvarStatusCampanha(
    chaveStatus,
    statusAtual
  );

  return statusAtual;
}


// ===========================================================
// VALIDAÇÃO DA MINHA BASE
// ===========================================================

async function validarContatoMinhaBase(
  contato,
  telefone
) {
  if (
    contato.origem !==
    "minha_base"
  ) {
    return {
      ok: true
    };
  }

  let registroLead;

  try {
    registroLead =
      await redisCommand([
        "GET",
        `lead:${telefone}`
      ]);

  } catch {
    return {
      ok: false,

      motivo:
        "Não foi possível validar o contato da Minha Base."
    };
  }

  if (!registroLead) {
    return {
      ok: false,

      motivo:
        "Contato da Minha Base não encontrado no cadastro de leads."
    };
  }

  const dadosLead =
    parseJsonSeguro(
      registroLead,
      null
    );

  if (!dadosLead) {
    return {
      ok: false,

      motivo:
        "Cadastro do lead inválido."
    };
  }

  const statusLead =
    String(
      dadosLead.status || ""
    )
      .trim()
      .toLowerCase();

  if (
    statusLead !== "ativo"
  ) {
    return {
      ok: false,

      motivo:
        "Contato da Minha Base não está ativo."
    };
  }

  if (
    dadosLead.consentimento !==
    true
  ) {
    return {
      ok: false,

      motivo:
        "Contato da Minha Base sem consentimento válido."
    };
  }

  return {
    ok: true
  };
}


// ===========================================================
// VERIFICA DESCADASTRO
// ===========================================================

async function contatoDescadastrado(
  telefone
) {
  try {
    const registroTelefone =
      await redisCommand([
        "GET",
        `campanha:telefone:${telefone}`
      ]);

    if (!registroTelefone) {
      return false;
    }

    const dadosTelefone =
      parseJsonSeguro(
        registroTelefone,
        null
      );

    return (
      dadosTelefone
        ?.descadastrado ===
      true
    );

  } catch (erro) {
    console.error(
      "Erro ao consultar descadastro:",
      erro
    );

    return false;
  }
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

  if (
    req.method !==
    "POST"
  ) {
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
        req.body?.campanha ||
        ""
      ).trim();

    const nomeTemplate =
      String(
        req.body?.template ||
        ""
      ).trim();

    const contatosRecebidos =
      Array.isArray(
        req.body?.contatos
      )
        ? req.body.contatos
        : [];

    const loteNumero =
      numeroInteiroSeguro(
        req.body?.loteNumero,
        1
      );

    const totalLotes =
      numeroInteiroSeguro(
        req.body?.totalLotes,
        1
      );

    const totalCampanha =
      numeroInteiroSeguro(
        req.body?.totalCampanha,
        contatosRecebidos.length
      );

    const continuacao =
      req.body
        ?.continuacao ===
      true;

    const ultimoLote =
      req.body
        ?.ultimoLote ===
      true ||
      loteNumero ===
      totalLotes;


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
      contatosRecebidos.length ===
      0
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
      MAX_CONTATOS_POR_LOTE
    ) {
      return res
        .status(400)
        .json({
          ok: false,

          erro:
            `Cada lote pode conter no máximo ${MAX_CONTATOS_POR_LOTE} contatos.`
        });
    }


    if (
      totalCampanha >
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
      loteNumero >
      totalLotes
    ) {
      return res
        .status(400)
        .json({
          ok: false,

          erro:
            "Número do lote inválido."
        });
    }


    if (
      !process.env
        .WHATSAPP_TOKEN ||
      !process.env
        .PHONE_NUMBER_ID
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
    // STATUS / CONTINUIDADE
    // -------------------------------------------------------

    const chaveStatus =
      `campanha:status:${nomeCampanha}`;

    const campanhaExistente =
      await lerStatusCampanha(
        chaveStatus
      );


    // Primeiro lote:
    // não pode existir campanha com o mesmo nome.

    if (
      !continuacao &&
      campanhaExistente
    ) {
      return res
        .status(409)
        .json({
          ok: false,

          erro:
            "Já existe uma campanha com esse nome. Use outro nome."
        });
    }


    // Lotes seguintes:
    // campanha precisa existir.

    if (
      continuacao &&
      !campanhaExistente
    ) {
      return res
        .status(409)
        .json({
          ok: false,

          erro:
            "A campanha não foi iniciada. Envie primeiro o lote 1."
        });
    }


    // Template precisa ser o mesmo em todos os lotes.

    if (
      continuacao &&
      campanhaExistente
        ?.template &&
      campanhaExistente
        .template !==
      nomeTemplate
    ) {
      return res
        .status(409)
        .json({
          ok: false,

          erro:
            "O template não corresponde ao template usado no início da campanha."
        });
    }


    // Total precisa ser igual ao registrado no primeiro lote.

    if (
      continuacao &&
      Number(
        campanhaExistente
          ?.total || 0
      ) !==
      totalCampanha
    ) {
      return res
        .status(409)
        .json({
          ok: false,

          erro:
            "O total de contatos não corresponde ao total registrado no início da campanha."
        });
    }


    // -------------------------------------------------------
    // REMOVE DUPLICADOS DENTRO DO LOTE
    // -------------------------------------------------------

    const telefonesVistos =
      new Set();

    const contatos =
      [];


    for (
      const contato of
      contatosRecebidos
    ) {

      const telefone =
        normalizarTelefone(
          contato
            ?.telefone
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
            contato
              ?.nome || ""
          ).trim(),

        telefone,

        origem:
          String(
            contato
              ?.origem || ""
          ).trim(),

        consentimento:
          contato
            ?.consentimento ===
          true
      });
    }


    if (
      contatos.length ===
      0
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
    // CRIA STATUS NO PRIMEIRO LOTE
    // -------------------------------------------------------

    if (!continuacao) {

      const criadoEm =
        new Date()
          .toISOString();

      const statusInicial = {
        campanha:
          nomeCampanha,

        template:
          nomeTemplate,

        total:
          totalCampanha,

        enviados:
          0,

        entregues:
          0,

        respondidos:
          0,

        descadastrados:
          0,

        falhas:
          0,

        ignorados:
          0,

        loteAtual:
          0,

        totalLotes,

        processando:
          true,

        criadoEm,

        atualizadoEm:
          criadoEm
      };


      await salvarStatusCampanha(
        chaveStatus,
        statusInicial
      );
    }


    // -------------------------------------------------------
    // ENVIO DO LOTE
    // -------------------------------------------------------

    let enviadosLote =
      0;

    let falhasLote =
      0;

    let ignoradosLote =
      0;


    const erros =
      [];

    const ignoradosDetalhes =
      [];


    const versaoGraph =
      process.env
        .GRAPH_API_VERSION ||
      "v23.0";


    const urlWhatsApp =
      `https://graph.facebook.com/${versaoGraph}/${process.env.PHONE_NUMBER_ID}/messages`;


    for (
      let indice = 0;
      indice <
      contatos.length;
      indice++
    ) {

      const contato =
        contatos[indice];

      const telefone =
        contato.telefone;


      // -----------------------------------------------------
      // VALIDA MINHA BASE
      // -----------------------------------------------------

      const validacaoMinhaBase =
        await validarContatoMinhaBase(
          contato,
          telefone
        );


      if (
        !validacaoMinhaBase.ok
      ) {

        ignoradosLote++;


        ignoradosDetalhes
          .push({
            telefone,

            motivo:
              validacaoMinhaBase
                .motivo
          });


        continue;
      }


      // -----------------------------------------------------
      // VERIFICA DESCADASTRO
      // -----------------------------------------------------

      const descadastrado =
        await contatoDescadastrado(
          telefone
        );


      if (descadastrado) {

        ignoradosLote++;


        ignoradosDetalhes
          .push({
            telefone,

            motivo:
              "Contato descadastrado."
          });


        continue;
      }


      // -----------------------------------------------------
      // ENVIA PARA META
      // -----------------------------------------------------

      try {

        const respostaMeta =
          await fetch(
            urlWhatsApp,
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
          await respostaMeta
            .json();


        if (
          !respostaMeta.ok
        ) {

          falhasLote++;


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
            ?.messages
            ?.[0]
            ?.id;


        if (!messageId) {

          falhasLote++;


          erros.push({
            telefone,

            erro:
              "A Meta não retornou o ID da mensagem."
          });


          continue;
        }


        enviadosLote++;


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

            lote:
              loteNumero,

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

            lote:
              loteNumero,

            criadoEm:
              new Date()
                .toISOString()
          })
        ]);


      } catch (
        erroEnvio
      ) {

        falhasLote++;


        erros.push({
          telefone,

          erro:
            erroEnvio
              ?.message ||
            "Erro inesperado no envio."
        });
      }


      // -----------------------------------------------------
      // INTERVALO ENTRE ENVIOS
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
    // ATUALIZA STATUS AGREGADO
    // -------------------------------------------------------

    const statusAtualizado =
      await atualizarContadoresCampanha(
        chaveStatus,
        {
          enviadosSomar:
            enviadosLote,

          falhasSomar:
            falhasLote,

          ignoradosSomar:
            ignoradosLote,

          loteNumero,

          totalLotes,

          finalizado:
            ultimoLote
        }
      );


    // -------------------------------------------------------
    // RESPOSTA
    // -------------------------------------------------------

    return res
      .status(200)
      .json({
        ok:
          true,

        campanha:
          nomeCampanha,

        template:
          nomeTemplate,

        loteNumero,

        totalLotes,

        ultimoLote,

        quantidadeLote:
          contatos.length,

        totalCampanha,

        enviadosLote,

        falhasLote,

        ignoradosLote,

        enviados:
          Number(
            statusAtualizado
              .enviados || 0
          ),

        falhas:
          Number(
            statusAtualizado
              .falhas || 0
          ),

        ignorados:
          Number(
            statusAtualizado
              .ignorados || 0
          ),

        erros,

        ignoradosDetalhes,

        finalizado:
          ultimoLote
      });


  } catch (erro) {

    console.error(
      "Erro send-campaign:",
      erro
    );


    return res
      .status(500)
      .json({
        ok:
          false,

        erro:
          erro
            ?.message ||
          "Erro interno ao enviar campanha."
      });
  }
}
