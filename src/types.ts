export interface AgentTaxConfig {
  apiKey: string;
  transactionType: string;
  workType?: string;
  defaultState?: string;
  role?: 'seller' | 'buyer';
  isB2B?: boolean;
  taxReserveWallet?: string;
  asset?: AssetConfig;
  baseUrl?: string;
  counterpartyIdFrom?: 'ip' | 'source' | 'header';
  /**
   * What to do when the AgentTax API is unreachable and tax cannot be
   * calculated. The AgentTax guardrail is "conservative when in doubt" —
   * the default behavior is to REJECT the charge with HTTP 503 so the
   * caller gets a clear signal instead of silently undercharging.
   *
   *   'reject' (default) — respond 503, do not forward to mppx.charge()
   *   'allow'            — proceed with $0 tax and a receipt flag (legacy)
   */
  onTaxUnavailable?: 'reject' | 'allow';
}

export interface AssetConfig {
  symbol: string;
  trackGains: boolean;
  accountingMethod?: 'fifo' | 'lifo' | 'specific_id';
  residentState?: string;
}

export interface JurisdictionResult {
  state: string;
  zip: string | null;
  method: 'self_reported' | 'ip_geolocation' | 'config_default';
  verification: JurisdictionVerification;
}

export interface JurisdictionVerification {
  method: 'self_reported' | 'ip_geolocation' | 'both' | 'config_default';
  ip_state: string | null;
  ip_is_datacenter: boolean;
  self_reported_state: string | null;
  self_reported_zip: string | null;
  match: boolean | null;
  confidence: 'high' | 'medium' | 'low';
  flags: string[];
}

export interface TaxCalculation {
  success: boolean;
  total_tax: number;
  combined_rate: number;
  buyer_state: string;
  jurisdiction: string;
  sales_tax: any;
  audit_trail: any;
  classification_basis: string;
  tax_source: 'api' | 'unavailable';
}

export interface TradeResult {
  success: boolean;
  trade_id?: string;
  realized_gain?: number;
  term?: string;
  cost_basis?: number;
  error?: string;
}

export interface TaxReceipt {
  engine_version: string;
  base_amount: string;
  tax_amount: string;
  total_charged: string;
  sales_tax: {
    jurisdiction: string;
    state_rate: number;
    local_rate: number;
    combined_rate: number;
    classification: string;
    note: string | null;
  } | null;
  jurisdiction_verification: JurisdictionVerification;
  capital_gains: any | null;
  transaction_id: string | null;
  timestamp: string;
  tax_source: 'api' | 'unavailable';
  flags: string[];
}

export interface ChargeOptions {
  amount: string;
  description?: string;
  [key: string]: any;
}
