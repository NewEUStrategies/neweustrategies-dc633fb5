// KROK `jobs-tick`: wysyłka próśb o potwierdzenie subskrypcji (wygaszanie
// nieaktywnych subskrybentów newslettera, I9d-Y1, Z-I9c-08).
//
// PODZIAŁ PRACY. Baza zakłada cykl (nocny przebieg retencji, kategoria
// `newsletter_inactive`), pilnuje karencji, kategorii włączonej, DZIENNEGO
// LIMITU na najemcę (`newsletterDailyCap` - reputacja domeny) i dzierżawy
// (`newsletter_sunset_claim`). Ten krok robi to, czego SQL nie umie: podpisuje
// link sekretem serwera, renderuje mail PL/EN z treścią z panelu i kolejkuje
// go wspólną kolejką poczty, a wynik zapisuje w cyklu (`newsletter_sunset_mark`).
//
// WYNIK WYSYŁKI -> STAN CYKLU (decyzje wykonawcze orkiestratora I9d):
//   * w kolejce / duplikat (ten sam klucz idempotencji już wysłany) - wysłana,
//     termin reakcji biegnie od teraz;
//   * zablokowana listą wyłączeń (`suppressed`) - JAK WYSŁANA: adres i tak
//     jest nieosiągalny dla newslettera, a cykl bez terminu wisiałby wiecznie;
//     NIE dopisujemy adresu do listy wyłączeń (wygaszenie to nie sprzeciw);
//   * błąd (kolejka, render, bramka reputacji domeny) - PONÓW: baza oddaje
//     prośbę po przerwie rosnącej z liczbą prób (1 h x próba, maks. doba);
//     bez wysłanej prośby nie ma terminu, więc nikt nie zostanie usunięty
//     bez szansy na reakcję.
// Mail idzie etykietą `newsletter_sunset` w kategorii `bulk`: bramka listy
// wyłączeń przy kolejkowaniu i ponownie w drenie w chwili wysyłki.
//
// IDEMPOTENCJA. Klucz `newsletter_sunset:<subskrybent>:<nonce>` - jeden mail
// na cykl, także gdy zapis wyniku padnie po zakolejkowaniu (dzierżawa wraca
// po 15 min, druga próba kończy się `duplicate`).
//
// Moduł ładowany WYŁĄCZNIE dynamicznie z `jobs-tick` (`*.server`).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { publicFacingOrigin } from "@/lib/http/host";
import { newsletterUnsubscribeUrl } from "@/lib/newsletter/unsubscribeUrl";
import type { RpcCallable } from "@/lib/revenue/rpcCallable";
import {
  NEWSLETTER_KEEP_TOKEN_TTL_DAYS,
  NEWSLETTER_SUNSET_COPY_SETTING_KEY,
  NEWSLETTER_SUNSET_EMPTY_OVERRIDES,
  NEWSLETTER_SUNSET_MAIL_BATCH,
  NEWSLETTER_SUNSET_MAIL_LABEL,
  newsletterKeepUrl,
  parseNewsletterSunsetOverrides,
  type NewsletterSunsetCopyOverrides,
  type NewsletterSunsetLang,
} from "./newsletterSunset";
import { signNewsletterKeepToken } from "./newsletterKeepToken.server";
import { renderNewsletterSunsetEmail } from "./newsletterSunsetRender.server";

type DbClient = SupabaseClient<Database>;

const DAY_MS = 86_400_000;

/**
 * RPC wygaszania nie ma jeszcze w wygenerowanych typach (`types.ts` dopisuje
 * integrator I9d) - klient rzutowany na kształt wywołania, nazwa RPC zostaje
 * LITERAŁEM w miejscu wywołania (bramka `generate:ts-sql-contract`).
 */
