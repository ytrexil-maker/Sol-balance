# Solana PnL Tracker - Edge Extension

A Microsoft Edge browser extension that tracks profit/loss for Solana wallets by comparing current balance vs 8 hours ago using the Solscan Pro API.

## Features

- Paste up to 20 Solana wallet addresses
- View current SOL balance for each wallet
- Compare against balance from 8 hours ago (via Solscan API)
- See profit/loss in SOL
- Summary stats: total wallets, total PnL, winners/losers count
- Real-time historical data from Solscan Pro API

## Requirements

**Solscan Pro API Key** - Required to fetch historical balance data.
- Get your API key at [solscan.io/apis](https://solscan.io/apis)
- Free tier available with rate limits

## Installation

### Load as Unpacked Extension (Developer Mode)

1. Clone or download this repository
2. Open Microsoft Edge and navigate to `edge://extensions/`
3. Enable **Developer mode** (toggle in bottom-left)
4. Click **Load unpacked**
5. Select the folder containing this extension
6. The extension icon should appear in your toolbar

## Setup

1. Click the extension icon
2. Expand **Settings**
3. Enter your Solscan Pro API key
4. Click **Save Settings**

## Usage

1. Click the extension icon in your toolbar
2. Paste Solana wallet addresses (one per line, max 20)
3. Click **Check PnL**
4. View the results table showing:
   - Address (shortened)
   - Balance 8 hours ago
   - Current balance
   - Profit/Loss

## How It Works

1. **Current Balance**: Fetched in real-time from Solana RPC
2. **Historical Balance**: Calculated using Solscan Pro API's transfer endpoint:
   - Fetches all SOL transfers from the last 8 hours
   - Calculates net change (inflows - outflows)
   - Historical balance = Current balance - Net change
3. **PnL**: The net change in SOL over 8 hours

## Technical Details

- Built with Manifest V3 for Edge compatibility
- Uses Solscan Pro API for historical transfer data
- Uses batch RPC calls for efficient current balance fetching
- Paginates through Solscan API results automatically
- Settings stored locally via chrome.storage

## Files

```
├── manifest.json      # Extension configuration
├── popup.html         # Main UI
├── popup.js           # Core logic (Solscan API integration)
├── styles.css         # Styling
├── background.js      # Background service worker
└── icons/             # Extension icons
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## API Endpoints Used

- **Solana RPC**: `getBalance` for current SOL balance
- **Solscan Pro API**: `/v2.0/account/transfer` for SOL transfer history

## Permissions

- `storage`: To save API key and settings locally
- `https://api.mainnet-beta.solana.com/*`: To fetch current SOL balances
- `https://pro-api.solscan.io/*`: To fetch historical transfer data

## Rate Limits

Solscan Pro API has rate limits based on your plan. If you hit rate limits:
- Reduce the number of addresses per check
- Wait between checks
- Consider upgrading your Solscan API plan

## License

MIT
