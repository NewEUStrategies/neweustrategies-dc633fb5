// Atom: skąd pochodzą liczby huba - historia, podstawa kwot, chwila
// przeliczenia i środowisko (SPEC §6.1, §6.2).
//
// PO CO. Hub liczy przychód z księgi ruchów MRR, która zaczyna się w dniu
// wdrożenia (`data_since`). Churn roczny, NRR i kohorty M12 potrzebują 12
// miesięcy historii - przed ich upływem liczba jest PRAWDZIWA, ale niepełna.
// Bez tej notki admin porównałby churn z 3 miesięcy z benchmarkiem rocznym
// i wyciągnął fałszywy wniosek. Stąd zdanie „Historia od X - wynik pełny od
// X + 12 mies." zamiast milczenia.
//
// DATA `data_since` TO DZIEŃ KALENDARZOWY, NIE CHWILA. Serwer podaje
// `YYYY-MM-DD`; `new Date("2026-03-01")` czyta taki napis jako PÓŁNOC UTC,
// czyli w Warszawie 1 marca 01:00, ale w strefach na zachód od Greenwich
// 28 lutego - data przeskoczyłaby o dzień. Rozbijamy napis i składamy datę
// LOKALNĄ konstruktorem `new Date(r, m, d)` (AGENTS: daty lokalne).
//
// `basisMix` TO UDZIAŁ KWOT PO CENIE KATALOGOWEJ. Do backfillu cen z operatora
// część MRR liczy się po cenniku; procent mówi, ile liczb może się jeszcze
// przesunąć, gdy przyjdzie prawdziwa cena.
import { useTranslation } from "react-i18next";

import { chartLangFrom, type ChartLang } from "@/lib/charts/format";
import { ensureI18n } from "@/lib/i18n-admin-revenue-shell";
import { isLocalIsoDay } from "@/lib/revenue/search";

const LOCALE: Readonly<Record<ChartLang, string>> = { pl: "pl-PL", en: "en-GB" };

/** Miesiące historii, po których wskaźniki roczne liczą się z pełnego okna. */
export const FULL_HISTORY_MONTHS = 12;

export interface ProvenanceNoteProps {
  /** `YYYY-MM-DD` - pierwszy dzień historii księgi (data LOKALNA, nie chwila). */
  dataSince?: string | null;
  /** Liczba pozycji wycenionych ceną operatora i ceną katalogową. */
  basisMix?: { provider: number; catalog: number } | null;
  /** Chwila przeliczenia migawki (ISO 8601 z przesunięciem). */
  computedAt?: string | null;
  /** Środowisko płatności, z którego pochodzą kwoty - hub liczy wyłącznie `live`. */
  environment?: "live";
}

/** Dzień kalendarzowy `YYYY-MM-DD` jako lokalna północ; napis spoza kalendarza → `null`. */
function localDayOf(day: string | null | undefined): Date | null {
  if (!isLocalIsoDay(day)) return null;
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Dzień, od którego wynik roczny jest pełny: ten sam dzień 12 miesięcy później.
 * Konstruktor lokalny przenosi przepełnienie miesiąca sam (29 lutego → 1 marca
 * w roku nieprzestępnym), bez arytmetyki na milisekundach, która myli się
 * przy zmianie czasu.
 */
function fullHistoryFrom(since: Date): Date {
  return new Date(since.getFullYear(), since.getMonth() + FULL_HISTORY_MONTHS, since.getDate());
}

export function ProvenanceNote({
  dataSince,
  basisMix,
  computedAt,
  environment,
}: ProvenanceNoteProps) {
  ensureI18n();
  const { t, i18n } = useTranslation();
  const locale = LOCALE[chartLangFrom(i18n.language)];
  const day = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" });

  const parts: { key: string; text: string }[] = [];

  const since = localDayOf(dataSince);
  if (since) {
    const full = fullHistoryFrom(since);
    // Porównanie z zegarem przeglądarki: notka jest stanem „dziś", nie danymi.
    parts.push(
      Date.now() < full.getTime()
        ? {
            key: "fullFrom",
            text: t("adminRevenue.provenance.fullFrom", {
              since: day.format(since),
              full: day.format(full),
            }),
          }
        : {
            key: "dataSince",
            text: t("adminRevenue.provenance.dataSince", { date: day.format(since) }),
          },
    );
  }

  if (basisMix) {
    const provider = Math.max(0, basisMix.provider);
    const catalog = Math.max(0, basisMix.catalog);
    const total = provider + catalog;
    // Komplet cen z operatora (catalog = 0) to stan docelowy - nie ma o czym
    // ostrzegać. Pusta baza (0 + 0) nie ma udziału.
    if (total > 0 && catalog > 0) {
      const share = new Intl.NumberFormat(locale, {
        style: "percent",
        maximumFractionDigits: 0,
      }).format(catalog / total);
      parts.push({ key: "basisMix", text: t("adminRevenue.provenance.basisMix", { share }) });
    }
  }

  if (computedAt) {
    const at = new Date(computedAt);
    if (Number.isFinite(at.getTime())) {
      const time = new Intl.DateTimeFormat(locale, {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(at);
      parts.push({ key: "computedAt", text: t("adminRevenue.provenance.computedAt", { time }) });
    }
  }

  if (environment === "live") {
    parts.push({ key: "liveOnly", text: t("adminRevenue.provenance.liveOnly") });
  }

  if (parts.length === 0) return null;

  return (
    <ul
      aria-label={t("adminRevenue.provenance.label")}
      className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] leading-snug text-muted-foreground"
    >
      {parts.map((part) => (
        <li key={part.key} data-provenance={part.key}>
          {part.text}
        </li>
      ))}
    </ul>
  );
}
