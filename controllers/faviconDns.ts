import { lookup as systemLookup } from "node:dns/promises";
import type { LookupAddress, LookupAllOptions } from "node:dns";

// Local TUN proxies can synthesize every hostname into the benchmarking range.
// Resolve those names over HTTPS; the caller still validates and pins every IP.
// Never use this fallback for private DNS answers or literal IP addresses.
export async function lookup(host: string, options: LookupAllOptions): Promise<LookupAddress[]> {
  const addresses = await systemLookup(host, options);
  if (!addresses.length || !addresses.every(({ address }) => /^198\.(18|19)\./.test(address))) return addresses;
  const url = new URL("https://cloudflare-dns.com/dns-query");
  url.searchParams.set("name", host);
  url.searchParams.set("type", "A");
  const response = await fetch(url, {
    headers: { Accept: "application/dns-json" },
    redirect: "error",
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error("Public DNS lookup failed");
  const data = await response.json() as { Status?: number; Answer?: Array<{ type: number; data: string }> };
  if (data.Status !== 0) throw new Error("Public DNS lookup failed");
  return (data.Answer || []).filter(answer => answer.type === 1).map(answer => ({ address: answer.data, family: 4 }));
}