function asRpc(client: unknown): RpcCallable {
  return client as RpcCallable;
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Wynik zapisywany w cyklu (lustro CHECK `newsletter_sunset_mark`). */
export type NewsletterSunsetOutcome = "queued" | "duplicate" | "suppressed" | "failed";

/** Wiersz `newsletter_sunset_claim` (rpc-shape w migracji 20261020162000). */
export interface NewsletterSunsetClaim {
  subscriberId: string;
  tenantId: string;
  email: string;
  lang: NewsletterSunsetLang;
  firstName: string | null;
  nonce: string;
  requestedAt: string;
  deleteAfter: Date;
  unsubscribeToken: string | null;
  attempt: number;
}

export interface NewsletterSunsetMailResult {
  claimed: number;
  queued: number;
  duplicate: number;
  suppressed: number;
  /** Do ponowienia (błąd kolejki, renderu, bramka reputacji, zapis wyniku). */
  failed: number;
  /** Zajęte, ale nieobsłużone przed terminem kroku - wrócą po dzierżawie. */
  deferred: number;
  /** Cykl zniknął między zajęciem a zapisem (reakcja, wypis, wykluczenie). */
  gone: number;
  skipped?: "migration_pending";
}

export class NewsletterSunsetShapeError extends Error {
  constructor(path: string, reason: string) {
    super(`newsletter sunset claim: ${path} - ${reason}`);
    this.name = "NewsletterSunsetShapeError";
  }
}

function field(row: Record<string, unknown>, index: number, key: string): unknown {
  if (!Object.hasOwn(row, key)) throw new NewsletterSunsetShapeError(`[${index}].${key}`, "brak");
  return row[key];
}

function uuidField(row: Record<string, unknown>, index: number, key: string): string {
  const value = field(row, index, key);
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new NewsletterSunsetShapeError(`[${index}].${key}`, "oczekiwano uuid");
  }
  return value.toLowerCase();
}

function instantField(row: Record<string, unknown>, index: number, key: string): string {
  const value = field(row, index, key);
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new NewsletterSunsetShapeError(`[${index}].${key}`, "oczekiwano znacznika czasu");
  }
  return value;
}

function nullableText(row: Record<string, unknown>, index: number, key: string): string | null {
  const value = field(row, index, key);
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new NewsletterSunsetShapeError(`[${index}].${key}`, "oczekiwano napisu albo null");
  }
  return value;
}

/**
 * Wiersze zajęcia -> DTO. Rzuca przy rozjeździe kontraktu: zajęte wiersze
 * wrócą po dzierżawie, a błąd kroku jest widoczny w dzienniku przebiegów
 * (`job_runner_runs`) zamiast cichej pustej wysyłki.
 */
export function parseNewsletterSunsetClaims(raw: unknown): NewsletterSunsetClaim[] {
  if (raw === null) return [];
  if (!Array.isArray(raw)) throw new NewsletterSunsetShapeError("$", "oczekiwano tablicy");
  return raw.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new NewsletterSunsetShapeError(`[${index}]`, "oczekiwano obiektu");
    }
    const row = entry as Record<string, unknown>;
    const email = field(row, index, "email");
    if (typeof email !== "string") {
      throw new NewsletterSunsetShapeError(`[${index}].email`, "oczekiwano napisu");
    }
    const lang = field(row, index, "lang");
    if (lang !== "pl" && lang !== "en") {
      throw new NewsletterSunsetShapeError(`[${index}].lang`, "oczekiwano pl|en");
    }
    const attempt = field(row, index, "attempt");
    if (typeof attempt !== "number" || !Number.isInteger(attempt) || attempt < 0) {
      throw new NewsletterSunsetShapeError(`[${index}].attempt`, "oczekiwano liczby >= 0");
    }
    return {
      subscriberId: uuidField(row, index, "subscriber_id"),
      tenantId: uuidField(row, index, "tenant_id"),
      email,
      lang,
      firstName: nullableText(row, index, "first_name"),
      nonce: uuidField(row, index, "nonce"),
      requestedAt: instantField(row, index, "requested_at"),
      deleteAfter: new Date(instantField(row, index, "delete_after")),
      unsubscribeToken: nullableText(row, index, "unsubscribe_token"),
      attempt,
    };
  });
}

