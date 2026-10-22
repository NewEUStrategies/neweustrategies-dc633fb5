// KROK `jobs-tick`: wysyłka próśb o zgodę na pomiar otwarć i kliknięć
// („Poproś o zgodę na pomiar" z panelu newslettera, I9d-Y2).
//
// PODZIAŁ PRACY (lustro wygaszania Y1). Baza zakłada prośby (start z panelu
// z potwierdzoną liczbą), pilnuje JEDNEJ prośby na (subskrybent, wersja
// treści), dziennego limitu WSPÓLNEGO z prośbami wygaszania (reputacja tej
// samej domeny), dzierżawy i nieaktualności (wypis albo zgoda udzielona
// w międzyczasie -> `skipped` bez maila) - `newsletter_measurement_claim`.
// Ten krok robi to, czego SQL nie umie: podpisuje link sekretem serwera,
// renderuje mail PL/EN z treścią z panelu i kolejkuje go wspólną kolejką
// poczty; wynik zapisuje `newsletter_measurement_mark`.
//
// WYNIK WYSYŁKI -> STAN PROŚBY (`sunsetOutcomeOf`, ta sama reguła co Y1):
//   * w kolejce / duplikat - wysłana;
//   * zablokowana listą wyłączeń - `suppressed` (bez maila, poza budżetem);
//     NIE dopisujemy adresu do listy wyłączeń;
//   * błąd (kolejka, render, bramka reputacji) - ponowienie po przerwie
//     rosnącej z liczbą prób (maks. 5 prób - potem „nieudana" w panelu).
// BRAK REAKCJI na mail = BEZ ZMIAN (żadnego wpisu „nie" w rejestrze zgód).
//
// IDEMPOTENCJA. Klucz `newsletter_measurement:<subskrybent>:<nonce>` - jeden
// mail na prośbę, także gdy zapis wyniku padnie po zakolejkowaniu.
//
// Moduł ładowany WYŁĄCZNIE dynamicznie z `jobs-tick` (`*.server`).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { publicFacingOrigin } from "@/lib/http/host";
import { newsletterUnsubscribeUrl } from "@/lib/newsletter/unsubscribeUrl";
import type { RpcCallable } from "@/lib/revenue/rpcCallable";
import { MEASUREMENT_CONFIRM_LINK_DAYS, newsletterMeasurementUrl } from "./measurement";
import {
  NEWSLETTER_MEASUREMENT_COPY_SETTING_KEY,
  NEWSLETTER_MEASUREMENT_EMPTY_OVERRIDES,
  NEWSLETTER_MEASUREMENT_MAIL_BATCH,
  NEWSLETTER_MEASUREMENT_MAIL_LABEL,
  parseNewsletterMeasurementOverrides,
  type NewsletterMeasurementCopyOverrides,
  type NewsletterMeasurementLang,
} from "./measurementReconfirm";
import { renderMeasurementReconfirmEmail } from "./measurementReconfirmRender.server";
import { signMeasurementConfirmToken } from "./measurementToken.server";
import { sunsetOutcomeOf, type NewsletterSunsetOutcome } from "./newsletterSunsetMail.server";

type DbClient = SupabaseClient<Database>;

const DAY_MS = 86_400_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * RPC pomiaru nie ma jeszcze w wygenerowanych typach (`types.ts` dopisuje
 * integrator) - klient rzutowany na kształt wywołania, nazwa RPC zostaje
 * LITERAŁEM w miejscu wywołania (bramka `generate:ts-sql-contract`).
 */
function asRpc(client: unknown): RpcCallable {
  return client as RpcCallable;
}

/** Wiersz `newsletter_measurement_claim` (rpc-shape w 20261020162500). */
export interface NewsletterMeasurementClaim {
  subscriberId: string;
  tenantId: string;
  email: string;
  lang: NewsletterMeasurementLang;
  firstName: string | null;
  nonce: string;
  consentVersion: string;
  unsubscribeToken: string | null;
  attempt: number;
}

