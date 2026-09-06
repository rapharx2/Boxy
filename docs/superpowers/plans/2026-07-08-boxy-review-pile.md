# Five-Minute Pile / Spaced Repetition (#3) — Design + Plan

> No-build vanilla MV3. Verify via Chrome mock-harness (no unit runner). Line 1 shim in every JS file. UI text ENGLISH; comments may be PT. Don't break Phase 1/2/#4/#11 (previews/archives/sketches IndexedDB v3, detectContent, saveHighlight, export/import, undo-delete, sketch).

## Design (decisions locked)

**Goal:** Resurface old saved items so they actually get revisited instead of rotting in the pile.

**Model — add a `review` field to items** (lives in storage.local metadata, small):
```
review: { interval: Number(days), dueAt: Number(ts), done: Boolean }
```
- An item is **due** when `review && !review.done && review.dueAt <= Date.now()`.
- **New items** initialize `review = { interval: 1, dueAt: created + 1 day, done: false }` — set in BOTH popup `saveItem()` and background `saveToBoxy()`.
- **Legacy backfill:** in `loadData()`, any item lacking `review` gets `review = { interval:1, dueAt: Date.now(), done:false }` (due now); persist once if any were backfilled.

**Intervals (spaced repetition):** `[1, 3, 7, 30, 90]` days. Advancing picks the next value up (caps at 90).

**Surfacing UI (popup):** a **Review banner** at the top of the list, visible only when ≥1 item is due. Shows the MOST overdue item at a time:
- Text: "Revisit: <item name>" + a small count "N to review".
- Buttons: **Open** (open url in a tab if present, then ADVANCE: interval = next step, dueAt = now + interval*day), **Later** (snooze: dueAt = now + interval*day, interval unchanged), **Done** (review.done = true — never due again).
- After any action: recompute due list, show next due item or hide banner.

**Daily nudge (background):** a `review-check` alarm (`periodInMinutes: 1440`, created at load) reads items, counts due, and if >0 shows ONE basic notification "Boxy — N items to revisit" (Firefox-safe options, like existing notifications). No spam beyond once/day.

**Out of scope:** custom intervals UI, per-folder review, streaks. YAGNI.

## Files
- `popup.html` — review banner markup at top of `.main-container` (before `#itemsList`).
- `popup.css` — banner styles.
- `popup.js` — due computation, banner render + actions, review init on save, legacy backfill.
- `background.js` — default review in `saveToBoxy`; `review-check` daily alarm + notification.

---

### Task 1: Review model — init on save + legacy backfill

**Files:** Modify `popup.js` (`saveItem`, `loadData`), `background.js` (`saveToBoxy`).

- [ ] **Step 1:** Add a helper near the top of popup.js:
```js
const REVIEW_STEPS = [1, 3, 7, 30, 90];
const DAY = 86400000;
function nextInterval(cur){ const i = REVIEW_STEPS.indexOf(cur); return REVIEW_STEPS[Math.min(i+1, REVIEW_STEPS.length-1)] ?? REVIEW_STEPS[REVIEW_STEPS.length-1]; }
function isDue(item){ return item.review && !item.review.done && item.review.dueAt <= Date.now(); }
```
- [ ] **Step 2:** In `saveItem()`, when building `item`, add `review: { interval:1, dueAt: Date.now()+DAY, done:false }`.
- [ ] **Step 3:** In background.js `saveToBoxy`, add the same default `review` to the item defaults.
- [ ] **Step 4:** In `loadData()`, after items load (before render), backfill: `let bf=false; state.items.forEach(i=>{ if(!i.review){ i.review={interval:1,dueAt:Date.now(),done:false}; bf=true; } }); if(bf) await saveData();`
- [ ] **Step 5 (verify):** Harness — new saved item has `review.interval===1` and `dueAt≈now+DAY`; a seeded legacy item (no review) gets `review` after load with `dueAt<=now`.

---

### Task 2: Review banner UI + actions

**Files:** Modify `popup.html`, `popup.css`, `popup.js` (`renderItems` or a new `renderReviewBanner`, wired in `setupEventListeners`; call `renderReviewBanner()` inside `renderItems()`).

**Interfaces — Produces DOM ids:** `#reviewBanner` (hidden by default), `#reviewName`, `#reviewCount`, `#reviewOpen`, `#reviewLater`, `#reviewDone`.

