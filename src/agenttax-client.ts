import type { TaxCalculation, TradeResult } from './types.js';

interface CalculateParams {
  role: string;
  amount: number;
  buyer_state: string;
  buyer_zip?: string;
  transaction_type: string;
  work_type?: string;
  counterparty_id: string;
  is_b2b?: boolean;
}

interface TradeParams {
  asset_symbol: string;
  trade_type: 'buy' | 'sell';
  quantity: number;
  price_per_unit: number;
  accounting_method?: string;
  resident_state?: string;
}

function zeroTax(buyerState: string): TaxCalculation {
  return {
    success: true,
    total_tax: 0,
    combined_rate: 0,
    buyer_state: buyerState,
    jurisdiction: buyerState,
    sales_tax: null,
    audit_trail: null,
    classification_basis: '',
    tax_source: 'unavailable',
  };
}

export class AgentTaxClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl = 'https://agenttax.io') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async calculate(params: CalculateParams): Promise<TaxCalculation> {
    try {
      const resp = await fetch(`${this.baseUrl}/api/v1/calculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': this.apiKey },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(5000),
      });
      const data = await resp.json() as any;
      if (data.success) {
        return { ...data, tax_source: 'api' as const };
      }
      return zeroTax(params.buyer_state);
    } catch {
      return zeroTax(params.buyer_state);
    }
  }

  async logTrade(params: TradeParams): Promise<TradeResult> {
    try {
      const resp = await fetch(`${this.baseUrl}/api/v1/trades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': this.apiKey },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(5000),
      });
      return await resp.json() as TradeResult;
    } catch {
      return { success: false, error: 'AgentTax API unreachable — trade not logged' };
    }
  }
}
