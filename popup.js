globalThis.browser ??= globalThis.chrome;
// Global state
let state = {
  items: [],
  folders: ['All Items'],
  theme: 'auto',
  currentTab: 'all',
  currentFolder: 'All Items',
  searchQuery: '',
  currentPageData: null,
  currentEditingItem: null
};

// Ícones SVG
const ICONS = {
  trash: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`,
  bell: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>`
};

// Local Intelligence v1 (#1/#2): índice TF-IDF sobre name+note dos itens
let searchIndex = null;
function rebuildSearchIndex() {
  searchIndex = BoxySearch.buildIndex(state.items.map(i => ({ id: i.id, text: (i.name || '') + ' ' + (i.note || '') })));
}

// Revisão espaçada (#3): intervalos em dias e helpers de vencimento
const REVIEW_STEPS = [1, 3, 7, 30, 90];
const DAY = 86400000;
function nextInterval(cur){ const i = REVIEW_STEPS.indexOf(cur); return REVIEW_STEPS[Math.min(i+1, REVIEW_STEPS.length-1)] ?? REVIEW_STEPS[REVIEW_STEPS.length-1]; }
// Sketches e imagens não entram na fila de revisão (não faz sentido "revisar" um desenho/foto)
function isReviewable(item){ return item.type !== 'sketch' && item.type !== 'image' && !item.hasSketch; }
function isDue(item){ return isReviewable(item) && item.review && !item.review.done && item.review.dueAt <= Date.now(); }

document.addEventListener('DOMContentLoaded', init);

async function init() {
  await loadData();
  setupEventListeners();
  applyTheme();
  
  if (!state.currentFolder) state.currentFolder = 'All Items';
  
  renderItems();
  updateFolderDropdowns();
  renderRelated();
}

async function loadData() {
  const data = await chrome.storage.local.get(['items', 'folders', 'theme']);
  state.items = data.items || [];
  state.folders = data.folders || ['All Items'];
  state.theme = data.theme || 'auto';

  // Migração única: previews legados inline no storage.local vão para o IndexedDB
  let migrated = false;
  for (const item of state.items) {
    if (item.preview) {
      try {
        await BoxyDB.setPreview(item.id, item.preview);
        migrated = true;
      } catch (err) {
        console.error('Erro ao migrar preview para o IndexedDB:', err);
      }
    }
  }

  // Reanexa os previews do IndexedDB aos itens em memória
  let previews = {};
  try {
    previews = await BoxyDB.getAllPreviews();
  } catch (err) {
    console.error('Erro ao carregar previews do IndexedDB:', err);
  }
  state.items.forEach(item => {
    item.preview = item.preview || previews[item.id] || '';
  });

  // Limpa previews órfãos (de itens que já não existem)
  const ids = new Set(state.items.map(i => i.id));
  for (const pid of Object.keys(previews)) {
    if (!ids.has(pid)) {
      try { await BoxyDB.deletePreview(pid); } catch (err) { console.error(err); }
    }
  }

  // Limpa arquivos órfãos (texto completo de itens que já não existem)
  try {
    const archiveIds = await BoxyDB.getAllArchiveIds();
    for (const aid of archiveIds) {
      if (!ids.has(aid)) {
        try { await BoxyDB.deleteArchive(aid); } catch (err) { console.error(err); }
      }
    }
  } catch (err) {
    console.error('Erro ao varrer arquivos órfãos do IndexedDB:', err);
  }

  // Limpa sketches órfãos (desenhos de itens que já não existem)
  try {
    const sketchIds = await BoxyDB.getAllSketchIds();
    for (const sid of sketchIds) {
      if (!ids.has(sid)) {
        try { await BoxyDB.deleteSketch(sid); } catch (err) { console.error(err); }
      }
    }
  } catch (err) {
    console.error('Erro ao varrer sketches órfãos do IndexedDB:', err);
  }

  // Backfill (#3): itens antigos sem `review` ficam devidos agora
  let bf = false;
  state.items.forEach(i => {
    if (!i.review) {
      i.review = { interval: 1, dueAt: Date.now(), done: false };
      bf = true;
    }
  });

  // Re-salva os metadados sem os previews inline (persiste uma vez só)
  if (migrated || bf) await saveData();
}

async function saveData() {
  try {
    await chrome.storage.local.set({
      // Previews ficam só no IndexedDB — aqui salvamos apenas os metadados
      items: state.items.map(({ preview, ...rest }) => rest),
      folders: state.folders,
      theme: state.theme
    });
  } catch (err) {
    console.error('Erro ao salvar no storage.local:', err);
    showToast('Failed to save. Storage full?', 'error');
  }
}

function applyTheme() {
  const body = document.body;
  body.classList.remove('theme-dark', 'theme-light');
  
  if (state.theme === 'dark') {
    body.classList.add('theme-dark');
  } else if (state.theme === 'light') {
    body.classList.add('theme-light');
  } else {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    body.classList.add(isDark ? 'theme-dark' : 'theme-light');
  }
}

