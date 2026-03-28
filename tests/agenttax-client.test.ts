import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentTaxClient } from '../src/agenttax-client.js';

describe('AgentTaxClient', () => {
  let client: AgentTaxClient;

  beforeEach(() => {
    client = new AgentTaxClient('atx_test_key', 'https://agenttax.io');
  });

  it('constructs correct calculate request', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        success: true, total_tax: 0.07, combined_rate: 0.0825,
        buyer_state: 'TX', jurisdiction: 'Texas',
        sales_tax: { rate: 0.0625 }, audit_trail: {},
        classification_basis: 'data_processing',
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await client.calculate({
      role: 'seller', amount: 1.00, buyer_state: 'TX',
      transaction_type: 'compute', counterparty_id: 'test',
    });

    expect(result.success).toBe(true);
    expect(result.total_tax).toBe(0.07);
    expect(result.tax_source).toBe('api');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://agenttax.io/api/v1/calculate',
      expect.objectContaining({ method: 'POST' }),
    );
    vi.unstubAllGlobals();
  });

  it('returns zero tax on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

    const result = await client.calculate({
      role: 'seller', amount: 1.00, buyer_state: 'TX',
      transaction_type: 'compute', counterparty_id: 'test',
    });

    expect(result.success).toBe(true);
    expect(result.total_tax).toBe(0);
    expect(result.tax_source).toBe('unavailable');
    vi.unstubAllGlobals();
  });

  it('returns zero tax on API error response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ success: false, error: 'Bad request' }),
    }));

    const result = await client.calculate({
      role: 'seller', amount: 1.00, buyer_state: 'TX',
      transaction_type: 'compute', counterparty_id: 'test',
    });

    expect(result.success).toBe(true);
    expect(result.total_tax).toBe(0);
    expect(result.tax_source).toBe('unavailable');
    vi.unstubAllGlobals();
  });

  it('constructs correct trade request', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, trade_id: 'trd_123' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await client.logTrade({
      asset_symbol: 'GPU_HOUR', trade_type: 'buy',
      quantity: 10, price_per_unit: 1.00,
    });

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://agenttax.io/api/v1/trades',
      expect.objectContaining({ method: 'POST' }),
    );
    vi.unstubAllGlobals();
  });

  it('returns error on trade failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));

    const result = await client.logTrade({
      asset_symbol: 'GPU_HOUR', trade_type: 'buy',
      quantity: 10, price_per_unit: 1.00,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    vi.unstubAllGlobals();
  });
});
