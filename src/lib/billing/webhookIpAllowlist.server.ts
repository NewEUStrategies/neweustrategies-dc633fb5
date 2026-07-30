// Allowlista adresów IP operatora płatności dla publicznego webhooka.
// Źródłem prawdy jest endpoint operatora (https://api.paddle.com/ips) - lista
// bywa zmieniana, dlatego nie zapisujemy jej na sztywno w kodzie, tylko
// pobieramy i buforujemy w pamięci procesu.
import type { PaddleEnv } from "@/lib/paddle.server";

const IPS_ENDPOINT: Record<PaddleEnv, string> = {
  live: "https://api.paddle.com/ips",
  sandbox: "https://sandbox-api.paddle.com/ips",
};

/** Bufor na 6 h - odświeżamy rzadko, ale bez restartu procesu. */
const TTL_MS = 6 * 60 * 60 * 1000;

interface CacheEntry {
  ips: ReadonlySet<string>;
  fetchedAt: number;
}

const cache = new Map<PaddleEnv, CacheEntry>();

/** Wyłącznie do testów - czyści bufor listy adresów. */
export function __resetIpAllowlistCache(): void {
  cache.clear();
}

function parseCidrs(cidrs: readonly string[]): ReadonlySet<string> {
  // Operator publikuje wyłącznie maski /32, czyli pojedyncze adresy.
  return new Set(cidrs.map((cidr) => cidr.split("/")[0]).filter(Boolean));
}

async function loadAllowlist(env: PaddleEnv): Promise<ReadonlySet<string> | null> {
  const cached = cache.get(env);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached.ips;

  try {
    const res = await fetch(IPS_ENDPOINT[env], { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`ips_endpoint_${res.status}`);
    const body = (await res.json()) as { data?: { ipv4_cidrs?: string[] } };
    const ips = parseCidrs(body.data?.ipv4_cidrs ?? []);
    if (ips.size === 0) throw new Error("ips_endpoint_empty");
    cache.set(env, { ips, fetchedAt: Date.now() });
    return ips;
  } catch (e) {
    console.error("[payments] IP allowlist fetch failed", e);
    // Zwracamy ostatnią znaną listę, a gdy jej nie ma - null (fail-open,
    // bo podpis kryptograficzny pozostaje twardą barierą autoryzacji).
    return cached?.ips ?? null;
  }
}

/** Pierwszy adres z łańcucha proxy - dopiero on pochodzi od operatora. */
export function clientIpFromHeaders(headers: Headers | null | undefined): string | null {
  // Środowiska bez pełnego `Request` (testy, runtime bez proxy) nie muszą mieć
  // nagłówków - brak adresu oznacza po prostu brak przesłanki do odrzucenia.
  if (!headers || typeof headers.get !== "function") return null;
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("cf-connecting-ip") ?? headers.get("x-real-ip");
}


/**
 * Sprawdza, czy żądanie przyszło z adresu operatora.
 * Zwraca `true` również wtedy, gdy listy nie da się pobrać ani odtworzyć z
 * bufora - wówczas jedynym zabezpieczeniem pozostaje weryfikacja podpisu.
 */
export async function isAllowedWebhookIp(request: Request, env: PaddleEnv): Promise<boolean> {
  const ip = clientIpFromHeaders(request.headers);
  if (!ip) return true;
  const allowlist = await loadAllowlist(env);
  if (!allowlist) return true;
  return allowlist.has(ip);
}