function setupEventListeners() {
  const fabBtn = document.getElementById('fabBtn');
  if(fabBtn) fabBtn.addEventListener('click', openSaveModal);

  const settingsBtn = document.getElementById('settingsBtn');
  if(settingsBtn) settingsBtn.addEventListener('click', openSettingsModal);
  
  const settingsClose = document.getElementById('settingsClose');
  if(settingsClose) settingsClose.addEventListener('click', closeSettingsModal);

  document.querySelectorAll('.settings-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.settings-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.settings-tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const content = document.getElementById(btn.dataset.tab + 'Tab');
      if(content) content.classList.add('active');
    });
  });

  const createFolderBtn = document.getElementById('createFolderBtn');
  if(createFolderBtn) createFolderBtn.addEventListener('click', createFolder);

  // "+ New folder…" inline nos dropdowns de salvar e editar
  wireNewFolderInline('itemFolder', 'itemFolderNew');
  wireNewFolderInline('editFolder', 'editFolderNew');

  const deleteAllBtn = document.getElementById('deleteAllBtn');
  if(deleteAllBtn) deleteAllBtn.addEventListener('click', deleteAllItems);

  const exportBtn = document.getElementById('exportBtn');
  if(exportBtn) exportBtn.addEventListener('click', exportBackup);

  const importBtn = document.getElementById('importBtn');
  const importFile = document.getElementById('importFile');
  if(importBtn && importFile) {
    importBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', importBackup);
  }

  // Event delegation para listas
  const foldersList = document.getElementById('foldersList');
  if(foldersList) {
    foldersList.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-delete-folder');
      if (btn) deleteFolder(btn.dataset.folder);
    });
  }

  const allItemsList = document.getElementById('allItemsList');
  if(allItemsList) {
    allItemsList.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-delete-item');
      if (btn) deleteItemById(btn.dataset.id);
    });
  }

  document.querySelectorAll('input[name="theme"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      state.theme = e.target.value;
      saveData();
      applyTheme();
    });
  });

  // Modal Save
  const modalClose = document.getElementById('modalClose');
  if(modalClose) modalClose.addEventListener('click', closeSaveModal);
  
  const modalCancel = document.getElementById('modalCancel');
  if(modalCancel) modalCancel.addEventListener('click', closeSaveModal);
  
  const modalSave = document.getElementById('modalSave');
  if(modalSave) modalSave.addEventListener('click', saveItem);

  const alarmToggle = document.getElementById('alarmToggle');
  if(alarmToggle) {
    alarmToggle.addEventListener('change', (e) => {
      const picker = document.getElementById('alarmPicker');
      if(picker) picker.style.display = e.target.checked ? 'block' : 'none';
    });
  }

  const itemNote = document.getElementById('itemNote');
  if(itemNote) {
    itemNote.addEventListener('input', (e) => {
      const charCount = document.getElementById('charCount');
      if(charCount) charCount.textContent = `${e.target.value.length}/500`;
    });
  }

  // Modal Edit
  const editModalClose = document.getElementById('editModalClose');
  if(editModalClose) editModalClose.addEventListener('click', closeEditModal);
  
  const editSave = document.getElementById('editSave');
  if(editSave) editSave.addEventListener('click', saveEditedItem);
  
  const editDelete = document.getElementById('editDelete');
  if(editDelete) editDelete.addEventListener('click', deleteCurrentItem);
  
  const editOpenLink = document.getElementById('editOpenLink');
  if(editOpenLink) editOpenLink.addEventListener('click', openItemLink);

  // Arquivo permanente: mostra/esconde o texto salvo no leitor
  const viewArchiveBtn = document.getElementById('viewArchiveBtn');
  if(viewArchiveBtn) {
    viewArchiveBtn.addEventListener('click', async () => {
      const reader = document.getElementById('archiveReader');
      if (!reader || !state.currentEditingItem) return;

      if (reader.style.display !== 'none') {
        reader.style.display = 'none';
        viewArchiveBtn.textContent = 'Read saved copy';
        return;
      }

      try {
        const archive = await BoxyDB.getArchive(state.currentEditingItem.id);
        if (archive && archive.text) {
          reader.textContent = archive.text;
          reader.style.display = 'block';
          viewArchiveBtn.textContent = 'Hide saved copy';
        } else {
          showToast('No archived text found for this item', 'error');
        }
      } catch (err) {
        console.error('Erro ao carregar arquivo do IndexedDB:', err);
        showToast('Failed to load the archived text', 'error');
      }
    });
  }

  const editAlarmToggle = document.getElementById('editAlarmToggle');
  if(editAlarmToggle) {
    editAlarmToggle.addEventListener('change', (e) => {
      const picker = document.getElementById('editAlarmPicker');
      if(picker) picker.style.display = e.target.checked ? 'block' : 'none';
    });
  }

  // Page-Watch (#5): liga/desliga a vigilância de mudanças da página
  const watchToggle = document.getElementById('watchToggle');
  if(watchToggle) watchToggle.addEventListener('change', async (e) => {
    const it = state.currentEditingItem; if(!it) return;
    if(e.target.checked) {
      it.watch = { enabled: true, lastHash: null, lastChecked: 0, changedAt: null };
      await saveData();
      // Baseline imediato: dá feedback visível de que o watch começou a valer agora
      renderWatchStatus(it, 'checking');
      try {
        const r = await browser.runtime.sendMessage({ action: 'watchNow', itemId: it.id });
        if (r && r.ok) { it.watch.lastChecked = r.lastChecked; renderWatchStatus(it, 'watching'); }
        else renderWatchStatus(it, 'error');
      } catch (err) { renderWatchStatus(it, 'error'); }
    } else {
      if(it.watch) it.watch.enabled = false;
      await saveData();
      renderWatchStatus(it, 'off');
    }
  });

  const editNote = document.getElementById('editNote');
  if(editNote) {
    editNote.addEventListener('input', (e) => {
      const charCount = document.getElementById('editCharCount');
      if(charCount) charCount.textContent = `${e.target.value.length}/500`;
    });
  }

  const searchInput = document.getElementById('searchInput');
  if(searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value.toLowerCase();
      renderItems();
    });
  }

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      const type = btn.dataset.type;
      if (type === 'folders') {
        state.currentTab = 'folders';
      } else {
        state.currentTab = type;
        if (!state.currentFolder) state.currentFolder = 'All Items';
      }
      renderItems();
    });
  });

  // Revisão espaçada (#3): chip minimalista — clicar abre/avança, ✕ dispensa (adia + esconde na sessão)
  const reviewOpenBtn = document.getElementById('reviewOpen');
  if(reviewOpenBtn) reviewOpenBtn.addEventListener('click', reviewOpen);

  const reviewDismissBtn = document.getElementById('reviewDismiss');
  if(reviewDismissBtn) reviewDismissBtn.addEventListener('click', reviewDismiss);

  // Sketch (#11): entradas, toolbar e canvas
  const newSketchBtn = document.getElementById('newSketchBtn');
  if(newSketchBtn) newSketchBtn.addEventListener('click', openNewSketch);

  const sketchItemBtn = document.getElementById('sketchItemBtn');
  if(sketchItemBtn) {
    sketchItemBtn.addEventListener('click', () => {
      const item = state.currentEditingItem;
      if (!item) return;
      closeEditModal();
      openSketchForItem(item);
    });
  }

  const sketchCancel = document.getElementById('sketchCancel');
  if(sketchCancel) sketchCancel.addEventListener('click', closeSketch);

  const sketchSaveBtn = document.getElementById('sketchSave');
  if(sketchSaveBtn) sketchSaveBtn.addEventListener('click', saveSketch);

  const sketchToolPen = document.getElementById('sketchToolPen');
  if(sketchToolPen) sketchToolPen.addEventListener('click', () => setSketchTool('pen'));

  const sketchToolEraser = document.getElementById('sketchToolEraser');
  if(sketchToolEraser) sketchToolEraser.addEventListener('click', () => setSketchTool('eraser'));

  const sketchUndo = document.getElementById('sketchUndo');
  if(sketchUndo) sketchUndo.addEventListener('click', () => { sketch.strokes.pop(); renderSketch(); });

  const sketchClear = document.getElementById('sketchClear');
  if(sketchClear) sketchClear.addEventListener('click', () => { sketch.strokes = []; renderSketch(); });

  const sketchLoadShot = document.getElementById('sketchLoadShot');
  if(sketchLoadShot) sketchLoadShot.addEventListener('click', sketchLoadScreenshot);

  document.querySelectorAll('#sketchColors .sketch-swatch').forEach(btn => {
    btn.addEventListener('click', () => {
      sketch.color = btn.dataset.color;
      updateSketchToolbarUI();
    });
  });

  document.querySelectorAll('#sketchSizes .sketch-size').forEach(btn => {
    btn.addEventListener('click', () => {
      sketch.size = Number(btn.dataset.size);
      updateSketchToolbarUI();
    });
  });

  const sketchCanvas = document.getElementById('sketchCanvas');
  if(sketchCanvas) {
    sketchCanvas.addEventListener('pointerdown', onSketchPointerDown);
    sketchCanvas.addEventListener('pointermove', onSketchPointerMove);
    sketchCanvas.addEventListener('pointerup', onSketchPointerUp);
    sketchCanvas.addEventListener('pointerleave', onSketchPointerUp);
  }

  // Visualizador de imagem/sketch (#7)
  const imageViewerClose = document.getElementById('imageViewerClose');
  if(imageViewerClose) imageViewerClose.addEventListener('click', closeImageViewer);
  const imageViewerEdit = document.getElementById('imageViewerEdit');
  if(imageViewerEdit) imageViewerEdit.addEventListener('click', () => {
    const it = viewerItem;
    closeImageViewer();
    if (it) openEditModal(it);
  });

  window.addEventListener('click', (e) => {
    if (e.target.id === 'saveModal') closeSaveModal();
    if (e.target.id === 'editModal') closeEditModal();
    if (e.target.id === 'settingsModal') closeSettingsModal();
    if (e.target.id === 'sketchModal') closeSketch();
    if (e.target.id === 'imageViewer') closeImageViewer(); // clique no fundo fecha
  });
}

// --- Funções de Pasta ---

