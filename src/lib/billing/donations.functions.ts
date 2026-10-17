// Publiczna warstwa `createServerFn` modułu darowizn: konfiguracja, statystyki
// i otwarcie kasy. Logika mieszka w `donations.server.ts`.
//
// Model wpłat jest konfigurowalny (`site_settings.donations`):
//   * `stripe`   - własny checkout (jednorazowo / miesięcznie), wpłaty lądują
//                  w `public.donations` przez webhook operatora,
//   * `external` - zewnętrzna zbiórka (tryb awaryjny, wyłącznie link).
// Podstawa prawno-podatkowa zmiany modelu: docs/WDROZENIE_DAROWIZNY_WLASNY_CHECKOUT_2026-08-06.md.
//
// Odczyty publiczne (konfiguracja + statystyki) idą przez `edgeTtlCache`, więc
// widget CMS na stronie głównej nie generuje jednego zapytania na render -
// jeden odczyt na 60 s na najemcę, współdzielony przez wszystkie żądania SSR.
import { createServerFn } from "@tanstack/react-start";
import { normalizeCheckoutLocale, type CheckoutLocale } from "@/lib/billing/checkoutLocale";
import { edgeTtlCache } from "@/lib/ssrCache";
import { resolveReturnUrl } from "@/lib/http/resolveReturnUrl";
import type { DonationsConfig } from "@/lib/billing/donationsConfig";

/** TTL wspólny dla konfiguracji i statystyk (te same dane widzi cała strona). */
const PUBLIC_TTL_MS = 60_000;
/** Twardy sufit skanu wpłat - ochrona pamięci izolatu przy dużym rejestrze. */
const STATS_ROW_CAP = 20_000;
const STATS_PAGE = 1_000;

export interface DonationsPublicStats {
  /** Suma NETTO (po zwrotach częściowych) opłaconych wpłat w walucie zbiórki. */
  totalCents: number;
  monthCents: number;
  count: number;
  monthCount: number;
  currency: string;
  recent: { amount_cents: number; currency: string; created_at: string }[];
  /** `true`, gdy rejestr przekroczył sufit skanu i sumy są przycięte. */
  truncated: boolean;
}

function emptyStats(currency: string): DonationsPublicStats {
  return {
    totalCents: 0,
    monthCents: 0,
    count: 0,
    monthCount: 0,
    currency,
    recent: [],
    truncated: false,
  };
}

/**
 * Publiczne, zagregowane statystyki darowizn dla widgetu CMS i formularza.
 *
 * NIE wystawia PII (donor_email, message) - tylko sumy i kwoty ostatnich N
 * pozycji. Odczyt service-role (RLS nie dopuszcza anona), zawężony do tenantu
 * hosta, `status='paid'` i ŚRODOWISKA bramki tego wdrożenia (w produkcji
 * `live`): wpłata kartą testową nie może podbijać paska zbiórki (audyt SUB-10).
 * Kwota pozycji to kwota NETTO - zwrot częściowy zostawia wpłatę opłaconą
 * (tak jak zamówienie), ale zwrócona część nie jest już zebranym wsparciem.
 *
 * Sumujemy WYŁĄCZNIE wpłaty w walucie zbiórki: rejestr bywa dwuwalutowy
 * (PLN historycznie, EUR po zmianie ustawień), a dodanie groszy do centów
 * dawało pasek postępu oderwany od celu zbiórki wyrażonego w jednej walucie.
 */
export const getDonationsPublicStats = createServerFn({ method: "GET" }).handler(
  async (): Promise<DonationsPublicStats> => {
    return edgeTtlCache("donations:public-stats", PUBLIC_TTL_MS, async () => {
      // Najemca przed konfiguracją: `loadConfigCached` rozstrzyga go tą samą
      // funkcją, a dwa równoległe pierwsze importy modułu katalogu najemców
      // potrafiły dać w testach dwie różne instancje.
      const tenantId = await hostTenantId();
      const [{ supabaseAdmin }, config] = await Promise.all([
        import("@/integrations/supabase/client.server"),
        loadConfigCached(),
      ]);
      if (!tenantId) return emptyStats(config.currency);
      const { resolveEnvironment } = await import("@/lib/stripe.server");
      const environment = resolveEnvironment(null);

      // Początek bieżącego miesiąca w UTC - ta sama granica co w eksportach.
      const now = new Date();
      const monthStart = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
      ).toISOString();

      const stats = emptyStats(config.currency);
      for (let offset = 0; offset < STATS_ROW_CAP; offset += STATS_PAGE) {
        const { data, error } = await supabaseAdmin
          .from("donations")
          .select("amount_cents,refunded_amount_cents,currency,created_at")
          .eq("tenant_id", tenantId)
          .eq("environment", environment)
          .eq("status", "paid")
          .eq("currency", config.currency)
          .order("created_at", { ascending: false })
          .range(offset, offset + STATS_PAGE - 1);
        if (error) {
          console.error("[donations] public stats failed", error.message);
          return emptyStats(config.currency);
        }
        const rows = data ?? [];
        for (const row of rows) {
          const netCents = Math.max(0, row.amount_cents - (row.refunded_amount_cents ?? 0));
          stats.totalCents += netCents;
          stats.count += 1;
          if (row.created_at >= monthStart) {
            stats.monthCents += netCents;
            stats.monthCount += 1;
          }
          if (stats.recent.length < 5) {
            stats.recent.push({
              amount_cents: netCents,
              currency: row.currency,
              created_at: row.created_at,
            });
          }
        }
        if (rows.length < STATS_PAGE) return stats;
      }
      stats.truncated = true;
      return stats;
    });
  },
);

