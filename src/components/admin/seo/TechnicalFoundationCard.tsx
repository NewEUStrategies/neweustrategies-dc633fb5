// KARTA FUNDAMENTÓW TECHNICZNYCH na kokpicie SEO.
//
// Odpowiada na pytanie, które przynosi każdy zewnętrzny audyt: „czy mapa strony
// naprawdę istnieje" i „czy dokument deklaruje język". Zamiast wierzyć raportowi
// skanera (bywa nieświeży o wiele godzin), karta POBIERA cztery powierzchnie
// z PUBLICZNEGO originu bieżącego tenanta (`useTenantPublicOrigin`) i ocenia
// je regułami z `@/lib/seo/technicalFoundation`. Origin jest per-tenant: admin
// tenanta z własną domeną ma widzieć stan SWOICH plików, nie plików marki.
//
// GRANICA WIARYGODNOŚCI. Pliki generowane nie wysyłają nagłówków CORS, więc
// odczyt originu publicznego z panelu otwartego na INNYM hoście zawsze pada.
// Spadek na same-origin jest uczciwy tylko wtedy, gdy host panelu należy do
// tego samego serwisu (`panelHostServesOrigin`) - inaczej względne
// `/sitemap.xml` to plik hosta panelu (marki albo tenanta domyślnego), a karta
// raportowałaby zielony stan CUDZEGO serwisu. W takim układzie wiersze mają
// stan „brak danych" z odesłaniem do linku „Otwórz", a „Pobierz" znika.
//
// Ekran kokpitu jest tylko do czytania (bramka `adminRouteAuthority.gate.test.ts`),
// więc tu nie ma żadnej mutacji - wyłącznie odczyty GET tego samego serwisu.
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Download, ExternalLink } from "@/lib/lucide-shim";
import { useTenantPublicOriginState } from "@/lib/seo/useTenantPublicOrigin";
import { panelHostServesOrigin } from "@/lib/seo/tenantPublicOrigin";
import { displayHost } from "@/lib/seo/socialNetworks";
// Karta woła wyłącznie klucze `adminSeoHub.*`. Bez tego importu nakładka
// wchodziła do chunka tylko wtedy, gdy wciągnął ją inny moduł kokpitu -
// renderowana samodzielnie pokazywała surowe klucze zamiast napisów.
import "@/lib/i18n-admin-seo-hub";
import {
  FOUNDATION_BODY_LIMIT,
  checkHtmlLang,
  checkLlms,
  checkRobots,
  checkSitemap,
  worstFoundationState,
  type FoundationCheck,
  type FoundationProbe,
  type FoundationState,
} from "@/lib/seo/technicalFoundation";

/**
 * Cztery powierzchnie: trzy pliki generowane i strona główna (atrybut lang).
 * Sondy celują w PUBLICZNY ORIGIN TENANTA - panel otwarty na hoście podglądu
 * ma raportować stan adresu publicznego, nie adresu tymczasowego (dla marki to
 * domena kanoniczna, dla tenanta z własną domeną - ta domena). Gdy przeglądarka
 * odmówi odczytu cross-origin (brak nagłówków CORS na domenie), wracamy do
 * same-origin TYLKO wtedy, gdy host panelu jest tym samym serwisem - wtedy
 * treść plików generowanych jest na obu hostach identyczna.
 */
const PROBE_PATHS = ["/sitemap.xml", "/robots.txt", "/llms.txt", "/"] as const;

/** Reguły w kolejności `PROBE_PATHS` - para (id wiersza, ocena treści). */
const RULES = [
  ["sitemap", checkSitemap],
  ["robots", checkRobots],
  ["llms", checkLlms],
  ["htmlLang", checkHtmlLang],
] as const;

/** Klucz fundamentu -> ścieżka pliku, który link „Otwórz" pokazuje. */
const OPEN_PATH: Record<string, string> = {
  sitemap: "/sitemap.xml",
  robots: "/robots.txt",
  llms: "/llms.txt",
  htmlLang: "/",
};

/**
 * `null` = pliku nie da się odczytać Z TEGO HOSTA (cross-origin odrzucony,
 * a same-origin należy do innego serwisu) - to nie jest awaria pliku.
 */
async function probe(
  origin: string,
  path: string,
  sameSiteFallback: boolean,
): Promise<FoundationProbe | null> {
  const targets = sameSiteFallback ? [`${origin}${path}`, path] : [`${origin}${path}`];
  for (const target of targets) {
    try {
      const res = await fetch(target, { headers: { Accept: "*/*" } });
      const text = await res.text();
      return { status: res.status, body: text.slice(0, FOUNDATION_BODY_LIMIT) };
    } catch {
      // Błąd sieci na originie publicznym - próbujemy same-origin (o ile to ten
      // sam serwis); 0 czyta się jako „brak odpowiedzi" i nie wywraca kokpitu.
    }
  }
  return sameSiteFallback ? { status: 0, body: "" } : null;
}

const TONE: Record<FoundationState, string> = {
  ok: "text-emerald-500",
  warn: "text-amber-500",
  fail: "text-destructive",
  unknown: "text-muted-foreground",
};