/** Wynik `enqueueRawEmail` -> wynik cyklu (+ kod błędu bez treści adresu). */
export function sunsetOutcomeOf(result: {
  ok: boolean;
  skipped?: "duplicate" | "suppressed" | "no_recipient";
  error?: string;
}): { outcome: NewsletterSunsetOutcome; code: string | null } {
  if (result.skipped === "duplicate") return { outcome: "duplicate", code: null };
  // Brak odbiorcy (pusty adres po obcięciu) jest równie nieosiągalny jak adres
  // z listy wyłączeń - ponawianie co dobę niczego by nie zmieniło.
  if (result.skipped === "suppressed" || result.skipped === "no_recipient") {
    return { outcome: "suppressed", code: null };
  }
  if (result.ok) return { outcome: "queued", code: null };
  // Do bazy idzie wyłącznie kod (CHECK `^[a-z0-9_.:-]{1,64}$`) - komunikat
  // Postgresa albo dostawcy mógłby cytować adres odbiorcy.
  return {
    outcome: "failed",
    code: result.error === "supabase_unavailable" ? "supabase_unavailable" : "enqueue_failed",
  };
}

interface TenantContext {
  origin: string;
  overrides: NewsletterSunsetCopyOverrides;
  /** `false` = bramka reputacji domeny wstrzymuje wysyłkę masową najemcy. */
  sendAllowed: boolean;
}

/** Domena i treść z panelu per najemca porcji (jedno zapytanie na rodzaj). */
async function loadTenants(
  admin: DbClient,
  tenantIds: readonly string[],
): Promise<Map<string, TenantContext>> {
  const { data: tenants, error } = await admin
    .from("tenants")
    .select("id, domain")
    .in("id", [...tenantIds]);
  if (error) throw new Error(`tenants: ${error.message}`);
  const domains = new Map((tenants ?? []).map((t) => [t.id, t.domain]));

  // Treść z panelu: fail-soft (jak treści maili systemowych) - błąd odczytu
  // daje treść domyślną, a nie wstrzymaną prośbę.
  const overrides = new Map<string, NewsletterSunsetCopyOverrides>();
  const { data: settings, error: settingsError } = await admin
    .from("site_settings")
    .select("tenant_id, value")
    .eq("key", NEWSLETTER_SUNSET_COPY_SETTING_KEY)
    .in("tenant_id", [...tenantIds]);
  if (settingsError) {
    console.error("[newsletter-sunset] copy read failed", settingsError.message);
  } else {
    for (const row of settings ?? []) {
      overrides.set(row.tenant_id, parseNewsletterSunsetOverrides(row.value));
    }
  }

  // Reputacja domeny (ta sama bramka co kampanie i ścieżki): prośba idzie do
  // adresów nieaktywnych - przy przekroczonym progu skarg albo odbić kolejna
  // fala tylko pogłębiłaby szkodę dla CAŁEJ poczty najemcy.
  const { evaluateSendGate } = await import("@/lib/email/reputationGate.server");
  const out = new Map<string, TenantContext>();
  for (const tenantId of tenantIds) {
    const verdict = await evaluateSendGate(admin, tenantId);
    out.set(tenantId, {
      origin: publicFacingOrigin(domains.get(tenantId) ?? null),
      overrides: overrides.get(tenantId) ?? NEWSLETTER_SUNSET_EMPTY_OVERRIDES,
      sendAllowed: verdict.allowed,
    });
  }
  return out;
}

export interface NewsletterSunsetMailOptions {
  /** Prośby na przebieg (domyślnie `NEWSLETTER_SUNSET_MAIL_BATCH`). */
  limit?: number;
  /** Chwila (ms epoki), po której krok nie zaczyna kolejnej prośby. */
  deadlineAt?: number;
  now?: () => Date;
}

