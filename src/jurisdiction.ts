import geoip from 'geoip-lite';
import { isDatacenterIp } from './datacenter-ranges.js';
import type { JurisdictionResult, JurisdictionVerification } from './types.js';

const US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
]);

export function isValidState(code: string): boolean {
  return US_STATES.has(code.toUpperCase());
}

function getIp(req: any): string {
  const xff = req.headers?.['x-forwarded-for'];
  if (xff) {
    const last = typeof xff === 'string' ? xff.split(',').pop()?.trim() : xff[xff.length - 1];
    if (last) return last;
  }
  return req.headers?.['x-real-ip'] || req.ip || req.socket?.remoteAddress || '';
}

function geoState(ip: string): string | null {
  const geo = geoip.lookup(ip);
  if (!geo || geo.country !== 'US') return null;
  return geo.region || null;
}

export function resolveJurisdiction(req: any, defaultState?: string): JurisdictionResult {
  const ip = getIp(req);
  const headerState = (req.headers?.['x-buyer-state'] || '').toString().toUpperCase().trim();
  const headerZip = (req.headers?.['x-buyer-zip'] || '').toString().trim();
  const flags: string[] = [];

  const ipState = geoState(ip);
  const dcCheck = isDatacenterIp(ip);

  let selfState: string | null = null;
  let selfZip: string | null = null;
  if (headerState) {
    if (isValidState(headerState)) {
      selfState = headerState;
      if (/^\d{5}$/.test(headerZip)) selfZip = headerZip;
    } else {
      flags.push('invalid_buyer_header — X-Buyer-State value not a valid US state code. Ignored.');
    }
  }

  const verification: JurisdictionVerification = {
    method: 'ip_geolocation',
    ip_state: ipState,
    ip_is_datacenter: dcCheck.isDatacenter,
    self_reported_state: selfState,
    self_reported_zip: selfZip,
    match: null,
    confidence: 'high',
    flags,
  };

  if (selfState && ipState) {
    verification.method = 'both';
    verification.match = selfState === ipState;
    if (!verification.match) {
      verification.confidence = 'medium';
      flags.push(`IP (${ipState}) and self-reported state (${selfState}) differ. Using self-reported. VPN or misreport possible.`);
    } else if (dcCheck.isDatacenter) {
      verification.confidence = 'medium';
    }
  } else if (selfState && !ipState) {
    verification.method = 'self_reported';
    verification.confidence = dcCheck.isDatacenter ? 'medium' : 'high';
  } else if (!selfState && ipState) {
    verification.method = 'ip_geolocation';
    if (dcCheck.isDatacenter) {
      verification.confidence = 'low';
      flags.push('datacenter_ip — jurisdiction uncertain. Buyer should send X-Buyer-State header.');
    }
  } else {
    verification.method = 'config_default';
    verification.confidence = 'low';
  }

  const state = selfState || ipState || defaultState || '';
  const method = selfState ? 'self_reported' as const
    : ipState ? 'ip_geolocation' as const
    : 'config_default' as const;

  return { state, zip: selfZip, method, verification };
}
