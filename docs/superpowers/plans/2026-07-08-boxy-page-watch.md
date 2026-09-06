# Page-Watch (#5) — Design + Plan

> No-build vanilla MV3. Verify via Chrome mock-harness. Line 1 shim in every JS file. UI text ENGLISH; comments may be PT. Don't break Phase 1/2/#4/#11/#3 (IndexedDB v3 previews/archives/sketches, detectContent, saveHighlight, export/import, undo-delete, sketch controller + __sketch hooks, review banner + review-check alarm).

## Design (decisions locked)

**Goal:** Notify when a watched page's content changes (price drop, new chapter, edital update).

**Model — add optional `watch` to items** (storage.local metadata, small):
```
watch: { enabled: Boolean, lastHash: Number|null, lastChecked: Number, changedAt: Number|null }
```
- Enabling sets `{ enabled:true, lastHash:null, lastChecked:0, changedAt:null }`.

**Change detection (background, NO DOM — service workers lack DOMParser):**
- `fetch(url)` (extension host_permissions `<all_urls>` bypasses CORS) → text.
- Clean with regex (no DOM): remove `<script...>...</script>` and `<style...>...</style>`, strip all `<...>` tags, collapse whitespace, take first ~100k chars.
- Hash with a small deterministic string hash (FNV-1a style) → Number.
- Compare to `lastHash`. If `lastHash !== null` and hash differs → CHANGED: set `changedAt = now`, fire one notification. Always update `lastHash` + `lastChecked`.
- Honest limitation (documented in-code + report): whole-page text hashing can false-positive on pages with rotating content (ads, timestamps). Selector-scoped watching is future work.

**Scheduling:** `watch-check` alarm `periodInMinutes: 180`; on fire, `checkWatches()` iterates items with `watch.enabled`.

**UI (popup):**
- Edit modal: a "Watch for changes" checkbox `#watchToggle` (only meaningful when the item has a url). Toggling sets/clears `item.watch`.
- Card indicator: if `item.watch?.changedAt && item.watch.changedAt > (item.accessed||0)` → show a small "changed" badge (🔔) in the card meta. Opening/editing the item updates `accessed`, clearing the badge naturally.

**Out of scope:** per-selector watch, custom intervals UI, diff preview. YAGNI.

## Files
- `popup.html` — `#watchToggle` in edit modal.
- `popup.js` — reflect/lower watch state in openEditModal + save; card "changed" badge in `createItemCard`/`createAlarmBadgeElement` area.
- `background.js` — `watch-check` alarm + `checkWatches()` + `cleanHtmlToText()` + `hashString()`.

---

### Task 1: Background change-detection engine

**Files:** Modify `background.js`.

**Interfaces — Produces:** `hashString(str)→Number`, `cleanHtmlToText(html)→String`, `async checkWatches()`.

- [ ] **Step 1:** Add helpers near top:
```js
function hashString(str){ let h=0x811c9dc5; for(let i=0;i<str.length;i++){ h^=str.charCodeAt(i); h=Math.imul(h,0x01000193); } return h>>>0; }
function cleanHtmlToText(html){
  return html
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/\s+/g,' ')
    .trim()
    .slice(0,100000);
}
```
- [ ] **Step 2:** Add `checkWatches()`:
```js
async function checkWatches(){
  const d = await chrome.storage.local.get(['items']);
  const items = d.items || [];
  let changed = false;
  for (const it of items){
    if (!it.watch || !it.watch.enabled || !it.url) continue;
    try {
      const res = await fetch(it.url, { cache:'no-store' });
      const html = await res.text();
      const hash = hashString(cleanHtmlToText(html));
      if (it.watch.lastHash !== null && it.watch.lastHash !== hash){
        it.watch.changedAt = Date.now();
        chrome.notifications.create('watch-'+it.id, { type:'basic', iconUrl:'icons/icon128.png', title:'Boxy', message:'Page changed: '+it.name, priority:1 });
      }
      it.watch.lastHash = hash;
      it.watch.lastChecked = Date.now();
      changed = true;
    } catch(e){ console.error('watch fetch failed', it.url, e); }
  }
  if (changed) await chrome.storage.local.set({ items });
}
```
- [ ] **Step 3:** Create the alarm at load near `cleanup-check`/`review-check`: `chrome.alarms.create('watch-check', { periodInMinutes: 180 });` and add a `'watch-check'` branch to the existing second `onAlarm` listener calling `checkWatches()`.
- [ ] **Step 4 (verify):** bg harness — mock `fetch` returning fixed HTML; seed a watched item with `lastHash:null` → after `checkWatches()`, `lastHash` set, NO notification (first run). Change the mock HTML, run again → notification `Page changed: <name>` and `changedAt` set. Non-watched/urlless items skipped. `hashString` deterministic; `cleanHtmlToText` strips script/style/tags.

---

### Task 2: Popup watch toggle + changed badge

**Files:** Modify `popup.html`, `popup.js`, `popup.css`.

**Produces DOM id:** `#watchToggle` (checkbox in edit modal).

- [ ] **Step 1:** popup.html — add in `#editModal` body (after the alarm group), a `.checkbox-label` with `#watchToggle` and label "Watch for changes" (reuse the alarm-toggle markup pattern, bell/eye SVG optional).
- [ ] **Step 2:** popup.js `openEditModal(item)`: set `#watchToggle.checked = !!item.watch?.enabled`. Only enable the control if `item.url` (else disable + uncheck).
- [ ] **Step 3:** popup.js — wire `#watchToggle` change in `setupEventListeners`:
```js
const watchToggle=document.getElementById('watchToggle');
if(watchToggle) watchToggle.addEventListener('change', async (e)=>{
  const it=state.currentEditingItem; if(!it) return;
  if(e.target.checked) it.watch={ enabled:true, lastHash:null, lastChecked:0, changedAt:null };
  else if(it.watch) it.watch.enabled=false;
  await saveData();
});
```
- [ ] **Step 4:** popup.js `createItemCard(item)` — in the meta row, if `item.watch?.changedAt && item.watch.changedAt > (item.accessed||0)`, append a small badge element (textContent '🔔 changed', class `watch-badge`).
- [ ] **Step 5:** popup.css — `.watch-badge { font-size:11px; color:var(--accent-primary); }` (verify var name).
- [ ] **Step 6 (verify):** popup harness — enable watch on an item via `#watchToggle` → `item.watch.enabled===true`; item with `watch.changedAt > accessed` shows the 🔔 badge on its card; toggling off sets `enabled:false`.

---

### Task 3: Regression

- [ ] **Step 1 (verify):** No `window.__errors`; save/edit/delete, review banner, sketch, archive still work; `node --check` passes on popup.js and background.js.

## Self-review
- Coverage: engine+alarm (T1), toggle+badge (T2). ✓
- No placeholders; `watch` shape + `hashString`/`cleanHtmlToText`/`checkWatches` consistent. ✓
- Cross-browser: regex clean avoids missing DOMParser in SW; fetch allowed by host_permissions. ✓
- YAGNI: whole-page hash, fixed 180-min interval, single notification per change. ✓
