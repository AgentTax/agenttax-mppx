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

## When AgentTax Is Unreachable

By default, if the AgentTax API can't be reached, the middleware **rejects the charge with HTTP 503**. This is the conservative default — charging base-amount-only with no tax receipt is a compliance gap. Your caller sees the error and can retry.

You can opt into legacy fail-open behavior with `onTaxUnavailable: 'allow'`. **Read the warning below before doing this.**

### ⚠ Warning on `onTaxUnavailable: 'allow'` (fail-open)

Setting `onTaxUnavailable: 'allow'` causes the middleware to proceed with a **$0-tax receipt** when the AgentTax API is unreachable. The charge still completes; the buyer is undercharged; you have no calculation trail for that transaction.

Use this setting only if **both** are true:

1. Your flow is demonstrably non-taxable in every jurisdiction you reach (e.g. SKUs limited to no-sales-tax states, or an exempt-sale-only platform).
2. You have a **separate compliance control** outside this middleware — an independent tax engine, a manual review queue, or a documented legal opinion that $0 tax is correct for every possible buyer you can reach.

Every fail-open invocation now emits:

- A `console.warn` line prefixed `[agenttax/mppx] FAIL-OPEN:` containing a structured JSON payload with timestamp, buyer state/ZIP, base amount, transaction type, and counterparty ID.
- An optional `onFailOpenAudit(entry)` callback you provide in config — use it to ship the event to Sentry, Datadog, a DB audit table, or anywhere else your retention policy requires.

```ts
const tax = agentTax({
  apiKey: process.env.AGENTTAX_API_KEY,
  transactionType: 'compute',
  onTaxUnavailable: 'allow',            // opt-in; read warning above
  onFailOpenAudit: (entry) => {
    await db.query(
      'INSERT INTO fail_open_audit(event, ts, state, amount, counterparty, tx_type) VALUES ($1,$2,$3,$4,$5,$6)',
      [entry.event, entry.timestamp, entry.buyer_state, entry.base_amount, entry.counterparty_id, entry.transaction_type]
    );
  },
});
```

If you run with `'allow'` and no `onFailOpenAudit` sink, you still get the stderr line — but shipping those to a proper audit store (not just Vercel function logs, which rotate) is on you.

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
| `onTaxUnavailable` | string | 'reject' | 'reject' (503 on API outage) or 'allow' (fail-open, logs audit; see warning above) |
| `onFailOpenAudit` | function | - | Optional callback `(entry) => void` invoked for every fail-open. Use to ship to your audit store. |

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
