globalThis.browser ??= globalThis.chrome;
// Background service worker - handles alarms and notifications

// Install event - create context menu
chrome.runtime.onInstalled.addListener(() => {
  console.log('Boxy installed');
  
  // Create context menu
  chrome.contextMenus.create({
    id: 'save-to-boxy',
    title: 'Save to Boxy',
    contexts: ['page', 'selection', 'image', 'video', 'link']
  });
});

// Revisão espaçada (#3): um dia em ms
const DAY = 86400000;

// Trunca texto para usar como nome do item (máx. 60 chars)
function truncateName(text, max = 60) {
  const trimmed = (text || '').trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.substring(0, max) + '…';
}

// Page-Watch (#5): hash FNV-1a de string → Number (determinístico, sem crypto)
function hashString(str){ let h=0x811c9dc5; for(let i=0;i<str.length;i++){ h^=str.charCodeAt(i); h=Math.imul(h,0x01000193); } return h>>>0; }

// Page-Watch (#5): limpa HTML via regex — service workers NÃO têm DOMParser.
// Remove script/style, tira tags, colapsa espaços e limita a ~100k chars.
function cleanHtmlToText(html){
  return html
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/\s+/g,' ')
    .trim()
    .slice(0,100000);
}

// Page-Watch (#5): verifica itens vigiados e notifica quando o hash muda.
// Limitação honesta: hash da página inteira pode dar falso-positivo em
// páginas com conteúdo rotativo (ads, timestamps). Watch por seletor é futuro.
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
      // Primeira checagem (lastHash null) só registra o hash, sem notificar
      if (it.watch.lastHash !== null && it.watch.lastHash !== hash){
        it.watch.changedAt = Date.now();
        // Firefox-safe: tipo basic, sem buttons/requireInteraction
        chrome.notifications.create('watch-'+it.id, { type:'basic', iconUrl:'icons/icon128.png', title:'Boxy', message:'Page changed: '+it.name, priority:1 });
      }
      it.watch.lastHash = hash;
      it.watch.lastChecked = Date.now();
      changed = true;
    } catch(e){ console.error('watch fetch failed', it.url, e); }
  }
  if (changed) await chrome.storage.local.set({ items });
}

// Captura imediata do baseline de UM item (ao ativar "Watch"), sem esperar o alarme.
// Faz a página deixar de "parecer quebrada": o usuário vê que o watch começou a valer agora.
async function watchOne(itemId){
  const d = await chrome.storage.local.get(['items']);
  const items = d.items || [];
  const it = items.find(i => i.id === itemId);
  if (!it || !it.watch || !it.url) return { ok:false, error:'no-item-or-url' };
  try {
    const res = await fetch(it.url, { cache:'no-store' });
    const html = await res.text();
    it.watch.lastHash = hashString(cleanHtmlToText(html));
    it.watch.lastChecked = Date.now();
    await chrome.storage.local.set({ items });
    return { ok:true, lastChecked: it.watch.lastChecked };
  } catch(e){
    console.error('watchOne fetch failed', it.url, e);
    return { ok:false, error:String(e) };
  }
}

// Salva um item diretamente no storage.local sem abrir o popup
async function saveToBoxy(item) {
  const data = await chrome.storage.local.get(['items']);
  const items = data.items || [];

  const newItem = {
    id: Date.now().toString(),
    type: 'article',
    name: '',
    url: '',
    preview: '',
    note: '',
    folder: 'All Items',
    created: Date.now(),
    alarm: null,
    accessed: Date.now(),
    review: { interval: 1, dueAt: Date.now() + DAY, done: false },
    ...item
  };

  items.unshift(newItem);
  await chrome.storage.local.set({ items });

  // Notificação de confirmação (opções básicas — cross-browser safe)
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Boxy',
    message: 'Saved to Boxy'
  });

  // Avisa o popup (se aberto) para atualizar a lista
  chrome.runtime.sendMessage({ action: 'itemSaved' }).catch(() => {});

  return newItem;
}

// Handle context menu clicks - salva direto, sem abrir o popup
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'save-to-boxy') return;

  let item;

  if (info.selectionText) {
    // Texto selecionado
    item = {
      type: 'text',
      name: truncateName(info.selectionText) || tab?.title || 'Text',
      note: info.selectionText,
      url: info.pageUrl,
      preview: ''
    };
  } else if (info.mediaType === 'image' && info.srcUrl) {
    // Imagem
    item = {
      type: 'image',
      name: tab?.title || 'Image',
      url: info.srcUrl,
      preview: info.srcUrl
    };
  } else if (info.linkUrl) {
    // Link
    item = {
      type: 'article',
      name: tab?.title || info.linkUrl,
      url: info.linkUrl,
      preview: ''
    };
  } else {
    // Página inteira
    item = {
      type: 'article',
      name: tab?.title || info.pageUrl,
      url: info.pageUrl,
      preview: ''
    };
  }

  saveToBoxy(item);
});

