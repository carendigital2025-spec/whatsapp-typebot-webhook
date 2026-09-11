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
// BUSCA AS CHAVES DE CAMPANHA
// ===========================================================

async function buscarChavesCampanhas() {
  let cursor = "0";

  const chaves =
    new Set();

  let ciclos = 0;


  do {

    const resultado =
      await redisCommand([
        "SCAN",
        cursor,
        "MATCH",
        "campanha:status:*",
        "COUNT",
        "100"
      ]);


    if (
      !Array.isArray(resultado) ||
      resultado.length < 2
    ) {
      break;
    }


    cursor =
      String(
        resultado[0] || "0"
      );


    const encontradas =
      Array.isArray(resultado[1])
        ? resultado[1]
        : [];


    encontradas.forEach(
      chave =>
        chaves.add(chave)
    );


    ciclos++;


  } while (
    cursor !== "0" &&
    ciclos < 20 &&
    chaves.size < 200
  );


  return Array.from(chaves);
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

    const chaves =
      await buscarChavesCampanhas();


    const campanhas = [];


    for (
      const chave of chaves
    ) {

      const registro =
        await redisCommand([
          "GET",
          chave
        ]);


      if (!registro) {
        continue;
      }


      try {

        const status =
          JSON.parse(registro);


        const nome =
          chave.replace(
            "campanha:status:",
            ""
          );


        campanhas.push({
          campanha:
            status.campanha ||
            nome,

          template:
            status.template ||
            "",

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
            status.criadoEm ||
            null,

          finalizadoEm:
            status.finalizadoEm ||
            null,

          atualizadoEm:
            status.atualizadoEm ||
            null
        });

      } catch (erroCampanha) {

        console.error(
          "Campanha inválida:",
          chave,
          erroCampanha
        );
      }
    }


    campanhas.sort(
      (a, b) => {

        const dataA =
          new Date(
            a.criadoEm ||
            a.atualizadoEm ||
            0
          ).getTime();

        const dataB =
          new Date(
            b.criadoEm ||
            b.atualizadoEm ||
            0
          ).getTime();

        return dataB - dataA;
      }
    );


    return res
      .status(200)
      .json({
        ok: true,

        quantidade:
          campanhas.length,

        campanhas:
          campanhas.slice(
            0,
            100
          )
      });


  } catch (erro) {

    console.error(
      "Erro campaign-history:",
      erro
    );


    return res
      .status(500)
      .json({
        ok: false,

        erro:
          erro?.message ||
          "Erro ao carregar histórico."
      });
  }
}
