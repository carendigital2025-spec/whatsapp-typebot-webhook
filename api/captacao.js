<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />

  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  />

  <title>Consulta FGTS | ADCred Solução Financeira</title>

  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      min-height: 100vh;
      font-family: Arial, Helvetica, sans-serif;
      background:
        linear-gradient(
          135deg,
          #071426 0%,
          #0d223c 55%,
          #102b4a 100%
        );
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }

    .pagina {
      width: 100%;
      max-width: 520px;
    }

    .marca {
      text-align: center;
      margin-bottom: 22px;
    }

    .logo {
      width: 68px;
      height: 68px;
      margin: 0 auto 12px;
      border-radius: 18px;
      background: #d7aa4b;
      color: #071426;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 27px;
      font-weight: 800;
      letter-spacing: -1px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
    }

    .marca h1 {
      font-size: 24px;
      font-weight: 700;
    }

    .marca p {
      color: #b9c6d5;
      font-size: 14px;
      margin-top: 5px;
    }

    .cnpj-topo {
      color: #d9e1ea;
      font-size: 12px;
      margin-top: 7px;
    }

    .card {
      background: #ffffff;
      color: #142033;
      border-radius: 22px;
      padding: 32px;
      box-shadow: 0 22px 55px rgba(0, 0, 0, 0.28);
    }

    .card h2 {
      font-size: 25px;
      line-height: 1.25;
      text-align: center;
      margin-bottom: 10px;
      color: #10233e;
    }

    .subtitulo {
      text-align: center;
      color: #68758a;
      font-size: 15px;
      line-height: 1.5;
      margin-bottom: 28px;
    }

    .grupo {
      margin-bottom: 19px;
    }

    .grupo label {
      display: block;
      margin-bottom: 7px;
      font-size: 14px;
      font-weight: 700;
      color: #26364c;
    }

    .grupo input[type="text"],
    .grupo input[type="tel"] {
      width: 100%;
      height: 50px;
      padding: 0 15px;
      border: 1px solid #d4dbe4;
      border-radius: 11px;
      font-size: 16px;
      color: #18263a;
      outline: none;
      transition: 0.2s;
      background: #ffffff;
    }

    .grupo input:focus {
      border-color: #d7aa4b;
      box-shadow: 0 0 0 3px rgba(215, 170, 75, 0.16);
    }

    .ajuda-telefone {
      margin-top: 6px;
      font-size: 11.5px;
      color: #8995a5;
    }

    .consentimento {
      display: flex;
      align-items: flex-start;
      gap: 11px;
      margin-top: 6px;
      padding: 15px;
      background: #f6f8fb;
      border: 1px solid #e2e7ee;
      border-radius: 12px;
    }

    .consentimento input {
      width: 19px;
      height: 19px;
      margin-top: 2px;
      flex-shrink: 0;
      accent-color: #102b4a;
      cursor: pointer;
    }

    .consentimento label {
      font-size: 12.5px;
      line-height: 1.55;
      color: #536176;
      cursor: pointer;
    }

    .botao {
      width: 100%;
      border: 0;
      border-radius: 12px;
      margin-top: 22px;
      min-height: 54px;
      padding: 13px 18px;
      background: #d7aa4b;
      color: #071426;
      font-size: 15px;
      font-weight: 800;
      cursor: pointer;
      transition: 0.2s;
    }

    .botao:hover {
      transform: translateY(-1px);
      filter: brightness(1.04);
    }

    .botao:disabled {
      cursor: not-allowed;
      opacity: 0.65;
      transform: none;
    }

    .privacidade {
      text-align: center;
      font-size: 11.5px;
      line-height: 1.5;
      color: #8a96a7;
      margin-top: 16px;
    }

    .mensagem {
      display: none;
      margin-top: 18px;
      padding: 13px;
      border-radius: 10px;
      font-size: 14px;
      line-height: 1.45;
      text-align: center;
    }

    .mensagem.erro {
      display: block;
      background: #fff1f1;
      color: #a52222;
      border: 1px solid #ffd1d1;
    }

    .mensagem.sucesso {
      display: block;
      background: #effaf3;
      color: #176936;
      border: 1px solid #cbeed7;
    }

    .rodape {
      text-align: center;
      color: #91a1b5;
      font-size: 11px;
      line-height: 1.6;
      margin-top: 20px;
    }

    @media (max-width: 560px) {
      body {
        padding: 16px;
        align-items: flex-start;
      }

      .pagina {
        margin-top: 18px;
      }

      .card {
        padding: 25px 20px;
        border-radius: 18px;
      }

      .card h2 {
        font-size: 22px;
      }

      .marca h1 {
        font-size: 21px;
      }
    }
  </style>
</head>

