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
   *
   * ⚠ The 'allow' setting is a fail-open. Every fail-open invocation logs
   *    a structured audit entry to stderr via console.warn, and (if
   *    provided) calls onFailOpenAudit(entry) so the host can ship the
   *    event to a proper audit sink. Do not run with 'allow' in production
   *    without that sink wired up.
   */
  onTaxUnavailable?: 'reject' | 'allow';

  /**
   * Optional callback invoked every time the 'allow' fail-open path fires.
   * Receives a structured audit entry (see FailOpenAuditEntry). Use it to
   * emit to Sentry, Datadog, a DB audit table, etc. Exceptions thrown by
   * the callback are caught and logged but do not block the charge.
   */
  onFailOpenAudit?: (entry: FailOpenAuditEntry) => void | Promise<void>;
}

/**
 * Structured record emitted on every fail-open invocation. Persist these;
 * they are the evidence trail for "we knowingly charged $0 tax because
 * our tax service was unavailable". Retain per your compliance policy.
 */
export interface FailOpenAuditEntry {
  event: 'agenttax_mppx_fail_open';
  timestamp: string; // ISO8601
  reason: 'tax_source_unavailable';
  config_setting: 'onTaxUnavailable=allow';
  buyer_state: string | null;
  buyer_zip: string | null;
  base_amount: string;
  transaction_type: string;
  counterparty_id: string;
  tax_collected: number;
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
