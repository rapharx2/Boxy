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

document.addEventListener('DOMContentLoaded', init);

async function init() {
  await loadData();
  setupEventListeners();
  applyTheme();
  
  if (!state.currentFolder) state.currentFolder = 'All Items';
  
  renderItems();
  updateFolderDropdowns();
}

async function loadData() {
  const data = await chrome.storage.local.get(['items', 'folders', 'theme']);
  state.items = data.items || [];
  state.folders = data.folders || ['All Items'];
  state.theme = data.theme || 'auto';
}

async function saveData() {
  await chrome.storage.local.set({
    items: state.items,
    folders: state.folders,
    theme: state.theme
  });
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
  
  const deleteAllBtn = document.getElementById('deleteAllBtn');
  if(deleteAllBtn) deleteAllBtn.addEventListener('click', deleteAllItems);

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

  const editAlarmToggle = document.getElementById('editAlarmToggle');
  if(editAlarmToggle) {
    editAlarmToggle.addEventListener('change', (e) => {
      const picker = document.getElementById('editAlarmPicker');
      if(picker) picker.style.display = e.target.checked ? 'block' : 'none';
    });
  }

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

  window.addEventListener('click', (e) => {
    if (e.target.id === 'saveModal') closeSaveModal();
    if (e.target.id === 'editModal') closeEditModal();
    if (e.target.id === 'settingsModal') closeSettingsModal();
  });
}

// --- Funções de Pasta ---

async function createFolder() {
  const input = document.getElementById('newFolderInput');
  const name = input.value.trim();
  
  if (!name) { showToast('Nome da pasta inválido', 'error'); return; }
  if (state.folders.includes(name)) { showToast('Pasta já existe', 'error'); return; }
  
  state.folders.push(name);
  await saveData();
  input.value = '';
  renderFoldersList();
  updateFolderDropdowns();
  showToast('Pasta criada');
}

async function deleteFolder(folderName) {
  if (folderName === 'All Items') { showToast('Não pode deletar a pasta padrão', 'error'); return; }
  if (!confirm(`Deletar "${folderName}"? Os itens irão para "All Items".`)) return;
  
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
  showToast(`Pasta deletada. ${movedCount} itens movidos.`);
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
    emptyMsg.textContent = 'Nenhum item salvo';
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

function renderItems() {
  const container = document.getElementById('itemsList');
  const emptyState = document.getElementById('emptyState');
  
  if(!container || !emptyState) return;

  if (state.currentTab === 'folders') {
    renderFoldersView();
    return;
  }
  
  let filtered = [...state.items];

  if (state.currentFolder) {
    filtered = filtered.filter(item => item.folder === state.currentFolder);
  } else {
    filtered = filtered.filter(item => item.folder === 'All Items');
  }

  if (state.currentTab !== 'all') {
    filtered = filtered.filter(item => item.type === state.currentTab);
  }

  if (state.searchQuery) {
    filtered = filtered.filter(item => {
      const searchText = `${item.name} ${item.note}`.toLowerCase();
      return searchText.includes(state.searchQuery);
    });
  }

  // Limpa itens atuais, mantendo o emptyState escondido ou não
  const existingCards = container.querySelectorAll('.item-card, .folders-view');
  existingCards.forEach(el => el.remove());

  if (filtered.length === 0) {
    emptyState.style.display = 'block';
    const p = emptyState.querySelector('p');
    if(p) {
        if(state.searchQuery) p.textContent = "Nenhum resultado encontrado";
        else if(state.currentFolder !== 'All Items') p.textContent = "Folder is empty";
        else p.textContent = "Your boxy is empty!";
    }
    return;
  }

  emptyState.style.display = 'none';

  filtered.forEach(item => {
    const card = createItemCard(item);
    container.appendChild(card);
  });
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
    openEditModal(item);
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
  
  if (!name) { showToast('Digite um nome', 'error'); return; }

  const type = document.getElementById('itemType').value;
  const folder = document.getElementById('itemFolder').value || 'All Items';
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
    accessed: Date.now()
  };

  state.items.unshift(item);
  await saveData();

  if (item.alarm) {
    const delay = (item.alarm - Date.now()) / 60000;
    if (delay > 0) browser.alarms.create(item.id, { delayInMinutes: delay });
  }

  closeSaveModal();
  renderItems();
  showToast('Salvo no Boxy! 📦');
}

async function saveEditedItem() {
  if (!state.currentEditingItem) return;
  const item = state.items.find(i => i.id === state.currentEditingItem.id);
  if (!item) return;

  item.folder = document.getElementById('editFolder').value || 'All Items';
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
  showToast('Alterações salvas');
}

async function deleteItemById(id) {
  if (!confirm('Deletar este item?')) return;
  state.items = state.items.filter(i => i.id !== id);
  browser.alarms.clear(id);
  await saveData();
  renderAllItemsList();
  renderItems(); 
  showToast('Item deletado');
}

async function deleteCurrentItem() {
  if (!state.currentEditingItem) return;
  if (!confirm('Deletar este item?')) return;
  
  const id = state.currentEditingItem.id;
  state.items = state.items.filter(i => i.id !== id);
  browser.alarms.clear(id);
  await saveData();
  closeEditModal();
  renderItems();
  showToast('Deletado');
}

async function deleteAllItems() {
  if (!confirm('Deletar TUDO? Isso não pode ser desfeito!')) return;
  state.items.forEach(item => browser.alarms.clear(item.id));
  state.items = [];
  await saveData();
  renderAllItemsList();
  renderItems();
  showToast('Tudo deletado');
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
    if(state.folders.includes(current)) dd.value = current;
    else dd.value = 'All Items';
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
  
  state.currentPageData = {
    url: tab.url,
    title: tab.title,
    favIconUrl: tab.favIconUrl,
    ...detected
  };

  const titleEl = document.getElementById('modalTitle');
  if(titleEl) titleEl.textContent = `Salvar: ${tab.title.substring(0, 20)}...`;
  
  document.getElementById('itemType').value = state.currentPageData.type || 'article';
  document.getElementById('itemFolder').value = state.currentFolder || 'All Items';
  document.getElementById('itemName').value = tab.title;
  
  const noteEl = document.getElementById('itemNote');
  if(noteEl) noteEl.value = '';
  
  const alarmEl = document.getElementById('alarmToggle');
  if(alarmEl) alarmEl.checked = false;
  
  const picker = document.getElementById('alarmPicker');
  if(picker) { picker.style.display = 'none'; picker.value = ''; }

  const modal = document.getElementById('saveModal');
  if(modal) modal.classList.add('active');
}

function closeSaveModal() {
  const modal = document.getElementById('saveModal');
  if(modal) modal.classList.remove('active');
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

  document.getElementById('editFolder').value = item.folder || 'All Items';
  document.getElementById('editNote').value = item.note || '';
  
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'alarmFired') renderItems();
});