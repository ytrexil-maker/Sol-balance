// Solana PnL Tracker - Popup Script
// Uses Solana RPC directly for historical balance calculation

const LAMPORTS_PER_SOL = 1_000_000_000;
const EIGHT_HOURS_SEC = 8 * 60 * 60;
const DEFAULT_RPC = 'https://api.mainnet-beta.solana.com';
const MAX_ADDRESSES = 20;

// DOM Elements
const addressesInput = document.getElementById('addresses');
const checkBtn = document.getElementById('checkBtn');
const clearBtn = document.getElementById('clearBtn');
const rpcUrlInput = document.getElementById('rpcUrl');
const saveSettingsBtn = document.getElementById('saveSettings');
const loadingSection = document.getElementById('loading');
const resultsSection = document.getElementById('results');
const errorSection = document.getElementById('error');
const errorMessage = document.getElementById('errorMessage');
const resultsBody = document.getElementById('resultsBody');
const totalWalletsSpan = document.getElementById('totalWallets');
const totalPnlSpan = document.getElementById('totalPnl');
const winLossSpan = document.getElementById('winLoss');

// State
let settings = {
  rpcUrl: DEFAULT_RPC
};

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await loadSavedAddresses();
});

// Event Listeners
checkBtn.addEventListener('click', handleCheck);
clearBtn.addEventListener('click', handleClear);
saveSettingsBtn.addEventListener('click', handleSaveSettings);

