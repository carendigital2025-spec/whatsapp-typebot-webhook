import crypto from "crypto";

function usuarioAutenticado(req) {
  const cookies = req.headers.cookie || "";
  const cookieSessao = cookies
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith("panel_session="));

  if (!cookieSessao || !process.env.PANEL_PASSWORD) return false;

  const tokenRecebido = cookieSessao.substring("panel_session=".length);
  const tokenEsperado = crypto
    .createHmac("sha256", process.env.PANEL_PASSWORD)
    .update("adcred-painel-autorizado")
    .digest("hex");

  const recebido = Buffer.from(tokenRecebido);
  const esperado = Buffer.from(tokenEsperado);

  return (
    recebido.length === esperado.length &&
    crypto.timingSafeEqual(recebido, esperado)
  );
}

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
    throw new Error("Variáveis do Redis não configuradas.");
  }

  return { url: url.replace(/\/$/, ""), token };
}

async function redisCommand(command) {
  const { url, token } = getRedisConfig();

  const resposta = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });

  const texto = await resposta.text();

  if (!resposta.ok) {
    console.error("Erro Redis:", resposta.status, texto);
    throw new Error("Erro ao consultar Redis.");
  }

  let dados;
  try {
    dados = JSON.parse(texto);
  } catch {
    throw new Error("Resposta inválida do Redis.");
  }

  if (dados?.error) throw new Error(`Redis: ${dados.error}`);
  return dados?.result;
}

function normalizarTelefone(valor) {
  return String(valor || "").replace(/\D/g, "");
}

async function obterConversa(telefone) {
  const registro = await redisCommand(["GET", `crm:conversation:${telefone}`]);

  if (!registro) return null;

  try {
    return JSON.parse(registro);
  } catch {
    return null;
  }
}

async function salvarConversa(telefone, conversa) {
  await redisCommand([
    "SET",
    `crm:conversation:${telefone}`,
    JSON.stringify(conversa),
  ]);
}

export default async function handler(req, res) {
  if (!usuarioAutenticado(req)) {
    return res.status(401).json({
      ok: false,
      erro: "Não autorizado. Faça login no painel.",
    });
  }

  try {
    if (req.method === "POST") {
      const telefone = normalizarTelefone(req.body?.telefone);
      const acao = String(req.body?.acao || "").trim();

      if (!telefone || !acao) {
        return res.status(400).json({
          ok: false,
          erro: "Telefone e ação são obrigatórios.",
        });
      }

      const conversaAtual = (await obterConversa(telefone)) || {
        telefone,
        nome: telefone,
        status: "novo",
        naoLidas: 0,
      };

      if (acao === "marcar_lida") {
        conversaAtual.naoLidas = 0;

      } else if (acao === "atualizar_status") {
        const statusPermitidos = [
          "novo",
          "em_atendimento",
          "aguardando_cliente",
          "finalizado",
        ];

        const status = String(req.body?.status || "").trim();

        if (!statusPermitidos.includes(status)) {
          return res.status(400).json({
            ok: false,
            erro: "Status inválido.",
          });
        }

        conversaAtual.status = status;

      } else if (acao === "atualizar_nome") {
        const nome = String(req.body?.nome || "")
          .trim()
          .slice(0, 80);

        conversaAtual.nome = nome || telefone;

      } else {
        return res.status(400).json({
          ok: false,
          erro: "Ação inválida.",
        });
      }

      await salvarConversa(
        telefone,
        conversaAtual
      );

      return res.status(200).json({
        ok: true,
        conversa: conversaAtual,
      });
    }

    if (req.method !== "GET") {
      return res.status(405).json({
        ok: false,
        erro: "Método não permitido",
      });
    }

    const telefone =
      normalizarTelefone(
        req.query?.telefone
      );

    if (telefone) {
      const registros =
        await redisCommand([
          "LRANGE",
          `crm:messages:${telefone}`,
          "0",
          "99",
        ]);

      const mensagens =
        Array.isArray(registros)
          ? registros
              .map((item) => {
                try {
                  return JSON.parse(item);
                } catch {
                  return null;
                }
              })
              .filter(Boolean)
          : [];

      const conversa =
        await obterConversa(telefone);

      return res.status(200).json({
        ok: true,
        telefone,
        conversa,
        mensagens,
      });
    }

    const telefones =
      await redisCommand([
        "ZREVRANGE",
        "crm:conversations",
        "0",
        "99",
      ]);

    if (
      !Array.isArray(telefones) ||
      telefones.length === 0
    ) {
      return res.status(200).json({
        ok: true,
        conversations: [],
      });
    }

    const conversations = [];

    for (const numero of telefones) {
      const conversa =
        await obterConversa(numero);

      if (!conversa) continue;

      conversations.push({
        telefone: numero,
        nome:
          conversa.nome ||
          numero,

        ultimaMensagem:
          conversa.ultimaMensagem ||
          "",

        ultimaDirecao:
          conversa.ultimaDirecao ||
          "",

        atualizadoEm:
          conversa.atualizadoEm ||
          conversa.ultimaData ||
          "",

        timestamp:
          Number(
            conversa.timestamp ||
            0
          ),

        naoLidas:
          Number(
            conversa.naoLidas ||
            0
          ),

        status:
          conversa.status ||
          "novo",
      });
    }

    return res.status(200).json({
      ok: true,
      conversations,
    });

  } catch (erro) {
    console.error(
      "Erro em conversations:",
      erro
    );

    return res.status(500).json({
      ok: false,
      erro:
        "Erro ao carregar as conversas.",
    });
  }
}
