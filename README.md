# Solana PnL Tracker - Edge Extension

A Microsoft Edge browser extension that tracks profit/loss for Solana wallets by comparing current balance vs 8 hours ago.

**No API key required** - Uses free Solscan public API.

## Features

- Paste up to 20 Solana wallet addresses
- View current SOL balance for each wallet
- Compare against balance from 8 hours ago
- See profit/loss in SOL
- Summary stats: total wallets, total PnL, winners/losers count
- No API key or signup required

## Installation

### Load as Unpacked Extension (Developer Mode)

1. Clone or download this repository
2. Open Microsoft Edge and navigate to `edge://extensions/`
3. Enable **Developer mode** (toggle in bottom-left)
4. Click **Load unpacked**
5. Select the folder containing this extension
6. The extension icon should appear in your toolbar

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
2. **Historical Balance**: Calculated using Solscan's free public API:
   - Fetches all SOL transfers from the last 8 hours
   - Calculates net change (inflows - outflows)
   - Historical balance = Current balance - Net change
3. **PnL**: The net change in SOL over 8 hours

## Technical Details

- Built with Manifest V3 for Edge compatibility
- Uses free Solscan public API (`public-api.solscan.io`)
- Uses batch RPC calls for efficient current balance fetching
- Includes rate limit handling with delays between requests
- No API key required

## Files

```
├── manifest.json      # Extension configuration
├── popup.html         # Main UI
├── popup.js           # Core logic
├── styles.css         # Styling
├── background.js      # Background service worker
└── icons/             # Extension icons
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## API Endpoints Used

- **Solana RPC**: `getBalance` for current SOL balance
- **Solscan Public API**: `/account/solTransfers` for SOL transfer history

## Permissions

- `storage`: To save settings and last-used addresses locally
- `https://api.mainnet-beta.solana.com/*`: To fetch current SOL balances
- `https://public-api.solscan.io/*`: To fetch historical transfer data

## Rate Limits

The free Solscan public API has rate limits. If you encounter errors:
- Reduce the number of addresses per check
- Wait a minute between checks
- The extension adds small delays between requests to help avoid limits

## License

MIT
