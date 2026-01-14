// Solana PnL Tracker - Popup Script
// Uses free RPC endpoints with fallbacks

const LAMPORTS_PER_SOL = 1_000_000_000;
const EIGHT_HOURS_SEC = 8 * 60 * 60;
const MAX_ADDRESSES = 20;

// Multiple RPC endpoints to try (free ones)
const RPC_ENDPOINTS = [
  'https://api.mainnet-beta.solana.com',
  'https://solana-mainnet.g.alchemy.com/v2/demo',
  'https://rpc.ankr.com/solana'
];

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

let settings = { rpcUrl: '' };
let workingRpc = RPC_ENDPOINTS[0];

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await loadSavedAddresses();
});

checkBtn.addEventListener('click', handleCheck);
clearBtn.addEventListener('click', handleClear);
saveSettingsBtn.addEventListener('click', handleSaveSettings);

async function loadSettings() {
  try {
    const stored = await chrome.storage.local.get(['settings']);
    if (stored.settings) {
      settings = stored.settings;
      rpcUrlInput.value = settings.rpcUrl || '';
    }
  } catch (e) {}
}

async function loadSavedAddresses() {
  try {
    const stored = await chrome.storage.local.get(['lastAddresses']);
    if (stored.lastAddresses) {
      addressesInput.value = stored.lastAddresses;
    }
  } catch (e) {}
}

async function handleSaveSettings() {
  settings.rpcUrl = rpcUrlInput.value.trim();
  try {
    await chrome.storage.local.set({ settings });
    saveSettingsBtn.textContent = 'Saved!';
    setTimeout(() => saveSettingsBtn.textContent = 'Save Settings', 1500);
  } catch (e) {}
}

function handleClear() {
  addressesInput.value = '';
  resultsSection.classList.add('hidden');
  errorSection.classList.add('hidden');
  resultsBody.innerHTML = '';
}

async function handleCheck() {
  const addressText = addressesInput.value.trim();
  if (!addressText) {
    showError('Please enter at least one Solana address');
    return;
  }

  const addresses = addressText.split(/[\n,]+/).map(a => a.trim()).filter(a => a.length > 0);

  if (addresses.length === 0) {
    showError('No valid addresses found');
    return;
  }

  if (addresses.length > MAX_ADDRESSES) {
    showError(`Maximum ${MAX_ADDRESSES} addresses allowed`);
    return;
  }

  const invalid = addresses.find(a => !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a));
  if (invalid) {
    showError(`Invalid address: ${invalid.slice(0, 12)}...`);
    return;
  }

  try {
    await chrome.storage.local.set({ lastAddresses: addressText });
  } catch (e) {}

  hideError();
  resultsSection.classList.add('hidden');
  loadingSection.classList.remove('hidden');
  checkBtn.disabled = true;

  try {
    const results = await fetchAllBalances(addresses);
    displayResults(results);
  } catch (e) {
    showError('Failed: ' + e.message);
  } finally {
    loadingSection.classList.add('hidden');
    checkBtn.disabled = false;
  }
}

async function rpc(method, params) {
  const endpoints = settings.rpcUrl ? [settings.rpcUrl, ...RPC_ENDPOINTS] : RPC_ENDPOINTS;

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
      });

      if (!res.ok) continue;

      const data = await res.json();
      if (data.error) continue;

      workingRpc = url;
      return data.result;
    } catch (e) {
      continue;
    }
  }
  throw new Error('All RPCs failed');
}

async function fetchAllBalances(addresses) {
  const results = [];

  for (const address of addresses) {
    try {
      // Current balance
      const bal = await rpc('getBalance', [address, { commitment: 'confirmed' }]);
      const currentBalance = (bal?.value || 0) / LAMPORTS_PER_SOL;

      // Get transaction history
      const pnl = await getPnL(address);
      const historicalBalance = currentBalance - pnl;

      results.push({ address, currentBalance, historicalBalance, pnl });
    } catch (e) {
      results.push({
        address,
        currentBalance: 0,
        historicalBalance: null,
        pnl: null,
        error: e.message
      });
    }

    // Delay
    await sleep(300);
  }

  return results;
}

