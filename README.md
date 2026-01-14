# Solana PnL Tracker - Edge Extension

A Microsoft Edge browser extension that tracks profit/loss for Solana wallets by comparing current balance vs 8 hours ago.

## Features

- Paste up to 20 Solana wallet addresses
- View current SOL balance for each wallet
- Compare against balance from 8 hours ago
- See profit/loss in SOL
- Summary stats: total wallets, total PnL, winners/losers count
- Stores balance history locally for comparison
- Optional Helius API integration for enhanced historical data

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

### First Time Usage Note

The extension stores balance snapshots when you check addresses. On your first check, there won't be historical data available yet - the "8h Ago" column will show "N/A".

Check your addresses again after 8+ hours to see the actual PnL comparison.

## Settings

Click **Settings** to configure:

- **RPC Endpoint**: Custom Solana RPC URL (defaults to public mainnet)
- **Helius API Key**: Optional - provides better historical data

## How It Works

1. **Current Balance**: Fetched in real-time from Solana RPC
2. **Historical Balance**: Stored locally when you check addresses. The extension looks for a stored balance from approximately 8 hours ago (with a 2-hour tolerance window)
3. **PnL Calculation**: Simply `Current Balance - Historical Balance`

## Technical Details

- Built with Manifest V3 for Edge compatibility
- Uses batch RPC calls for efficient balance fetching
- Stores up to 24 hours of balance history per address
- Automatically cleans up old data via background worker
- No external servers - all data stored locally

## Files

```
├── manifest.json      # Extension configuration
├── popup.html         # Main UI
├── popup.js          # Core logic
├── styles.css        # Styling
├── background.js     # Background service worker
└── icons/            # Extension icons
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Permissions

- `storage`: To save balance history and settings locally
- `https://api.mainnet-beta.solana.com/*`: To fetch SOL balances
- `https://api.helius.xyz/*`: Optional, for enhanced historical data

## License

MIT
