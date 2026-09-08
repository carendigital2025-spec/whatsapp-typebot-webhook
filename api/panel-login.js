import crypto from "crypto";

function gerarToken() {
  const senhaServidor = process.env.PANEL_PASSWORD;

  if (!senhaServidor) {
    throw new Error("PANEL_PASSWORD não configurada");
  }

  return crypto
    .createHmac("sha256", senhaServidor)
    .update("adcred-painel-autorizado")
    .digest("hex");
}

function compararSeguro(valorA, valorB) {
  const a = Buffer.from(String(valorA));
  const b = Buffer.from(String(valorB));

  if (a.length !== b.length) {
    return false;
  }

  return crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  try {

    /* LOGIN */
    if (req.method === "POST") {

      const { senha } = req.body || {};

      if (!senha) {
        return res.status(400).json({
          ok: false,
          erro: "Digite a senha."
        });
      }

      const senhaCorreta =
        process.env.PANEL_PASSWORD;

      if (!senhaCorreta) {
        console.error(
          "PANEL_PASSWORD não configurada na Vercel"
        );

        return res.status(500).json({
          ok: false,
          erro: "Configuração do servidor incompleta."
        });
      }

      if (
        !compararSeguro(
          senha,
          senhaCorreta
        )
      ) {
        return res.status(401).json({
          ok: false,
          erro: "Senha incorreta."
        });
      }

      const token = gerarToken();

      res.setHeader(
        "Set-Cookie",
`panel_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800`      );

      return res.status(200).json({
        ok: true,
        mensagem: "Login realizado com sucesso."
      });
    }


    /* VERIFICAR SE JÁ ESTÁ LOGADA */
    if (req.method === "GET") {

      const cookies =
        req.headers.cookie || "";

      const tokenEsperado =
        gerarToken();

      const cookieSessao =
        cookies
          .split(";")
          .map(item => item.trim())
          .find(
            item =>
              item.startsWith(
                "panel_session="
              )
          );

      if (!cookieSessao) {
        return res.status(401).json({
          ok: false,
          autenticado: false
        });
      }

      const tokenRecebido =
        cookieSessao.substring(
          "panel_session=".length
        );

      const autenticado =
        compararSeguro(
          tokenRecebido,
          tokenEsperado
        );

      if (!autenticado) {
        return res.status(401).json({
          ok: false,
          autenticado: false
        });
      }

      return res.status(200).json({
        ok: true,
        autenticado: true
      });
    }


    /* SAIR DO PAINEL */
    if (req.method === "DELETE") {

      res.setHeader(
        "Set-Cookie",
        "panel_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0"
      );

      return res.status(200).json({
        ok: true
      });
    }


    return res.status(405).json({
      ok: false,
      erro: "Método não permitido"
    });

  } catch (error) {

    console.error(
      "Erro no login do painel:",
      error
    );

    return res.status(500).json({
      ok: false,
      erro: "Erro interno do servidor."
    });
  }
}