async function getPnL(address) {
  const eightHoursAgo = Math.floor(Date.now() / 1000) - EIGHT_HOURS_SEC;

  // Get signatures
  const sigs = await rpc('getSignaturesForAddress', [address, { limit: 20 }]);
  if (!sigs || sigs.length === 0) return 0;

  // Filter to 8 hours
  const recent = sigs.filter(s => s.blockTime >= eightHoursAgo);
  if (recent.length === 0) return 0;

  let total = 0;

  for (const sig of recent.slice(0, 10)) {
    try {
      const tx = await rpc('getTransaction', [
        sig.signature,
        { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }
      ]);

      if (!tx?.meta) continue;

      const keys = tx.transaction?.message?.accountKeys || [];
      let idx = -1;
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        if ((typeof k === 'string' ? k : k.pubkey) === address) {
          idx = i;
          break;
        }
      }

      if (idx >= 0 && tx.meta.preBalances && tx.meta.postBalances) {
        const pre = tx.meta.preBalances[idx] || 0;
        const post = tx.meta.postBalances[idx] || 0;
        total += (post - pre) / LAMPORTS_PER_SOL;
      }
    } catch (e) {}

    await sleep(200);
  }

  return total;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function displayResults(results) {
  resultsBody.innerHTML = '';
  let totalPnl = 0, winners = 0, losers = 0, errors = 0;

  for (const r of results) {
    const row = document.createElement('tr');

    const addr = document.createElement('td');
    addr.className = 'address-cell';
    addr.textContent = r.address.slice(0, 4) + '...' + r.address.slice(-4);
    addr.title = r.address;

    const hist = document.createElement('td');
    hist.className = 'balance-cell';
    if (r.historicalBalance !== null) {
      hist.textContent = fmtBal(r.historicalBalance);
    } else {
      hist.textContent = 'Error';
      hist.style.color = '#ff6b6b';
      errors++;
    }

    const curr = document.createElement('td');
    curr.className = 'balance-cell';
    curr.textContent = fmtBal(r.currentBalance);

    const pnl = document.createElement('td');
    if (r.pnl !== null) {
      pnl.textContent = fmtPnl(r.pnl);
      pnl.className = r.pnl > 0.0001 ? 'pnl-positive' : r.pnl < -0.0001 ? 'pnl-negative' : 'pnl-neutral';
      totalPnl += r.pnl;
      if (r.pnl > 0.0001) winners++;
      else if (r.pnl < -0.0001) losers++;
    } else {
      pnl.textContent = '-';
      pnl.className = 'pnl-neutral';
    }

    row.append(addr, hist, curr, pnl);
    resultsBody.appendChild(row);
  }

  totalWalletsSpan.textContent = results.length;
  totalPnlSpan.textContent = fmtPnl(totalPnl) + ' SOL';
  totalPnlSpan.className = 'value ' + (totalPnl > 0 ? 'pnl-positive' : totalPnl < 0 ? 'pnl-negative' : 'pnl-neutral');
  winLossSpan.textContent = `${winners}/${losers}`;

  resultsSection.classList.remove('hidden');

  if (errors > 0) {
    showError(`${errors} failed. Using RPC: ${workingRpc.slice(0, 30)}...`);
  }
}

function fmtBal(b) {
  if (b === 0) return '0';
  if (Math.abs(b) < 0.0001) return '<0.0001';
  if (Math.abs(b) < 1) return b.toFixed(4);
  if (Math.abs(b) < 100) return b.toFixed(3);
  return b.toFixed(2);
}

function fmtPnl(p) {
  const pre = p >= 0 ? '+' : '';
  if (Math.abs(p) < 0.0001) return '0';
  if (Math.abs(p) < 1) return pre + p.toFixed(4);
  return pre + p.toFixed(3);
}

function showError(msg) {
  errorMessage.textContent = msg;
  errorSection.classList.remove('hidden');
}

function hideError() {
  errorSection.classList.add('hidden');
}
