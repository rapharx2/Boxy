# Boxy — Feature #11: Sketch (annotate / free-draw canvas)

**Date:** 2026-07-08
**Status:** Approved design
**Phase:** 2 (Captura inteligente) — final slice. First seed of the pen/sketch capability planned for Phase 6.

## Goal

A drawing editor inside the Boxy popup. The user can draw on a **blank canvas** or **over a screenshot** ("draw over prints"). Drawings are stored as **vector strokes** (re-editable) plus a rendered **PNG** used as the item's thumbnail.

## Non-goals (this slice)

- No shapes/arrows/text — essentials only (pen, colors, thickness, eraser, undo, clear).
- Sketch data is **not** included in export/import backups yet (the background screenshot is heavy). The `hasSketch` flag is exported as normal metadata. Including sketches in backup is future work.
- No pressure sensitivity yet (but Pointer Events are used so Phase 6 can add it without rework).

## User-facing behavior

### Entry points
1. **From a saved item** — a "Sketch" button in the edit modal (`#editModal`). Opens the editor with the item's existing preview image as the background (draw over the print); blank if the item has no image.
2. **New standalone sketch** — a small secondary "✏️ New sketch" button near the main `+` FAB. Creates a new item `{ type: 'sketch', ... }` with a blank canvas. Inside the editor a **"Load screenshot"** button captures the current visible tab (`captureVisibleTab`) and sets it as the background.

### Editor (`#sketchModal`)
- Toolbar: pen · color (6 preset swatches) · thickness (S/M/L) · eraser · undo · clear.
- A `<canvas>` inside a **scrollable container** (canvas may be larger than the popup viewport, scrolls both axes).
- **Canvas size:** if a background screenshot is present, the canvas matches the screenshot's natural dimensions, capped at 1600px on the longest side. If blank, a default large canvas of **800×1100**. Scrollable either way.
- Input via **Pointer Events** (mouse/touch/stylus).
- **Rendering in two layers:** background image drawn first; strokes rendered on a separate transparent layer composited on top. The **eraser only removes strokes** (composite `destination-out` on the strokes layer) — it never erases the background print.
- **Save** and **Cancel** buttons.

## Data model

New IndexedDB object store `sketches` in the existing "boxy" DB. Bump DB version (currently 2 → **3**); create `sketches` inside `onupgradeneeded` guarded by `objectStoreNames.contains(...)`, leaving `previews` and `archives` untouched.

`BoxyDB` additions:
- `setSketch(id, data)`
- `getSketch(id)` → object or `null`
- `deleteSketch(id)`
- `getAllSketchIds()` → for orphan sweep

Sketch record (keyed by item id):
```js
{
  strokes: [ { points: [{x, y}, ...], color: '#rrggbb', size: Number, eraser: Boolean }, ... ],
  bg: 'data:image/jpeg;base64,...' | null,  // background screenshot / print
  width: Number,
  height: Number,
  updatedAt: Number
}
```

Item metadata (in `storage.local`, unchanged shape otherwise):
- `type: 'sketch'` for standalone sketches (existing items keep their type).
- `hasSketch: true` when the item has a sketch.
- The rendered composite PNG is stored as the item's `preview` via `BoxyDB.setPreview(id, png)`, so the card thumbnail shows the drawing.

## Lifecycle

- **Save:** write `sketches` record; set `item.hasSketch = true` (+ `type:'sketch'` for new sketches); render the composite (bg + strokes) to a PNG and store as `preview`; `saveData()`; refresh list. For a new sketch, `unshift` the new item first.
- **Reopen:** `getSketch(id)` → restore `strokes` + `bg`, redraw, continue editing. **Undo** = pop the last stroke and redraw. **Clear** = empty strokes (keeps bg).
- **Delete item:** on undo-window finalization, also `BoxyDB.deleteSketch(id)` (mirrors `deletePreview`/`deleteArchive`). Orphan-sketch sweep in `loadData()` mirrors the existing orphan sweeps.

## Components / boundaries

- **db.js** — add the `sketches` store + 4 methods. Pure storage; no UI knowledge.
- **popup.html** — `#sketchModal` markup (toolbar + scrollable canvas container + Save/Cancel), the "Sketch" button in the edit modal, the "New sketch" secondary button near the FAB.
- **popup.css** — styles for the sketch modal, toolbar, scrollable canvas area, color swatches, active-tool state.
- **popup.js — sketch controller** (a cohesive block): open/close editor, tool state, pointer handlers building strokes, layered render, undo/clear, load-screenshot (via `browser.tabs.captureVisibleTab`), save (persist strokes + PNG preview + metadata). Kept as a focused, self-contained section so it can be reasoned about and tested independently.

## Testing (TDD + verification)

Popup harness (mock `chrome.storage`/`tabs`, real IndexedDB in a file:// page):
- Open editor from a new sketch → draw N strokes (dispatch pointer events or invoke the stroke API) → assert `strokes.length === N`.
- Undo → `strokes.length === N-1`.
- Clear → `strokes.length === 0`, bg retained.
- Save → `BoxyDB.getSketch(id)` returns the strokes; item has `hasSketch`; `BoxyDB.getPreview(id)` returns a PNG data URL; the item appears in the list.
- Reopen the saved sketch → strokes restored (count matches), bg restored.
- Eraser stroke stored with `eraser:true`; verify it composites without removing the bg (spot-check a bg pixel remains after an eraser stroke over it).
- Delete item + finalize → `getSketch(id)` returns null.

## Open risks / notes

- `captureVisibleTab` captures only the visible viewport (not full page) — acceptable for "draw over print".
- Large bg screenshots increase sketch record size; mitigated by the 1600px cap and JPEG background.
- Canvas coordinate mapping must account for scroll offset and any CSS scaling of the canvas element.
