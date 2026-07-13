// Server-only SSRF egress guard.
//
// Any server-side `fetch()` of a URL that a *user* (even a tenant admin) can
// configure is an SSRF risk: the attacker can point it at the cloud metadata
// endpoint (169.254.169.254), localhost, or an internal service and use the
// response - or timing - to read/probe infrastructure across the customer ->
// infra trust boundary. This guard is the single choke point every such fetch
// must pass through.
//
// Contract: `assertPublicHttpUrl(raw)` resolves to a parsed URL only when the
// target is https AND every DNS answer for its host is a public, routable
// address. It throws (fail-closed) on anything else - private/reserved ranges,
// literal internal IPs, `localhost`, `.internal`/`.local` suffixes, non-https
// schemes, unparseable URLs, or a DNS lookup that fails/returns nothing.
//
// Note on DNS rebinding: this validates the host at check time; a hostile
// resolver could still return a public IP here and a private IP to the
// subsequent fetch. Callers therefore also (a) require https and (b) never echo
// the upstream response body, so even a rebind yields at most a blind request.
// `redirect: "manual"` on the fetch prevents a 30x from bouncing to an internal
// host after the check.
//
// `.server.ts` + Node builtins: import this only from server code, and prefer a
// dynamic `await import()` inside a server-fn body so `node:*` never enters the
// client bundle.
import dnsPromises from "node:dns/promises";
import net from "node:net";

const BLOCKED_HOSTS = new Set(["localhost", "ip6-localhost", "metadata.google.internal"]);

/** True for any IPv4/IPv6 address that must never be reachable from a user-configured fetch. */
export function isPrivateOrReservedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;
    if (a === 0) return true; // "this" network
    if (a === 10) return true; // private
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (RFC 6598)
    if (a === 192 && b === 0) return true; // 192.0.0.0/24 + 192.0.2.0/24 (reserved/TEST-NET-1)
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a >= 224) return true; // multicast + reserved (224.0.0.0/3)
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === "::" || lower === "::1") return true; // unspecified / loopback
    if (lower.startsWith("fe80")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique-local (fc00::/7)
    if (lower.startsWith("ff")) return true; // multicast
    const mapped = lower.match(/(?:::ffff:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mapped) return isPrivateOrReservedIp(mapped[1]); // IPv4-mapped
    return false;
  }
  return true; // not a recognisable IP literal -> refuse
}

export class BlockedUrlError extends Error {
  constructor(reason: string) {
    super(`blocked_url:${reason}`);
    this.name = "BlockedUrlError";
  }
}

export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError("unparseable");
  }
  if (url.protocol !== "https:") throw new BlockedUrlError("scheme");

  const host = url.hostname
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^\[|\]$/g, "");
  if (!host) throw new BlockedUrlError("no_host");
  if (BLOCKED_HOSTS.has(host)) throw new BlockedUrlError("host");
  if (host.endsWith(".internal") || host.endsWith(".local") || host.endsWith(".localhost")) {
    throw new BlockedUrlError("host");
  }

  // Literal IP in the host: check directly, no DNS.
  if (net.isIP(host)) {
    if (isPrivateOrReservedIp(host)) throw new BlockedUrlError("ip");
    return url;
  }

  // Hostname: resolve and require EVERY answer to be public.
  let answers: Array<{ address: string }>;
  try {
    answers = await dnsPromises.lookup(host, { all: true });
  } catch {
    throw new BlockedUrlError("dns"); // cannot verify -> fail closed
  }
  if (!answers.length) throw new BlockedUrlError("dns_empty");
  for (const a of answers) {
    if (isPrivateOrReservedIp(a.address)) throw new BlockedUrlError("ip");
  }
  return url;
}

/** Convenience: fetch a user-configured URL only after the egress guard passes. */
export async function safeExternalFetch(raw: string, init?: RequestInit): Promise<Response> {
  await assertPublicHttpUrl(raw);
  return fetch(raw, { redirect: "manual", ...init });
}
