// Solana PnL Tracker - Popup Script

const LAMPORTS_PER_SOL = 1_000_000_000;
const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
const DEFAULT_RPC = 'https://api.mainnet-beta.solana.com';
const MAX_ADDRESSES = 20;

// DOM Elements
const addressesInput = document.getElementById('addresses');
const checkBtn = document.getElementById('checkBtn');
const clearBtn = document.getElementById('clearBtn');
const rpcUrlInput = document.getElementById('rpcUrl');
const heliusKeyInput = document.getElementById('heliusKey');
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
  rpcUrl: DEFAULT_RPC,
  heliusKey: ''
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
      heliusKeyInput.value = settings.heliusKey || '';
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
  settings.heliusKey = heliusKeyInput.value.trim();

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
    showError(`Failed to fetch balances: ${e.message}`);
  } finally {
    loadingSection.classList.add('hidden');
    checkBtn.disabled = false;
  }
}

// Validate Solana address format
function isValidSolanaAddress(address) {
  // Base58 characters (no 0, O, I, l)
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  return base58Regex.test(address);
}

// Fetch balances for all addresses
async function fetchAllBalances(addresses) {
  const results = [];
  const storedBalances = await getStoredBalances();
  const now = Date.now();

  // Batch RPC calls for current balances
  const currentBalances = await batchGetBalances(addresses);

  for (let i = 0; i < addresses.length; i++) {
    const address = addresses[i];
    const currentBalance = currentBalances[i];

    // Get historical balance
    let historicalBalance = null;
    let historicalSource = 'stored';

    // Check if we have a stored balance from ~8 hours ago
    const stored = storedBalances[address];
    if (stored && stored.length > 0) {
      // Find the closest balance to 8 hours ago
      const targetTime = now - EIGHT_HOURS_MS;
      const closest = findClosestBalance(stored, targetTime);
      if (closest) {
        historicalBalance = closest.balance;
        historicalSource = 'stored';
      }
    }

    // If no stored historical balance, try Helius if available
    if (historicalBalance === null && settings.heliusKey) {
      try {
        historicalBalance = await getHeliusHistoricalBalance(address);
        historicalSource = 'helius';
      } catch (e) {
        console.warn('Helius historical fetch failed:', e);
      }
    }

    // Store current balance for future reference
    await storeBalance(address, currentBalance, now);

    results.push({
      address,
      currentBalance,
      historicalBalance,
      historicalSource,
      pnl: historicalBalance !== null ? currentBalance - historicalBalance : null
    });
  }

  return results;
}

// Batch get current balances using JSON-RPC batch
async function batchGetBalances(addresses) {
  const rpcUrl = settings.rpcUrl || DEFAULT_RPC;

  // Create batch request
  const batchRequest = addresses.map((address, index) => ({
    jsonrpc: '2.0',
    id: index,
    method: 'getBalance',
    params: [address, { commitment: 'confirmed' }]
  }));

  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batchRequest)
    });

    if (!response.ok) {
      throw new Error(`RPC request failed: ${response.status}`);
    }

    const results = await response.json();

    // Sort by id and extract balances
    const sorted = Array.isArray(results) ? results.sort((a, b) => a.id - b.id) : [results];

    return sorted.map(r => {
      if (r.error) {
        console.warn('RPC error for address:', r.error);
        return 0;
      }
      return (r.result?.value || 0) / LAMPORTS_PER_SOL;
    });
  } catch (e) {
    console.error('Batch balance fetch failed:', e);
    // Fallback to individual requests
    return Promise.all(addresses.map(addr => getSingleBalance(addr)));
  }
}

// Get single balance (fallback)
async function getSingleBalance(address) {
  const rpcUrl = settings.rpcUrl || DEFAULT_RPC;

  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getBalance',
        params: [address, { commitment: 'confirmed' }]
      })
    });

    const result = await response.json();
    return (result.result?.value || 0) / LAMPORTS_PER_SOL;
  } catch (e) {
    console.error('Failed to get balance for', address, e);
    return 0;
  }
}

// Get stored balances from chrome storage
async function getStoredBalances() {
  try {
    const stored = await chrome.storage.local.get(['balanceHistory']);
    return stored.balanceHistory || {};
  } catch (e) {
    console.error('Failed to get stored balances:', e);
    return {};
  }
}

