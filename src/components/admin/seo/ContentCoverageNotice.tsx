// Atomy kokpitu SEO o STANIE ODCZYTU treści: lista niepełna (przycięta albo
// o nieznanej liczności) i odczyt, który padł. Używają ich obie zakładki
// liczące treści (`/admin/seo/` i `/admin/seo/content`), więc komunikat
// i przycisk ponowienia nie mogą się między nimi rozjechać.
//
// Lista niepełna: kafelki „bez opisu" / „domyślna karta" / „gotowe" liczone
// z przyciętej listy wyglądają identycznie jak liczone z pełnej - jedyna
// różnica jest w tym, czy ekran o przycięciu powie.
//
// `ContentCoverageNotice` dla listy kompletnej nie renderuje niczego.
// Kompletność rozstrzyga `seoContentCoverage` (`@/lib/seo/seoContentQuery`) -
// tu wyłącznie ją pokazujemy.
import { useTranslation } from "react-i18next";
// Klucze `adminSeoHub.*` - patrz ten sam import w `TechnicalFoundationCard.tsx`.
import "@/lib/i18n-admin-seo-hub";
import type { SeoContentCoverage } from "@/lib/seo/seoContentQuery";

export function ContentCoverageNotice({ coverage }: { coverage: SeoContentCoverage }) {
  const { t } = useTranslation();
  if (coverage.state === "complete") return null;
  return (
    <p
      data-seo-coverage={coverage.state}
      className="rounded-lg border border-brand/40 bg-brand/5 px-3 py-2 text-xs text-brand-ink dark:text-brand"
    >
      {coverage.state === "truncated"
        ? t("adminSeoHub.coverageTruncated", { shown: coverage.shown, total: coverage.total })
        : t("adminSeoHub.coverageUnknown", { shown: coverage.shown })}
    </p>
  );
}

/** Dopisek przy etykiecie kafelka liczonego z niepełnej listy. */
export function PartialTag() {
  const { t } = useTranslation();
  return (
    <span data-seo-partial className="ml-1 text-brand-ink dark:text-brand">
      ({t("adminSeoHub.coveragePartialTag")})
    </span>
  );
}

/**
 * Odczyt treści padł. Stan ODRĘBNY od ładowania i od pustej bazy - inaczej
 * awaria wygląda jak „ładowanie" w nieskończoność albo jak „0 problemów".
 */
export function ContentReadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      data-seo-read-error
      className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
    >
      <span>{t("adminSeoHub.contentReadError")}</span>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-md border border-destructive/40 px-2 py-1 font-medium hover:bg-destructive/10"
      >
        {t("adminSeoHub.contentRetry")}
      </button>
    </div>
  );
}