async function createFolder() {
  const input = document.getElementById('newFolderInput');
  const name = input.value.trim();
  
  if (!name) { showToast('Invalid folder name', 'error'); return; }
  if (state.folders.includes(name)) { showToast('Folder already exists', 'error'); return; }
  
  state.folders.push(name);
  await saveData();
  input.value = '';
  renderFoldersList();
  updateFolderDropdowns();
  showToast('Folder created');
}

async function deleteFolder(folderName) {
  if (folderName === 'All Items') { showToast("Can't delete the default folder", 'error'); return; }
  if (!confirm(`Delete "${folderName}"? Its items will move to "All Items".`)) return;
  
  let movedCount = 0;
  state.items.forEach(item => {
    if (item.folder === folderName) {
      item.folder = 'All Items';
      movedCount++;
    }
  });
  
  state.folders = state.folders.filter(f => f !== folderName);
  if (state.currentFolder === folderName) state.currentFolder = 'All Items';
  
  await saveData();
  renderFoldersList();
  updateFolderDropdowns();
  renderItems();
  showToast(`Folder deleted. ${movedCount} items moved.`);
}

// --- Renderização Segura (DOM Manipulation) ---

function renderFoldersList() {
  const container = document.getElementById('foldersList');
  if(!container) return;
  container.textContent = ''; // Limpa seguramente
  
  state.folders.forEach(folder => {
    const count = state.items.filter(item => item.folder === folder).length;
    
    const div = document.createElement('div');
    div.className = 'folder-item';
    
    // Nome da pasta
    const spanName = document.createElement('span');
    spanName.className = 'folder-item-name';
    spanName.textContent = folder;
    div.appendChild(spanName);
    
    // Contagem
    const spanCount = document.createElement('span');
    spanCount.className = 'folder-item-count';
    spanCount.textContent = `${count} items`;
    div.appendChild(spanCount);
    
    // Ações
    const divActions = document.createElement('div');
    divActions.className = 'folder-item-actions';
    
    if (folder !== 'All Items') {
      const btn = document.createElement('button');
      btn.className = 'btn-icon btn-delete-folder';
      btn.dataset.folder = folder;
      btn.innerHTML = ICONS.trash; // SVG é seguro aqui pois é constante
      divActions.appendChild(btn);
    }
    
    div.appendChild(divActions);
    container.appendChild(div);
  });
}

function renderAllItemsList() {
  const container = document.getElementById('allItemsList');
  if(!container) return;
  container.textContent = '';
  
  if (state.items.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.style.padding = '20px';
    emptyMsg.style.textAlign = 'center';
    emptyMsg.style.color = 'var(--text-secondary)';
    emptyMsg.textContent = 'No items saved';
    container.appendChild(emptyMsg);
    return;
  }
  
  const grouped = {};
  state.items.forEach(item => {
    const f = item.folder || 'All Items';
    if (!grouped[f]) grouped[f] = [];
    grouped[f].push(item);
  });
  
  Object.entries(grouped).forEach(([folder, items]) => {
    const header = document.createElement('div');
    header.style.cssText = 'font-weight: 600; margin: 12px 0 8px; color: var(--text-primary);';
    header.textContent = folder;
    container.appendChild(header);
    
    items.forEach(item => {
      const div = document.createElement('div');
      div.className = 'settings-item';
      
      const spanName = document.createElement('span');
      spanName.className = 'settings-item-name';
      spanName.textContent = item.name;
      div.appendChild(spanName);
      
      const btn = document.createElement('button');
      btn.className = 'btn-icon btn-delete-item';
      btn.dataset.id = item.id;
      btn.innerHTML = ICONS.trash;
      div.appendChild(btn);
      
      container.appendChild(div);
    });
  });
}

// Banner de revisão (#3): mostra o item devido MAIS atrasado, com contagem
let reviewDismissed = false; // dispensado nesta sessão de popup
function renderReviewBanner(){
  const b = document.getElementById('reviewBanner'); if(!b) return;
  if(reviewDismissed){ b.style.display='none'; b._id=null; return; }
  const due = state.items.filter(isDue).sort((a,b)=>a.review.dueAt-b.review.dueAt);
  if(!due.length){ b.style.display='none'; b._id=null; return; }
  const it = due[0]; b._id = it.id;
  const txt = document.getElementById('reviewChipText');
  if(txt) txt.textContent = due.length + ' to revisit · ' + it.name;
  b.style.display = 'inline-flex';
}

function currentReviewItem(){
  const b = document.getElementById('reviewBanner');
  return state.items.find(i => i.id === b._id);
}

// Open: abre o link e avança o intervalo (1 → 3 → 7 → 30 → 90)
async function reviewOpen(){
  const it = currentReviewItem(); if(!it) return;
  if (it.url) browser.tabs.create({ url: it.url });
  it.review.interval = nextInterval(it.review.interval);
  it.review.dueAt = Date.now() + it.review.interval * DAY;
  it.accessed = Date.now();
  await saveData();
  renderItems();
}

// ✕ Dispensar: adia o item pelo intervalo atual (não reaparece já) e esconde o chip nesta sessão
async function reviewDismiss(){
  const it = currentReviewItem();
  if(it){ it.review.dueAt = Date.now() + it.review.interval * DAY; await saveData(); }
  reviewDismissed = true;
  renderItems();
}

// Related-to-page (#2): pontua o texto da aba atual contra o índice.
// Dois caminhos (definidos com o owner):
//  A) itens relacionados já estão numa pasta → só AVISA e oferece abrir a pasta;
//  B) itens relacionados estão soltos ("All Items") → sugere CRIAR uma pasta do tema.
async function renderRelated() {
  const box = document.getElementById('relatedBox');
  const titleEl = document.getElementById('relatedTitle');
  const bodyEl = document.getElementById('relatedBody');
  const actionsEl = document.getElementById('relatedActions');
  if (!box || !titleEl || !bodyEl || !actionsEl) return;
  titleEl.textContent = ''; bodyEl.textContent = ''; actionsEl.textContent = '';

  let pageText = '', pageUrl = '', pageTitle = '';
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    pageUrl = tab?.url || '';
    pageTitle = tab?.title || '';
    const r = await browser.tabs.sendMessage(tab.id, { action: 'detectContent' });
    pageText = ((pageTitle) + ' ' + (r?.snippet || '')).trim();
  } catch (e) {
    box.style.display = 'none';
    return;
  }
  if (!pageText || !searchIndex) { box.style.display = 'none'; return; }

  // Exige ao menos 2 termos DISTINTOS em comum: um único token coincidente
  // (ex.: o "2026" do nome auto de uma sketch batendo com "Copa 2026") não basta.
  const pageTerms = new Set(BoxySearch.tokenize(pageText));
  const sharedTerms = (it) => {
    let n = 0;
    for (const t of new Set(BoxySearch.tokenize((it.name || '') + ' ' + (it.note || ''))))
      if (pageTerms.has(t)) n++;
    return n;
  };

  // Itens relacionados (top-6 para decidir agrupamento), excluindo a própria página
  // e itens sem sobreposição real de conteúdo (>=2 termos).
  const related = BoxySearch.score(searchIndex, pageText)
    .map(x => state.items.find(i => i.id === x.id))
    .filter(it => it && it.url !== pageUrl && sharedTerms(it) >= 2)
    .slice(0, 6);
  if (!related.length) { box.style.display = 'none'; return; }

  const inFolder = related.filter(it => it.folder && it.folder !== 'All Items');
  const loose = related.filter(it => !it.folder || it.folder === 'All Items');
  const names = (arr) => arr.slice(0, 3).map(it => it.name).filter(Boolean).join(', ');

  if (inFolder.length) {
    // ── Caso A: já existe pasta sobre o assunto → apenas avisa
    const counts = {};
    for (const it of inFolder) counts[it.folder] = (counts[it.folder] || 0) + 1;
    const folder = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    const n = counts[folder];
    titleEl.textContent = 'You already saved items about this';
    bodyEl.textContent = `${n} related ${n === 1 ? 'item is' : 'items are'} in “${folder}”.`;
    const open = document.createElement('button');
    open.className = 'related-btn related-btn-primary';
    open.textContent = 'Open folder →';
    open.addEventListener('click', () => { box.style.display = 'none'; openFolderView(folder); });
    actionsEl.appendChild(open);
  } else {
    // ── Caso B: itens soltos → sugere criar uma pasta do tema
    const n = loose.length;
    titleEl.textContent = 'You saved items related to this';
    bodyEl.textContent = `${n} related ${n === 1 ? 'item' : 'items'} (${names(loose)}) — group them in a folder about this topic?`;

    const create = document.createElement('button');
    create.className = 'related-btn related-btn-primary';
    create.textContent = 'Create folder';
    const dismiss = document.createElement('button');
    dismiss.className = 'related-btn';
    dismiss.textContent = 'Dismiss';
    dismiss.addEventListener('click', () => { box.style.display = 'none'; });

    create.addEventListener('click', () => {
      // Passo de nomear: sugestão editável (definido com o owner)
      actionsEl.textContent = '';
      const input = document.createElement('input');
      input.className = 'related-name-input';
      input.type = 'text';
      input.value = suggestFolderName(pageTitle, pageText);
      input.setAttribute('aria-label', 'New folder name');
      const confirm = document.createElement('button');
      confirm.className = 'related-btn related-btn-primary';
      confirm.textContent = 'Create';
      const cancel = document.createElement('button');
      cancel.className = 'related-btn';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => { box.style.display = 'none'; });
      const doCreate = async () => {
        const name = input.value.trim();
        if (!name) { showToast('Invalid folder name', 'error'); return; }
        await createFolderWithItems(name, loose);
        box.style.display = 'none';
        openFolderView(name);
      };
      confirm.addEventListener('click', doCreate);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doCreate(); });
      actionsEl.appendChild(input);
      actionsEl.appendChild(confirm);
      actionsEl.appendChild(cancel);
      input.focus();
      input.select();
    });

    actionsEl.appendChild(create);
    actionsEl.appendChild(dismiss);
  }
  box.style.display = 'block';
}