// Store a balance
async function storeBalance(address, balance, timestamp) {
  try {
    const stored = await chrome.storage.local.get(['balanceHistory']);
    const history = stored.balanceHistory || {};

    if (!history[address]) {
      history[address] = [];
    }

    // Add new entry
    history[address].push({ balance, timestamp });

    // Keep only entries from the last 24 hours
    const cutoff = Date.now() - (24 * 60 * 60 * 1000);
    history[address] = history[address].filter(e => e.timestamp > cutoff);

    // Limit to 50 entries per address
    if (history[address].length > 50) {
      history[address] = history[address].slice(-50);
    }

    await chrome.storage.local.set({ balanceHistory: history });
  } catch (e) {
    console.error('Failed to store balance:', e);
  }
}

// Find closest balance to target time
function findClosestBalance(entries, targetTime) {
  if (!entries || entries.length === 0) return null;

  // Find entry closest to 8 hours ago (within 2 hour window)
  const minTime = targetTime - (2 * 60 * 60 * 1000); // 6 hours ago
  const maxTime = targetTime + (2 * 60 * 60 * 1000); // 10 hours ago

  let closest = null;
  let closestDiff = Infinity;

  for (const entry of entries) {
    if (entry.timestamp >= minTime && entry.timestamp <= maxTime) {
      const diff = Math.abs(entry.timestamp - targetTime);
      if (diff < closestDiff) {
        closestDiff = diff;
        closest = entry;
      }
    }
  }

  // If no entry within window, use oldest entry if it's older than 6 hours
  if (!closest) {
    const oldest = entries[0];
    if (oldest && oldest.timestamp < (Date.now() - (6 * 60 * 60 * 1000))) {
      return oldest;
    }
  }

  return closest;
}

// Get historical balance from Helius (if API key available)
async function getHeliusHistoricalBalance(address) {
  if (!settings.heliusKey) return null;

  // Calculate timestamp for 8 hours ago
  const eightHoursAgo = new Date(Date.now() - EIGHT_HOURS_MS);

  try {
    // Use Helius getBalances endpoint with time context
    const response = await fetch(`https://api.helius.xyz/v0/addresses/${address}/balances?api-key=${settings.heliusKey}`);

    if (!response.ok) {
      throw new Error(`Helius API error: ${response.status}`);
    }

    const data = await response.json();

    // Find native SOL balance
    if (data.nativeBalance !== undefined) {
      return data.nativeBalance / LAMPORTS_PER_SOL;
    }

    return null;
  } catch (e) {
    console.warn('Helius fetch failed:', e);
    return null;
  }
}

// Display results in table
function displayResults(results) {
  resultsBody.innerHTML = '';

  let totalPnl = 0;
  let winners = 0;
  let losers = 0;
  let validPnlCount = 0;

  for (const result of results) {
    const row = document.createElement('tr');

    // Address cell
    const addrCell = document.createElement('td');
    addrCell.className = 'address-cell';
    addrCell.textContent = shortenAddress(result.address);
    addrCell.title = result.address;

    // Historical balance cell
    const histCell = document.createElement('td');
    histCell.className = 'balance-cell';
    if (result.historicalBalance !== null) {
      histCell.textContent = formatBalance(result.historicalBalance);
    } else {
      histCell.textContent = 'N/A';
      histCell.style.color = '#555';
    }

    // Current balance cell
    const currCell = document.createElement('td');
    currCell.className = 'balance-cell';
    currCell.textContent = formatBalance(result.currentBalance);

    // PnL cell
    const pnlCell = document.createElement('td');
    if (result.pnl !== null) {
      pnlCell.textContent = formatPnl(result.pnl);
      pnlCell.className = getPnlClass(result.pnl);
      totalPnl += result.pnl;
      validPnlCount++;

      if (result.pnl > 0.0001) winners++;
      else if (result.pnl < -0.0001) losers++;
    } else {
      pnlCell.textContent = '-';
      pnlCell.className = 'pnl-neutral';
    }

    row.appendChild(addrCell);
    row.appendChild(histCell);
    row.appendChild(currCell);
    row.appendChild(pnlCell);
    resultsBody.appendChild(row);
  }

  // Update summary
  totalWalletsSpan.textContent = results.length;
  totalPnlSpan.textContent = formatPnl(totalPnl) + ' SOL';
  totalPnlSpan.className = 'value ' + getPnlClass(totalPnl);
  winLossSpan.textContent = `${winners}/${losers}`;

  // Show results
  resultsSection.classList.remove('hidden');

  // Show note if no historical data
  if (validPnlCount === 0) {
    showError('No historical data available yet. Check again in 8 hours to see PnL comparison. Your current balances have been recorded.');
  }
}

// Utility functions
function shortenAddress(address) {
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function formatBalance(balance) {
  if (balance === 0) return '0';
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