- [ ] **Step 1:** popup.html — add before `#itemsList`:
```html
<div class="review-banner" id="reviewBanner" style="display:none;">
  <div class="review-info"><span class="review-eyebrow">Revisit <span id="reviewCount"></span></span><span class="review-name" id="reviewName"></span></div>
  <div class="review-actions">
    <button class="btn-secondary" id="reviewLater">Later</button>
    <button class="btn-secondary" id="reviewDone">Done</button>
    <button class="btn-primary" id="reviewOpen">Open</button>
  </div>
</div>
```
- [ ] **Step 2:** popup.css — `.review-banner { display:flex; justify-content:space-between; align-items:center; gap:8px; padding:10px 12px; margin:8px; border-radius:10px; background:var(--accent-soft, rgba(0,0,0,.05)); border:1px solid var(--border-color); }` `.review-eyebrow{font-size:11px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.05em;}` `.review-name{display:block;font-weight:600;color:var(--text-primary);}` `.review-actions{display:flex;gap:6px;}` buttons compact (`padding:6px 10px;width:auto;`). (Inspect popup.css for exact var names; reuse existing button classes.)
- [ ] **Step 3:** popup.js — `renderReviewBanner()`:
```js
function renderReviewBanner(){
  const b=document.getElementById('reviewBanner'); if(!b) return;
  const due=state.items.filter(isDue).sort((a,b)=>a.review.dueAt-b.review.dueAt);
  if(!due.length){ b.style.display='none'; b._id=null; return; }
  const it=due[0]; b._id=it.id;
  document.getElementById('reviewName').textContent=it.name;
  document.getElementById('reviewCount').textContent='· '+due.length+' to review';
  b.style.display='flex';
}
```
Call `renderReviewBanner()` at the end of `renderItems()`.
- [ ] **Step 4:** popup.js — wire actions in `setupEventListeners` (use `#reviewBanner`._id to find the current item):
```js
function currentReviewItem(){ const b=document.getElementById('reviewBanner'); return state.items.find(i=>i.id===b._id); }
async function reviewOpen(){ const it=currentReviewItem(); if(!it) return; if(it.url) browser.tabs.create({url:it.url}); it.review.interval=nextInterval(it.review.interval); it.review.dueAt=Date.now()+it.review.interval*DAY; it.accessed=Date.now(); await saveData(); renderItems(); }
async function reviewLater(){ const it=currentReviewItem(); if(!it) return; it.review.dueAt=Date.now()+it.review.interval*DAY; await saveData(); renderItems(); }
async function reviewDone(){ const it=currentReviewItem(); if(!it) return; it.review.done=true; await saveData(); renderItems(); }
```
Bind `#reviewOpen`/`#reviewLater`/`#reviewDone`.
- [ ] **Step 5 (verify):** Harness — seed 2 items due (dueAt in past) + 1 not due; banner shows most-overdue, count "2 to review". Click **Later** → that item's dueAt in future, banner shows the other due item. Click **Done** → item.review.done true, not shown. Click **Open** on last → tabs.create called, interval advanced 1→3, dueAt≈now+3d, banner hides.

---

### Task 3: Daily nudge (background)

**Files:** Modify `background.js`.

- [ ] **Step 1:** At load (near the existing `cleanup-check` alarm), add `chrome.alarms.create('review-check', { periodInMinutes: 1440 });`
- [ ] **Step 2:** In the existing `onAlarm` handling, add a branch for `'review-check'` → `checkReviewDue()`:
```js
async function checkReviewDue(){
  const d = await chrome.storage.local.get(['items']);
  const now = Date.now();
  const due = (d.items||[]).filter(i => i.review && !i.review.done && i.review.dueAt <= now);
  if (due.length){
    chrome.notifications.create('review-nudge', { type:'basic', iconUrl:'icons/icon128.png', title:'Boxy', message: due.length+' item(s) to revisit', priority:1 });
  }
}
```
(Firefox-safe: basic type, no buttons/requireInteraction.)
- [ ] **Step 3 (verify):** Harness loads background.js with mock chrome; invoke the `review-check` onAlarm callback with seeded due items in mock storage → a `review-nudge` notification is created with the right count; with no due items → no notification.

---

### Task 4: Regression

- [ ] **Step 1 (verify):** No `window.__errors`; saving/editing/deleting still work; `node --check` passes on popup.js and background.js.

## Self-review
- Coverage: model+init (T1), banner+3 actions+spaced intervals (T2), daily nudge (T3). ✓
- No placeholders; `isDue`/`nextInterval`/`REVIEW_STEPS`/`review` shape consistent across tasks. ✓
- YAGNI: single-item banner, fixed intervals, once-daily nudge. ✓