// Sugere um nome de pasta a partir do título da página (limpa sufixo de site), com fallback nos termos
function suggestFolderName(title, pageText) {
  let base = (title || '').split(/\s[-–—|·]\s/)[0].trim();
  if (base.length > 32) base = base.slice(0, 32).trim();
  if (!base) base = BoxySearch.tokenize(pageText || '').slice(0, 2).join(' ');
  return base || 'New folder';
}

// Abre a visão de uma pasta específica (mesma lógica do clique num folder-card)
function openFolderView(folder) {
  state.currentFolder = folder;
  state.currentTab = 'all';
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const allTab = document.querySelector('.tab-btn[data-type="all"]');
  if (allTab) allTab.classList.add('active');
  renderItems();
}

// Cria (ou reutiliza) uma pasta e move os itens soltos indicados para ela
async function createFolderWithItems(name, items) {
  if (!state.folders.includes(name)) state.folders.push(name);
  for (const it of items) it.folder = name;
  await saveData();
  updateFolderDropdowns();
  showToast(`Moved ${items.length} ${items.length === 1 ? 'item' : 'items'} to “${name}”`);
}

// Page-Watch (#5): estado visível do watch no modal de edição, para não "parecer quebrado"
function renderWatchStatus(item, mode) {
  const el = document.getElementById('watchStatus');
  if (!el) return;
  if (mode === 'off') { el.style.display = 'none'; el.textContent = ''; return; }
  el.style.display = 'block';
  if (mode === 'checking') {
    el.textContent = '⏳ Capturing this page as the baseline…';
  } else if (mode === 'error') {
    el.textContent = '⚠️ Couldn’t reach this page — Boxy will retry on its next check.';
  } else { // watching
    const when = item.watch?.lastChecked ? getTimeAgo(item.watch.lastChecked) : null;
    el.textContent = when
      ? `🔔 Watching this page. Last checked ${when} ago.`
      : '🔔 Watching this page for changes.';
  }
}

function renderItems() {
  const container = document.getElementById('itemsList');
  const emptyState = document.getElementById('emptyState');

  if(!container || !emptyState) return;

  if (state.currentTab === 'folders') {
    renderFoldersView();
    renderReviewBanner();
    return;
  }
  
  // Local Intelligence v1: reconstrói o índice antes de filtrar (barato p/ tamanhos típicos)
  rebuildSearchIndex();

  let filtered = [...state.items];

  // Busca é sempre GLOBAL: ignora o filtro de pasta para que nada fique escondido.
  // Sem busca: "All Items" (ou nulo) mostra TODOS os itens; uma pasta específica filtra só ela.
  if (state.searchQuery) {
    filtered = filtered.filter(item => {
      const searchText = `${item.name} ${item.note || ''}`.toLowerCase();
      return searchText.includes(state.searchQuery);
    });
  } else if (state.currentFolder && state.currentFolder !== 'All Items') {
    filtered = filtered.filter(item => item.folder === state.currentFolder);
  }

  if (state.currentTab !== 'all') {
    // Sketches são conteúdo visual → aparecem junto com imagens na aba "Images"
    filtered = filtered.filter(item =>
      item.type === state.currentTab ||
      (state.currentTab === 'image' && item.type === 'sketch'));
  }

  // Smart search (#1): reordena por relevância TF-IDF; o filtro por substring
  // acima continua valendo (queries sem tokens ainda filtram normalmente)
  if (state.searchQuery && searchIndex) {
    const ranked = BoxySearch.score(searchIndex, state.searchQuery);
    const rank = new Map(ranked.map((r, i) => [r.id, i]));
    filtered.sort((a, b) => (rank.has(a.id) ? rank.get(a.id) : 1e9) - (rank.has(b.id) ? rank.get(b.id) : 1e9));
  }

  // Limpa itens atuais, mantendo o emptyState escondido ou não
  const existingCards = container.querySelectorAll('.item-card, .folders-view');
  existingCards.forEach(el => el.remove());

  if (filtered.length === 0) {
    emptyState.style.display = 'block';
    const p = emptyState.querySelector('p');
    if(p) {
        if(state.searchQuery) p.textContent = "No results found";
        else if(state.currentFolder !== 'All Items') p.textContent = "Folder is empty";
        else p.textContent = "Your boxy is empty!";
    }
    renderReviewBanner();
    return;
  }

  emptyState.style.display = 'none';

  filtered.forEach(item => {
    const card = createItemCard(item);
    container.appendChild(card);
  });

  renderReviewBanner();
}

function renderFoldersView() {
  const container = document.getElementById('itemsList');
  const emptyState = document.getElementById('emptyState');
  
  if(!container) return;
  if(emptyState) emptyState.style.display = 'none';
  
  const existing = container.querySelectorAll('.item-card, .folders-view');
  existing.forEach(el => el.remove());
  
  const view = document.createElement('div');
  view.className = 'folders-view';
  
  state.folders.forEach(folder => {
    const count = state.items.filter(item => item.folder === folder).length;
    
    const card = document.createElement('div');
    card.className = 'folder-card';
    
    const header = document.createElement('div');
    header.className = 'folder-card-header';
    
    const nameSpan = document.createElement('span');
    nameSpan.className = 'folder-card-name';
    nameSpan.textContent = folder;
    
    const countSpan = document.createElement('span');
    countSpan.className = 'folder-card-count';
    countSpan.textContent = `${count} items`;
    
    header.appendChild(nameSpan);
    header.appendChild(countSpan);
    card.appendChild(header);
    
    card.addEventListener('click', () => {
      state.currentFolder = folder;
      state.currentTab = 'all';
      
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      const allTab = document.querySelector('.tab-btn[data-type="all"]');
      if(allTab) allTab.classList.add('active');
      
      renderItems();
    });
    
    view.appendChild(card);
  });
  
  container.appendChild(view);
}

