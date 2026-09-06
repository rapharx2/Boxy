# Planos de animação — Boxy

Gerados pela skill `improve-animations` (auditoria de motion) contra o commit
`dc1d2fe`. Ficam aqui, e não em `plans/` na raiz, para não criar um segundo
diretório de planos: o repositório já usa `docs/superpowers/plans/`.

Os planos são auto-contidos — quem executa não precisa de contexto da conversa
que os gerou.

## Planos

| # | Título | Severidade | Categoria | Status |
|---|---|---|---|---|
| [001](001-remover-fadein-do-item-card.md) | Remover a animação de entrada do `.item-card` | HIGH | Purpose & frequency | **DONE** |
| [002](002-usar-ease-out-nas-entradas.md) | Trocar `ease` por `var(--ease-out)` nas entradas | HIGH | Easing & duration | **DONE** |

## Ordem de execução

**001 → 002**, nessa ordem.

O 001 apaga a linha `animation: fadeIn 0.3s ease forwards` do `.item-card`, que
é uma das linhas que o 002 trocaria de curva. Rodando 002 primeiro, esse trabalho
é desfeito pelo 001 logo em seguida. O 002 documenta essa dependência e diz o que
fazer caso encontre a linha ainda presente.

Fora isso, são independentes: tocam regras diferentes do mesmo arquivo e não
compartilham nenhuma linha.

## Achados auditados — todos aplicados

Levantados na auditoria e corrigidos direto no `popup.css`, sem plano formal
(eram pequenos e independentes entre si):

| # | Sev | Categoria | O que foi feito | Verificação |
|---|---|---|---|---|
| 3 | MEDIUM | Performance | `.toast` deixou de animar `bottom` (propriedade de layout). Agora `transform: translate(-50%, calc(100% + 24px))` → `translate(-50%, 0)` mais `opacity`, com `var(--ease-out)`. O `100%` é a própria altura do toast, então sumiu o `-100px` chutado. | Medido: `bottom` constante em 24px durante toda a animação; `transitionProperty` = `transform, opacity`. |
| 4 | MEDIUM | Accessibility | O bloco `prefers-reduced-motion` parou de zerar tudo com `!important`. Agora sobrescreve `transition-property` para `background-color, color, border-color, box-shadow, opacity` — opacidade e cor sobrevivem, o deslocamento sai. Mais `.modal-content { animation: none }` e `.toast` já nascendo na posição final. | 3 regras confirmadas na folha de estilo; `transition-duration: 0.01ms` não existe mais no arquivo. |
| 5 | LOW | Physicality | Feedback de press em 9 classes que tinham `:hover` e nenhuma resposta ao clique: `scale(0.97)`. O `.sketch-swatch` usa `scale(1.05)` porque o hover dele já é `scale(1.1)`. O `.btn-primary:active { translateY(0px) }`, que era no-op, virou `scale(0.97)`. As 5 classes sem `transition` ganharam `var(--transition)`. | 11 de 11 classes-alvo com regra `:active`, nenhuma faltando. |
| 6 | LOW | Accessibility | As 5 regras `:hover` que **movem** (`.fab`, `.btn-primary`, `.folder-card`, `.fab-secondary`, `.sketch-swatch`) foram envelopadas em `@media (hover: hover) and (pointer: fine)`. As de só cor ficaram soltas, que é o correto. | 5 media queries confirmadas, cada uma com o seletor certo. |

## Oportunidades registradas

Aditivas, não corretivas — nenhuma tem plano:

- `relatedBox` e `reviewBanner` entram e saem via `style.display`
  (`popup.js:561` e `popup.js:635`), que não transiciona. Painéis surgem do nada
  no topo da lista.
- A entrada de card está no lugar errado: o momento em que ela seria merecida é
  quando o usuário **salva** algo novo, e hoje isso é indistinguível de um
  re-render de filtro. Depois do plano 001, aplicar uma entrada apenas ao card
  genuinamente novo transforma um incômodo constante em feedback útil.
- Deletar um item e desfazer: o card some e reaparece instantaneamente. O undo
  em especial ganharia com o card voltando ao lugar, explicando o que foi
  restaurado.
