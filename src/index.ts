import { resolveJurisdiction } from './jurisdiction.js';
import { AgentTaxClient } from './agenttax-client.js';
import type { AgentTaxConfig, ChargeOptions, TaxReceipt, FailOpenAuditEntry } from './types.js';

export { resolveJurisdiction } from './jurisdiction.js';
export { AgentTaxClient } from './agenttax-client.js';
export { isValidState } from './jurisdiction.js';
export type { AgentTaxConfig, TaxReceipt, JurisdictionResult, JurisdictionVerification, FailOpenAuditEntry } from './types.js';

export function agentTax(config: AgentTaxConfig) {
  const client = new AgentTaxClient(
    config.apiKey,
    config.baseUrl || 'https://agenttax.io',
  );
  const role = config.role || 'seller';
  const isB2B = config.isB2B || false;
  // Default: reject the charge if AgentTax can't calculate tax. This matches
  // the "conservative when in doubt" guardrail in the main product — silently
  // charging base-amount-only is the inverse of that policy.
  const onTaxUnavailable = config.onTaxUnavailable || 'reject';

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

      // ── Tax unavailable handling ──
      // The client returns { tax_source: 'unavailable' } when the AgentTax
      // API can't be reached or returns success=false. Charging the base
      // amount in that state is a compliance bug: the merchant collects $0
      // tax and has no receipt trail. Default is to reject; caller can opt
      // into the legacy "allow" behavior explicitly.
      if (taxResult.tax_source === 'unavailable' && onTaxUnavailable === 'reject') {
        if (res?.status && res?.json) {
          return res.status(503).json({
            error: 'Tax calculation unavailable',
            message: 'AgentTax API is unreachable. Charge rejected because tax cannot be calculated. Set { onTaxUnavailable: "allow" } in agentTax() config to bypass (not recommended).',
            buyer_state: jurisdiction.state,
            base_amount: baseAmount.toFixed(2),
          });
        }
        // Non-Express-shaped response — surface via next() so hosts using a
        // raw Node handler or a custom framework see the error.
        const err = new Error('AgentTax tax calculation unavailable — charge rejected');
        (err as any).status = 503;
        (err as any).code = 'AGENTTAX_UNAVAILABLE';
        if (typeof next === 'function') return next(err);
        throw err;
      }

      // Fail-open audit: when allow is set and the API is down, we're about
      // to process a $0-tax charge. Emit a structured record so the host can
      // prove (a) the fail-open happened, (b) under what config, and (c) for
      // which transaction. Every fail-open produces a warn line AND calls
      // the caller's onFailOpenAudit hook if supplied. Do not swallow.
      if (taxResult.tax_source === 'unavailable' && onTaxUnavailable === 'allow') {
        const auditEntry: FailOpenAuditEntry = {
          event: 'agenttax_mppx_fail_open',
          timestamp: new Date().toISOString(),
          reason: 'tax_source_unavailable',
          config_setting: 'onTaxUnavailable=allow',
          buyer_state: jurisdiction.state,
          buyer_zip: jurisdiction.zip || null,
          base_amount: baseAmount.toFixed(2),
          transaction_type: config.transactionType,
          counterparty_id: counterpartyId,
          tax_collected: 0,
        };
        // Single-line JSON for log ingestion friendliness.
        console.warn('[agenttax/mppx] FAIL-OPEN: tax unavailable, allowing $0 tax per config. ' + JSON.stringify(auditEntry));
        if (typeof config.onFailOpenAudit === 'function') {
          try {
            const maybePromise = config.onFailOpenAudit(auditEntry);
            if (maybePromise && typeof (maybePromise as any).catch === 'function') {
              (maybePromise as Promise<void>).catch((err) =>
                console.error('[agenttax/mppx] onFailOpenAudit rejected:', err),
              );
            }
          } catch (err) {
            console.error('[agenttax/mppx] onFailOpenAudit threw:', err);
          }
        }
      }

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
