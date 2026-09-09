import crypto from "crypto";

export default async function handler(req, res) {
  // ===========================================================
  // PROTEÇÃO DA ROTA PELO LOGIN DO PAINEL
  // ===========================================================

  const cookies = req.headers.cookie || "";

  const cookieSessao = cookies
    .split(";")
    .map(cookie => cookie.trim())
    .find(cookie => cookie.startsWith("panel_session="));

  const senhaPainel =
    process.env.PANEL_PASSWORD ||
    process.env.SENHA_DO_PAINEL;

  if (!cookieSessao || !senhaPainel) {
    return res.status(401).json({
      ok: false,
      erro: "Não autorizado. Faça login no painel."
    });
  }

  const tokenRecebido =
    cookieSessao.substring("panel_session=".length);

  const tokenEsperado = crypto
    .createHmac("sha256", senhaPainel)
    .update("adcred-painel-autorizado")
    .digest("hex");

  const recebido = Buffer.from(tokenRecebido);
  const esperado = Buffer.from(tokenEsperado);

  const autenticado =
    recebido.length === esperado.length &&
    crypto.timingSafeEqual(recebido, esperado);

  if (!autenticado) {
    return res.status(401).json({
      ok: false,
      erro: "Não autorizado. Faça login no painel."
    });
  }

  // ===========================================================
  // SOMENTE GET
  // ===========================================================

  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      erro: "Método não permitido"
    });
  }

  // ===========================================================
  // VARIÁVEIS DA META
  // ===========================================================

  const token = process.env.WHATSAPP_TOKEN;
  const wabaId =
    process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;

  if (!token) {
    return res.status(500).json({
      ok: false,
      erro: "WHATSAPP_TOKEN não configurado na Vercel."
    });
  }

  if (!wabaId) {
    return res.status(500).json({
      ok: false,
      erro: "WHATSAPP_BUSINESS_ACCOUNT_ID não configurado na Vercel."
    });
  }

  // ===========================================================
  // BUSCA OS TEMPLATES NA META
  // ===========================================================

  try {
    const url =
      `https://graph.facebook.com/v26.0/${wabaId}/message_templates` +
      `?fields=id,name,status,category,language` +
      `&limit=100`;

    const respostaMeta = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const dadosMeta = await respostaMeta.json();

    if (!respostaMeta.ok) {
      console.error(
        "Erro da Meta ao buscar templates:",
        dadosMeta
      );

      return res.status(respostaMeta.status).json({
        ok: false,
        erro:
          dadosMeta?.error?.message ||
          "Não foi possível buscar os templates na Meta.",
        codigo: dadosMeta?.error?.code || null
      });
    }

    // ===========================================================
    // ORGANIZA OS TEMPLATES
    // ===========================================================

    const templates =
      Array.isArray(dadosMeta.data)
        ? dadosMeta.data.map(template => ({
            id: template.id || "",
            nome: template.name || "",
            status: template.status || "",
            categoria: template.category || "",
            idioma: template.language || ""
          }))
        : [];

    // ===========================================================
    // RETORNO PARA O PAINEL
    // ===========================================================

    return res.status(200).json({
      ok: true,
      quantidade: templates.length,
      templates
    });

  } catch (error) {
    console.error("Erro em templates.js:", error);

    return res.status(500).json({
      ok: false,
      erro:
        "Erro interno ao buscar os templates do WhatsApp."
    });
  }
}
