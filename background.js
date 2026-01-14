// Solana PnL Tracker - Background Service Worker

// Clean up old balance history periodically
chrome.runtime.onInstalled.addListener(() => {
  console.log('Solana PnL Tracker installed');

  // Set up periodic cleanup alarm
  chrome.alarms.create('cleanupHistory', {
    periodInMinutes: 60 // Run every hour
  });
});

// Handle alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'cleanupHistory') {
    await cleanupOldHistory();
  }
});

// Clean up balance entries older than 24 hours
async function cleanupOldHistory() {
  try {
    const stored = await chrome.storage.local.get(['balanceHistory']);
    const history = stored.balanceHistory || {};
    const cutoff = Date.now() - (24 * 60 * 60 * 1000); // 24 hours

    let cleaned = false;

    for (const address of Object.keys(history)) {
      const entries = history[address];
      const filtered = entries.filter(e => e.timestamp > cutoff);

      if (filtered.length !== entries.length) {
        history[address] = filtered;
        cleaned = true;
      }

      // Remove address if no entries left
      if (filtered.length === 0) {
        delete history[address];
      }
    }

    if (cleaned) {
      await chrome.storage.local.set({ balanceHistory: history });
      console.log('Cleaned up old balance history');
    }
  } catch (e) {
    console.error('Failed to cleanup history:', e);
  }
}

// Listen for messages from popup (for future features)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getStorageStats') {
    chrome.storage.local.get(null, (data) => {
      const size = JSON.stringify(data).length;
      const addressCount = Object.keys(data.balanceHistory || {}).length;
      sendResponse({ size, addressCount });
    });
    return true; // Keep channel open for async response
  }
});
