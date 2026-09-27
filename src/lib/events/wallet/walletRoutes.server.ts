// Logika tras `/api/public/events/wallet/*` (Apple, Google, dostępność).
//
// TRASY SĄ CIENKIE, LOGIKA TUTAJ. Pliki tras importuje zachłannie
// `routeTree.gen.ts`, więc budowa przepustki (podpis, ZIP, klient Supabase)
// dochodzi do grafu serwera dopiero przez `await import()` z handlera.
//
// POŚWIADCZENIEM JEST JAWNY KOD BILETU W CIELE POST - nigdy w adresie ani
// w logu. Strona biletu ma go we fragmencie adresu i wysyła go stąd:
// Apple - zwykłym formularzem (iOS Safari otwiera wtedy arkusz „Dodaj
// przepustkę”, czego nie robi dla pobrania z `blob:`), Google - JSON-em,
// po którym klient sam przechodzi pod `saveUrl` (przekierowanie z odpowiedzi
// na formularz zablokowałoby CSP `form-action 'self'`).
//
// KOLEJNOŚĆ ZAPÓR: konfiguracja (503, bez dotykania bazy) -> kształt kodu (400)
// -> limit tempa w bazie po adresie IP i po kodzie (429) -> dane przepustki
// po kodzie, klientem wołającego z najemcą z hosta (`callerSupabase`; 404 dla
// kodu, który nie daje ważnego biletu) -> budowa. Apple ma też tryb
// `intent=check`: te same zapory bez budowy paczki, żeby przycisk mógł pokazać
// błąd na stronie, zanim formularz nawiguje.
//
// DWA KUBEŁKI LIMITU. Po IP - luźny, bo sala kongresowa wychodzi do sieci przez
// jeden NAT i ciasny limit odcinałby wszystkich po kilku uczestnikach. Po KODZIE
// - ciasny, bo to on chroni przed kodem wyniesionym do sieci i wołanym z wielu
// adresów (każde wywołanie Google to zapis w Google Wallet API). Kubełek kodu
// nosi skrót SHA-256, nigdy sam kod.
//
// DZIENNIK WYDAŃ (`_event_wallet_pass_note`, service_role) jest best-effort:
// jego awaria nie odbiera uczestnikowi przepustki, tylko zostawia ostrzeżenie.
import { callerSupabase, type CallerSupabase } from "@/lib/events/callerClient.server";
import { MANAGE_TOKEN_PATTERN } from "@/lib/events/manageToken";
import { rateLimitIpSubject } from "@/lib/http/rateLimit";
import { trustedPublicHost } from "@/lib/http/requestHost";
import { rateLimit } from "@/lib/server/rate-limit.server";

import { buildApplePass } from "./applePass.server";
import { createGoogleWalletSave } from "./googleWallet.server";
import { sha256, toHex } from "./rsa";
import { appleWalletConfig, googleWalletConfig, walletAvailability } from "./walletConfig.server";
import { walletTicketFromPayload, type WalletTicket } from "./walletTicket";

/** Platformy dziennika wydań - lustro CHECK `event_wallet_passes_platform_values`. */
export const WALLET_PLATFORMS = ["apple", "google"] as const;
export type WalletPlatform = (typeof WALLET_PLATFORMS)[number];

/** Kody błędów odpowiedzi - klient mapuje je na komunikaty (`eventWallet.errors.*`). */
export type WalletErrorCode =
  "not_configured" | "invalid_token" | "rate_limited" | "not_found" | "upstream" | "wallet_failed";

const PRIVATE_HEADERS = {
  "Cache-Control": "no-store, private",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
} as const;

const RATE_WINDOW_MINUTES = 10;
/** Wspólny NAT sali: sto dodań na 10 minut z jednego adresu (Apple liczy dwa wywołania). */
const RATE_MAX_PER_IP = 200;
/** Pięć dodań jednego biletu na 10 minut; Apple liczy sprawdzenie i pobranie osobno. */
const RATE_MAX_PER_TOKEN = 10;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...PRIVATE_HEADERS, ...headers },
  });
}

function fail(status: number, error: WalletErrorCode, headers?: Record<string, string>): Response {
  return json(status, { error }, headers);
}

interface WalletRequest {
  readonly token: string;
  readonly lang: string | null;
  readonly check: boolean;
}

function readRequest(source: { get(name: string): unknown }): WalletRequest | null {
  const token = source.get("token");
  if (typeof token !== "string" || !MANAGE_TOKEN_PATTERN.test(token.trim())) return null;
  const lang = source.get("lang");
  return {
    token: token.trim(),
    lang: typeof lang === "string" ? lang : null,
    check: source.get("intent") === "check",
  };
}

async function readForm(request: Request): Promise<WalletRequest | null> {
  try {
    return readRequest(await request.formData());
  } catch {
    return null;
  }
}

async function readJson(request: Request): Promise<WalletRequest | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  return readRequest({ get: (name) => record[name] });
}

/** Podmiot kubełka kodu: 32 znaki szesnastkowe SHA-256 - kod biletu nie trafia do bazy limitów. */
async function tokenSubject(token: string): Promise<string> {
  return toHex(await sha256(new TextEncoder().encode(token))).slice(0, 32);
}