export interface NewsletterMeasurementMailResult {
  claimed: number;
  queued: number;
  duplicate: number;
  suppressed: number;
  /** Do ponowienia (błąd kolejki, renderu, bramka reputacji, zapis wyniku). */
  failed: number;
  /** Zajęte, ale nieobsłużone przed terminem kroku - wrócą po dzierżawie. */
  deferred: number;
  /** Prośba zniknęła między zajęciem a zapisem (subskrybent usunięty). */
  gone: number;
  skipped?: "migration_pending";
}

export class NewsletterMeasurementShapeError extends Error {
  constructor(path: string, reason: string) {
    super(`newsletter measurement claim: ${path} - ${reason}`);
    this.name = "NewsletterMeasurementShapeError";
  }
}

function field(row: Record<string, unknown>, index: number, key: string): unknown {
  if (!Object.hasOwn(row, key)) {
    throw new NewsletterMeasurementShapeError(`[${index}].${key}`, "brak");
  }
  return row[key];
}

function uuidField(row: Record<string, unknown>, index: number, key: string): string {
  const value = field(row, index, key);
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new NewsletterMeasurementShapeError(`[${index}].${key}`, "oczekiwano uuid");
  }
  return value.toLowerCase();
}

function nullableText(row: Record<string, unknown>, index: number, key: string): string | null {
  const value = field(row, index, key);
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new NewsletterMeasurementShapeError(`[${index}].${key}`, "oczekiwano napisu albo null");
  }
  return value;
}

/**
 * Wiersze zajęcia -> DTO. Rzuca przy rozjeździe kontraktu: zajęte wiersze
 * wrócą po dzierżawie, a błąd kroku widać w dzienniku przebiegów zamiast
 * cichej pustej wysyłki.
 */
export function parseNewsletterMeasurementClaims(raw: unknown): NewsletterMeasurementClaim[] {
  if (raw === null) return [];
  if (!Array.isArray(raw)) throw new NewsletterMeasurementShapeError("$", "oczekiwano tablicy");
  return raw.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new NewsletterMeasurementShapeError(`[${index}]`, "oczekiwano obiektu");
    }
    const row = entry as Record<string, unknown>;
    const email = field(row, index, "email");
    if (typeof email !== "string") {
      throw new NewsletterMeasurementShapeError(`[${index}].email`, "oczekiwano napisu");
    }
    const lang = field(row, index, "lang");
    if (lang !== "pl" && lang !== "en") {
      throw new NewsletterMeasurementShapeError(`[${index}].lang`, "oczekiwano pl|en");
    }
    const version = field(row, index, "consent_version");
    if (typeof version !== "string" || !version) {
      throw new NewsletterMeasurementShapeError(`[${index}].consent_version`, "oczekiwano napisu");
    }
    const attempt = field(row, index, "attempt");
    if (typeof attempt !== "number" || !Number.isInteger(attempt) || attempt < 0) {
      throw new NewsletterMeasurementShapeError(`[${index}].attempt`, "oczekiwano liczby >= 0");
    }
    return {
      subscriberId: uuidField(row, index, "subscriber_id"),
      tenantId: uuidField(row, index, "tenant_id"),
      email,
      lang,
      firstName: nullableText(row, index, "first_name"),
      nonce: uuidField(row, index, "nonce"),
      consentVersion: version,
      unsubscribeToken: nullableText(row, index, "unsubscribe_token"),
      attempt,
    };
  });
}

interface TenantContext {
  origin: string;
  overrides: NewsletterMeasurementCopyOverrides;
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

  // Treść z panelu: fail-soft - błąd odczytu daje treść domyślną.
  const overrides = new Map<string, NewsletterMeasurementCopyOverrides>();
  const { data: settings, error: settingsError } = await admin
    .from("site_settings")
    .select("tenant_id, value")
    .eq("key", NEWSLETTER_MEASUREMENT_COPY_SETTING_KEY)
    .in("tenant_id", [...tenantIds]);
  if (settingsError) {
    console.error("[newsletter-measurement] copy read failed", settingsError.message);
  } else {
    for (const row of settings ?? []) {
      overrides.set(row.tenant_id, parseNewsletterMeasurementOverrides(row.value));
    }
  }

