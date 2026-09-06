# Local Intelligence v1 (#1 smart search + #2 related-to-page) — Design + Plan

> No-build vanilla MV3. Verify via Chrome mock-harness. Line 1 shim in every JS file. UI text ENGLISH; comments may be PT. Don't break Phase 1/2/3/4/#4/#11 (IndexedDB v3, detectContent/extractArticle, saveHighlight, export/import, undo-delete, sketch + __sketch hooks, review banner + review-check, watch + watch-check).

## Design decision (documented)

True semantic embeddings in a no-build MV3 extension require a ~25MB bundled model (transformers.js + WASM + Chrome offscreen document + CSP risk) OR a remote API (breaks offline/privacy/no-key). **v1 uses a lightweight local TF-IDF index** — fully offline, instant, no build, no deps. It delivers relevance-ranked search over saved items and a "Related to this page" surface. Ranks by term relevance, not deep meaning (so "sourdough" won't match "fermentação"). True embeddings are a Phase-6 upgrade (that era already adds heavier infra). This slice is explicitly labeled v1.

**Corpus per item (v1):** `name + ' ' + note`. (Archive full text and true embeddings = future upgrade; keeps popup load cheap and avoids bulk IndexedDB reads.)

## Components

- **`search.js` (new, included before popup.js):** pure functions on `globalThis.BoxySearch`:
  - `tokenize(text)` → lowercased tokens, strip punctuation, split on non-word, drop a small PT+EN stopword set, drop len<2.
  - `buildIndex(docs)` where `docs=[{id,text}]` → `{ N, df:Map, docs:[{id, tf:Map, len}] }`.
  - `score(index, queryText)` → `[{id, score}]` sorted desc; score = Σ over query tokens of `tf(t,doc) * idf(t)`, `idf = Math.log(1 + N/(1+df))`. Items with score>0 only.
- **#1 smart search:** in `renderItems`, when `state.searchQuery` is set, rank the filtered items by `BoxySearch.score` (relevance order) instead of leaving them in insertion order; keep the substring path as a fallback so a query with no token hits still filters. (Global search already implemented.)
- **#2 related-to-page:** on popup `init`, read the current tab's text (reuse `browser.tabs.sendMessage(tab.id,{action:'detectContent'})` → `snippet`, plus title); score it against the index; take top 3 with score above a small threshold, excluding items whose own url === current tab url; render a "Related to this page" box.

## Files
- `search.js` (new)
- `popup.html` — include `search.js`; add `#relatedBox` (top of `.main-container`, before `#reviewBanner`)
- `popup.js` — build index; use ranking in `renderItems`; compute+render related on init
- `popup.css` — `#relatedBox` styles

---

### Task 1: `search.js` — TF-IDF index + scoring

**Files:** Create `search.js`.

**Produces:** `globalThis.BoxySearch = { tokenize, buildIndex, score }`.

- [ ] **Step 1:** Create `search.js` (line 1 = shim, though it uses no browser APIs — keep convention). Implement:
```js
globalThis.browser ??= globalThis.chrome;
(function(){
  const STOP = new Set(('a o e de da do das dos um uma para por com que no na em os as se ao à the of and to in is it for on with that this at be or an as your you').split(' '));
  function tokenize(text){
    return (text||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')
      .split(/[^a-z0-9]+/).filter(t=>t.length>=2 && !STOP.has(t));
  }
  function buildIndex(docs){
    const df=new Map(); const D=[];
    for(const d of docs){ const tf=new Map(); const toks=tokenize(d.text);
      for(const t of toks) tf.set(t,(tf.get(t)||0)+1);
      for(const t of tf.keys()) df.set(t,(df.get(t)||0)+1);
      D.push({id:d.id, tf, len:toks.length}); }
    return { N:D.length, df, docs:D };
  }
  function score(index, queryText){
    const q=tokenize(queryText); if(!q.length) return [];
    const out=[];
    for(const doc of index.docs){ let s=0;
      for(const t of q){ const tf=doc.tf.get(t); if(!tf) continue;
        const idf=Math.log(1 + index.N/(1+(index.df.get(t)||0))); s+=tf*idf; }
      if(s>0) out.push({id:doc.id, score:s}); }
    return out.sort((a,b)=>b.score-a.score);
  }
  globalThis.BoxySearch = { tokenize, buildIndex, score };
})();
```
- [ ] **Step 2 (verify):** harness — `buildIndex([{id:'1',text:'javascript async await promises'},{id:'2',text:'brazilian sourdough bread recipe'}])`; `score(idx,'async promises')[0].id==='1'`; `score(idx,'bread recipe')[0].id==='2'`; `score(idx,'zzz')` is `[]`; stopwords/accents handled (`tokenize('É a de código')` → `['codigo']`).

---

### Task 2: #1 relevance-ranked search

**Files:** Modify `popup.html` (include search.js before popup.js), `popup.js`.

- [ ] **Step 1:** popup.html — add `<script src="search.js"></script>` immediately before `<script src="db.js"></script>`.
- [ ] **Step 2:** popup.js — add a module-level `let searchIndex=null;` and `function rebuildSearchIndex(){ searchIndex = BoxySearch.buildIndex(state.items.map(i=>({id:i.id, text:(i.name||'')+' '+(i.note||'')}))); }`. Call it at the end of `loadData()` and after every `saveData()` that changes items (simplest: call inside `renderItems()` before filtering — cheap for typical sizes).
- [ ] **Step 3:** popup.js `renderItems()` — after the existing filters, when `state.searchQuery`, reorder `filtered` by relevance:
```js
if (state.searchQuery && searchIndex){
  const ranked = BoxySearch.score(searchIndex, state.searchQuery);
  const rank = new Map(ranked.map((r,i)=>[r.id,i]));
  filtered.sort((a,b)=>(rank.has(a.id)?rank.get(a.id):1e9)-(rank.has(b.id)?rank.get(b.id):1e9));
}
```
(The substring filter already narrowed `filtered`; this just orders by relevance. Keep substring filter as-is so zero-token queries still work.)
- [ ] **Step 4 (verify):** harness — seed 3 items; type a multi-word query in `#searchInput`; the most relevant item appears first in `#itemsList`.

---

### Task 3: #2 related-to-page box

**Files:** Modify `popup.html`, `popup.css`, `popup.js`.

**Produces DOM id:** `#relatedBox`, `#relatedList`.

- [ ] **Step 1:** popup.html — before `#reviewBanner` inside `.main-container`:
```html
<div class="related-box" id="relatedBox" style="display:none;">
  <div class="related-title">Related to this page</div>
  <div id="relatedList"></div>
</div>
```
- [ ] **Step 2:** popup.css — `.related-box{margin:8px;padding:10px 12px;border:1px solid var(--border-color);border-radius:10px;}` `.related-title{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-secondary);margin-bottom:6px;}` `.related-item{display:block;width:100%;text-align:left;background:none;border:none;color:var(--text-primary);padding:4px 0;cursor:pointer;font-size:13px;}`
- [ ] **Step 3:** popup.js — new `async function renderRelated()` called at end of `init()` (after first render):
```js
async function renderRelated(){
  const box=document.getElementById('relatedBox'), list=document.getElementById('relatedList');
  if(!box||!list) return;
  let pageText='', pageUrl='';
  try{ const [tab]=await browser.tabs.query({active:true,currentWindow:true}); pageUrl=tab?.url||'';
    const r=await browser.tabs.sendMessage(tab.id,{action:'detectContent'}); pageText=((tab?.title||'')+' '+(r?.snippet||'')).trim();
  }catch(e){ box.style.display='none'; return; }
  if(!pageText || !searchIndex){ box.style.display='none'; return; }
  const ranked=BoxySearch.score(searchIndex, pageText)
    .filter(x=>{ const it=state.items.find(i=>i.id===x.id); return it && it.url!==pageUrl; })
    .slice(0,3);
  if(!ranked.length){ box.style.display='none'; return; }
  list.textContent='';
  for(const r of ranked){ const it=state.items.find(i=>i.id===r.id); if(!it) continue;
    const btn=document.createElement('button'); btn.className='related-item'; btn.textContent=it.name;
    btn.addEventListener('click',()=>openEditModal(it)); list.appendChild(btn); }
  box.style.display='block';
}
```
- [ ] **Step 4 (verify):** harness — mock `tabs.sendMessage` to return a snippet matching one seeded item; after `init()` (or calling `renderRelated()`), `#relatedBox` visible with that item; mock a non-matching snippet → box hidden; an item whose url === current tab url is excluded.

---

### Task 4: Regression

- [ ] **Step 1 (verify):** No `window.__errors`; save/edit/delete, review banner, watch toggle, sketch, archive all still work; `node --check` passes on search.js and popup.js.

## Self-review
- Coverage: index/score (T1), ranked search (T2), related box (T3). ✓
- No placeholders; `BoxySearch.{tokenize,buildIndex,score}` + `searchIndex`/`rebuildSearchIndex`/`renderRelated` consistent. ✓
- YAGNI: name+note corpus, top-3 related, TF-IDF (no model). Embeddings + archive-text indexing = documented future upgrade. ✓