async function allowRate(
  platform: WalletPlatform,
  request: Request,
  token: string,
): Promise<boolean> {
  // Ta sama baza odpowiada za dane biletu - przy jej awarii i tak nie ma
  // czego wydać, a zamknięty limit nie wzmacnia ruchu na leżącą bazę.
  const byIp = await rateLimit({
    scope: `event_wallet.${platform}`,
    subjectId: rateLimitIpSubject(request.headers),
    max: RATE_MAX_PER_IP,
    windowMinutes: RATE_WINDOW_MINUTES,
    failClosed: true,
  });
  if (!byIp) return false;
  return rateLimit({
    scope: `event_wallet.${platform}.token`,
    subjectId: await tokenSubject(token),
    max: RATE_MAX_PER_TOKEN,
    windowMinutes: RATE_WINDOW_MINUTES,
    failClosed: true,
  });
}

type Loaded = { ok: true; ticket: WalletTicket } | { ok: false; response: Response };

async function loadTicket(parsed: WalletRequest): Promise<Loaded> {
  // Klient wołającego: klucz publiczny i nagłówek hosta (najemca z domeny).
  // Brak zmiennych środowiska to konfiguracja (503 w JSON-ie, jak brak
  // portfela), a nie surowy błąd serwera.
  let client: CallerSupabase["client"];
  try {
    ({ client } = await callerSupabase());
  } catch (err) {
    const head = (err instanceof Error ? err.message : String(err)).split(":")[0];
    if (head === "server_misconfigured") {
      console.error("[wallet] supabase client not configured");
      return { ok: false, response: fail(503, "not_configured") };
    }
    console.warn("[wallet] caller client failed:", head);
    return { ok: false, response: fail(502, "upstream") };
  }
  const { data, error } = await client.rpc("event_ticket_wallet_payload", {
    p_payload: { qr_token: parsed.token },
  });
  if (error) {
    const head = error.message.split(":")[0];
    if (head === "not_found" || head === "invalid_token") {
      return { ok: false, response: fail(404, "not_found") };
    }
    console.warn("[wallet] payload rpc failed:", head);
    return { ok: false, response: fail(502, "upstream") };
  }
  const ticket = walletTicketFromPayload(data, parsed.token, parsed.lang);
  if (ticket === null) return { ok: false, response: fail(502, "upstream") };
  return { ok: true, ticket };
}

/** `https://<zaufany host>` albo `null`. */
async function publicOrigin(request: Request): Promise<string | null> {
  const host = await trustedPublicHost(request);
  return host === null ? null : `https://${host}`;
}

async function noteIssued(ticket: WalletTicket, platform: WalletPlatform, objectId: string) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.rpc("_event_wallet_pass_note", {
      p_tenant: ticket.tenantId,
      p_registration_id: ticket.registrationId,
      p_platform: platform,
      p_object_id: objectId,
    });
    if (error) console.warn(`[wallet] ${platform} issue log failed:`, error.message);
  } catch (err) {
    console.warn(`[wallet] ${platform} issue log failed:`, String(err));
  }
}

/** Wspólne zapory obu platform po kształcie kodu: limit tempa i dane biletu. */
async function guard(
  platform: WalletPlatform,
  request: Request,
  parsed: WalletRequest,
): Promise<Loaded> {
  if (!(await allowRate(platform, request, parsed.token))) {
    return {
      ok: false,
      response: fail(429, "rate_limited", { "Retry-After": String(RATE_WINDOW_MINUTES * 60) }),
    };
  }
  return loadTicket(parsed);
}

/** POST /api/public/events/wallet/apple (formularz: token, lang, intent). */
export async function appleWalletPost(request: Request): Promise<Response> {
  const config = appleWalletConfig();
  if (config === null) return fail(503, "not_configured");
  const parsed = await readForm(request);
  if (parsed === null) return fail(400, "invalid_token");
  const loaded = await guard("apple", request, parsed);
  if (!loaded.ok) return loaded.response;
  if (parsed.check) return new Response(null, { status: 204, headers: PRIVATE_HEADERS });

  const { ticket } = loaded;
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = new Uint8Array(
      await buildApplePass({
        ticket,
        config,
        publicOrigin: await publicOrigin(request),
        now: new Date(),
      }),
    );
  } catch (err) {
    console.error("[wallet] apple pass build failed:", String(err));
    return fail(500, "wallet_failed");
  }
  await noteIssued(ticket, "apple", ticket.registrationId);
  // Slug ma w bazie CHECK `^[a-z0-9-]{3,120}$`; filtr i tak trzyma nagłówek w ryzach.
  const slug = ticket.event.slug.replace(/[^a-z0-9-]/gi, "");
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.apple.pkpass",
      "Content-Disposition": `attachment; filename="bilet-${slug}.pkpass"`,
      "Content-Length": String(bytes.byteLength),
      ...PRIVATE_HEADERS,
    },
  });
}

/** POST /api/public/events/wallet/google (JSON: token, lang) -> `{ saveUrl }`. */
export async function googleWalletPost(request: Request): Promise<Response> {
  const config = googleWalletConfig();
  if (config === null) return fail(503, "not_configured");
  const parsed = await readJson(request);
  if (parsed === null) return fail(400, "invalid_token");
  const loaded = await guard("google", request, parsed);
  if (!loaded.ok) return loaded.response;

  const { ticket } = loaded;
  let saved: { saveUrl: string; objectId: string };
  try {
    saved = await createGoogleWalletSave({
      ticket,
      config,
      publicOrigin: await publicOrigin(request),
      nowMs: Date.now(),
    });
  } catch (err) {
    console.error("[wallet] google save failed:", String(err));
    return fail(502, "wallet_failed");
  }
  await noteIssued(ticket, "google", saved.objectId);
  return json(200, { saveUrl: saved.saveUrl });
}

/** GET /api/public/events/wallet/availability -> `{ apple, google }` (bez sekretów). */
export function walletAvailabilityGet(): Response {
  return new Response(JSON.stringify(walletAvailability()), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
