# 001 — Remover a animação de entrada do `.item-card`

- **Status**: DONE — aplicado e verificado (opacidade 1 durante digitação; curva computada = `cubic-bezier(0.23, 1, 0.32, 1)`)
- **Commit**: dc1d2fe
- **Atenção**: `dc1d2fe` é o `HEAD`, mas a árvore está suja. As linhas citadas
  e o token `--ease-out` existem na **árvore de trabalho**, não no commit.
  Executar contra a working tree, não contra um checkout limpo de `dc1d2fe`.
- **Severity**: HIGH
- **Category**: Purpose & frequency (com agravante de Interruptibility)
- **Estimated scope**: 1 arquivo (`popup.css`), 2 linhas removidas

## Problema

`.item-card` nasce invisível e depende de um `@keyframes` para aparecer:

```css
/* popup.css:466-483 — atual */
.item-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  margin-bottom: 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  min-height: 80px;
  transition: var(--transition);
  opacity: 0;
  animation: fadeIn 0.3s ease forwards;
  position: relative;
}
```

O problema não é a animação em si — é quando ela dispara. `renderItems()` apaga
e recria **todos** os cards a cada chamada:

```js
// popup.js:793-795 — atual
const existingCards = container.querySelectorAll('.item-card, .folders-view');
existingCards.forEach(el => el.remove());
```

E a busca chama isso a cada tecla, sem debounce:

```js
// popup.js:323-326 — atual
searchInput.addEventListener('input', (e) => {
  state.searchQuery = e.target.value.toLowerCase();
  renderItems();
});
```

Cada card recriado é um elemento novo, então o `@keyframes` reinicia do zero
(diferente de uma `transition`, que retargetaria a partir do estado atual).

**Medido no navegador**, simulando digitação a 60ms por tecla: a opacidade dos
cards fica entre **0,13 e 0,22**, e só volta a 1 cerca de 300ms depois que o
usuário para de digitar. Na prática, a lista que a pessoa está filtrando fica
quase invisível exatamente enquanto ela filtra.

`renderItems()` é chamado de 17 lugares em `popup.js` — busca, troca de aba,
salvar, editar, deletar, desfazer, alarme disparado. Em nenhum desses casos a
lista inteira é "nova"; ela está apenas sendo re-renderizada.

Uma entrada em item de lista de alta frequência é motion decorativo sem
propósito. A correção certa é remover, não ajustar a curva ou a duração.

## Alvo

```css
/* popup.css — alvo */
.item-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  margin-bottom: 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  min-height: 80px;
  transition: var(--transition);
  position: relative;
}
```

Exatamente duas linhas somem: `opacity: 0;` e `animation: fadeIn 0.3s ease forwards;`.
Nada mais muda na regra.

O `@keyframes fadeIn` (popup.css:485-487) **permanece no arquivo** — ele ainda é
usado por `.modal` (popup.css:644) e `.image-viewer` (popup.css:859). Removê-lo
quebraria esses dois.

## Convenções do repositório a seguir

- CSS vanilla, sem build, sem pré-processador. Editar `popup.css` direto.
- Tokens de motion vivem no `:root` de `popup.css`: `--ease-out` e `--transition`.
- Comentários no código são em português; texto de UI é em inglês. Esta mudança
  não adiciona texto de UI.
- Exemplar de card que não anima na entrada e ainda assim responde ao hover:
  `popup.css:489-491` (`.item-card:hover { box-shadow: var(--shadow-hover); }`).
  O feedback de hover é preservado pela `transition: var(--transition)` que fica.

## Passos

1. Abrir `popup.css` e localizar a regra `.item-card {` (por volta da linha 469).
2. Remover a linha `  opacity: 0;`.
3. Remover a linha `  animation: fadeIn 0.3s ease forwards;`.
4. Não tocar em mais nada dentro da regra. A `transition: var(--transition)` e o
   `position: relative` continuam.

## Limites

- NÃO remover o bloco `@keyframes fadeIn` — `.modal` e `.image-viewer` dependem dele.
- NÃO mexer em `popup.js`. Adicionar debounce na busca é uma otimização separada
  e não é escopo deste plano; com a animação removida, o re-render deixa de ser
  perceptível de qualquer forma.
- NÃO adicionar uma animação de entrada só para cards genuinamente novos. Isso é
  uma oportunidade registrada à parte, não faz parte desta correção.
- NÃO trocar markup ou estrutura — só propriedades de motion.
- NÃO adicionar dependências.
- Se o código encontrado não bater com o trecho citado acima (drift desde o
  commit `dc1d2fe`), PARAR e reportar em vez de improvisar.

## Verificação

- **Mecânica**:
  - `grep -n "fadeIn" popup.css` deve retornar **4** ocorrências: a definição do
    `@keyframes` (l.485), os usos em `.modal` (l.644) e `.image-viewer` (l.859),
    e uma menção em comentário (l.1328). A ocorrência em `.item-card` (l.481)
    não pode mais aparecer. Antes da execução são 5.
  - Contagem de chaves balanceada:
    `python3 -c "s=open('popup.css').read(); assert s.count('{')==s.count('}')"`
- **Feel check**: carregar a extensão em `chrome://extensions`, salvar 5 ou mais
  itens, abrir o popup e:
  - Digitar rápido na busca. Os cards visíveis devem permanecer **totalmente
    opacos** o tempo todo. Antes, ficavam translúcidos enquanto se digitava.
  - Apagar a busca de uma vez (Ctrl+A, Backspace). A lista completa reaparece
    sem piscar.
  - Passar o mouse sobre um card: a sombra ainda cresce suavemente. Se o hover
    ficou instantâneo, a `transition` foi removida por engano — reverter.
  - Trocar de aba (All → Articles → All): sem flash de opacidade.
  - No DevTools, painel Animations, colocar a velocidade em 10% e digitar na
    busca: nenhuma animação de card deve ser registrada.
- **Done when**: digitar na busca não produz nenhuma mudança de opacidade nos
  cards, e o hover continua com transição suave.
