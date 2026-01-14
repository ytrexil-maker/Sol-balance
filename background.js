// Solana PnL Tracker - Background Service Worker

chrome.runtime.onInstalled.addListener(() => {
  console.log('Solana PnL Tracker installed');
});

// Listen for messages from popup (for future features)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getStorageStats') {
    chrome.storage.local.get(null, (data) => {
      const size = JSON.stringify(data).length;
      sendResponse({ size });
    });
    return true; // Keep channel open for async response
  }
});
