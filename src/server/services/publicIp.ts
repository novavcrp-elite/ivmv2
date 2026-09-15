/**
 * Public IP lookup for the local node.
 *
 * The panel can only see its own private address, so the public IPv4 is resolved
 * through external echo services. Results are cached so repeated dashboard polls
 * (and page reloads) do not hammer those services.
 */

const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;

const SOURCES: Array<{ url: string; pick: (payload: any) => string | undefined }> = [
  { url: "https://api.ipify.org?format=json", pick: (payload) => payload?.ip },
  { url: "https://ipv4.icanhazip.com", pick: (payload) => payload },
  { url: "https://api.ipify.org", pick: (payload) => payload },
  { url: "https://ifconfig.me/ip", pick: (payload) => payload },
];

const CACHE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 5000;

export type PublicIpResult = {
  ip: string;
  cached: boolean;
  stale?: boolean;
  fetchedAt: number;
  source?: string;
};

let cache: { ip: string; at: number; source: string } | null = null;

const isIPv4 = (value: string) => IPV4_RE.test(value.trim());

export async function getPublicIPv4(force = false): Promise<PublicIpResult> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return { ip: cache.ip, cached: true, fetchedAt: cache.at, source: cache.source };
  }

  for (const source of SOURCES) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const response = await fetch(source.url, {
        signal: controller.signal,
        headers: { "User-Agent": "IVM-Panel/3.0", Accept: "application/json, text/plain, */*" },
      });
      clearTimeout(timer);
      if (!response.ok) continue;

      const body = (await response.text()).trim();
      let candidate: string | undefined;
      try {
        candidate = source.pick(JSON.parse(body));
      } catch {
        candidate = source.pick(body);
      }

      const ip = (candidate || "").trim();
      if (!isIPv4(ip)) continue;

      cache = { ip, at: Date.now(), source: source.url };
      return { ip, cached: false, fetchedAt: cache.at, source: source.url };
    } catch {
      // Offline or blocked: try the next echo service.
    }
  }

  if (cache) {
    // Every lookup failed but we have a previously resolved address.
    return { ip: cache.ip, cached: true, stale: true, fetchedAt: cache.at, source: cache.source };
  }

  throw new Error("Unable to resolve the public IPv4 address");
}
