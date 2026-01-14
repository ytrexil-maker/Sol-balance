// Solana PnL Tracker - Popup Script
// Uses Solscan Pro API to get historical balance data

const LAMPORTS_PER_SOL = 1_000_000_000;
const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
const EIGHT_HOURS_SEC = 8 * 60 * 60;
const DEFAULT_RPC = 'https://api.mainnet-beta.solana.com';
const SOLSCAN_API_BASE = 'https://pro-api.solscan.io/v2.0';
const SOL_TOKEN = 'So11111111111111111111111111111111111111111';
const MAX_ADDRESSES = 20;

// DOM Elements
const addressesInput = document.getElementById('addresses');
const checkBtn = document.getElementById('checkBtn');
const clearBtn = document.getElementById('clearBtn');
const rpcUrlInput = document.getElementById('rpcUrl');
const solscanKeyInput = document.getElementById('solscanKey');
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
  solscanKey: ''
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
      solscanKeyInput.value = settings.solscanKey || '';
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
  settings.solscanKey = solscanKeyInput.value.trim();

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
  // Check for API key first
  if (!settings.solscanKey) {
    showError('Solscan Pro API key required. Get one at solscan.io/apis and add it in Settings.');
    return;
  }

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
  // Get current balances in batch
  const currentBalances = await batchGetBalances(addresses);

  // Get historical data from Solscan for each address
  const results = await Promise.all(
    addresses.map(async (address, index) => {
      const currentBalance = currentBalances[index];

      try {
        // Get SOL transfers from last 8 hours from Solscan
        const netChange = await getSolscanNetChange(address);

        // Historical balance = current balance - net change over 8 hours
        // If net change is +5 SOL (received 5), then 8h ago was current - 5
        // If net change is -3 SOL (sent 3), then 8h ago was current + 3
        const historicalBalance = currentBalance - netChange;

        return {
          address,
          currentBalance,
          historicalBalance,
          pnl: netChange // PnL is the net change
        };
      } catch (e) {
        console.error(`Failed to get history for ${address}:`, e);
        return {
          address,
          currentBalance,
          historicalBalance: null,
          pnl: null,
          error: e.message
        };
      }
    })
  );

  return results;
}

// Get net SOL change from Solscan API over the last 8 hours
async function getSolscanNetChange(address) {
  const now = Math.floor(Date.now() / 1000);
  const eightHoursAgo = now - EIGHT_HOURS_SEC;

  let allTransfers = [];
  let page = 1;
  const pageSize = 100;
  let hasMore = true;

  // Paginate through all transfers in the time range
  while (hasMore) {
    const url = new URL(`${SOLSCAN_API_BASE}/account/transfer`);
    url.searchParams.set('address', address);
    url.searchParams.set('token', SOL_TOKEN);
    url.searchParams.set('from_time', eightHoursAgo.toString());
    url.searchParams.set('to_time', now.toString());
    url.searchParams.set('page', page.toString());
    url.searchParams.set('page_size', pageSize.toString());

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'token': settings.solscanKey,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Invalid Solscan API key');
      } else if (response.status === 429) {
        throw new Error('Rate limited - try again later');
      }
      throw new Error(`Solscan API error: ${response.status}`);
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.message || 'Solscan API returned error');
    }

    const transfers = data.data || [];
    allTransfers = allTransfers.concat(transfers);

    // Check if there are more pages
    if (transfers.length < pageSize) {
      hasMore = false;
    } else {
      page++;
      // Safety limit to prevent infinite loops
      if (page > 10) {
        hasMore = false;
      }
    }
  }

  // Calculate net change
  // flow: "in" means received, "out" means sent
  let netChange = 0;

  for (const transfer of allTransfers) {
    const amount = (transfer.amount || 0) / LAMPORTS_PER_SOL;

    if (transfer.flow === 'in') {
      netChange += amount;
    } else if (transfer.flow === 'out') {
      netChange -= amount;
    }
  }

  return netChange;
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

// Display results in table
function displayResults(results) {
  resultsBody.innerHTML = '';

  let totalPnl = 0;
  let winners = 0;
  let losers = 0;
  let validPnlCount = 0;
  let errorCount = 0;

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
      histCell.textContent = result.error ? 'Error' : 'N/A';
      histCell.style.color = '#ff6b6b';
      histCell.title = result.error || '';
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
      errorCount++;
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

  // Show error note if some failed
  if (errorCount > 0 && errorCount < results.length) {
    showError(`${errorCount} address(es) failed to fetch historical data. Check the API key or try again.`);
  } else if (errorCount === results.length) {
    showError('Failed to fetch historical data for all addresses. Check your Solscan API key.');
  }
}

// Utility functions
function shortenAddress(address) {
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function formatBalance(balance) {
  if (balance === 0) return '0';
  if (balance < 0) return formatBalance(Math.abs(balance)) + ' (neg)';
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
