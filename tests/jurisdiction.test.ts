import { describe, it, expect } from 'vitest';
import { resolveJurisdiction } from '../src/jurisdiction.js';

function mockReq(headers: Record<string, string> = {}, ip = '73.162.100.50') {
  return {
    headers: { 'x-forwarded-for': ip, ...headers },
    ip,
    socket: { remoteAddress: ip },
  } as any;
}

describe('resolveJurisdiction', () => {
  it('resolves state from IP geolocation', () => {
    const result = resolveJurisdiction(mockReq());
    expect(result.state).toBeTruthy();
    expect(result.method).toBe('ip_geolocation');
    expect(result.verification.confidence).toBeDefined();
  });

  it('prefers X-Buyer-State header over IP', () => {
    const result = resolveJurisdiction(mockReq({ 'x-buyer-state': 'TX' }));
    expect(result.state).toBe('TX');
    expect(result.method).toBe('self_reported');
  });

  it('extracts zip from X-Buyer-Zip header', () => {
    const result = resolveJurisdiction(mockReq({ 'x-buyer-state': 'TX', 'x-buyer-zip': '78701' }));
    expect(result.state).toBe('TX');
    expect(result.zip).toBe('78701');
  });

  it('ignores invalid state header and falls back to IP', () => {
    const result = resolveJurisdiction(mockReq({ 'x-buyer-state': 'INVALID' }));
    expect(result.method).not.toBe('self_reported');
    expect(result.verification.flags).toContain('invalid_buyer_header — X-Buyer-State value not a valid US state code. Ignored.');
  });

  it('flags datacenter IPs with low confidence', () => {
    const result = resolveJurisdiction(mockReq({}, '52.94.1.1'), 'CA');
    expect(result.verification.ip_is_datacenter).toBe(true);
    expect(result.verification.confidence).toBe('low');
  });

  it('flags mismatch between IP and self-reported state', () => {
    const result = resolveJurisdiction(mockReq({ 'x-buyer-state': 'TX' }, '73.162.100.50'));
    if (result.verification.ip_state && result.verification.ip_state !== 'TX') {
      expect(result.verification.match).toBe(false);
      expect(result.verification.confidence).toBe('medium');
    }
  });

  it('uses defaultState when IP fails and no header', () => {
    const result = resolveJurisdiction(mockReq({}, '0.0.0.0'), 'NJ');
    expect(result.state).toBe('NJ');
    expect(result.method).toBe('config_default');
  });
});
