export default async function handler(req, res) {
  // Esta rota será usada pelo painel de campanhas da ADCred.
  // Por enquanto ela NÃO envia nenhuma mensagem.

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      erro: "Método não permitido"
    });
  }

  try {
    const { campanha, template, contatos } = req.body || {};

    if (!campanha) {
      return res.status(400).json({
        ok: false,
        erro: "Nome da campanha não informado"
      });
    }

    if (!template) {
      return res.status(400).json({
        ok: false,
        erro: "Template não informado"
      });
    }

    if (!Array.isArray(contatos) || contatos.length === 0) {
      return res.status(400).json({
        ok: false,
        erro: "Nenhum contato válido recebido"
      });
    }

    return res.status(200).json({
      ok: true,
      modo: "teste",
      mensagem: "Campanha recebida com sucesso. Nenhuma mensagem foi enviada.",
      campanha,
      template,
      quantidade: contatos.length
    });

  } catch (error) {
    console.error("Erro em send-campaign:", error);

    return res.status(500).json({
      ok: false,
      erro: "Erro interno ao preparar a campanha"
    });
  }
}
