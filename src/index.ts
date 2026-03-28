import { resolveJurisdiction } from './jurisdiction.js';
import { AgentTaxClient } from './agenttax-client.js';
import type { AgentTaxConfig, ChargeOptions, TaxReceipt } from './types.js';

export { resolveJurisdiction } from './jurisdiction.js';
export { AgentTaxClient } from './agenttax-client.js';
export { isValidState } from './jurisdiction.js';
export type { AgentTaxConfig, TaxReceipt, JurisdictionResult, JurisdictionVerification } from './types.js';

export function agentTax(config: AgentTaxConfig) {
  const client = new AgentTaxClient(
    config.apiKey,
    config.baseUrl || 'https://agenttax.io',
  );
  const role = config.role || 'seller';
  const isB2B = config.isB2B || false;

  function charge(mppx: any, opts: ChargeOptions) {
    return async function taxMiddleware(req: any, res: any, next: any) {
      const baseAmount = parseFloat(opts.amount);

      // 1. Resolve jurisdiction
      const jurisdiction = resolveJurisdiction(req, config.defaultState);

      if (!jurisdiction.state) {
        const mppxMiddleware = mppx.charge({ ...opts });
        return mppxMiddleware(req, res, next);
      }

      // 2. Derive counterparty_id
      let counterpartyId = 'unknown';
      if (config.counterpartyIdFrom === 'header') {
        counterpartyId = req.headers?.['x-counterparty-id'] || 'unknown';
      } else if (config.counterpartyIdFrom === 'ip') {
        counterpartyId = req.ip || req.socket?.remoteAddress || 'unknown';
      } else {
        counterpartyId = req.headers?.['x-counterparty-id'] || req.ip || 'unknown';
      }

      // 3. Calculate tax
      const taxResult = await client.calculate({
        role,
        amount: baseAmount,
        buyer_state: jurisdiction.state,
        buyer_zip: jurisdiction.zip || undefined,
        transaction_type: config.transactionType,
        work_type: config.workType,
        counterparty_id: counterpartyId,
        is_b2b: isB2B,
      });

      const taxAmount = taxResult.total_tax || 0;
      const total = Math.round((baseAmount + taxAmount) * 100) / 100;

      // 4. Build charge options
      const chargeOpts: any = { ...opts, amount: total.toFixed(2) };

      if (config.taxReserveWallet && taxAmount > 0) {
        chargeOpts.splits = [
          { amount: taxAmount.toFixed(2), recipient: config.taxReserveWallet },
        ];
      }

      if (opts.description && taxAmount > 0) {
        chargeOpts.description = `${opts.description} (incl. $${taxAmount.toFixed(2)} tax)`;
      }

      // 5. Build tax receipt
      const receipt: TaxReceipt = {
        engine_version: '1.5',
        base_amount: baseAmount.toFixed(2),
        tax_amount: taxAmount.toFixed(2),
        total_charged: total.toFixed(2),
        sales_tax: taxResult.sales_tax ? {
          jurisdiction: taxResult.jurisdiction,
          state_rate: taxResult.sales_tax?.state_rate || taxResult.combined_rate,
          local_rate: taxResult.sales_tax?.local_rate || 0,
          combined_rate: taxResult.combined_rate,
          classification: taxResult.classification_basis,
          note: taxResult.sales_tax?.note || null,
        } : null,
        jurisdiction_verification: jurisdiction.verification,
        capital_gains: null,
        transaction_id: (taxResult as any).transaction_id || null,
        timestamp: new Date().toISOString(),
        tax_source: taxResult.tax_source,
        flags: [...jurisdiction.verification.flags],
      };

      if (taxResult.tax_source === 'unavailable') {
        receipt.flags.push('tax_source: unavailable — AgentTax API was unreachable. No tax calculated.');
      }

      // 6. Capital gains tracking
      if (config.asset?.trackGains) {
        try {
          const tradeResult = await client.logTrade({
            asset_symbol: config.asset.symbol,
            trade_type: role === 'buyer' ? 'buy' : 'sell',
            quantity: 1,
            price_per_unit: baseAmount,
            accounting_method: config.asset.accountingMethod,
            resident_state: config.asset.residentState,
          });
          if (tradeResult.success) {
            receipt.capital_gains = {
              asset_symbol: config.asset.symbol,
              side: role === 'buyer' ? 'buy' : 'sell',
              quantity: 1,
              price_per_unit: baseAmount.toFixed(2),
              realized_gain: tradeResult.realized_gain ?? null,
              term: tradeResult.term ?? null,
              cost_basis: tradeResult.cost_basis ?? null,
              accounting_method: config.asset.accountingMethod || 'fifo',
              note: role === 'buyer' ? 'Buy logged. Cost basis established. Gains calculated on sell.' : undefined,
            };
          } else {
            receipt.flags.push('gains_logging_failed — trade not recorded');
          }
        } catch {
          receipt.flags.push('gains_logging_failed — AgentTax trades API unreachable');
        }
      }

      // 7. Store receipt on request
      (req as any).__taxReceipt = receipt;

      // 8. Wrap response to attach X-Tax-Receipt header
      const origSetHeader = res.setHeader?.bind(res);
      const origEnd = res.end?.bind(res);
      if (origEnd) {
        res.end = function (...args: any[]) {
          if ((req as any).__taxReceipt && origSetHeader) {
            const receiptB64 = Buffer.from(JSON.stringify((req as any).__taxReceipt)).toString('base64');
            origSetHeader('X-Tax-Receipt', receiptB64);
          }
          return origEnd(...args);
        };
      }

      // 9. Delegate to mppx.charge()
      const mppxMiddleware = mppx.charge(chargeOpts);
      return mppxMiddleware(req, res, next);
    };
  }

  return { charge };
}
