// Solana PnL Tracker - Popup Script
// Uses Solscan Public API (free, no API key required)

const LAMPORTS_PER_SOL = 1_000_000_000;
const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
const EIGHT_HOURS_SEC = 8 * 60 * 60;
const DEFAULT_RPC = 'https://api.mainnet-beta.solana.com';
const SOLSCAN_PUBLIC_API = 'https://public-api.solscan.io';
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

  // Get historical data from Solscan for each address (with small delay to avoid rate limits)
  const results = [];

  for (let i = 0; i < addresses.length; i++) {
    const address = addresses[i];
    const currentBalance = currentBalances[i];

    try {
      // Get SOL transfers from last 8 hours from Solscan
      const netChange = await getSolscanNetChange(address);

      // Historical balance = current balance - net change over 8 hours
      const historicalBalance = currentBalance - netChange;

      results.push({
        address,
        currentBalance,
        historicalBalance,
        pnl: netChange
      });
    } catch (e) {
      console.error(`Failed to get history for ${address}:`, e);
      results.push({
        address,
        currentBalance,
        historicalBalance: null,
        pnl: null,
        error: e.message
      });
    }

    // Small delay between requests to avoid rate limiting (100ms)
    if (i < addresses.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return results;
}

// Get net SOL change from Solscan Public API over the last 8 hours
async function getSolscanNetChange(address) {
  const now = Math.floor(Date.now() / 1000);
  const eightHoursAgo = now - EIGHT_HOURS_SEC;

  let allTransfers = [];
  let offset = 0;
  const limit = 50;
  let hasMore = true;

  // Paginate through transfers
  while (hasMore) {
    const url = `${SOLSCAN_PUBLIC_API}/account/solTransfers?account=${address}&limit=${limit}&offset=${offset}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error('Rate limited - wait a moment and try again');
      }
      throw new Error(`Solscan API error: ${response.status}`);
    }

    const data = await response.json();

    // Handle different response formats
    const transfers = Array.isArray(data) ? data : (data.data || []);

    if (transfers.length === 0) {
      hasMore = false;
      break;
    }

    // Filter transfers within the last 8 hours
    for (const transfer of transfers) {
      const blockTime = transfer.blockTime || transfer.block_time || 0;

      if (blockTime >= eightHoursAgo) {
        allTransfers.push(transfer);
      } else {
        // Transfers are sorted by time desc, so we can stop when we hit old ones
        hasMore = false;
        break;
      }
    }

    // Check if we should continue paginating
    if (hasMore && transfers.length === limit) {
      offset += limit;
      // Safety limit
      if (offset > 500) {
        hasMore = false;
      }
    } else {
      hasMore = false;
    }
  }

  // Calculate net change
  let netChange = 0;

  for (const transfer of allTransfers) {
    // Amount is in lamports
    const amount = (transfer.lamport || transfer.amount || 0) / LAMPORTS_PER_SOL;
    const src = transfer.src || transfer.source || transfer.from_address || '';
    const dst = transfer.dst || transfer.destination || transfer.to_address || '';

    // Determine if this is incoming or outgoing
    if (dst.toLowerCase() === address.toLowerCase()) {
      // Incoming transfer
      netChange += amount;
    } else if (src.toLowerCase() === address.toLowerCase()) {
      // Outgoing transfer
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
    showError(`${errorCount} address(es) failed. May be rate limited - try fewer addresses.`);
  } else if (errorCount === results.length) {
    showError('Failed to fetch data. The free API may be rate limited - try again in a minute.');
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
