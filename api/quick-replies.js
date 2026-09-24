// ===========================================================
// ADCred CRM - RESPOSTAS RÁPIDAS
// ===========================================================
//
// Este endpoint permite:
// GET    -> listar respostas rápidas
// POST   -> criar uma nova resposta
// PUT    -> editar uma resposta existente
// DELETE -> excluir uma resposta
//
// As respostas ficam salvas no Upstash Redis.
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
    throw new Error(
      "Variáveis do Upstash Redis não encontradas."
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
  const { url, token } = getRedisConfig();

  const response = await fetch(url, {
    method: "POST",

    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },

    body: JSON.stringify(command)
  });

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
    data = JSON.parse(responseText);
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
// CHAVE UTILIZADA NO REDIS
// ===========================================================

const QUICK_REPLIES_KEY =
  "crm:quick-replies";


// ===========================================================
// BUSCAR TODAS AS RESPOSTAS
// ===========================================================

async function getQuickReplies() {
  const registro =
    await redisCommand([
      "GET",
      QUICK_REPLIES_KEY
    ]);

  if (!registro) {
    return [];
  }

  try {
    const respostas =
      JSON.parse(registro);

    if (!Array.isArray(respostas)) {
      return [];
    }

    return respostas;

  } catch {
    return [];
  }
}


// ===========================================================
// SALVAR TODAS AS RESPOSTAS
// ===========================================================

async function saveQuickReplies(
  respostas
) {
  await redisCommand([
    "SET",
    QUICK_REPLIES_KEY,
    JSON.stringify(respostas)
  ]);
}


// ===========================================================
// NORMALIZAR TEXTO
// ===========================================================

function normalizarTexto(valor) {
  return String(
    valor || ""
  ).trim();
}


// ===========================================================
// CRIAR ID
// ===========================================================

function criarId() {
  return (
    Date.now().toString(36) +
    "-" +
    Math.random()
      .toString(36)
      .slice(2, 10)
  );
}


// ===========================================================
// VERIFICAR LOGIN DO PAINEL
// ===========================================================
//
// Utiliza a mesma lógica básica de sessão usada pelo painel.
// A presença do cookie é validada aqui.
// A autenticação completa continua sendo controlada pelo
// sistema de login já existente.
// ===========================================================

function temSessaoPainel(req) {
  const cookies =
    req.headers.cookie || "";

  return cookies
    .split(";")
    .map(
      cookie =>
        cookie.trim()
    )
    .some(
      cookie =>
        cookie.startsWith(
          "panel_session="
        )
    );
}


// ===========================================================
// HANDLER PRINCIPAL
// ===========================================================