export async function runNewsletterSunsetMail(
  admin: DbClient,
  options: NewsletterSunsetMailOptions = {},
): Promise<NewsletterSunsetMailResult> {
  const now = options.now ?? (() => new Date());
  const result: NewsletterSunsetMailResult = {
    claimed: 0,
    queued: 0,
    duplicate: 0,
    suppressed: 0,
    failed: 0,
    deferred: 0,
    gone: 0,
  };
  const { data, error } = await asRpc(admin).rpc("newsletter_sunset_claim", {
    p_limit: options.limit ?? NEWSLETTER_SUNSET_MAIL_BATCH,
  });
  if (error) {
    const { isMigrationPending } = await import("@/lib/supabase/migrationPending");
    if (isMigrationPending(error)) return { ...result, skipped: "migration_pending" };
    throw new Error(error.message);
  }
  const claims = parseNewsletterSunsetClaims(data);
  result.claimed = claims.length;
  if (claims.length === 0) return result;

  const tenants = await loadTenants(admin, [...new Set(claims.map((c) => c.tenantId))]);
  const { enqueueRawEmail } = await import("@/lib/email/transactional.server");

  const mark = async (
    claim: NewsletterSunsetClaim,
    outcome: NewsletterSunsetOutcome,
    code: string | null,
  ) => {
    const { data: marked, error: markError } = await asRpc(admin).rpc("newsletter_sunset_mark", {
      p_subscriber: claim.subscriberId,
      p_nonce: claim.nonce,
      p_outcome: outcome,
      p_error: code,
    });
    if (markError) {
      // Mail mógł już wyjść - dzierżawa wróci po 15 min, a ten sam klucz
      // idempotencji da wtedy `duplicate` zamiast drugiej wiadomości.
      console.error("[newsletter-sunset] mark failed", markError.message);
      result.failed += 1;
      return;
    }
    if ((marked as { ok?: unknown } | null)?.ok !== true) {
      result.gone += 1;
      return;
    }
    if (outcome === "failed") result.failed += 1;
    else result[outcome] += 1;
  };

  for (const claim of claims) {
    if (options.deadlineAt !== undefined && Date.now() >= options.deadlineAt) {
      result.deferred += 1;
      continue;
    }
    const tenant = tenants.get(claim.tenantId);
    if (!tenant?.sendAllowed) {
      await mark(claim, "failed", "reputation_blocked");
      continue;
    }
    let rendered: Awaited<ReturnType<typeof renderNewsletterSunsetEmail>>;
    try {
      const token = signNewsletterKeepToken({
        subscriberId: claim.subscriberId,
        nonce: claim.nonce,
        expiresAt: new Date(now().getTime() + NEWSLETTER_KEEP_TOKEN_TTL_DAYS * DAY_MS),
      });
      rendered = await renderNewsletterSunsetEmail({
        lang: claim.lang,
        overrides: tenant.overrides,
        firstName: claim.firstName,
        deleteAfter: claim.deleteAfter,
        keepUrl: newsletterKeepUrl(tenant.origin, token, claim.lang),
        unsubscribeUrl: claim.unsubscribeToken
          ? newsletterUnsubscribeUrl(tenant.origin, claim.unsubscribeToken)
          : null,
        siteUrl: tenant.origin,
      });
    } catch (err) {
      console.error("[newsletter-sunset] render failed", err);
      await mark(claim, "failed", "render_failed");
      continue;
    }
    const sent = await enqueueRawEmail({
      to: claim.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      label: NEWSLETTER_SUNSET_MAIL_LABEL,
      category: "bulk",
      idempotencyKey: `newsletter_sunset:${claim.subscriberId}:${claim.nonce}`,
      tenantId: claim.tenantId,
      // Nagłówki RFC 8058: wypis jednym kliknięciem także z tej wiadomości.
      unsubscribeUrl: claim.unsubscribeToken
        ? newsletterUnsubscribeUrl(tenant.origin, claim.unsubscribeToken)
        : null,
    });
    const { outcome, code } = sunsetOutcomeOf(sent);
    await mark(claim, outcome, code);
  }
  return result;
}
