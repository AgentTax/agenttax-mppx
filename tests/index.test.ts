import { describe, it, expect, vi } from 'vitest';
import { agentTax } from '../src/index.js';

vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({
    success: true, total_tax: 0.07, combined_rate: 0.0825,
    buyer_state: 'TX', jurisdiction: 'Texas',
    sales_tax: { rate: 0.0625, local_rate: 0.02, combined_rate: 0.0825,
      state_rate: 0.0625, jurisdiction: 'Texas', classification: 'data_processing', note: null },
    audit_trail: {}, classification_basis: 'data_processing',
    transaction_id: 'txn_test',
  }),
}));

describe('agentTax', () => {
  it('creates a tax instance with charge method', () => {
    const tax = agentTax({ apiKey: 'atx_test', transactionType: 'compute' });
    expect(tax).toHaveProperty('charge');
    expect(typeof tax.charge).toBe('function');
  });

  it('charge() returns a middleware function', () => {
    const tax = agentTax({ apiKey: 'atx_test', transactionType: 'compute' });
    const mockMppx = { charge: vi.fn().mockReturnValue(vi.fn()) };
    const middleware = tax.charge(mockMppx as any, { amount: '1.00' });
    expect(typeof middleware).toBe('function');
  });

  it('calculates tax-inclusive amount and delegates to mppx', async () => {
    const tax = agentTax({ apiKey: 'atx_test', transactionType: 'compute', defaultState: 'TX' });
    const mppxChargeFn = vi.fn().mockImplementation((_req: any, _res: any, next: any) => next());
    const mockMppx = { charge: vi.fn().mockReturnValue(mppxChargeFn) };
    const middleware = tax.charge(mockMppx as any, { amount: '1.00', description: 'test' });

    const req = { headers: { 'x-buyer-state': 'TX' }, ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' } };
    const res = { setHeader: vi.fn(), end: vi.fn() };
    const next = vi.fn();

    await middleware(req, res, next);

    expect(mockMppx.charge).toHaveBeenCalled();
    const chargeArgs = mockMppx.charge.mock.calls[0][0];
    expect(parseFloat(chargeArgs.amount)).toBeCloseTo(1.07, 2);
  });

  it('uses splits when taxReserveWallet is set', async () => {
    const tax = agentTax({
      apiKey: 'atx_test', transactionType: 'compute',
      defaultState: 'TX', taxReserveWallet: '0xTAXWALLET',
    });
    const mppxChargeFn = vi.fn().mockImplementation((_req: any, _res: any, next: any) => next());
    const mockMppx = { charge: vi.fn().mockReturnValue(mppxChargeFn) };
    const middleware = tax.charge(mockMppx as any, { amount: '1.00' });

    const req = { headers: { 'x-buyer-state': 'TX' }, ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' } };
    const res = { setHeader: vi.fn(), end: vi.fn() };
    const next = vi.fn();

    await middleware(req, res, next);

    const chargeArgs = mockMppx.charge.mock.calls[0][0];
    expect(chargeArgs.splits).toBeDefined();
    expect(chargeArgs.splits[0].recipient).toBe('0xTAXWALLET');
    expect(parseFloat(chargeArgs.splits[0].amount)).toBeCloseTo(0.07, 2);
  });

  it('passes through without tax when no jurisdiction can be determined', async () => {
    const tax = agentTax({ apiKey: 'atx_test', transactionType: 'compute' });
    const mppxChargeFn = vi.fn().mockImplementation((_req: any, _res: any, next: any) => next());
    const mockMppx = { charge: vi.fn().mockReturnValue(mppxChargeFn) };
    const middleware = tax.charge(mockMppx as any, { amount: '1.00' });

    const req = { headers: {}, ip: '0.0.0.0', socket: { remoteAddress: '0.0.0.0' } };
    const res = { setHeader: vi.fn(), end: vi.fn() };
    const next = vi.fn();

    await middleware(req, res, next);

    const chargeArgs = mockMppx.charge.mock.calls[0][0];
    expect(chargeArgs.amount).toBe('1.00');
  });

  describe('onTaxUnavailable behavior (AgentTax API unreachable)', () => {
    it('rejects the charge with 503 by default when AgentTax is unreachable', async () => {
      // One-off failing fetch mock just for this test
      const failingFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      vi.stubGlobal('fetch', failingFetch);

      const tax = agentTax({ apiKey: 'atx_test', transactionType: 'compute', defaultState: 'TX' });
      const mppxChargeFn = vi.fn().mockImplementation((_req: any, _res: any, next: any) => next());
      const mockMppx = { charge: vi.fn().mockReturnValue(mppxChargeFn) };
      const middleware = tax.charge(mockMppx as any, { amount: '1.00' });

      const req = { headers: { 'x-buyer-state': 'TX' }, ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' } };
      const jsonSpy = vi.fn();
      const res = {
        status: vi.fn().mockReturnThis(),
        json: jsonSpy,
        setHeader: vi.fn(),
        end: vi.fn(),
      };
      const next = vi.fn();

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(jsonSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Tax calculation unavailable',
          buyer_state: 'TX',
          base_amount: '1.00',
        })
      );
      // Critically: mppx.charge() must NOT have been called when we reject.
      expect(mockMppx.charge).not.toHaveBeenCalled();

      // Restore the happy-path fetch mock for subsequent tests.
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true, total_tax: 0.07, combined_rate: 0.0825,
          buyer_state: 'TX', jurisdiction: 'Texas',
          sales_tax: { rate: 0.0625, local_rate: 0.02, combined_rate: 0.0825,
            state_rate: 0.0625, jurisdiction: 'Texas', classification: 'data_processing', note: null },
          audit_trail: {}, classification_basis: 'data_processing',
          transaction_id: 'txn_test',
        }),
      }));
    });

    it('allows the charge with $0 tax when onTaxUnavailable="allow" and emits fail-open audit', async () => {
      const failingFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      vi.stubGlobal('fetch', failingFetch);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const auditSink = vi.fn();

      const tax = agentTax({
        apiKey: 'atx_test',
        transactionType: 'compute',
        defaultState: 'TX',
        onTaxUnavailable: 'allow',
        onFailOpenAudit: auditSink,
      });
      const mppxChargeFn = vi.fn().mockImplementation((_req: any, _res: any, next: any) => next());
      const mockMppx = { charge: vi.fn().mockReturnValue(mppxChargeFn) };
      const middleware = tax.charge(mockMppx as any, { amount: '1.00' });

      const req = { headers: { 'x-buyer-state': 'TX' }, ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' } };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
        setHeader: vi.fn(),
        end: vi.fn(),
      };
      const next = vi.fn();

      await middleware(req, res, next);

      // Legacy behavior: charge proceeds with base amount, mppx.charge() is called.
      expect(mockMppx.charge).toHaveBeenCalled();
      const chargeArgs = mockMppx.charge.mock.calls[0][0];
      expect(chargeArgs.amount).toBe('1.00');
      expect(res.status).not.toHaveBeenCalled();

      // Fail-open audit: warn line AND callback MUST both fire exactly once.
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toMatch(/FAIL-OPEN/);
      expect(auditSink).toHaveBeenCalledTimes(1);
      const entry = auditSink.mock.calls[0][0];
      expect(entry.event).toBe('agenttax_mppx_fail_open');
      expect(entry.reason).toBe('tax_source_unavailable');
      expect(entry.config_setting).toBe('onTaxUnavailable=allow');
      expect(entry.buyer_state).toBe('TX');
      expect(entry.base_amount).toBe('1.00');
      expect(entry.transaction_type).toBe('compute');
      expect(entry.tax_collected).toBe(0);
      expect(typeof entry.timestamp).toBe('string');

      warnSpy.mockRestore();

      // Restore happy-path fetch.
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true, total_tax: 0.07, combined_rate: 0.0825,
          buyer_state: 'TX', jurisdiction: 'Texas',
          sales_tax: { rate: 0.0625, local_rate: 0.02, combined_rate: 0.0825,
            state_rate: 0.0625, jurisdiction: 'Texas', classification: 'data_processing', note: null },
          audit_trail: {}, classification_basis: 'data_processing',
          transaction_id: 'txn_test',
        }),
      }));
    });
  });
});
