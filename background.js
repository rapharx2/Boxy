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

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'save-to-boxy') {
    // Open popup
    chrome.action.openPopup();
  }
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
  chrome.notifications.create(alarm.name, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Boxy Reminder',
    message: `Time for "${item.name}"`,
    priority: 2,
    requireInteraction: true,
    buttons: [
      { title: 'Open' },
      { title: 'Dismiss' }
    ]
  });

  // Notify popup to update UI
  chrome.runtime.sendMessage({ action: 'alarmFired', itemId: alarm.name });
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
chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
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

// Handle messages from popup
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
});

// Periodic cleanup check (every hour)
chrome.alarms.create('cleanup-check', { periodInMinutes: 60 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'cleanup-check') {
    checkForCleanup();
  }
});

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
