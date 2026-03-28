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
});