<body>
  <main class="pagina">

    <header class="marca">
      <div class="logo">AD</div>

      <h1>ADCred Solução Financeira</h1>

      <p>Atendimento digital</p>

      <div class="cnpj-topo">
        CNPJ: 68.860.680/0001-57
      </div>
    </header>

    <section class="card">

      <h2>
        Consulte sua possibilidade de antecipação do FGTS
      </h2>

      <p class="subtitulo">
        Preencha seus dados para iniciar sua consulta.
        A simulação é gratuita.
      </p>

      <form id="formCaptacao">

        <div class="grupo">
          <label for="nome">Nome</label>

          <input
            id="nome"
            name="nome"
            type="text"
            placeholder="Digite seu nome"
            autocomplete="name"
            maxlength="100"
            required
          />
        </div>

        <div class="grupo">
          <label for="telefone">WhatsApp</label>

          <input
            id="telefone"
            name="telefone"
            type="tel"
            placeholder="(DDD) 99999-9999"
            autocomplete="tel"
            inputmode="numeric"
            maxlength="16"
            required
          />

          <div class="ajuda-telefone">
            Informe seu número com DDD. Aceitamos números de todo o Brasil.
          </div>
        </div>

        <div class="consentimento">

          <input
            id="consentimento"
            name="consentimento"
            type="checkbox"
            required
          />

          <label for="consentimento">
            Autorizo a ADCred Solução Financeira,
            CNPJ 68.860.680/0001-57,
            a entrar em contato comigo pelo WhatsApp sobre esta
            solicitação e comunicações relacionadas aos seus produtos
            e serviços. Estou ciente de que posso solicitar o
            descadastro a qualquer momento.
          </label>

        </div>

        <button
          id="botaoEnviar"
          class="botao"
          type="submit"
        >
          QUERO FAZER MINHA CONSULTA
        </button>

        <div
          id="mensagem"
          class="mensagem"
          aria-live="polite"
        ></div>

      </form>

      <p class="privacidade">
        Seus dados serão utilizados para atender sua solicitação
        e registrar sua autorização de contato.
      </p>

    </section>

    <footer class="rodape">
      ADCred Solução Financeira
      <br />
      CNPJ: 68.860.680/0001-57
      <br />
      Atendimento digital e seguro.
    </footer>

  </main>

  <script>
    const form = document.getElementById("formCaptacao");
    const nomeInput = document.getElementById("nome");
    const telefoneInput = document.getElementById("telefone");
    const consentimentoInput =
      document.getElementById("consentimento");
    const botaoEnviar =
      document.getElementById("botaoEnviar");
    const mensagem =
      document.getElementById("mensagem");

    // -------------------------------------------------------
    // MÁSCARA DO TELEFONE
    // ACEITA QUALQUER DDD BRASILEIRO
    // -------------------------------------------------------

    telefoneInput.addEventListener("input", function () {
      let valor = telefoneInput.value.replace(/\D/g, "");

      valor = valor.substring(0, 11);

      if (valor.length <= 2) {
        telefoneInput.value = valor;
        return;
      }

      if (valor.length <= 6) {
        telefoneInput.value =
          "(" +
          valor.substring(0, 2) +
          ") " +
          valor.substring(2);

        return;
      }

      if (valor.length <= 10) {
        telefoneInput.value =
          "(" +
          valor.substring(0, 2) +
          ") " +
          valor.substring(2, 6) +
          "-" +
          valor.substring(6);

        return;
      }

      telefoneInput.value =
        "(" +
        valor.substring(0, 2) +
        ") " +
        valor.substring(2, 7) +
        "-" +
        valor.substring(7);
    });

    // -------------------------------------------------------
    // MENSAGENS
    // -------------------------------------------------------

    function mostrarMensagem(texto, tipo) {
      mensagem.textContent = texto;
      mensagem.className = "mensagem " + tipo;
    }

    function limparMensagem() {
      mensagem.textContent = "";
      mensagem.className = "mensagem";
    }

    // -------------------------------------------------------
    // ENVIO
    // -------------------------------------------------------

    form.addEventListener("submit", async function (event) {
      event.preventDefault();

      limparMensagem();

      const nome = nomeInput.value.trim();

      const telefone =
        telefoneInput.value.replace(/\D/g, "");

      if (nome.length < 2) {
        mostrarMensagem(
          "Digite seu nome para continuar.",
          "erro"
        );

        return;
      }

      if (
        telefone.length !== 10 &&
        telefone.length !== 11
      ) {
        mostrarMensagem(
          "Digite um número de WhatsApp válido com DDD.",
          "erro"
        );

        return;
      }

      if (!consentimentoInput.checked) {
        mostrarMensagem(
          "Para solicitar o contato, marque a autorização.",
          "erro"
        );

        return;
      }

      botaoEnviar.disabled = true;
      botaoEnviar.textContent = "ENVIANDO...";

      try {
        const resposta = await fetch("/api/captacao", {
          method: "POST",

          headers: {
            "Content-Type": "application/json"
          },

          body: JSON.stringify({
            nome,
            telefone,
            consentimento: true,
            origem: "pagina_captacao",
            versaoConsentimento: "v1"
          })
        });

        const tipoConteudo =
          resposta.headers.get("content-type") || "";

        if (!tipoConteudo.includes("application/json")) {
          throw new Error(
            "O servidor não respondeu corretamente. Tente novamente em instantes."
          );
        }

        const dados = await resposta.json();

        if (!resposta.ok || !dados.ok) {
          throw new Error(
            dados.erro ||
            "Não foi possível realizar o cadastro."
          );
        }

        mostrarMensagem(
          "Cadastro realizado! Recebemos sua solicitação.",
          "sucesso"
        );

        form.reset();

      } catch (erro) {
        console.error(
          "Erro ao realizar cadastro:",
          erro
        );

        mostrarMensagem(
          erro.message ||
          "Não foi possível enviar seus dados. Tente novamente.",
          "erro"
        );

      } finally {
        botaoEnviar.disabled = false;

        botaoEnviar.textContent =
          "QUERO FAZER MINHA CONSULTA";
      }
    });
  </script>

</body>
</html>