// Load settings from storage
async function loadSettings() {
  try {
    const stored = await chrome.storage.local.get(['settings']);
    if (stored.settings) {
      settings = { ...settings, ...stored.settings };
      rpcUrlInput.value = settings.rpcUrl || '';
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
}

// Load saved addresses
async function loadSavedAddresses() {
  try {
    const stored = await chrome.storage.local.get(['lastAddresses']);
    if (stored.lastAddresses) {
      addressesInput.value = stored.lastAddresses;
    }
  } catch (e) {
    console.error('Failed to load addresses:', e);
  }
}

// Save settings
async function handleSaveSettings() {
  settings.rpcUrl = rpcUrlInput.value.trim() || DEFAULT_RPC;

  try {
    await chrome.storage.local.set({ settings });
    saveSettingsBtn.textContent = 'Saved!';
    setTimeout(() => {
      saveSettingsBtn.textContent = 'Save Settings';
    }, 1500);
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

// Clear all
function handleClear() {
  addressesInput.value = '';
  resultsSection.classList.add('hidden');
  errorSection.classList.add('hidden');
  resultsBody.innerHTML = '';
}

// Main check function
async function handleCheck() {
  const addressText = addressesInput.value.trim();
  if (!addressText) {
    showError('Please enter at least one Solana address');
    return;
  }

  // Parse addresses
  const addresses = addressText
    .split(/[\n,]+/)
    .map(a => a.trim())
    .filter(a => a.length > 0);

  // Validate
  if (addresses.length === 0) {
    showError('No valid addresses found');
    return;
  }

  if (addresses.length > MAX_ADDRESSES) {
    showError(`Maximum ${MAX_ADDRESSES} addresses allowed. You entered ${addresses.length}.`);
    return;
  }

  // Validate address format (base58, 32-44 chars)
  const invalidAddresses = addresses.filter(a => !isValidSolanaAddress(a));
  if (invalidAddresses.length > 0) {
    showError(`Invalid address format: ${invalidAddresses[0].substring(0, 20)}...`);
    return;
  }

  // Save addresses for next time
  try {
    await chrome.storage.local.set({ lastAddresses: addressText });
  } catch (e) {
    console.error('Failed to save addresses:', e);
  }

  // Show loading
  hideError();
  resultsSection.classList.add('hidden');
  loadingSection.classList.remove('hidden');
  checkBtn.disabled = true;

  try {
    const results = await fetchAllBalances(addresses);
    displayResults(results);
  } catch (e) {
    console.error('Main error:', e);
    showError(`Failed to fetch balances: ${e.message}`);
  } finally {
    loadingSection.classList.add('hidden');
    checkBtn.disabled = false;
  }
}

// Validate Solana address format
function isValidSolanaAddress(address) {
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  return base58Regex.test(address);
}

// Make RPC call with retry
async function rpcCall(method, params, retries = 2) {
  const rpcUrl = settings.rpcUrl || DEFAULT_RPC;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method,
          params
        })
      });

      if (response.status === 429) {
        // Rate limited, wait and retry
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        throw new Error('Rate limited by RPC');
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      if (data.error) {
        throw new Error(data.error.message || 'RPC error');
      }

      return data.result;
    } catch (e) {
      if (attempt === retries) throw e;
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

// Fetch balances for all addresses
async function fetchAllBalances(addresses) {
  const results = [];

  for (let i = 0; i < addresses.length; i++) {
    const address = addresses[i];

    try {
      // Get current balance
      const balanceResult = await rpcCall('getBalance', [address, { commitment: 'confirmed' }]);
      const currentBalance = (balanceResult?.value || 0) / LAMPORTS_PER_SOL;

      // Get balance change from transactions
      const netChange = await getBalanceChange(address);
      const historicalBalance = currentBalance - netChange;

      results.push({
        address,
        currentBalance,
        historicalBalance,
        pnl: netChange
      });
    } catch (e) {
      console.error(`Error for ${address}:`, e);

      // Try to at least get current balance
      let currentBalance = 0;
      try {
        const balanceResult = await rpcCall('getBalance', [address, { commitment: 'confirmed' }]);
        currentBalance = (balanceResult?.value || 0) / LAMPORTS_PER_SOL;
      } catch (e2) {
        console.error('Balance fetch also failed:', e2);
      }

      results.push({
        address,
        currentBalance,
        historicalBalance: null,
        pnl: null,
        error: e.message
      });
    }

    // Delay between addresses to avoid rate limits
    if (i < addresses.length - 1) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  return results;
}

// Get balance change from transaction history
async function getBalanceChange(address) {
  const eightHoursAgo = Math.floor(Date.now() / 1000) - EIGHT_HOURS_SEC;

  // Get recent signatures
  const signatures = await rpcCall('getSignaturesForAddress', [address, { limit: 30 }]);

  if (!signatures || signatures.length === 0) {
    return 0;
  }

  // Filter to last 8 hours
  const recentSigs = signatures.filter(s => s.blockTime && s.blockTime >= eightHoursAgo);

  if (recentSigs.length === 0) {
    return 0;
  }

  // Get transactions one at a time with delays to avoid rate limits
  let totalChange = 0;

  for (let i = 0; i < Math.min(recentSigs.length, 20); i++) {
    const sig = recentSigs[i];

    try {
      const tx = await rpcCall('getTransaction', [
        sig.signature,
        { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }
      ]);

      if (!tx || !tx.meta) continue;

      // Find address index
      const accountKeys = tx.transaction?.message?.accountKeys || [];
      let idx = -1;
      for (let j = 0; j < accountKeys.length; j++) {
        const key = accountKeys[j];
        const pubkey = typeof key === 'string' ? key : key.pubkey;
        if (pubkey === address) {
          idx = j;
          break;
        }
      }

      if (idx >= 0 && idx < tx.meta.preBalances.length) {
        const pre = tx.meta.preBalances[idx] || 0;
        const post = tx.meta.postBalances[idx] || 0;
        totalChange += (post - pre) / LAMPORTS_PER_SOL;
      }
    } catch (e) {
      console.warn(`Failed to get tx ${sig.signature}:`, e.message);
      // Continue with other transactions
    }

    // Small delay between transaction fetches
    if (i < recentSigs.length - 1) {
      await new Promise(r => setTimeout(r, 150));
    }
  }

  return totalChange;
}

// Display results in table
function displayResults(results) {
  resultsBody.innerHTML = '';

  let totalPnl = 0;
  let winners = 0;
  let losers = 0;
  let errorCount = 0;

  for (const result of results) {
    const row = document.createElement('tr');

    const addrCell = document.createElement('td');
    addrCell.className = 'address-cell';
    addrCell.textContent = shortenAddress(result.address);
    addrCell.title = result.address;

    const histCell = document.createElement('td');
    histCell.className = 'balance-cell';
    if (result.historicalBalance !== null) {
      histCell.textContent = formatBalance(result.historicalBalance);
    } else {
      histCell.textContent = 'Error';
      histCell.style.color = '#ff6b6b';
      histCell.title = result.error || 'Failed to fetch';
    }

    const currCell = document.createElement('td');
    currCell.className = 'balance-cell';
    currCell.textContent = formatBalance(result.currentBalance);

    const pnlCell = document.createElement('td');
    if (result.pnl !== null) {
      pnlCell.textContent = formatPnl(result.pnl);
      pnlCell.className = getPnlClass(result.pnl);
      totalPnl += result.pnl;

      if (result.pnl > 0.0001) winners++;
      else if (result.pnl < -0.0001) losers++;
    } else {
      pnlCell.textContent = '-';
      pnlCell.className = 'pnl-neutral';
      errorCount++;
    }

    row.appendChild(addrCell);
    row.appendChild(histCell);
    row.appendChild(currCell);
    row.appendChild(pnlCell);
    resultsBody.appendChild(row);
  }

  totalWalletsSpan.textContent = results.length;
  totalPnlSpan.textContent = formatPnl(totalPnl) + ' SOL';
  totalPnlSpan.className = 'value ' + getPnlClass(totalPnl);
  winLossSpan.textContent = `${winners}/${losers}`;

  resultsSection.classList.remove('hidden');

  if (errorCount > 0) {
    showError(`${errorCount}/${results.length} failed. RPC may be rate-limiting. Try fewer addresses or wait a bit.`);
  }
}

function shortenAddress(address) {
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function formatBalance(balance) {
  if (balance === 0) return '0';
  if (balance < 0) return '-' + formatBalance(Math.abs(balance));
  if (balance < 0.0001) return '<0.0001';
  if (balance < 1) return balance.toFixed(4);
  if (balance < 100) return balance.toFixed(3);
  if (balance < 10000) return balance.toFixed(2);
  return balance.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function formatPnl(pnl) {
  const prefix = pnl >= 0 ? '+' : '';
  if (Math.abs(pnl) < 0.0001) return '0';
  if (Math.abs(pnl) < 1) return prefix + pnl.toFixed(4);
  if (Math.abs(pnl) < 100) return prefix + pnl.toFixed(3);
  return prefix + pnl.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function getPnlClass(pnl) {
  if (pnl > 0.0001) return 'pnl-positive';
  if (pnl < -0.0001) return 'pnl-negative';
  return 'pnl-neutral';
}

function showError(message) {
  errorMessage.textContent = message;
  errorSection.classList.remove('hidden');
}

function hideError() {
  errorSection.classList.add('hidden');
}