// Criação do Card usando DOM seguro
function createItemCard(item) {
  const card = document.createElement('div');
  card.className = 'item-card';
  
  // Imagem Preview
  if (item.preview) {
    const img = document.createElement('img');
    img.src = item.preview;
    img.className = 'item-preview';
    img.alt = 'Preview';
    card.appendChild(img);
  }

  const content = document.createElement('div');
  content.className = 'item-content';

  // Nome do item
  const nameDiv = document.createElement('div');
  nameDiv.className = 'item-name';
  nameDiv.textContent = item.name;
  content.appendChild(nameDiv);

  // Meta info
  const metaDiv = document.createElement('div');
  metaDiv.className = 'item-meta';

  // Tempo
  const timeSpan = document.createElement('span');
  timeSpan.className = 'item-time';
  timeSpan.textContent = getTimeAgo(item.created);
  metaDiv.appendChild(timeSpan);

  // Alarme
  if (item.alarm) {
    const alarmBadge = createAlarmBadgeElement(item.alarm);
    metaDiv.appendChild(alarmBadge);
  }

  // Page-Watch (#5): badge quando a página mudou depois do último acesso
  if (item.watch?.changedAt && item.watch.changedAt > (item.accessed || 0)) {
    const watchBadge = document.createElement('span');
    watchBadge.className = 'watch-badge';
    watchBadge.textContent = '🔔 changed';
    metaDiv.appendChild(watchBadge);
  }

  // Folder Badge
  if (item.folder && item.folder !== 'All Items') {
    const folderBadge = document.createElement('span');
    folderBadge.className = 'folder-badge';
    folderBadge.textContent = `#${item.folder}`;
    metaDiv.appendChild(folderBadge);
  }

  content.appendChild(metaDiv);
  card.appendChild(content);

  card.addEventListener('click', () => {
    // #7: imagens e sketches abrem o visualizador (ver a imagem cheia), não o modal de edição
    if ((item.type === 'image' || item.type === 'sketch' || item.hasSketch) && item.preview) {
      openImageViewer(item);
    } else {
      openEditModal(item);
    }
  });

  return card;
}

// Funções Auxiliares

function getTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'new';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}min`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function createAlarmBadgeElement(alarmTime) {
  const now = Date.now();
  const diff = alarmTime - now;
  
  const badge = document.createElement('span');
  badge.className = 'alarm-badge';
  
  // Ícone de sino embutido no elemento
  const iconSpan = document.createElement('span');
  iconSpan.innerHTML = ICONS.bell; 
  iconSpan.style.display = 'inline-flex';
  iconSpan.style.marginRight = '4px';
  badge.appendChild(iconSpan);

  if (diff < 0) {
    badge.classList.add('expired');
    badge.appendChild(document.createTextNode('expired'));
  } else {
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    const text = hours > 0 ? `${hours}h${minutes}m` : `${minutes}m`;
    badge.appendChild(document.createTextNode(text));
  }
  
  return badge;
}

// --- Ações de Item e Modais (Mantidos e Ajustados) ---

async function saveItem() {
  const nameInput = document.getElementById('itemName');
  const name = nameInput ? nameInput.value.trim() : '';
  
  if (!name) { showToast('Enter a name', 'error'); return; }

  const type = document.getElementById('itemType').value;
  const folderVal = document.getElementById('itemFolder').value;
  const folder = (!folderVal || folderVal === NEW_FOLDER_OPTION) ? 'All Items' : folderVal;
  const note = document.getElementById('itemNote').value.trim();
  const alarmEnabled = document.getElementById('alarmToggle').checked;
  const alarmTime = document.getElementById('alarmPicker').value;

  const item = {
    id: Date.now().toString(),
    type,
    name,
    url: state.currentPageData ? state.currentPageData.url : '',
    preview: (state.currentPageData && state.currentPageData.preview) ? state.currentPageData.preview : '',
    note,
    folder,
    created: Date.now(),
    alarm: alarmEnabled && alarmTime ? new Date(alarmTime).getTime() : null,
    accessed: Date.now(),
    review: { interval: 1, dueAt: Date.now() + DAY, done: false }
  };

  // Arquivo permanente: guarda o texto completo do artigo no IndexedDB
  const archiveToggle = document.getElementById('archiveToggle');
  const article = state.currentPageData ? state.currentPageData.article : null;
  if (archiveToggle && archiveToggle.checked && article && article.text) {
    try {
      await BoxyDB.setArchive(item.id, {
        text: article.text,
        wordCount: article.wordCount,
        savedAt: Date.now(),
        url: item.url
      });
      item.archived = true;
    } catch (err) {
      console.error('Erro ao salvar arquivo no IndexedDB:', err);
      showToast('Item saved, but the article text could not be archived', 'error');
    }
  }

  state.items.unshift(item);

  // Preview vai para o IndexedDB; em memória ele continua no item para renderização
  if (item.preview) {
    try {
      await BoxyDB.setPreview(item.id, item.preview);
    } catch (err) {
      console.error('Erro ao salvar preview no IndexedDB:', err);
      showToast('Item saved, but the preview could not be stored', 'error');
    }
  }

  await saveData();

  if (item.alarm) {
    const delay = (item.alarm - Date.now()) / 60000;
    if (delay > 0) browser.alarms.create(item.id, { delayInMinutes: delay });
  }

  closeSaveModal();
  renderItems();
  showToast('Saved to Boxy! 📦');
}

async function saveEditedItem() {
  if (!state.currentEditingItem) return;
  const item = state.items.find(i => i.id === state.currentEditingItem.id);
  if (!item) return;

  const editFolderVal = document.getElementById('editFolder').value;
  item.folder = (!editFolderVal || editFolderVal === NEW_FOLDER_OPTION) ? 'All Items' : editFolderVal;
  item.note = document.getElementById('editNote').value.trim();

  const alarmEnabled = document.getElementById('editAlarmToggle').checked;
  const alarmTime = document.getElementById('editAlarmPicker').value;

  if (alarmEnabled && alarmTime) {
    item.alarm = new Date(alarmTime).getTime();
    const delay = (item.alarm - Date.now()) / 60000;
    if (delay > 0) browser.alarms.create(item.id, { delayInMinutes: delay });
  } else {
    item.alarm = null;
    browser.alarms.clear(item.id);
  }

  item.accessed = Date.now();
  await saveData();
  closeEditModal();
  renderItems();
  showToast('Changes saved');
}

// Deleta itens com opção de desfazer: remove da UI na hora, mas só limpa
// alarme e preview (IndexedDB) quando a janela de undo expira.
async function deleteWithUndo(removed, message) {
  if (removed.length === 0) return;

  await saveData();
  renderAllItemsList();
  renderItems();

  showUndoToast(message, async () => {
    // Desfazer: restaura os itens nas posições originais
    removed
      .slice()
      .sort((a, b) => a.index - b.index)
      .forEach(({ item, index }) => {
        state.items.splice(Math.min(index, state.items.length), 0, item);
      });
    await saveData();
    renderAllItemsList();
    renderItems();
  }, async () => {
    // Finaliza: agora sim limpa alarmes, previews e arquivos
    for (const { item } of removed) {
      browser.alarms.clear(item.id);
      try {
        await BoxyDB.deletePreview(item.id);
      } catch (err) {
        console.error('Erro ao deletar preview do IndexedDB:', err);
      }
      try {
        await BoxyDB.deleteArchive(item.id);
      } catch (err) {
        console.error('Erro ao deletar arquivo do IndexedDB:', err);
      }
      try {
        await BoxyDB.deleteSketch(item.id);
      } catch (err) {
        console.error('Erro ao deletar sketch do IndexedDB:', err);
      }
    }
    await saveData();
  });
}

async function deleteItemById(id) {
  const index = state.items.findIndex(i => i.id === id);
  if (index === -1) return;
  const removed = [{ item: state.items[index], index }];
  state.items.splice(index, 1);
  await deleteWithUndo(removed, 'Item deleted');
}

async function deleteCurrentItem() {
  if (!state.currentEditingItem) return;
  const id = state.currentEditingItem.id;
  closeEditModal();
  await deleteItemById(id);
}

async function deleteAllItems() {
  if (state.items.length === 0) return;
  // O undo do toast vive no DOM do popup, que o Chrome fecha a qualquer perda
  // de foco — e deleteWithUndo ja persistiu. Sem esta confirmacao, um clique
  // apaga tudo de forma irreversivel na pratica. Mesmo confirm() de deleteFolder.
  if (!confirm(`Delete all ${state.items.length} items? You can undo this only while Boxy stays open.`)) return;
  const removed = state.items.map((item, index) => ({ item, index }));
  state.items = [];
  await deleteWithUndo(removed, 'All deleted');
}

// --- Helpers e Modais ---

function openSettingsModal() {
  renderFoldersList();
  renderAllItemsList();
  
  const light = document.getElementById('themeLight');
  const dark = document.getElementById('themeDark');
  
  if (state.theme === 'light' && light) light.checked = true;
  else if (state.theme === 'dark' && dark) dark.checked = true;
  
  const modal = document.getElementById('settingsModal');
  if(modal) modal.classList.add('active');
}

function closeSettingsModal() {
  const modal = document.getElementById('settingsModal');
  if(modal) modal.classList.remove('active');
}

// Valor sentinela da opção "+ New folder…" no fim de cada dropdown de pasta
const NEW_FOLDER_OPTION = '__new__';

function updateFolderDropdowns() {
  const dropdowns = [document.getElementById('itemFolder'), document.getElementById('editFolder')];

  dropdowns.forEach(dd => {
    if(!dd) return;
    const current = dd.value;
    dd.textContent = ''; // Limpa seguramente
    state.folders.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f;
      opt.textContent = f;
      dd.appendChild(opt);
    });
    // Opção final para criar pasta na hora (save e edit)
    const newOpt = document.createElement('option');
    newOpt.value = NEW_FOLDER_OPTION;
    newOpt.textContent = '+ New folder…';
    dd.appendChild(newOpt);

    if(state.folders.includes(current)) dd.value = current;
    else dd.value = 'All Items';
    dd.dataset.prev = dd.value; // seleção válida anterior, para reverter no Cancel
  });
}

// Liga o fluxo "+ New folder…" de um <select> ao seu campo inline (input + Create/Cancel).
// Ao escolher a opção sentinela, revela o campo; Create adiciona a pasta e a seleciona;
// Cancel/valor vazio reverte para a seleção anterior.
function wireNewFolderInline(selectId, inlineId) {
  const dd = document.getElementById(selectId);
  const inline = document.getElementById(inlineId);
  if (!dd || !inline) return;
  const input = inline.querySelector('input');
  const createBtn = inline.querySelector('.nf-create');
  const cancelBtn = inline.querySelector('.nf-cancel');

  const hide = () => { inline.style.display = 'none'; input.value = ''; };
  const revert = () => { dd.value = dd.dataset.prev || 'All Items'; hide(); };

  const doCreate = async () => {
    const name = input.value.trim();
    if (!name) { showToast('Invalid folder name', 'error'); input.focus(); return; }
    if (state.folders.includes(name)) {
      // Pasta já existe: apenas seleciona, sem duplicar
      dd.value = name; dd.dataset.prev = name; hide();
      return;
    }
    state.folders.push(name);
    await saveData();
    updateFolderDropdowns();      // reconstrói opções de AMBOS os dropdowns
    dd.value = name;              // deixa a nova pasta já selecionada aqui
    dd.dataset.prev = name;
    hide();
    showToast(`Folder “${name}” created`);
  };

  dd.addEventListener('change', () => {
    if (dd.value === NEW_FOLDER_OPTION) {
      inline.style.display = 'flex';
      input.focus();
    } else {
      dd.dataset.prev = dd.value;
      hide();
    }
  });
  createBtn.addEventListener('click', doCreate);
  cancelBtn.addEventListener('click', revert);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doCreate(); }
    else if (e.key === 'Escape') { e.preventDefault(); revert(); }
  });
}

async function openSaveModal() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  let detected = { type: 'article', preview: null };
  
  try {
    const res = await browser.tabs.sendMessage(tab.id, { action: 'detectContent' });
    if (res) detected = res;
  } catch (e) { console.log('Content script unavailable'); }
  
  if (!detected.preview) {
    try {
      detected.preview = await browser.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 50 });
    } catch (e) {}
  }
  
  // Extrai o texto completo do artigo para o arquivo permanente (opcional)
  let article = null;
  try {
    const res = await browser.tabs.sendMessage(tab.id, { action: 'extractArticle' });
    if (res && res.text) article = res;
  } catch (e) { console.log('Article extraction unavailable'); }

  state.currentPageData = {
    url: tab.url,
    title: tab.title,
    favIconUrl: tab.favIconUrl,
    ...detected,
    article
  };

  const titleEl = document.getElementById('modalTitle');
  if(titleEl) titleEl.textContent = `Save: ${tab.title.substring(0, 20)}...`;
  
  document.getElementById('itemType').value = state.currentPageData.type || 'article';
  const itemFolderEl = document.getElementById('itemFolder');
  itemFolderEl.value = (state.currentFolder && state.currentFolder !== NEW_FOLDER_OPTION) ? state.currentFolder : 'All Items';
  itemFolderEl.dataset.prev = itemFolderEl.value;
  const itemFolderNew = document.getElementById('itemFolderNew');
  if (itemFolderNew) itemFolderNew.style.display = 'none';
  document.getElementById('itemName').value = tab.title;
  
  const noteEl = document.getElementById('itemNote');
  if(noteEl) noteEl.value = '';
  
  const alarmEl = document.getElementById('alarmToggle');
  if(alarmEl) alarmEl.checked = false;
  
  const picker = document.getElementById('alarmPicker');
  if(picker) { picker.style.display = 'none'; picker.value = ''; }

  // Arquivo permanente: marcado por padrão para artigos com texto extraído
  const archiveEl = document.getElementById('archiveToggle');
  if(archiveEl) {
    const hasArticle = !!(article && article.text);
    archiveEl.disabled = !hasArticle;
    archiveEl.checked = hasArticle && (state.currentPageData.type === 'article');
  }

  const modal = document.getElementById('saveModal');
  if(modal) modal.classList.add('active');
}

function closeSaveModal() {
  const modal = document.getElementById('saveModal');
  if(modal) modal.classList.remove('active');
}

// Visualizador de imagem/sketch (#7): mostra a imagem em tamanho grande
let viewerItem = null;
function openImageViewer(item) {
  viewerItem = item;
  const viewer = document.getElementById('imageViewer');
  const img = document.getElementById('imageViewerImg');
  const name = document.getElementById('imageViewerName');
  if (!viewer || !img) return;
  img.src = item.preview || '';
  img.alt = item.name || 'Image';
  if (name) name.textContent = item.name || '';
  viewer.classList.add('show');
}

function closeImageViewer() {
  const viewer = document.getElementById('imageViewer');
  if (viewer) viewer.classList.remove('show');
  const img = document.getElementById('imageViewerImg');
  if (img) img.src = '';
  viewerItem = null;
}

function openEditModal(item) {
  state.currentEditingItem = item;
  
  const title = document.getElementById('editModalTitle');
  if(title) title.textContent = item.name;
  
  const preview = document.getElementById('editPreview');
  if(preview) {
    preview.textContent = ''; // Limpa
    if (item.preview) {
        const img = document.createElement('img');
        img.src = item.preview;
        img.style.maxWidth = '100%';
        img.style.borderRadius = '8px';
        preview.appendChild(img);
    }
  }

  const editFolderEl = document.getElementById('editFolder');
  editFolderEl.value = (item.folder && item.folder !== NEW_FOLDER_OPTION) ? item.folder : 'All Items';
  editFolderEl.dataset.prev = editFolderEl.value;
  const editFolderNew = document.getElementById('editFolderNew');
  if (editFolderNew) editFolderNew.style.display = 'none';
  document.getElementById('editNote').value = item.note || '';

  // Arquivo permanente: botões e leitor visíveis conforme o item
  const viewArchiveBtn = document.getElementById('viewArchiveBtn');
  if(viewArchiveBtn) {
    viewArchiveBtn.style.display = item.archived ? 'block' : 'none';
    viewArchiveBtn.textContent = 'Read saved copy';
  }

  // Sketch (#11): botão sempre visível; label indica se já existe desenho
  const sketchItemBtn = document.getElementById('sketchItemBtn');
  if(sketchItemBtn) {
    sketchItemBtn.style.display = 'block';
    sketchItemBtn.textContent = item.hasSketch ? 'Edit sketch' : 'Sketch';
  }

  const reader = document.getElementById('archiveReader');
  if(reader) { reader.style.display = 'none'; reader.textContent = ''; }

  // Page-Watch (#5): reflete o estado; só faz sentido quando o item tem URL
  const watchToggle = document.getElementById('watchToggle');
  if(watchToggle) {
    if (item.url) {
      watchToggle.disabled = false;
      watchToggle.checked = !!item.watch?.enabled;
    } else {
      watchToggle.disabled = true;
      watchToggle.checked = false;
    }
  }
  renderWatchStatus(item, item.watch?.enabled ? 'watching' : 'off');

  const toggle = document.getElementById('editAlarmToggle');
  const picker = document.getElementById('editAlarmPicker');
  
  if (item.alarm) {
    if(toggle) toggle.checked = true;
    if(picker) {
      picker.style.display = 'block';
      const d = new Date(item.alarm);
      picker.value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    }
  } else {
    if(toggle) toggle.checked = false;
    if(picker) { picker.style.display = 'none'; picker.value = ''; }
  }

  const modal = document.getElementById('editModal');
  if(modal) modal.classList.add('active');
}

function closeEditModal() {
  const modal = document.getElementById('editModal');
  if(modal) modal.classList.remove('active');
  state.currentEditingItem = null;
}

function openItemLink() {
  if (state.currentEditingItem && state.currentEditingItem.url) {
    browser.tabs.create({ url: state.currentEditingItem.url });
  }
}

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  if(toast) {
    toast.textContent = message;
    toast.className = `toast ${type}`;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
  }
}

// Toast com botão "Desfazer". Só um undo pode estar ativo por vez:
// um novo delete finaliza o anterior imediatamente.
let activeUndo = null;

function showUndoToast(message, onUndo, onFinalize) {
  if (activeUndo) {
    clearTimeout(activeUndo.timer);
    const prev = activeUndo;
    activeUndo = null;
    prev.finalize();
  }

  const toast = document.getElementById('toast');
  if (!toast) { onFinalize(); return; }

  toast.textContent = '';
  const msgSpan = document.createElement('span');
  msgSpan.textContent = message;
  toast.appendChild(msgSpan);

  const undoBtn = document.createElement('button');
  undoBtn.type = 'button';
  undoBtn.textContent = 'Undo';
  undoBtn.style.cssText = 'margin-left: 12px; background: none; border: none; padding: 0; color: inherit; font: inherit; font-weight: 600; text-decoration: underline; cursor: pointer;';
  toast.appendChild(undoBtn);

  toast.className = 'toast info';
  toast.classList.add('show');

  const timer = setTimeout(() => {
    if (activeUndo && activeUndo.timer === timer) {
      activeUndo = null;
      toast.classList.remove('show');
      onFinalize();
    }
  }, 6000);

  activeUndo = { timer, finalize: onFinalize };

  undoBtn.addEventListener('click', () => {
    if (activeUndo && activeUndo.timer === timer) {
      clearTimeout(timer);
      activeUndo = null;
      toast.classList.remove('show');
      onUndo();
    }
  });
}

// --- Backup (Exportar / Importar) ---

function exportBackup() {
  const backup = {
    version: 1,
    exportedAt: Date.now(),
    theme: state.theme,
    folders: state.folders,
    items: state.items // previews já anexados em memória: backup autocontido
  };

  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `boxy-backup-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('Backup exported');
}