// Pliki do pobrania - same-origin, żeby atrybut `download` zadziałał
// (przeglądarka ignoruje go dla adresów z innej domeny). Celowo NIE origin
// publiczny tenanta - ale wyłącznie wtedy, gdy host panelu jest tym samym
// serwisem; inaczej plik same-origin należy do kogoś innego i link znika.
const DOWNLOAD: Record<string, { href: string; file: string }> = {
  sitemap: { href: "/sitemap.xml", file: "sitemap.xml" },
  robots: { href: "/robots.txt", file: "robots.txt" },
  llms: { href: "/llms.txt", file: "llms.txt" },
};

export function TechnicalFoundationCard() {
  const { t } = useTranslation();
  // Linki „Otwórz" prowadzą na TEN SAM origin, który sondujemy - audytor ma
  // zobaczyć publiczny plik swojego serwisu, nie jego kopię na hoście podglądu
  // ani plik innego tenanta.
  const { origin, host, status, retry } = useTenantPublicOriginState();
  const sameSite = panelHostServesOrigin(host, origin);
  const publicHost = origin ? displayHost(origin) : "";
  const { data, isPending } = useQuery({
    // Origin i „ten sam serwis" w kluczu: wynik sond należy do konkretnego
    // serwisu oglądanego z konkretnego hosta. Sondy ruszają WYŁĄCZNIE po
    // udanym odczycie domeny - ani w locie, ani po błędzie (origin tymczasowy
    // to wtedy host karty, a jego pliki mogą być plikami marki).
    queryKey: ["admin-seo-foundation", origin, sameSite],
    enabled: status === "resolved" && origin !== null,
    // Same-origin GET-y, więc odświeżanie przy każdym wejściu na zakładkę jest
    // tanie; minuta świeżości wystarcza po publikacji.
    staleTime: 60_000,
    queryFn: async (): Promise<FoundationCheck[]> => {
      const probes = await Promise.all(
        PROBE_PATHS.map((path) => probe(origin ?? "", path, sameSite)),
      );
      return RULES.map(([id, rule], index): FoundationCheck => {
        const result = probes[index];
        return result
          ? rule(result)
          : { id, state: "unknown", detailKey: "foundationCrossHost", detailValue: publicHost };
      });
    },
  });

  const checks = data ?? [];
  const worst = worstFoundationState(checks);

  // Odczyt domeny padł: nie sondujemy originu tymczasowego, tylko mówimy to
  // wprost i dajemy ponowienie.
  if (status === "failed") {
    return (
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">{t("adminSeoHub.sectionFoundation")}</h2>
        <p className="text-xs text-muted-foreground" data-seo-foundation-origin="failed">
          {t("adminSeoHub.foundationOriginFailed")}
        </p>
        <button
          type="button"
          onClick={retry}
          className="text-xs font-medium text-brand hover:underline"
        >
          {t("adminSeoHub.foundationOriginRetry")}
        </button>
      </section>
    );
  }

  // Tenant bez publicznej domeny: nie ma czego sondować, a spadek na host
  // karty pokazałby pliki marki.
  if (status === "resolved" && origin === null) {
    return (
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">{t("adminSeoHub.sectionFoundation")}</h2>
        <p className="text-xs text-muted-foreground" data-seo-foundation-origin="none">
          {t("adminSeoHub.noPublicDomain")}
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">{t("adminSeoHub.sectionFoundation")}</h2>
      <p className="text-xs text-muted-foreground">{t("adminSeoHub.foundationIntro")}</p>
      {!isPending && !sameSite ? (
        <p className="text-xs text-amber-500" data-seo-foundation-cross-host>
          {t("adminSeoHub.foundationCrossHostNote", { value: publicHost })}
        </p>
      ) : null}

      {isPending ? (
        <p className="text-xs text-muted-foreground">{t("admin.loading")}</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border" data-seo-foundation>
          <table className="w-full text-sm">
            <tbody>
              {checks.map((check) => (
                <tr key={check.id} className="border-b border-border last:border-0">
                  <td className="w-1/3 px-3 py-2 align-top font-medium">
                    {t(`adminSeoHub.foundation_${check.id}`)}
                  </td>
                  <td
                    className={`w-24 px-3 py-2 align-top text-xs font-medium ${TONE[check.state]}`}
                  >
                    {t(`adminSeoHub.foundationState_${check.state}`)}
                  </td>
                  <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                    {t(`adminSeoHub.${check.detailKey}`, { value: check.detailValue ?? "" })}
                  </td>
                  <td className="w-40 px-3 py-2 text-right align-top">
                    <span className="inline-flex flex-wrap justify-end gap-3">
                      {/* Pliki generowane nie są trasami routera - zwykłe <a>. */}
                      <a
                        href={`${origin ?? ""}${OPEN_PATH[check.id] ?? "/"}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-brand hover:underline"
                      >
                        {t("adminSeoHub.open")}
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                      {sameSite && DOWNLOAD[check.id] ? (
                        <a
                          href={DOWNLOAD[check.id]?.href}
                          download={DOWNLOAD[check.id]?.file}
                          data-seo-download={check.id}
                          className="inline-flex items-center gap-1 text-brand hover:underline"
                        >
                          {t("adminSeoHub.download")}
                          <Download className="h-3 w-3 shrink-0" />
                        </a>
                      ) : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!isPending && worst === "ok" ? (
        <p className="text-xs text-emerald-500">{t("adminSeoHub.foundationAllGood")}</p>
      ) : null}
    </section>
  );
}
