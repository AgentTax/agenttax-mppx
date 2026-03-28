// CIDR ranges for major cloud providers.
// Used to detect when an IP is from a datacenter/VPN, which lowers
// jurisdiction confidence since the IP doesn't reflect physical location.

interface CidrRange {
  start: number;
  end: number;
  provider: string;
}

// Convert "a.b.c.d" to 32-bit integer
function ipToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

// Convert "a.b.c.d/n" to { start, end }
function cidrToRange(cidr: string, provider: string): CidrRange {
  const [ip, bits] = cidr.split('/');
  const mask = ~((1 << (32 - Number(bits))) - 1) >>> 0;
  const start = ipToInt(ip) & mask;
  const end = start | (~mask >>> 0);
  return { start, end, provider };
}

// Major cloud provider ranges (representative subnets, not exhaustive)
const CIDRS: [string, string][] = [
  // AWS
  ['3.0.0.0/8', 'AWS'], ['13.0.0.0/8', 'AWS'], ['15.0.0.0/8', 'AWS'],
  ['18.0.0.0/8', 'AWS'], ['35.0.0.0/8', 'AWS'], ['44.192.0.0/10', 'AWS'],
  ['52.0.0.0/8', 'AWS'], ['54.0.0.0/8', 'AWS'], ['99.77.0.0/16', 'AWS'],
  // GCP
  ['34.0.0.0/8', 'GCP'], ['35.184.0.0/13', 'GCP'], ['104.196.0.0/14', 'GCP'],
  ['130.211.0.0/16', 'GCP'], ['146.148.0.0/16', 'GCP'],
  // Azure
  ['13.64.0.0/11', 'Azure'], ['20.0.0.0/8', 'Azure'], ['40.64.0.0/10', 'Azure'],
  ['51.104.0.0/14', 'Azure'], ['52.224.0.0/11', 'Azure'],
  // Cloudflare
  ['103.21.244.0/22', 'Cloudflare'], ['104.16.0.0/12', 'Cloudflare'],
  ['172.64.0.0/13', 'Cloudflare'], ['188.114.96.0/20', 'Cloudflare'],
  ['190.93.240.0/20', 'Cloudflare'], ['197.234.240.0/22', 'Cloudflare'],
  // DigitalOcean
  ['64.225.0.0/16', 'DigitalOcean'], ['67.205.128.0/17', 'DigitalOcean'],
  ['104.131.0.0/16', 'DigitalOcean'], ['137.184.0.0/14', 'DigitalOcean'],
  ['138.197.0.0/16', 'DigitalOcean'], ['159.65.0.0/16', 'DigitalOcean'],
  ['161.35.0.0/16', 'DigitalOcean'], ['164.90.0.0/16', 'DigitalOcean'],
  ['167.71.0.0/16', 'DigitalOcean'], ['174.138.0.0/16', 'DigitalOcean'],
  // Hetzner
  ['49.12.0.0/14', 'Hetzner'], ['78.46.0.0/15', 'Hetzner'],
  ['88.198.0.0/15', 'Hetzner'], ['138.201.0.0/16', 'Hetzner'],
  ['148.251.0.0/16', 'Hetzner'], ['159.69.0.0/16', 'Hetzner'],
  ['168.119.0.0/16', 'Hetzner'], ['176.9.0.0/16', 'Hetzner'],
  // OVH
  ['51.68.0.0/14', 'OVH'], ['54.36.0.0/14', 'OVH'],
  ['91.121.0.0/16', 'OVH'], ['137.74.0.0/16', 'OVH'],
  ['145.239.0.0/16', 'OVH'], ['151.80.0.0/16', 'OVH'],
  // Vultr
  ['45.32.0.0/16', 'Vultr'], ['45.63.0.0/16', 'Vultr'],
  ['45.76.0.0/16', 'Vultr'], ['45.77.0.0/16', 'Vultr'],
  ['64.176.0.0/16', 'Vultr'], ['66.42.0.0/16', 'Vultr'],
  ['108.61.0.0/16', 'Vultr'], ['149.28.0.0/16', 'Vultr'],
  ['207.148.0.0/16', 'Vultr'], ['216.128.128.0/17', 'Vultr'],
  // Linode/Akamai
  ['45.33.0.0/16', 'Linode'], ['45.56.0.0/16', 'Linode'],
  ['45.79.0.0/16', 'Linode'], ['50.116.0.0/16', 'Linode'],
  ['66.175.208.0/20', 'Linode'], ['69.164.192.0/18', 'Linode'],
  ['96.126.96.0/19', 'Linode'], ['139.162.0.0/16', 'Linode'],
  ['172.104.0.0/15', 'Linode'], ['192.155.80.0/20', 'Linode'],
  // Fly.io
  ['66.241.124.0/22', 'Fly.io'], ['137.66.0.0/16', 'Fly.io'],
  // Render
  ['216.24.56.0/22', 'Render'],
  // Railway
  ['209.97.128.0/17', 'Railway'],
  // Vercel (edge)
  ['76.76.21.0/24', 'Vercel'],
];

const RANGES: CidrRange[] = CIDRS.map(([cidr, provider]) => cidrToRange(cidr, provider));
RANGES.sort((a, b) => a.start - b.start);

export function isDatacenterIp(ip: string): { isDatacenter: boolean; provider: string | null } {
  const n = ipToInt(ip);
  for (const r of RANGES) {
    if (n >= r.start && n <= r.end) {
      return { isDatacenter: true, provider: r.provider };
    }
  }
  return { isDatacenter: false, provider: null };
}