async function importBackup(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = ''; // permite importar o mesmo arquivo de novo
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async () => {
    let backup;
    try {
      backup = JSON.parse(reader.result);
    } catch (err) {
      showToast('Invalid backup file', 'error');
      return;
    }
    if (!backup || !Array.isArray(backup.items)) {
      showToast('Invalid backup file', 'error');
      return;
    }

    // Merge: adiciona apenas pastas e itens que ainda não existem
    (Array.isArray(backup.folders) ? backup.folders : []).forEach(f => {
      if (typeof f === 'string' && f && !state.folders.includes(f)) state.folders.push(f);
    });

    const existingIds = new Set(state.items.map(i => i.id));
    let imported = 0;
    for (const item of backup.items) {
      if (!item || !item.id || existingIds.has(item.id)) continue;
      if (item.preview) {
        try {
          await BoxyDB.setPreview(item.id, item.preview);
        } catch (err) {
          console.error('Erro ao salvar preview importado:', err);
        }
      }
      state.items.push(item);
      existingIds.add(item.id);
      imported++;
    }

    await saveData();
    updateFolderDropdowns();
    renderFoldersList();
    renderAllItemsList();
    renderItems();
    showToast(`${imported} items imported`);
  };
  reader.onerror = () => showToast('Failed to read the file', 'error');
  reader.readAsText(file);
}

// =========================================================================
// SKETCH (#11) — editor de desenho/anotação (bloco autocontido)
// Renderização em duas camadas: fundo (screenshot/preview) + traços em um
// canvas offscreen transparente, para que a borracha (destination-out)
// apague apenas os traços e nunca o fundo.
// =========================================================================

let sketch = {
  itemId: null, isNew: false, strokes: [], bg: null, width: 0, height: 0,
  tool: 'pen', color: '#111111', size: 5, drawing: false, cur: null, _bgImg: null
};

function sketchLoadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Limita o lado maior a `cap` px, mantendo a proporção
function sketchCapSize(w, h, cap) {
  const longest = Math.max(w, h);
  if (longest <= cap) return { w, h };
  const k = cap / longest;
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

// Abre o editor a partir de um item existente
async function openSketchForItem(item) {
  let rec = null;
  try {
    rec = await BoxyDB.getSketch(item.id);
  } catch (err) {
    console.error('Erro ao carregar sketch do IndexedDB:', err);
  }
  // Se já existe um sketch salvo, respeita o fundo dele (mesmo que seja nulo);
  // caso contrário, desenha por cima do preview do item, se houver
  const bg = rec ? (rec.bg ?? null) : (item.preview || null);
  await openSketchEditor({ itemId: item.id, isNew: false, rec, bg });
}

// Novo sketch avulso (canvas em branco)
function openNewSketch() {
  openSketchEditor({ itemId: Date.now().toString(), isNew: true, rec: null, bg: null });
}

async function openSketchEditor({ itemId, isNew, rec, bg }) {
  sketch.itemId = itemId;
  sketch.isNew = isNew;
  sketch.strokes = (rec && rec.strokes) ? JSON.parse(JSON.stringify(rec.strokes)) : [];
  sketch.bg = bg || null;
  sketch.tool = 'pen';
  sketch.color = '#111111';
  sketch.size = 5;
  sketch.drawing = false;
  sketch.cur = null;
  sketch._bgImg = null;

  if (sketch.bg) {
    try {
      const img = await sketchLoadImage(sketch.bg);
      sketch._bgImg = img;
      const dims = sketchCapSize(img.naturalWidth, img.naturalHeight, 1600);
      sketch.width = dims.w;
      sketch.height = dims.h;
    } catch (err) {
      console.error('Erro ao carregar fundo do sketch:', err);
      sketch.bg = null;
      sketch.width = (rec && rec.width) || 800;
      sketch.height = (rec && rec.height) || 1100;
    }
  } else {
    // Canvas em branco: usa o tamanho salvo, ou o padrão 800×1100
    sketch.width = (rec && rec.width) || 800;
    sketch.height = (rec && rec.height) || 1100;
  }

  const c = document.getElementById('sketchCanvas');
  if (c) {
    c.width = sketch.width;
    c.height = sketch.height;
  }
  renderSketch();
  updateSketchToolbarUI();

  const modal = document.getElementById('sketchModal');
  if (modal) modal.classList.add('active');
}

function closeSketch() {
  const modal = document.getElementById('sketchModal');
  if (modal) modal.classList.remove('active');
  sketch.drawing = false;
  sketch.cur = null;
  sketch._bgImg = null;
}

// Renderização em duas camadas; `extraStroke` (opcional) = traço em andamento
function renderSketch(extraStroke) {
  const c = document.getElementById('sketchCanvas');
  if (!c) return;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  if (sketch._bgImg) ctx.drawImage(sketch._bgImg, 0, 0, c.width, c.height);

  // Traços em camada offscreen transparente: a borracha só apaga traços
  const off = document.createElement('canvas');
  off.width = c.width;
  off.height = c.height;
  const octx = off.getContext('2d');
  octx.lineJoin = octx.lineCap = 'round';
  const strokes = extraStroke ? sketch.strokes.concat([extraStroke]) : sketch.strokes;
  for (const s of strokes) {
    octx.globalCompositeOperation = s.eraser ? 'destination-out' : 'source-over';
    octx.strokeStyle = s.color;
    octx.lineWidth = s.size;
    octx.beginPath();
    s.points.forEach((p, i) => i ? octx.lineTo(p.x, p.y) : octx.moveTo(p.x, p.y));
    if (s.points.length === 1) {
      octx.lineTo(s.points[0].x + 0.01, s.points[0].y + 0.01); // ponto único
    }
    octx.stroke();
  }
  ctx.drawImage(off, 0, 0);
}

function renderStrokePreview() {
  if (sketch.cur) renderSketch(sketch.cur);
}

// Mapeia o evento para coordenadas do canvas (considera scale via CSS)
function sketchCanvasPoint(e) {
  const c = document.getElementById('sketchCanvas');
  const r = c.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * (c.width / r.width),
    y: (e.clientY - r.top) * (c.height / r.height)
  };
}

function onSketchPointerDown(e) {
  e.preventDefault();
  sketch.drawing = true;
  sketch.cur = {
    points: [sketchCanvasPoint(e)],
    color: sketch.color,
    size: sketch.size,
    eraser: sketch.tool === 'eraser'
  };
  e.target.setPointerCapture?.(e.pointerId);
}

function onSketchPointerMove(e) {
  if (!sketch.drawing) return;
  sketch.cur.points.push(sketchCanvasPoint(e));
  renderStrokePreview();
}

function onSketchPointerUp() {
  if (!sketch.drawing) return;
  sketch.drawing = false;
  if (sketch.cur && sketch.cur.points.length) sketch.strokes.push(sketch.cur);
  sketch.cur = null;
  renderSketch();
}

function setSketchTool(tool) {
  sketch.tool = tool;
  updateSketchToolbarUI();
}

function updateSketchToolbarUI() {
  const pen = document.getElementById('sketchToolPen');
  if (pen) pen.classList.toggle('active', sketch.tool === 'pen');
  const eraser = document.getElementById('sketchToolEraser');
  if (eraser) eraser.classList.toggle('active', sketch.tool === 'eraser');
  document.querySelectorAll('#sketchColors .sketch-swatch').forEach(b => {
    b.classList.toggle('active', b.dataset.color === sketch.color);
  });
  document.querySelectorAll('#sketchSizes .sketch-size').forEach(b => {
    b.classList.toggle('active', Number(b.dataset.size) === sketch.size);
  });
}

// Captura a aba visível e usa como fundo do desenho
async function sketchLoadScreenshot() {
  try {
    const shot = await browser.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 60 });
    const img = await sketchLoadImage(shot);
    sketch._bgImg = img;
    sketch.bg = shot;
    const dims = sketchCapSize(img.naturalWidth, img.naturalHeight, 1600);
    sketch.width = dims.w;
    sketch.height = dims.h;
    const c = document.getElementById('sketchCanvas');
    if (c) {
      c.width = dims.w;
      c.height = dims.h;
    }
    renderSketch();
  } catch (err) {
    console.error('Erro ao capturar screenshot:', err);
    showToast('Could not capture the screenshot', 'error');
  }
}

async function saveSketch() {
  if (!sketch.itemId) return;
  try {
    const c = document.getElementById('sketchCanvas');
    renderSketch(); // garante o composto final (sem traço em andamento)
    const png = c.toDataURL('image/png');

    await BoxyDB.setSketch(sketch.itemId, {
      strokes: sketch.strokes,
      bg: sketch.bg,
      width: c.width,
      height: c.height,
      updatedAt: Date.now()
    });
    await BoxyDB.setPreview(sketch.itemId, png); // thumbnail do card

    if (sketch.isNew) {
      state.items.unshift({
        id: sketch.itemId,
        type: 'sketch',
        name: 'Sketch ' + new Date().toLocaleDateString(),
        url: '',
        preview: png,
        note: '',
        folder: state.currentFolder || 'All Items',
        created: Date.now(),
        accessed: Date.now(),
        alarm: null,
        hasSketch: true
      });
    } else {
      const it = state.items.find(i => i.id === sketch.itemId);
      if (it) {
        it.preview = png;
        it.hasSketch = true;
        it.accessed = Date.now();
      }
    }

    await saveData();
    closeSketch();
    renderItems();
    showToast('Sketch saved');
  } catch (err) {
    console.error('Erro ao salvar sketch:', err);
    showToast('Failed to save the sketch', 'error');
  }
}

// Ganchos mínimos para o harness de testes (inofensivos em produção)
globalThis.__sketchAddStroke = (stroke) => { sketch.strokes.push(stroke); renderSketch(); };
globalThis.__sketchState = () => sketch;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'alarmFired') renderItems();

  if (message.action === 'itemSaved') {
    // Item salvo pelo background (menu de contexto / highlight) — recarrega a lista
    (async () => {
      await loadData();
      updateFolderDropdowns();
      renderItems();
    })();
  }
});