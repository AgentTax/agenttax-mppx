# @agenttax/mppx

Tax middleware for MPP (Machine Payments Protocol). Makes any machine payment endpoint tax-compliant with one line of code.

## Why

MPP enables AI agents to pay for services programmatically. But every transaction is a taxable digital service in most US states — and nobody is calculating that tax. This middleware fills the gap.

## Install

```
npm install @agenttax/mppx
```

## Quick Start

```ts
import { Mppx, tempo } from 'mppx/express'
import { agentTax } from '@agenttax/mppx'

const mppx = Mppx.create({
  secretKey: process.env.MPP_SECRET_KEY,
  methods: [tempo({ recipient: '0x...', currency: USDC })],
})

const tax = agentTax({
  apiKey: process.env.AGENTTAX_API_KEY,
  transactionType: 'compute',
  workType: 'compute',
})

// Replace mppx.charge() with tax.charge()
app.get('/api/gpu-hour',
  tax.charge(mppx, { amount: '1.00', description: 'GPU compute hour' }),
  (req, res) => { res.json({ result: '...' }) }
)
```

The middleware:
1. Detects buyer jurisdiction (IP geolocation + optional X-Buyer-State header)
2. Calls AgentTax API to calculate sales tax
3. Adjusts the 402 challenge to the tax-inclusive amount
4. Attaches an X-Tax-Receipt header to the response

## Auto-Split Tax to Separate Wallet

```ts
const tax = agentTax({
  apiKey: process.env.AGENTTAX_API_KEY,
  transactionType: 'compute',
  taxReserveWallet: '0x...your-tax-reserve',
})
```

Tax portion automatically routes to a separate wallet via MPP splits. Both wallets belong to the merchant. AgentTax never touches the money.

## Capital Gains Tracking

```ts
const tax = agentTax({
  apiKey: process.env.AGENTTAX_API_KEY,
  transactionType: 'compute',
  asset: {
    symbol: 'GPU_HOUR',
    trackGains: true,
    accountingMethod: 'fifo',
    residentState: 'TX',
  },
})
```

Every payment logged as a trade. Sell-side responses include realized gain/loss.

## Buyer Headers (Optional)

Buyers can self-report jurisdiction for higher accuracy:

- `X-Buyer-State: TX` — 2-letter state code
- `X-Buyer-Zip: 78701` — 5-digit zip for local rates

The middleware cross-verifies against IP and flags mismatches. Datacenter/VPN IPs are detected and flagged automatically.

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | string | required | AgentTax API key |
| `transactionType` | string | required | compute, saas, api_access, etc. |
| `workType` | string | inferred | compute, research, content, consulting, trading |
| `role` | string | 'seller' | 'seller' or 'buyer' |
| `isB2B` | boolean | false | B2B transaction flag |
| `defaultState` | string | - | Fallback state when jurisdiction can't be determined |
| `taxReserveWallet` | string | - | 0x address for auto-split tax to separate wallet |
| `asset.symbol` | string | - | Asset identifier for capital gains tracking |
| `asset.trackGains` | boolean | false | Enable trade logging |
| `asset.accountingMethod` | string | 'fifo' | fifo, lifo, or specific_id |
| `asset.residentState` | string | - | State for capital gains rate |
| `baseUrl` | string | https://agenttax.io | AgentTax API base URL |
| `counterpartyIdFrom` | string | 'source' | How to derive counterparty ID: ip, source, or header |

## Get an API Key

```bash
curl -X POST https://agenttax.io/api/v1/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "password": "securepass", "agent_name": "my-agent"}'
```

Free tier: 100 calls/month. Save the `api_key.key` from the response — it's only shown once.

## Links

- [AgentTax](https://agenttax.io)
- [MPP Protocol](https://mpp.dev)
- [Agent Integration Guide](https://agenttax.io/api/v1/agents)
- [MCP Server](https://github.com/AgentTax/agenttax-mcp)

## License

MIT