export default async function handler(
  req,
  res
) {

  // ---------------------------------------------------------
  // SEGURANÇA
  // ---------------------------------------------------------

  if (!temSessaoPainel(req)) {
    return res
      .status(401)
      .json({
        ok: false,
        erro:
          "Não autorizado. Faça login no painel."
      });
  }


  // ---------------------------------------------------------
  // GET
  // LISTAR RESPOSTAS
  // ---------------------------------------------------------

  if (req.method === "GET") {
    try {
      const respostas =
        await getQuickReplies();

      return res
        .status(200)
        .json({
          ok: true,
          respostas
        });

    } catch (erro) {
      console.error(
        "Erro ao listar respostas rápidas:",
        erro
      );

      return res
        .status(500)
        .json({
          ok: false,
          erro:
            "Não foi possível carregar as respostas rápidas."
        });
    }
  }


  // ---------------------------------------------------------
  // POST
  // CRIAR NOVA RESPOSTA
  // ---------------------------------------------------------

  if (req.method === "POST") {
    try {
      const titulo =
        normalizarTexto(
          req.body?.titulo
        );

      const texto =
        normalizarTexto(
          req.body?.texto
        );

      if (!titulo) {
        return res
          .status(400)
          .json({
            ok: false,
            erro:
              "Informe um título para a resposta."
          });
      }

      if (!texto) {
        return res
          .status(400)
          .json({
            ok: false,
            erro:
              "Informe o texto da resposta."
          });
      }

      const respostas =
        await getQuickReplies();

      const agora =
        new Date().toISOString();

      const novaResposta = {
        id: criarId(),
        titulo,
        texto,
        criadaEm: agora,
        atualizadaEm: agora
      };

      respostas.push(
        novaResposta
      );

      await saveQuickReplies(
        respostas
      );

      return res
        .status(201)
        .json({
          ok: true,
          resposta:
            novaResposta,
          respostas
        });

    } catch (erro) {
      console.error(
        "Erro ao criar resposta rápida:",
        erro
      );

      return res
        .status(500)
        .json({
          ok: false,
          erro:
            "Não foi possível criar a resposta rápida."
        });
    }
  }


  // ---------------------------------------------------------
  // PUT
  // EDITAR RESPOSTA
  // ---------------------------------------------------------

  if (req.method === "PUT") {
    try {
      const id =
        normalizarTexto(
          req.body?.id
        );

      const titulo =
        normalizarTexto(
          req.body?.titulo
        );

      const texto =
        normalizarTexto(
          req.body?.texto
        );

      if (!id) {
        return res
          .status(400)
          .json({
            ok: false,
            erro:
              "Resposta não identificada."
          });
      }

      if (!titulo) {
        return res
          .status(400)
          .json({
            ok: false,
            erro:
              "Informe um título para a resposta."
          });
      }

      if (!texto) {
        return res
          .status(400)
          .json({
            ok: false,
            erro:
              "Informe o texto da resposta."
          });
      }

      const respostas =
        await getQuickReplies();

      const indice =
        respostas.findIndex(
          resposta =>
            String(
              resposta.id
            ) === id
        );

      if (indice === -1) {
        return res
          .status(404)
          .json({
            ok: false,
            erro:
              "Resposta rápida não encontrada."
          });
      }

      respostas[indice] = {
        ...respostas[indice],
        titulo,
        texto,
        atualizadaEm:
          new Date().toISOString()
      };

      await saveQuickReplies(
        respostas
      );

      return res
        .status(200)
        .json({
          ok: true,
          resposta:
            respostas[indice],
          respostas
        });

    } catch (erro) {
      console.error(
        "Erro ao editar resposta rápida:",
        erro
      );

      return res
        .status(500)
        .json({
          ok: false,
          erro:
            "Não foi possível editar a resposta rápida."
        });
    }
  }


  // ---------------------------------------------------------
  // DELETE
  // EXCLUIR RESPOSTA
  // ---------------------------------------------------------

  if (req.method === "DELETE") {
    try {
      const id =
        normalizarTexto(
          req.body?.id
        );

      if (!id) {
        return res
          .status(400)
          .json({
            ok: false,
            erro:
              "Resposta não identificada."
          });
      }

      const respostas =
        await getQuickReplies();

      const existe =
        respostas.some(
          resposta =>
            String(
              resposta.id
            ) === id
        );

      if (!existe) {
        return res
          .status(404)
          .json({
            ok: false,
            erro:
              "Resposta rápida não encontrada."
          });
      }

      const novasRespostas =
        respostas.filter(
          resposta =>
            String(
              resposta.id
            ) !== id
        );

      await saveQuickReplies(
        novasRespostas
      );

      return res
        .status(200)
        .json({
          ok: true,
          respostas:
            novasRespostas
        });

    } catch (erro) {
      console.error(
        "Erro ao excluir resposta rápida:",
        erro
      );

      return res
        .status(500)
        .json({
          ok: false,
          erro:
            "Não foi possível excluir a resposta rápida."
        });
    }
  }


  // ---------------------------------------------------------
  // MÉTODO NÃO PERMITIDO
  // ---------------------------------------------------------

  res.setHeader(
    "Allow",
    [
      "GET",
      "POST",
      "PUT",
      "DELETE"
    ]
  );

  return res
    .status(405)
    .json({
      ok: false,
      erro:
        "Método não permitido."
    });
}
