// Atom: przypis źródła benchmarku w stylu chicagowskim z odznakami jakości
// (SPEC §6.1, §6.5; brief 05 §1).
//
// PRZYPIS, NIE LINK. Sam adres nie mówi, KTO twierdzi i KIEDY - a to
// rozstrzyga, ile pasmo jest warte. Opis składa `chicagoBibliography` (ta sama
// funkcja co przypisy wykresów), więc źródło wygląda identycznie w objaśnieniu,
// w słowniku i pod wykresem.
//
// ODZNAKI MÓWIĄ O SŁABOŚCIACH ŹRÓDŁA WPROST, przy liczbie, a nie w przypisie
// do przypisu: „fragment z wyszukiwarki” (strona za paywallem albo 403 -
// liczba potwierdzona tylko wycinkiem), „dostawca narzędzia” (raport firmy,
// która sprzedaje rozwiązanie mierzonego problemu), „starsze niż 18 miesięcy”
// (rynek sprzed podwyżek cen). Wiarygodność A/B/C ma opis słowny w `title`
// i w tekście dla czytnika - sama litera nic nie mówi.
import { useTranslation } from "react-i18next";
import {
  STALE_SOURCE_MONTHS,
  toChartSource,
  type LocalizedSource,
} from "@/lib/analytics/semantic/benchmarks/adapter";
import type { ChartLang } from "@/lib/charts/format";
import { chicagoBibliography, safeSourceUrl } from "@/lib/charts/sources";
import { ensureI18n } from "@/lib/i18n-admin-revenue-shell";
import { cn } from "@/lib/utils";

const RELIABILITY_KEY: Readonly<Record<LocalizedSource["reliability"], string>> = {
  A: "adminRevenue.benchmark.source.reliability_A",
  B: "adminRevenue.benchmark.source.reliability_B",
  C: "adminRevenue.benchmark.source.reliability_C",
};

const BADGE =
  "inline-flex items-center rounded-[6px] border px-1.5 text-[10px] font-medium leading-4 text-muted-foreground";

export interface SourceCitationProps {
  source: LocalizedSource;
  lang: ChartLang;
  className?: string;
}

export function SourceCitation({ source, lang, className }: SourceCitationProps) {
  ensureI18n();
  const { t } = useTranslation();
  const opts = { lng: lang };
  const parts = chicagoBibliography(toChartSource(source), lang);
  const url = safeSourceUrl(source.url);
  const stale = source.ageMonths !== null && source.ageMonths > STALE_SOURCE_MONTHS;
  const reliability = t(RELIABILITY_KEY[source.reliability], opts);

  return (
    <div className={cn("space-y-1 text-[11px] leading-snug", className)} data-source={source.id}>
      <p className="m-0 break-words">
        {parts.map((p, i) => {
          if (p.quoted) return <q key={i}>{p.text}</q>;
          if (p.italic) return <cite key={i}>{p.text}</cite>;
          // Adres jako odsyłacz wyłącznie dla http(s) - pole źródła jest
          // treścią redakcyjną i nie może wstawić `javascript:` do `href`.
          const raw = source.url.trim();
          if (url && raw !== "" && p.text.startsWith(raw)) {
            return (
              <span key={i}>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all underline underline-offset-2"
                >
                  {raw}
                </a>
                {p.text.slice(raw.length)}
              </span>
            );
          }
          return <span key={i}>{p.text}</span>;
        })}
      </p>
      <p className="m-0 flex flex-wrap items-center gap-1">
        <span className={BADGE} title={reliability} data-reliability={source.reliability}>
          <span aria-hidden="true">{source.reliability}</span>
          <span className="sr-only">{reliability}</span>
        </span>
        {source.verification === "snippet" ? (
          <span className={cn(BADGE, "border-dashed")} data-badge="snippet">
            {t("adminRevenue.benchmark.source.snippet", opts)}
          </span>
        ) : null}
        {source.vendor ? (
          <span className={BADGE} data-badge="vendor">
            {t("adminRevenue.benchmark.source.vendor", opts)}
          </span>
        ) : null}
        {stale ? (
          <span className={BADGE} data-badge="stale">
            {t("adminRevenue.benchmark.source.stale", opts)}
          </span>
        ) : null}
      </p>
    </div>
  );
}
