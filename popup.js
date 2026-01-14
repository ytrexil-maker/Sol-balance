// Solana PnL Tracker - Popup Script
// Uses Solana RPC directly for historical balance calculation (no external APIs needed)

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

// Fetch balances for all addresses
async function fetchAllBalances(addresses) {
  // Get current balances in batch
  const currentBalances = await batchGetBalances(addresses);

  // Get historical balance changes from transactions
  const results = [];

  for (let i = 0; i < addresses.length; i++) {
    const address = addresses[i];
    const currentBalance = currentBalances[i];

    try {
      // Calculate net change from transaction history
      const netChange = await getBalanceChangeFromRPC(address);
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

    // Small delay between addresses
    if (i < addresses.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return results;
}

// Get balance change from Solana RPC transaction history
async function getBalanceChangeFromRPC(address) {
  const rpcUrl = settings.rpcUrl || DEFAULT_RPC;
  const eightHoursAgo = Math.floor(Date.now() / 1000) - EIGHT_HOURS_SEC;

  // Get recent transaction signatures
  const sigResponse = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getSignaturesForAddress',
      params: [address, { limit: 100 }]
    })
  });

  const sigResult = await sigResponse.json();
  if (sigResult.error) {
    throw new Error(sigResult.error.message);
  }

  const signatures = sigResult.result || [];

  // Filter to only transactions in the last 8 hours
  const recentSigs = signatures.filter(sig => sig.blockTime && sig.blockTime >= eightHoursAgo);

  if (recentSigs.length === 0) {
    return 0; // No transactions in last 8 hours
  }

  // Get transaction details to calculate balance changes
  let totalChange = 0;

  // Process in batches of 10 to avoid overwhelming the RPC
  for (let i = 0; i < recentSigs.length; i += 10) {
    const batch = recentSigs.slice(i, i + 10);

    const txPromises = batch.map(sig =>
      fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: sig.signature,
          method: 'getTransaction',
          params: [sig.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]
        })
      }).then(r => r.json())
    );

    const txResults = await Promise.all(txPromises);

    for (const txResult of txResults) {
      if (txResult.error || !txResult.result) continue;

      const tx = txResult.result;
      const meta = tx.meta;
      if (!meta) continue;

      // Find this address in the account keys
      const accountKeys = tx.transaction?.message?.accountKeys || [];
      let accountIndex = -1;

      for (let j = 0; j < accountKeys.length; j++) {
        const key = accountKeys[j];
        const pubkey = typeof key === 'string' ? key : key.pubkey;
        if (pubkey === address) {
          accountIndex = j;
          break;
        }
      }

      if (accountIndex === -1) continue;

      // Calculate balance change for this transaction
      const preBalance = meta.preBalances?.[accountIndex] || 0;
      const postBalance = meta.postBalances?.[accountIndex] || 0;
      const change = (postBalance - preBalance) / LAMPORTS_PER_SOL;

      totalChange += change;
    }

    // Small delay between batches
    if (i + 10 < recentSigs.length) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  return totalChange;
}

// Batch get current balances using JSON-RPC batch
async function batchGetBalances(addresses) {
  const rpcUrl = settings.rpcUrl || DEFAULT_RPC;

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

    const addrCell = document.createElement('td');
    addrCell.className = 'address-cell';
    addrCell.textContent = shortenAddress(result.address);
    addrCell.title = result.address;

    const histCell = document.createElement('td');
    histCell.className = 'balance-cell';
    if (result.historicalBalance !== null) {
      histCell.textContent = formatBalance(result.historicalBalance);
    } else {
      histCell.textContent = result.error ? 'Error' : 'N/A';
      histCell.style.color = '#ff6b6b';
      histCell.title = result.error || '';
    }

    const currCell = document.createElement('td');
    currCell.className = 'balance-cell';
    currCell.textContent = formatBalance(result.currentBalance);

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

  totalWalletsSpan.textContent = results.length;
  totalPnlSpan.textContent = formatPnl(totalPnl) + ' SOL';
  totalPnlSpan.className = 'value ' + getPnlClass(totalPnl);
  winLossSpan.textContent = `${winners}/${losers}`;

  resultsSection.classList.remove('hidden');

  if (errorCount > 0 && errorCount < results.length) {
    showError(`${errorCount} address(es) failed to fetch.`);
  } else if (errorCount === results.length) {
    showError('Failed to fetch historical data.');
  }
}

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