/** Najemca hosta żądania (płaszczyzna treści) - `null`, gdy katalog milczy. */
async function hostTenantId(): Promise<string | null> {
  const [{ resolveTenantIdForHost }, { currentTenantHost }] = await Promise.all([
    import("@/lib/server/tenant.server"),
    import("@/lib/http/requestHost"),
  ]);
  return resolveTenantIdForHost(await currentTenantHost());
}

/**
 * Konfiguracja z cache per izolat - współdzielona przez stats i server fn.
 * Klucz `edgeTtlCache` jest zawężany do hosta, a host wyznacza najemcę, więc
 * jeden wpis = konfiguracja jednego najemcy (nigdy „pierwszego wiersza").
 */
function loadConfigCached(): Promise<DonationsConfig> {
  return edgeTtlCache("donations:config", PUBLIC_TTL_MS, async () => {
    const [{ loadDonationsConfig }, tenantId] = await Promise.all([
      import("@/lib/billing/donations.server"),
      hostTenantId(),
    ]);
    return loadDonationsConfig(tenantId);
  });
}

/** Publiczna konfiguracja darowizn dla formularza i CTA (bez sekretów). */
export const getDonationsConfig = createServerFn({ method: "GET" }).handler(
  async (): Promise<DonationsConfig> => loadConfigCached(),
);

export interface DonationCheckoutInput {
  environment: "sandbox" | "live";
  amountCents: number;
  recurring: boolean;
  donorEmail?: string;
  message?: string;
  returnUrl: string;
  locale?: CheckoutLocale;
}

/**
 * Otwiera sesję osadzonej kasy dla darowizny. Endpoint jest publiczny (wpłata
 * nie wymaga konta), więc kwota, waluta i limity są walidowane WYŁĄCZNIE po
 * stronie serwera, a próby limitowane per podmiot (skrót IP albo konto).
 *
 * ŚRODOWISKO od klienta jest tylko prośbą: rozstrzyga je `resolveEnvironment`
 * (ta sama funkcja co checkout planów - w produkcji zawsze `live`). Wcześniej
 * `getStripeClient(input.environment)` brał wartość z przeglądarki wprost.
 *
 * Tożsamość czytamy miękko: zalogowany darczyńca dostaje wpłatę w rejestrze
 * profilu i status wspierającego, anonimowy - pełną anonimowość.
 */
export const createDonationCheckout = createServerFn({ method: "POST" })
  .validator((data: DonationCheckoutInput) => {
    if (data.environment !== "sandbox" && data.environment !== "live") {
      throw new Error("invalid_environment");
    }
    if (!Number.isFinite(data.amountCents)) throw new Error("invalid_amount");
    if (typeof data.returnUrl !== "string") {
      throw new Error("invalid_return_url");
    }
    try {
      new URL(data.returnUrl);
    } catch {
      throw new Error("invalid_return_url");
    }
    return data;
  })
  .handler(async ({ data }) => {
    const [
      { getRequest },
      { createDonationSession },
      { requestRateSubject },
      { optionalUserIdFromRequest },
    ] = await Promise.all([
      import("@tanstack/react-start/server"),
      import("@/lib/billing/donations.server"),
      import("@/lib/server/rateSubject.server"),
      import("@/lib/auth/optionalUser.server"),
    ]);
    // Osobno, po module darowizn: ten sam moduł bramki ładowany równolegle
    // dwiema ścieżkami importu dostawał w testach dwie różne instancje.
    const { resolveEnvironment } = await import("@/lib/stripe.server");

    const userId = await optionalUserIdFromRequest();
    let headers: Headers | null = null;
    try {
      headers = getRequest()?.headers ?? null;
    } catch {
      /* brak kontekstu HTTP - wspólny kubełek limitu */
    }

    return createDonationSession({
      environment: resolveEnvironment(data.environment),
      amountCents: data.amountCents,
      recurring: Boolean(data.recurring),
      donorEmail: data.donorEmail ?? null,
      message: data.message ?? null,
      userId,
      returnUrl: resolveReturnUrl(data.returnUrl),
      locale: normalizeCheckoutLocale(data.locale),
      rateKey: requestRateSubject(headers, userId),
    });
  });