// Handle alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
  console.log('Alarm fired:', alarm.name);
  
  // Get item data
  const data = await chrome.storage.local.get(['items']);
  const item = data.items?.find(i => i.id === alarm.name);
  
  if (!item) {
    console.log('Item not found for alarm:', alarm.name);
    return;
  }

  // Create notification
  const notificationOptions = {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Boxy Reminder',
    message: `Time for "${item.name}"`,
    priority: 2
  };

  // Firefox rejeita 'buttons' e 'requireInteraction' (não suportados)
  if (chrome.notifications.onButtonClicked) {
    notificationOptions.requireInteraction = true;
    notificationOptions.buttons = [
      { title: 'Open' },
      { title: 'Dismiss' }
    ];
  }

  chrome.notifications.create(alarm.name, notificationOptions);

  // Notify popup to update UI
  chrome.runtime.sendMessage({ action: 'alarmFired', itemId: alarm.name }).catch(() => {});
});

// Handle notification clicks
chrome.notifications.onClicked.addListener((notificationId) => {
  // Open the item URL
  chrome.storage.local.get(['items', 'archive'], (data) => {
    const allItems = [...(data.items || []), ...(data.archive || [])];
    const item = allItems.find(i => i.id === notificationId);
    
    if (item && item.url) {
      chrome.tabs.create({ url: item.url });
    }
    
    chrome.notifications.clear(notificationId);
  });
});

// Handle notification button clicks
// Firefox não suporta onButtonClicked - guarda para não quebrar o script
if (chrome.notifications.onButtonClicked) chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  if (buttonIndex === 0) {
    // Open button
    chrome.storage.local.get(['items', 'archive'], (data) => {
      const allItems = [...(data.items || []), ...(data.archive || [])];
      const item = allItems.find(i => i.id === notificationId);
      
      if (item && item.url) {
        chrome.tabs.create({ url: item.url });
      }
    });
  }
  
  // Clear notification
  chrome.notifications.clear(notificationId);
});

// Handle notification closed
chrome.notifications.onClosed.addListener((notificationId) => {
  console.log('Notification closed:', notificationId);
});

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'captureTab') {
    // Capture visible tab screenshot
    chrome.tabs.captureVisibleTab(
      null,
      { format: 'jpeg', quality: 50 },
      (dataUrl) => {
        sendResponse({ preview: dataUrl });
      }
    );
    return true;
  }

  if (message.action === 'saveHighlight') {
    // Salva o texto destacado enviado pelo content script
    saveToBoxy({
      type: 'text',
      name: truncateName(message.text) || message.title || 'Highlight',
      note: message.text,
      url: message.url,
      preview: ''
    });
    return false;
  }

  if (message.action === 'watchNow') {
    // Baseline imediato ao ativar o watch, respondendo ao popup de forma assíncrona
    watchOne(message.itemId).then((r) => sendResponse(r));
    return true;
  }
});

// Periodic cleanup check (every hour)
chrome.alarms.create('cleanup-check', { periodInMinutes: 60 });

// Revisão espaçada (#3): checagem diária de itens devidos
chrome.alarms.create('review-check', { periodInMinutes: 1440 });

// Page-Watch (#5): checagem de páginas vigiadas a cada 3 horas
chrome.alarms.create('watch-check', { periodInMinutes: 180 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'cleanup-check') {
    checkForCleanup();
  }
  if (alarm.name === 'review-check') {
    checkReviewDue();
  }
  if (alarm.name === 'watch-check') {
    checkWatches();
  }
});

// Notifica UMA vez por dia com a contagem de itens a revisitar
async function checkReviewDue(){
  const d = await chrome.storage.local.get(['items']);
  const now = Date.now();
  // Sketches/imagens não entram na revisão (espelha isReviewable do popup)
  const due = (d.items || []).filter(i =>
    i.type !== 'sketch' && i.type !== 'image' && !i.hasSketch &&
    i.review && !i.review.done && i.review.dueAt <= now);
  if (due.length){
    // Firefox-safe: tipo basic, sem buttons/requireInteraction
    chrome.notifications.create('review-nudge', {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Boxy',
      message: due.length + ' item(s) to revisit',
      priority: 1
    });
  }
}

async function checkForCleanup() {
  const data = await chrome.storage.local.get(['items', 'settings']);
  const items = data.items || [];
  const settings = data.settings || { cleanupDays: 30 };
  
  const cutoffDate = Date.now() - (settings.cleanupDays * 86400000);
  const oldItems = items.filter(item => !item.done && item.accessed < cutoffDate);
  
  if (oldItems.length >= 10) {
    // Create notification suggesting cleanup
    chrome.notifications.create('cleanup-suggestion', {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Boxy Cleanup',
      message: `You have ${oldItems.length} old items. Time to cleanup?`,
      priority: 1
    });
  }
}

// Keep service worker alive
let keepAlive;
chrome.runtime.onStartup.addListener(() => {
  keepAlive = setInterval(() => {
    chrome.storage.local.get('keepAlive');
  }, 20000);
});

console.log('Boxy background service worker loaded');
