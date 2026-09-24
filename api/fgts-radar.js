import crypto from "crypto";

// ===========================================================
// CONFIGURAÇÃO REDIS
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
    throw new Error("Redis não configurado.");
  }

  return {
    url: url.replace(/\/$/, ""),
    token
  };
}

async function redisCommand(command) {
  const { url, token } = getRedisConfig();

  const resposta = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command)
  });

  const texto = await resposta.text();

  if (!resposta.ok) {
    throw new Error(texto);
  }

  const dados = JSON.parse(texto);

  if (dados.error) {
    throw new Error(dados.error);
  }

  return dados.result;
}

// ===========================================================
// LOGIN DO PAINEL
// ===========================================================

function autenticado(req) {
  const cookies = req.headers.cookie || "";

  const cookie = cookies
    .split(";")
    .map(c => c.trim())
    .find(c => c.startsWith("panel_session="));

  if (!cookie || !process.env.PANEL_PASSWORD) {
    return false;
  }

  const recebido =
    cookie.substring("panel_session=".length);

  const esperado = crypto
    .createHmac(
      "sha256",
      process.env.PANEL_PASSWORD
    )
    .update("adcred-painel-autorizado")
    .digest("hex");

  return recebido === esperado;
}

// ===========================================================
// CHAVE REDIS
// ===========================================================

const KEY = "crm:fgts-radar";

// ===========================================================
// UTILIDADES
// ===========================================================

function hojeISO() {
  return new Date()
    .toISOString()
    .slice(0, 10);
}

function proximoDia23() {
  const hoje = new Date();

  let ano = hoje.getFullYear();
  let mes = hoje.getMonth();

  if (hoje.getDate() > 23) {
    mes++;

    if (mes > 11) {
      mes = 0;
      ano++;
    }
  }

  return `${ano}-${String(mes + 1).padStart(2, "0")}-23`;
}

async function carregarLista() {
  const valor =
    await redisCommand(["GET", KEY]);

  if (!valor) {
    return [];
  }

  try {
    return JSON.parse(valor);
  } catch {
    return [];
  }
}

async function salvarLista(lista) {
  await redisCommand([
    "SET",
    KEY,
    JSON.stringify(lista)
  ]);
}

// ===========================================================
// HANDLER
// ===========================================================

export default async function handler(req, res) {

  if (!autenticado(req)) {
    return res.status(401).json({
      ok: false,
      erro: "Não autorizado."
    });
  }

  // =========================================================
  // GET
  // =========================================================

  if (req.method === "GET") {

    const lista =
      await carregarLista();

    const hoje = hojeISO();

    const estatisticas = {
      total: lista.length,

      hoje: lista.filter(
        c =>
          c.reconsulta === hoje &&
          c.ativo
      ).length,

      atrasados: lista.filter(
        c =>
          c.reconsulta < hoje &&
          c.ativo
      ).length,

      proximos: lista.filter(
        c =>
          c.reconsulta > hoje &&
          c.ativo
      ).length
    };

    return res.json({
      ok: true,
      clientes: lista,
      estatisticas
    });
  }

  // =========================================================
  // POST
  // NOVO CLIENTE
  // =========================================================

  if (req.method === "POST") {

    const lista =
      await carregarLista();

    const cliente = {
      id:
        Date.now().toString(36),

      nome:
        String(
          req.body.nome || ""
        ).trim(),

      telefone:
        String(
          req.body.telefone || ""
        ).trim(),

      origem:
        req.body.origem ||
        "WhatsApp",

      ultimaConsulta:
        req.body.ultimaConsulta ||
        hojeISO(),

      reconsulta:
        req.body.reconsulta ||
        proximoDia23(),

      resultado:
        req.body.resultado ||
        "Sem saldo",

      observacao:
        req.body.observacao || "",

      ativo: true,

      criadoEm:
        new Date().toISOString()
    };

    lista.unshift(cliente);

    await salvarLista(lista);

    return res.status(201).json({
      ok: true,
      cliente,
      clientes: lista
    });
  }

  // =========================================================
  // PUT
  // ATUALIZA CLIENTE
  // =========================================================

  if (req.method === "PUT") {

    const lista =
      await carregarLista();

    const i =
      lista.findIndex(
        c => c.id === req.body.id
      );

    if (i === -1) {
      return res.status(404).json({
        ok: false
      });
    }

    lista[i] = {
      ...lista[i],

      ...req.body,

      ultimaAtualizacao:
        new Date().toISOString()
    };

    await salvarLista(lista);

    return res.json({
      ok: true,
      cliente: lista[i]
    });
  }

  // =========================================================
  // DELETE
  // =========================================================

  if (req.method === "DELETE") {

    const lista =
      await carregarLista();

    const nova =
      lista.filter(
        c => c.id !== req.body.id
      );

    await salvarLista(nova);

    return res.json({
      ok: true
    });
  }

  res.status(405).json({
    ok: false
  });
}
