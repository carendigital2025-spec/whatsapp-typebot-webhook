export default async function handler(req, res) {
  // ===========================================================
  // SOMENTE GET
  // ===========================================================

  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      erro: "Método não permitido"
    });
  }

  try {
    // ===========================================================
    // PEGA O ID DA MÍDIA
    // ===========================================================

    const mediaId = req.query?.id;

    if (!mediaId) {
      return res.status(400).json({
        ok: false,
        erro: "ID da mídia não informado"
      });
    }

    // ===========================================================
    // TOKEN DA META
    // ===========================================================

    const token =
      process.env.WHATSAPP_TOKEN ||
      process.env.META_ACCESS_TOKEN ||
      process.env.ACCESS_TOKEN;

    if (!token) {
      return res.status(500).json({
        ok: false,
        erro: "Token da Meta não configurado"
      });
    }

    // ===========================================================
    // BUSCA INFORMAÇÕES DA MÍDIA NA META
    // ===========================================================

    const respostaInfo = await fetch(
      `https://graph.facebook.com/v23.0/${encodeURIComponent(mediaId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    const info = await respostaInfo.json();

    if (!respostaInfo.ok || !info?.url) {
      console.error(
        "Erro ao buscar informações da mídia:",
        info
      );

      return res.status(502).json({
        ok: false,
        erro: "Não foi possível localizar a mídia no WhatsApp"
      });
    }

    // ===========================================================
    // BAIXA A MÍDIA
    // ===========================================================

    const respostaMedia = await fetch(
      info.url,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    if (!respostaMedia.ok) {
      const erro = await respostaMedia.text();

      console.error(
        "Erro ao baixar mídia:",
        erro
      );

      return res.status(502).json({
        ok: false,
        erro: "Não foi possível baixar a mídia"
      });
    }

    // ===========================================================
    // CONVERTE PARA BUFFER
    // ===========================================================

    const arrayBuffer =
      await respostaMedia.arrayBuffer();

    const buffer =
      Buffer.from(arrayBuffer);

    const contentType =
      respostaMedia.headers.get("content-type") ||
      info.mime_type ||
      "application/octet-stream";

    // ===========================================================
    // DEVOLVE A MÍDIA PARA O CRM
    // ===========================================================

    res.setHeader(
      "Content-Type",
      contentType
    );

    res.setHeader(
      "Content-Length",
      buffer.length
    );

    res.setHeader(
      "Cache-Control",
      "private, max-age=300"
    );

    return res.status(200).send(buffer);

  } catch (erro) {
    console.error(
      "Erro na rota de mídia:",
      erro
    );

    return res.status(500).json({
      ok: false,
      erro: "Erro interno ao carregar mídia"
    });
  }
}
