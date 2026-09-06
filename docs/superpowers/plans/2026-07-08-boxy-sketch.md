# Sketch (#11) Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox (`- [ ]`) syntax.
> **Testing note:** This repo is a no-build vanilla MV3 extension with NO unit-test runner. "Verify" steps are performed by the orchestrator using a mock-`chrome` HTML harness driven through the Chrome DevTools MCP (real IndexedDB runs in a file:// page). Each task ends with a concrete, observable check.

**Goal:** Add a sketch/annotation editor to Boxy: draw on a blank canvas or over a screenshot, store drawings as re-editable vector strokes plus a PNG thumbnail.

**Architecture:** New IndexedDB `sketches` store holds `{strokes, bg, width, height, updatedAt}` per item id. A self-contained sketch controller in popup.js drives a `#sketchModal` (toolbar + scrollable `<canvas>`), rendering background + strokes in two layers so the eraser only removes strokes. On save, a composite PNG becomes the item's `preview`.

**Tech Stack:** Vanilla JS, Pointer Events, Canvas 2D, IndexedDB (BoxyDB in db.js).

## Global Constraints

- Line 1 of every JS file: `globalThis.browser ??= globalThis.chrome;` — never remove.
- No build step; no external libraries. All user-facing text in ENGLISH; code comments may be Portuguese.
- Do NOT break Phase-1/2 or #4 code: `previews` & `archives` IndexedDB stores, `detectContent`, `saveHighlight`, selection button, export/import, undo-delete.
- Item metadata persisted to storage.local is stripped of `preview` (previews/sketch PNGs live in IndexedDB).
- Cross-browser (Firefox min 109 / Chrome). Use `browser.*` (shim aliases chrome).

---

### Task 1: `sketches` object store + BoxyDB API

**Files:**
- Modify: `db.js` (bump DB version 2 → 3; add store + 4 methods)

**Interfaces — Produces:**
- `BoxyDB.setSketch(id, data)` → Promise<void>  (`data = {strokes, bg, width, height, updatedAt}`)
- `BoxyDB.getSketch(id)` → Promise<object|null>
- `BoxyDB.deleteSketch(id)` → Promise<void>
- `BoxyDB.getAllSketchIds()` → Promise<string[]>

- [ ] **Step 1:** In `db.js`, bump the version constant to `3`. In `onupgradeneeded`, add guarded creation (keep existing `previews`/`archives` creation intact):
```js
if (!db.objectStoreNames.contains('sketches')) db.createObjectStore('sketches');
```
- [ ] **Step 2:** Add the four methods mirroring the existing archive methods (use the same `withStore(storeName, mode, fn)` helper). `setSketch(id, data)` → `put(data, id)`; `getSketch(id)` → `get(id)` resolving `result ?? null`; `deleteSketch(id)` → `delete(id)`; `getAllSketchIds()` → `getAllKeys()`.
- [ ] **Step 3 (verify):** Harness — `await BoxyDB.setSketch('t1', {strokes:[], bg:null, width:10, height:10, updatedAt:1})`; `getSketch('t1')` returns the object; `getSketch('nope')` returns null; `getAllSketchIds()` includes `'t1'`; existing `getPreview`/`getArchive` still work (no store wiped).

---

### Task 2: Sketch modal markup + entry buttons + styles

**Files:**
- Modify: `popup.html` (add `#sketchModal`; add `#sketchItemBtn` in edit modal; add `#newSketchBtn` near the FAB)
- Modify: `popup.css` (sketch modal, toolbar, scroll area, swatches, active state)

**Interfaces — Produces (DOM ids consumed by Task 3):**
`#sketchModal`, `#sketchCanvas`, `#sketchScroll` (scroll container), `#sketchToolPen`, `#sketchToolEraser`, `#sketchUndo`, `#sketchClear`, `#sketchLoadShot`, `#sketchSave`, `#sketchCancel`, `#sketchColors` (container of `.sketch-swatch[data-color]`), `#sketchSizes` (container of `.sketch-size[data-size]`), edit-modal `#sketchItemBtn`, FAB-area `#newSketchBtn`.

- [ ] **Step 1:** Add `#newSketchBtn` as a small secondary FAB just above `#fabBtn` (English title "New sketch", pencil glyph). Add `#sketchItemBtn` ("Sketch") in `#editModal` body near `#editOpenLink`, full-width btn-secondary.
- [ ] **Step 2:** Add `#sketchModal` (class `modal`) with: header (title "Sketch" + `#sketchCancel` close); a toolbar row containing `#sketchToolPen`, `#sketchToolEraser`, `#sketchColors` (6 `.sketch-swatch` buttons with `data-color` = #111111,#e0392b,#2e9e78,#4c74e0,#e0912b,#ffffff), `#sketchSizes` (3 `.sketch-size` buttons data-size = 2,5,12), `#sketchUndo`, `#sketchClear`, `#sketchLoadShot`; a `#sketchScroll` div (overflow:auto) wrapping `#sketchCanvas`; a footer with `#sketchSave` (btn-primary).
- [ ] **Step 3:** popup.css — `#sketchScroll { max-height: 70vh; overflow: auto; }`; canvas gets a subtle checkerboard/white background and border; `.sketch-swatch` are round color chips; `.active` tool/swatch/size gets an accent outline using existing vars (`--accent-primary`, `--border-color`). Toolbar wraps on small widths.
- [ ] **Step 4 (verify):** Load popup harness; assert every id above exists and `#sketchModal` is hidden by default.

---

### Task 3: Sketch controller in popup.js

**Files:**
- Modify: `popup.js` (add a cohesive "SKETCH" section + wire listeners in `setupEventListeners`; hooks in `openEditModal`, delete finalize, `loadData` orphan sweep, `createItemCard` unaffected since PNG is stored as preview)

**Interfaces — Consumes:** Task 1 BoxyDB sketch API; Task 2 DOM ids.

State (module-level):
```js
let sketch = { itemId:null, isNew:false, strokes:[], bg:null, width:0, height:0,
               tool:'pen', color:'#111111', size:5, drawing:false, cur:null };
```

- [ ] **Step 1 — open flows.**
```js
// From an existing item
async function openSketchForItem(item){
  const rec = await BoxyDB.getSketch(item.id);
  const bg = rec?.bg ?? item.preview ?? null;      // draw over the print if present
  openSketchEditor({ itemId:item.id, isNew:false, rec, bg });
}
// New standalone sketch
function openNewSketch(){ openSketchEditor({ itemId:Date.now().toString(), isNew:true, rec:null, bg:null }); }
```
`openSketchEditor({itemId,isNew,rec,bg})`: set `sketch` fields (strokes = rec?.strokes ? deep-copy : []); compute size: if bg image → load it, canvas = natural size capped 1600 on long side; else 800×1100. Set canvas width/height, `renderSketch()`, add `.active` to current tool/color/size, show `#sketchModal`.

- [ ] **Step 2 — rendering (two layers).**
```js
function renderSketch(){
  const c = document.getElementById('sketchCanvas'); const ctx = c.getContext('2d');
  ctx.clearRect(0,0,c.width,c.height);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,c.width,c.height);
  if (sketch._bgImg) ctx.drawImage(sketch._bgImg, 0,0, c.width, c.height);
  // strokes on an offscreen transparent layer so eraser only removes strokes
  const off = document.createElement('canvas'); off.width=c.width; off.height=c.height;
  const octx = off.getContext('2d'); octx.lineJoin=octx.lineCap='round';
  for (const s of sketch.strokes){
    octx.globalCompositeOperation = s.eraser ? 'destination-out' : 'source-over';
    octx.strokeStyle = s.color; octx.lineWidth = s.size;
    octx.beginPath();
    s.points.forEach((p,i)=> i? octx.lineTo(p.x,p.y): octx.moveTo(p.x,p.y));
    if (s.points.length===1){ octx.lineTo(s.points[0].x+0.01, s.points[0].y+0.01); } // dot
    octx.stroke();
  }
  ctx.drawImage(off,0,0);
}
```
(`sketch._bgImg` = an `Image` loaded from `bg` in Step 1; if none, skip.)

- [ ] **Step 3 — pointer input (coordinate mapping accounts for CSS scaling).**
```js
function canvasPoint(e){
  const c = document.getElementById('sketchCanvas'); const r = c.getBoundingClientRect();
  return { x:(e.clientX-r.left)*(c.width/r.width), y:(e.clientY-r.top)*(c.height/r.height) };
}
function onPointerDown(e){ sketch.drawing=true; sketch.cur={ points:[canvasPoint(e)], color:sketch.color, size:sketch.size, eraser:sketch.tool==='eraser' }; e.target.setPointerCapture?.(e.pointerId); }
function onPointerMove(e){ if(!sketch.drawing) return; sketch.cur.points.push(canvasPoint(e)); renderStrokePreview(); }
function onPointerUp(){ if(!sketch.drawing) return; sketch.drawing=false; if(sketch.cur.points.length){ sketch.strokes.push(sketch.cur);} sketch.cur=null; renderSketch(); }
```
`renderStrokePreview()` may call `renderSketch()` then draw `sketch.cur` for live feedback (acceptable for MVP). Expose `__sketchAddStroke(stroke)` on the controller for harness testing (pushes to strokes + renders).

- [ ] **Step 4 — tools/undo/clear.** Clicking a `.sketch-swatch`/`.sketch-size`/pen/eraser updates `sketch` + `.active` class. `#sketchUndo` → `sketch.strokes.pop(); renderSketch();`. `#sketchClear` → `sketch.strokes=[]; renderSketch();` (keeps bg).

- [ ] **Step 5 — load screenshot.** `#sketchLoadShot` → `const shot = await browser.tabs.captureVisibleTab(null,{format:'jpeg',quality:60});` load into `sketch._bgImg`, set `sketch.bg=shot`, resize canvas to image (cap 1600), `renderSketch()`. try/catch with toast on failure.

- [ ] **Step 6 — save.**
```js
async function saveSketch(){
  const c = document.getElementById('sketchCanvas');
  const png = c.toDataURL('image/png');
  await BoxyDB.setSketch(sketch.itemId, { strokes:sketch.strokes, bg:sketch.bg, width:c.width, height:c.height, updatedAt:Date.now() });
  await BoxyDB.setPreview(sketch.itemId, png);              // thumbnail
  if (sketch.isNew){
    state.items.unshift({ id:sketch.itemId, type:'sketch', name:'Sketch '+new Date().toLocaleDateString(),
      url:'', preview:png, note:'', folder: state.currentFolder||'All Items',
      created:Date.now(), accessed:Date.now(), alarm:null, hasSketch:true });
  } else {
    const it = state.items.find(i=>i.id===sketch.itemId); if(it){ it.preview=png; it.hasSketch=true; it.accessed=Date.now(); }
  }
  await saveData(); closeSketch(); renderItems(); showToast('Sketch saved');
}
```
(`new Date()` is fine in extension runtime — the Date restriction only applies to Workflow scripts.)

- [ ] **Step 7 — wiring & lifecycle.** In `setupEventListeners`: bind `#newSketchBtn`→openNewSketch, `#sketchItemBtn`→`openSketchForItem(state.currentEditingItem)`, `#sketchCancel`/backdrop→closeSketch, `#sketchSave`→saveSketch, toolbar buttons, `#sketchCanvas` pointerdown/move/up (+pointerleave→onPointerUp). In `openEditModal`: show `#sketchItemBtn` always (label "Sketch" if `!item.hasSketch` else "Edit sketch"). In `deleteWithUndo` finalize: add `await BoxyDB.deleteSketch(item.id)`. In `loadData` orphan sweep: also sweep sketch ids via `getAllSketchIds()`.

- [ ] **Step 8 (verify):** Harness:
  1. `openNewSketch()`; push 3 strokes via `__sketchAddStroke`; assert `sketch.strokes.length===3`.
  2. undo → 2; clear → 0 (bg retained if set).
  3. eraser stroke stored with `eraser:true`.
  4. `saveSketch()` → `getSketch(id)` returns 3-... (re-add) strokes; item exists with `type:'sketch'`, `hasSketch:true`; `getPreview(id)` returns a `data:image/png` URL; item appears in list.
  5. Reopen via `openSketchForItem(item)` → `sketch.strokes.length` matches saved; bg restored.
  6. Delete item + finalize → `getSketch(id)` null.

---

### Task 4: Full-flow regression check

- [ ] **Step 1 (verify):** In one harness run, confirm no `window.__errors`; Phase-1/2/#4 still work: save a normal item (preview→IndexedDB), archive toggle still present, export still runs, undo-delete still works. Confirm `node --check` passes on db.js and popup.js.

---

## Self-Review

- **Spec coverage:** vector strokes (T3), PNG thumbnail (T3.6), `sketches` store v3 (T1), both entry points (T2/T3.1,7), essentials toolbar (T2/T3.4), Pointer Events (T3.3), eraser-only-removes-strokes (T3.2), scrollable larger canvas (T2.3/T3.1), delete+orphan sweep (T3.7), export exclusion (unchanged → sketches not added to export; OK per spec). ✓
- **Placeholder scan:** none.
- **Type consistency:** `setSketch/getSketch/deleteSketch/getAllSketchIds` used consistently T1↔T3; `sketch` state keys consistent; DOM ids from T2 match T3. ✓
