# 002 — Trocar `ease` por `var(--ease-out)` nas animações de entrada

- **Status**: DONE — aplicado e verificado (opacidade 1 durante digitação; curva computada = `cubic-bezier(0.23, 1, 0.32, 1)`)
- **Commit**: dc1d2fe
- **Atenção**: `dc1d2fe` é o `HEAD`, mas a árvore está suja. As linhas citadas
  e o token `--ease-out` existem na **árvore de trabalho**, não no commit.
  Executar contra a working tree, não contra um checkout limpo de `dc1d2fe`.
- **Severity**: HIGH
- **Category**: Easing & duration (com agravante de Cohesion & tokens)
- **Estimated scope**: 1 arquivo (`popup.css`), 3 a 4 linhas alteradas

## Problema

Toda animação de entrada do popup usa a curva `ease` embutida do CSS:

```css
/* popup.css:481 — atual (removida pelo plano 001; ver "Dependência") */
.item-card { animation: fadeIn 0.3s ease forwards; }

/* popup.css:644 — atual (overlay do modal) */
.modal { animation: fadeIn 0.2s ease; }

/* popup.css:662 — atual (conteúdo do modal) */
.modal-content { animation: slideUp 0.3s ease; }

/* popup.css:859 — atual (visualizador de imagem) */
.image-viewer { animation: fadeIn 0.2s ease; }
```

`ease` é `cubic-bezier(0.25, 0.1, 0.25, 1)`: começa devagar. Para um elemento
que está **entrando**, isso atrasa exatamente o instante em que o usuário está
olhando, e o resultado é uma UI que parece lenta mesmo com duração curta. A
regra para entrada e saída é `ease-out` — começa rápido e desacelera, que é o
que dá sensação de resposta imediata.

Há um agravante de coesão. O token com a curva certa **já existe** no arquivo:

```css
/* popup.css:51 — atual */
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);
```

Ele foi introduzido junto com o token `--transition` e é usado pelas 15
transições do arquivo. Nenhum `@keyframes` o usa. O projeto tem duas linguagens
de motion convivendo: as transições com a curva forte, e as animações de entrada
com a curva fraca do navegador.

As durações (0,2s e 0,3s) estão corretas e não mudam — modais têm orçamento de
200 a 500ms.

## Alvo

```css
/* popup.css:644 — alvo */
.modal {
  /* ... demais propriedades inalteradas ... */
  animation: fadeIn 0.2s var(--ease-out);
}

/* popup.css:662 — alvo */
.modal-content {
  /* ... demais propriedades inalteradas ... */
  animation: slideUp 0.3s var(--ease-out);
}

/* popup.css:859 — alvo */
.image-viewer {
  /* ... demais propriedades inalteradas ... */
  animation: fadeIn 0.2s var(--ease-out);
}
```

Valor exato do token, já definido em `popup.css:51` e que **não deve ser
redefinido nem duplicado**:

```css
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);
```

## Dependência

Este plano assume que o **001** já foi executado, o que remove a linha do
`.item-card` (popup.css:481). Se o 001 ainda não rodou, a linha existe e deve
ser deixada **como está** — o 001 vai apagá-la inteira, então mexer na curva
dela aqui é trabalho jogado fora e gera conflito.

Executar na ordem: 001, depois 002.

## Convenções do repositório a seguir

- CSS vanilla, sem build. Editar `popup.css` direto.
- Curvas e durações vivem como tokens no `:root` de `popup.css` (o `:root` começa
  na linha 29). Nunca escrever um `cubic-bezier` literal fora do `:root`.
- Exemplar que já faz certo: `popup.css:51-58`, onde o token `--transition`
  compõe as seis propriedades usando `var(--ease-out)` em cada uma. As
  animações devem referenciar o mesmo token, não redeclarar a curva.

## Passos

1. Abrir `popup.css`, localizar a regra `.modal {` (por volta da linha 636).
   Trocar `animation: fadeIn 0.2s ease;` por `animation: fadeIn 0.2s var(--ease-out);`.
2. Localizar `.modal-content {` (por volta da linha 650). Trocar
   `animation: slideUp 0.3s ease;` por `animation: slideUp 0.3s var(--ease-out);`.
3. Localizar `.image-viewer {` (por volta da linha 848). Trocar
   `animation: fadeIn 0.2s ease;` por `animation: fadeIn 0.2s var(--ease-out);`.
4. Se o plano 001 **não** tiver sido executado, deixar a linha 481 do
   `.item-card` intocada e registrar isso no relatório.

## Limites

- NÃO mudar as durações. 0,2s e 0,3s estão dentro do orçamento e não são o problema.
- NÃO alterar o conteúdo dos blocos `@keyframes fadeIn` e `@keyframes slideUp`.
  Só a curva na propriedade `animation` muda.
- NÃO redefinir `--ease-out` nem adicionar novos tokens de curva. O token existe.
- NÃO tocar no token `--transition` nem nas 15 transições que já o usam.
- NÃO mexer no `.toast` (`transition: bottom`) — é o achado #3, plano separado.
- NÃO adicionar dependências.
- Se o código encontrado não bater com os trechos citados (drift desde `dc1d2fe`),
  PARAR e reportar.

## Verificação

- **Mecânica**:
  - `grep -n "animation:.*ease;" popup.css` não deve retornar **nenhuma** linha
    (nenhuma animação usando a curva embutida).
  - `grep -c "animation:.*var(--ease-out)" popup.css` deve retornar **3**.
  - `grep -c "cubic-bezier" popup.css` deve continuar retornando **1** — só a
    definição do token no `:root`. Se der 2 ou mais, a curva foi duplicada.
  - Chaves balanceadas:
    `python3 -c "s=open('popup.css').read(); assert s.count('{')==s.count('}')"`
- **Feel check**: carregar a extensão em `chrome://extensions`, abrir o popup e:
  - Clicar no FAB `+` para abrir o modal de salvar. O painel deve subir com
    arranque rápido e parada macia. Antes, a saída da posição inicial era lenta.
  - No DevTools, painel Animations, colocar a velocidade em **10%** e reabrir o
    modal: confirmar que o movimento cobre a maior parte da distância no
    primeiro terço do tempo. Se o meio do percurso for o trecho mais rápido, a
    curva antiga ainda está ativa.
  - Abrir uma imagem salva (`.image-viewer`) e confirmar o mesmo perfil.
  - No painel Rendering, marcar `prefers-reduced-motion: reduce` e reabrir o
    modal: ele deve aparecer sem deslizar.
- **Done when**: nenhuma propriedade `animation` no arquivo usa a curva `ease`
  embutida, e o `cubic-bezier` aparece exatamente uma vez, no `:root`.
