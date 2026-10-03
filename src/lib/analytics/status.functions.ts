/**
 * Aggregate status for the /admin/analytics dashboard.
 * Reports which integrations (GSC, GA4, Web Vitals) are configured.
 * Never returns secret values.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  resolveGa4MeasurementId,
  type Ga4MeasurementIdSource,
} from "@/lib/analytics/measurementId";
import { firstEnv } from "@/lib/analytics/envSecrets";
import {
  readStoredAnalyticsSettings,
  requireAnalyticsAdmin,
  toAnalyticsGatewayCtx,
} from "@/lib/analytics/gateway.server";

export type Ga4Mode = "service_account" | "oauth_refresh" | "measurement_protocol" | "embed" | null;

export interface AnalyticsStatus {
  gsc: { configured: boolean };
  ga4: {
    // True gdy przynajmniej jeden tryb odczytu raportów jest gotowy
    // (service_account lub oauth_refresh) + property id.
    configured: boolean;
    // Zewnętrzny "kill switch" wymuszony przez admina (Odłącz w UI).
    enabled: boolean;
    // Który tryb jest aktywny do pobierania raportów Data API.
    activeMode: Ga4Mode;
    hasServiceAccount: boolean;
    hasPropertyId: boolean;
    hasOauthRefresh: boolean;
    hasOauthClient: boolean;
    hasMeasurementProtocol: boolean;
    hasMeasurementId: boolean;
    hasEmbedUrl: boolean;
    serviceAccountEmail: string | null;
    propertyId: string | null;
    measurementId: string | null;
    // Skąd pochodzi ID pomiaru: sekret, ustawienia panelu czy konektor.
    measurementIdSource: Ga4MeasurementIdSource;
    embedUrl: string | null;
    // Podpowiedzi UX - czego brakuje po stronie sekretów projektu.
    missingSecrets: string[];
  };
  vitals: { configured: boolean };
}

export const getAnalyticsStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AnalyticsStatus> => {
    // Bramka przed czymkolwiek innym: odmowa nie kosztuje odczytu ustawień ani
    // nie dotyka sekretów środowiska.
    await requireAnalyticsAdmin(context);

    const stored = await readStoredAnalyticsSettings(toAnalyticsGatewayCtx(context));
    const ga4Enabled = stored.ga4_enabled !== false;

    const gscOk = Boolean(process.env.LOVABLE_API_KEY && process.env.GOOGLE_SEARCH_CONSOLE_API_KEY);

    // Service Account
    const saRaw = process.env.GA4_SERVICE_ACCOUNT_JSON ?? "";
    let saEmail: string | null = null;
    let saOk = false;
    if (saRaw) {
      try {
        const parsed = JSON.parse(saRaw) as { client_email?: string; private_key?: string };
        if (parsed.client_email && parsed.private_key) {
          saOk = true;
          saEmail = parsed.client_email;
        }
      } catch {
        saOk = false;
      }
    }

    // OAuth 2.0 refresh token - przyjmujemy też nazwy z przedrostkiem
    // GOOGLE_*, bo pod takimi użytkownik zapisuje klucze z Google Cloud.
    const oauthClientOk = Boolean(
      firstEnv("GA4_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_ID") &&
      firstEnv("GA4_OAUTH_CLIENT_SECRET", "GOOGLE_OAUTH_CLIENT_SECRET"),
    );
    const oauthRefreshOk = Boolean(
      firstEnv("GA4_OAUTH_REFRESH_TOKEN", "GOOGLE_OAUTH_REFRESH_TOKEN"),
    );

    // Measurement Protocol (send events) - fall back to stored measurement id.
    // `||`, nie `??`: pusta zmienna środowiskowa to pusty string, a nie brak
    // wartości. Z `??` deklaracja `GA4_MEASUREMENT_ID=` przesłaniałaby wpis
    // najemcy i panel meldowałby „nieskonfigurowane", podczas gdy
    // `sendGa4Event` (`GA4_MEASUREMENT_ID?.trim() || stored...`) nadawałby
    // identyfikatorem z bazy - dwie funkcje modułu przeczyłyby sobie co do
    // tej samej wartości.
    // Konektor Google Analytics jest trzecim (zapasowym) źródłem - ta sama
    // kolejność co w kliencie, żeby panel nie meldował „brak", gdy skrypt GA
    // realnie działa z ID konektora.
    const { measurementId, source: measurementIdSource } = resolveGa4MeasurementId(
      stored.ga4_measurement_id,
    );
    const apiSecretOk = Boolean(process.env.GA4_API_SECRET);
    const mpOk = Boolean(measurementId && apiSecretOk);

    // Embed (Looker Studio / iframe)
    const embedUrl = process.env.GA4_EMBED_URL ?? null;

    // Property ID: env pierwsze, potem konfiguracja z bazy. Znowu `||`:
    // pusty sekret znaczy BRAK sekretu, a nie skasowanie property zapisanego
    // przez najemcę - ta sama granica, co w `resolveGa4PropertyId`
    // (`ga4.server.ts`), żeby status i odczyt raportów mówiły to samo.
    const propertyId =
      process.env.GA4_PROPERTY_ID?.trim() || stored.ga4_property_id?.trim() || null;
    const hasProperty = Boolean(propertyId);

    let activeMode: Ga4Mode = null;
    if (ga4Enabled) {
      if (saOk && hasProperty) activeMode = "service_account";
      else if (oauthClientOk && oauthRefreshOk && hasProperty) activeMode = "oauth_refresh";
      else if (embedUrl) activeMode = "embed";
      else if (mpOk) activeMode = "measurement_protocol";
    }

    const missingSecrets: string[] = [];
    if (!hasProperty) missingSecrets.push("GA4_PROPERTY_ID");
    if (!saOk && !(oauthClientOk && oauthRefreshOk)) {
      missingSecrets.push("GA4_SERVICE_ACCOUNT_JSON");
    }

    const readyToRead = (saOk || (oauthClientOk && oauthRefreshOk)) && hasProperty;
    return {
      gsc: { configured: gscOk },
      ga4: {
        configured: ga4Enabled && readyToRead,
        enabled: ga4Enabled,
        activeMode,
        hasServiceAccount: saOk,
        hasPropertyId: hasProperty,
        hasOauthRefresh: oauthRefreshOk,
        hasOauthClient: oauthClientOk,
        hasMeasurementProtocol: mpOk,
        hasMeasurementId: Boolean(measurementId),
        hasEmbedUrl: Boolean(embedUrl),
        serviceAccountEmail: saEmail,
        propertyId,
        measurementId,
        measurementIdSource,
        embedUrl,
        missingSecrets,
      },
      vitals: { configured: true },
    };
  });
