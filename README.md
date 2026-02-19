# Boxy
# 📦 Boxy - Web Content Organizer

**Boxy** é uma extensão de navegador leve e minimalista que ajuda você a salvar e organizar conteúdos importantes da web (textos, imagens, vídeos e links) em um só lugar, permitindo que você os encontre facilmente mais tarde sem precisar manter dezenas de abas abertas.

## 🎯 O que ela faz

- **Captura Inteligente:** Salva links, seleciona textos, imagens ou vídeos diretamente da página atual.
- **Organização em Pastas:** Categorize os itens salvos em pastas personalizadas (ex: "Trabalho", "Estudos", "Memes").
- **Busca e Filtros:** Encontre rapidamente o que você precisa filtrando por pasta, tipo de mídia ou usando a barra de pesquisa.
- **Sistema de Lembretes:** Defina alarmes para itens específicos. O Boxy enviará uma notificação no navegador quando for a hora de revisitar aquele link.
- **Privacidade em 1º Lugar:** Funciona 100% offline. Todos os dados são salvos localmente no seu navegador (`storage.local`), sem servidores externos.

## 🛠️ Tecnologias Utilizadas

- **HTML5, CSS3 & JavaScript (Vanilla)**
- **WebExtensions API / Chrome API** (Manifest V3)
- **DOM Manipulation** (Renderização segura e eficiente)
- **Service Workers / Background Scripts** (Para gerenciamento de alarmes e menu de contexto)
- **Design Adaptativo** (Suporte nativo a Temas Claro e Escuro)

## 💡 Casos de Uso Típicos

- Salvar vídeos longos ou artigos interessantes para ler/assistir no fim de semana.
- Definir um lembrete para uma página de check-in de voo ou link de reunião.
- Guardar referências de design ou trechos de código sem poluir a barra de favoritos.

## 🚀 Instalação

### Instalação Oficial (Recomendado)
A maneira mais fácil e segura de instalar o Boxy é diretamente pela loja oficial:
1. Acesse a **Chrome Web Store**.
2. Procure por **"Boxy"** na barra de pesquisa.
3. Clique em **Usar no Chrome** (ou "Adicionar extensão").
4. Pronto! O ícone do Boxy aparecerá na sua barra de ferramentas.

### Instalação Manual (Modo Desenvolvedor)
Se você for um desenvolvedor e quiser testar a versão de código-fonte aberto:

**No Google Chrome / Edge / Brave:**
1. Faça o clone deste repositório: `git clone https://github.com/SEU-USUARIO/boxy.git`
2. Abra o navegador e acesse `chrome://extensions/` (ou `edge://extensions/`).
3. Ative o **Modo do desenvolvedor** (geralmente no canto superior direito).
4. Clique em **Carregar sem compactação** (Load unpacked) e selecione a pasta do projeto.

**No Mozilla Firefox:**
1. Acesse `about:debugging#/runtime/this-firefox`.
2. Clique em **Carregar um complemento temporário...** (Load Temporary Add-on).
3. Selecione o arquivo `manifest.json` dentro da pasta do projeto.

## ⌨️ Atalhos

- `Ctrl + Shift + S` (Windows/Linux) ou `Cmd + Shift + S` (Mac): Abre o popup do Boxy instantaneamente.

## 📝 Licença

Este projeto está sob a licença MIT. Veja o arquivo [LICENSE](LICENSE) para mais detalhes.