  // Reputacja domeny (ta sama bramka co kampanie, ścieżki i prośby Y1).
  const { evaluateSendGate } = await import("@/lib/email/reputationGate.server");
  const out = new Map<string, TenantContext>();
  for (const tenantId of tenantIds) {
    const verdict = await evaluateSendGate(admin, tenantId);
    out.set(tenantId, {
      origin: publicFacingOrigin(domains.get(tenantId) ?? null),
      overrides: overrides.get(tenantId) ?? NEWSLETTER_MEASUREMENT_EMPTY_OVERRIDES,
      sendAllowed: verdict.allowed,
    });
  }
  return out;
}

export interface NewsletterMeasurementMailOptions {
  /** Prośby na przebieg (domyślnie `NEWSLETTER_MEASUREMENT_MAIL_BATCH`). */
  limit?: number;
  /** Chwila (ms epoki), po której krok nie zaczyna kolejnej prośby. */
  deadlineAt?: number;
  now?: () => Date;
}

export async function runNewsletterMeasurementMail(
  admin: DbClient,
  options: NewsletterMeasurementMailOptions = {},
): Promise<NewsletterMeasurementMailResult> {
  const now = options.now ?? (() => new Date());
  const result: NewsletterMeasurementMailResult = {
    claimed: 0,
    queued: 0,
    duplicate: 0,
    suppressed: 0,
    failed: 0,
    deferred: 0,
    gone: 0,
  };
  const { data, error } = await asRpc(admin).rpc("newsletter_measurement_claim", {
    p_limit: options.limit ?? NEWSLETTER_MEASUREMENT_MAIL_BATCH,
  });
  if (error) {
    const { isMigrationPending } = await import("@/lib/supabase/migrationPending");
    if (isMigrationPending(error)) return { ...result, skipped: "migration_pending" };
    throw new Error(error.message);
  }
  const claims = parseNewsletterMeasurementClaims(data);
  result.claimed = claims.length;
  if (claims.length === 0) return result;

  const tenants = await loadTenants(admin, [...new Set(claims.map((c) => c.tenantId))]);
  const { enqueueRawEmail } = await import("@/lib/email/transactional.server");

  const mark = async (
    claim: NewsletterMeasurementClaim,
    outcome: NewsletterSunsetOutcome,
    code: string | null,
  ) => {
    const { data: marked, error: markError } = await asRpc(admin).rpc(
      "newsletter_measurement_mark",
      {
        p_subscriber: claim.subscriberId,
        p_nonce: claim.nonce,
        p_outcome: outcome,
        p_error: code,
      },
    );
    if (markError) {
      // Mail mógł już wyjść - dzierżawa wróci po 15 min, a ten sam klucz
      // idempotencji da wtedy `duplicate` zamiast drugiej wiadomości.
      console.error("[newsletter-measurement] mark failed", markError.message);
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
    const unsubscribeUrl = claim.unsubscribeToken
      ? newsletterUnsubscribeUrl(tenant.origin, claim.unsubscribeToken)
      : null;
    let rendered: Awaited<ReturnType<typeof renderMeasurementReconfirmEmail>>;
    try {
      const token = signMeasurementConfirmToken({
        subscriberId: claim.subscriberId,
        nonce: claim.nonce,
        expiresAt: new Date(now().getTime() + MEASUREMENT_CONFIRM_LINK_DAYS * DAY_MS),
      });
      rendered = await renderMeasurementReconfirmEmail({
        lang: claim.lang,
        overrides: tenant.overrides,
        firstName: claim.firstName,
        confirmUrl: newsletterMeasurementUrl(tenant.origin, token, claim.lang),
        unsubscribeUrl,
        siteUrl: tenant.origin,
      });
    } catch (err) {
      console.error("[newsletter-measurement] render failed", err);
      await mark(claim, "failed", "render_failed");
      continue;
    }
    const sent = await enqueueRawEmail({
      to: claim.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      label: NEWSLETTER_MEASUREMENT_MAIL_LABEL,
      category: "bulk",
      idempotencyKey: `newsletter_measurement:${claim.subscriberId}:${claim.nonce}`,
      tenantId: claim.tenantId,
      // Nagłówki RFC 8058: wypis jednym kliknięciem także z tej wiadomości.
      unsubscribeUrl,
    });
    const { outcome, code } = sunsetOutcomeOf(sent);
    await mark(claim, outcome, code);
  }
  return result;
}
