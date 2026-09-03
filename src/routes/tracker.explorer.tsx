// Explorer stanowisk i koalicji + dashboard trackera. URL: /tracker/explorer
//
// Wzorzec ECFR "EU Coalition Explorer" w skali NES: macierz dossier × 27 państw
// (komórka = kolor stanowiska), filtr obszaru polityki oraz kafle statystyk
// (liczba dossier, rozkład po etapach i obszarach) z RPC get_tracker_stats.
// Publiczny odczyt (RLS: opublikowane dossier + ich stanowiska).
import { useMemo, useState } from "react";
import { createFileRoute, Link, type ErrorComponentProps } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Landmark } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RouteErrorFallback } from "@/components/molecules/RouteErrorFallback";
import {
  positionsForItemsQueryOptions,
  publishedItemsQueryOptions,
  trackerStatsQueryOptions,
  usePublishedItems,
  usePositionsForItems,
  useTrackerStats,
  type PolicyItem,
  type PolicyPosition,
  type TrackerStats,
} from "@/lib/tracker/queries";
import { EU_COUNTRIES, STANCE_META, stanceLabel, stanceMeta } from "@/lib/tracker/euCountries";
import { POLICY_AREAS, areaLabel, stageLabel } from "@/lib/tracker/stages";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import { buildContentHead } from "@/lib/seo/meta";
import { anyDegraded, loadResilient, resilientCacheControl } from "@/lib/ssr/resilientLoad";
import { setCacheControlHeader } from "@/lib/http/responseHeaders";
import { ensureI18n as ensureTrackerI18n } from "@/lib/i18n-tracker";

/** Okno macierzy. Stała stoi PRZED deklaracją trasy, bo ten sam literał bierze
 *  loader (klucz cache) i stan początkowy komponentu - rozjazd tych dwóch daje
 *  SSR pod jednym kluczem i odczyt kliencki pod innym, czyli powrót defektu. */
const MATRIX_LIMIT = 100;

/**
 * Budżet DRUGIEJ fali (stanowiska). Krótszy niż domyślny budżet odpornego
 * ładowania, bo ta fala biegnie PO pierwszej: klucz stanowisk zawiera
 * identyfikatory dossier, więc round-trip jest z konstrukcji sekwencyjny i jego
 * budżet dodaje się do TTFB, a nie biegnie równolegle.
 */
const POSITIONS_BUDGET_MS = 2_000;

/** Fallbacki zdegradowanego renderu (patrz lib/ssr/resilientLoad). */
const NO_ITEMS: PolicyItem[] = [];
const NO_POSITIONS: PolicyPosition[] = [];
const NO_STATS: TrackerStats = { total: 0, by_stage: {}, by_area: {} };

export const Route = createFileRoute("/tracker/explorer")({
  // LOADER, KTÓREGO TA TRASA NIE MIAŁA (naprawa N4, 2026-09-02).
  //
  // DECYZJA: brak loadera NIE BYŁ tu uzasadniony. `useQuery` nie startuje
  // fetcha na serwerze, więc crawler i pierwsze malowanie dostawały powłokę
  // z `t("tracker.loading")` - a macierz stanowisk jest JEDYNĄ powierzchnią
  // serwisu, na której te dane w ogóle istnieją: kanał `/tracker/rss.xml`
  // niesie wpisy osi czasu, `/tracker` niesie karty dossier, a przekrój
  // „dossier x 27 państw" nie schodzi z serwera NIGDZIE. Powłoka bez treści
  // wchodziła potem do NES Edge Cache na do 24 h.
  //
  // ROZWAŻONE ODRZUCENIE I DLACZEGO NIE PRZESZŁO. (a) „To narzędzie
  // interaktywne, nie treść" - ale `head()` tej trasy deklaruje indeksowalny
  // tytuł i opis w obu językach, więc trasa JEST zgłoszona do indeksu jako
  // treść. (b) „Dane przefiltruje loader trasy nadrzędnej" - sprawdzone
  // w `routeTree.gen.ts`: pliku `tracker.tsx` NIE MA, rodzicem `/tracker/*`
  // jest `__root`, więc nie ma czyich danych filtrować.
  //
  // KASKADA JEST TU FAKTEM, NIE WYBOREM: klucz stanowisk zawiera
  // identyfikatory dossier, więc druga fala musi poczekać na pierwszą. Dlatego
  // fala pierwsza (statystyki + dossier) biegnie RÓWNOLEGLE, a druga dostaje
  // krótszy budżet - blip po stronie stanowisk oddaje macierz bez wierszy,
  // ale nigdy nie zamienia strony w HTTP 500.
  //
  // Brak `notFound()` jest świadomy: pusty tracker (nowy tenant, dossier bez
  // ani jednego stanowiska) to legalny stan z własnym, dwujęzycznym
  // komunikatem `tracker.explorer.noData`.
  loader: async ({ context }) => {
    const queryClient = context.queryClient;
    // FALA 1 - równolegle, więc dwa wolne zapytania kosztują tyle co jedno.
    const [stats, items] = await Promise.all([
      loadResilient(queryClient, trackerStatsQueryOptions(), NO_STATS),
      loadResilient(queryClient, publishedItemsQueryOptions({}, MATRIX_LIMIT), NO_ITEMS),
    ]);
    // FALA 2 - stanowiska pod kluczem złożonym z identyfikatorów fali 1.
    const itemIds = items.data.map((item) => item.id);
    const positions =
      itemIds.length > 0
        ? await loadResilient(queryClient, positionsForItemsQueryOptions(itemIds), NO_POSITIONS, {
            budgetMs: POSITIONS_BUDGET_MS,
          })
        : { data: NO_POSITIONS, degraded: false };
    // Zdegradowany render (macierz z fallbacku) nie może trafić do cache'a
    // wspólnego - brzeg serwowałby pustkę kolejnym czytelnikom długo po tym,
    // jak baza wróciła do zdrowia.
    const degraded = anyDegraded(stats, items, positions);
    setCacheControlHeader(resilientCacheControl(degraded));
    return { degraded };
  },
  head: () => {
    const url = getRequestUrl() || "/tracker/explorer";
    const lang = activeLang(url);
    return buildContentHead({
      url,
      lang,
      type: "website",
      title:
        lang === "en"
          ? "Positions & coalitions explorer - EU legislative tracker"
          : "Explorer stanowisk i koalicji - tracker legislacyjny UE",
      description:
        lang === "en"
          ? "A cross-section of member state positions on key EU legislative files."
          : "Przekrój stanowisk państw członkowskich wobec kluczowych dossier legislacyjnych UE.",
    });
  },
  component: TrackerExplorerPage,
  errorComponent: (props) => <TrackerErrorFallback {...props} />,
});

/**
 * Ekran awarii trasy mówiący JĘZYKIEM STRONY. Wcześniej `errorComponent` podawał
 * tytuł zahardkodowanym literałem, więc czytelnik `/en/tracker/explorer` dostawał
 * jedyny polski napis na całej stronie. `errorComponent` renderuje się jak każdy
 * komponent, więc wolno mu wziąć zdanie ze słownika - klucz `tracker.loadError`
 * istnieje w PL i EN, więc nie dopisujemy nowego.
 */
function TrackerErrorFallback(props: ErrorComponentProps) {
  ensureTrackerI18n();
  const { t } = useTranslation();
  return <RouteErrorFallback {...props} title={t("tracker.loadError")} />;
}

type Lang = "pl" | "en";

function StatBar({
  entries,
  labelOf,
  lang,
}: {
  entries: [string, number][];
  labelOf: (key: string, lang: Lang) => string;
  lang: Lang;
}) {
  const max = Math.max(1, ...entries.map(([, n]) => n));
  return (
    <ul className="space-y-1.5">
      {entries.map(([key, n]) => (
        <li key={key} className="grid grid-cols-[9rem_1fr_2rem] items-center gap-2 text-xs">
          <span className="truncate text-muted-foreground">{labelOf(key, lang)}</span>
          <span className="h-2 rounded-full bg-muted">
            <span
              className="block h-2 rounded-full bg-primary"
              style={{ width: `${Math.round((n / max) * 100)}%` }}
              aria-hidden="true"
            />
          </span>
          <span className="text-right tabular-nums">{n}</span>
        </li>
      ))}
    </ul>
  );
}

function TrackerExplorerPage() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureTrackerI18n();
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === "en" ? "en" : "pl";
  const [area, setArea] = useState<string>("all");

  const statsQ = useTrackerStats();
  const itemsQ = usePublishedItems(area === "all" ? {} : { area }, MATRIX_LIMIT);
  const items = useMemo<PolicyItem[]>(() => itemsQ.data ?? [], [itemsQ.data]);
  const itemIds = useMemo(() => items.map((i) => i.id), [items]);
  const positionsQ = usePositionsForItems(itemIds);

  // Mapa (item_id -> country_code -> stance) do szybkiego malowania komórek.
  const byItemCountry = useMemo(() => {
    const m = new Map<string, Map<string, string>>();
    for (const p of positionsQ.data ?? []) {
      const inner = m.get(p.item_id) ?? new Map<string, string>();
      inner.set(p.country_code, p.stance);
      m.set(p.item_id, inner);
    }
    return m;
  }, [positionsQ.data]);

  // Do macierzy trafiają tylko dossier z co najmniej jednym stanowiskiem.
  const rows = useMemo(
    () => items.filter((i) => (byItemCountry.get(i.id)?.size ?? 0) > 0),
    [items, byItemCountry],
  );

  const byStage = statsQ.data ? Object.entries(statsQ.data.by_stage) : [];
  const byArea = statsQ.data ? Object.entries(statsQ.data.by_area) : [];

  return (
    <div className="container mx-auto max-w-6xl px-4 py-10">
      <h1 className="flex items-start gap-2 text-2xl font-bold md:text-3xl">
        <Landmark className="mt-1 h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
        {t("tracker.explorer.title")}
      </h1>
      <p className="mt-3 max-w-3xl text-muted-foreground">{t("tracker.explorer.intro")}</p>

      <div className="mt-4 flex flex-wrap gap-3 text-sm">
        <Link to="/tracker" className="text-primary hover:underline">
          {t("tracker.backToIndex")}
        </Link>
        <Link to="/tracker/changes" className="text-primary hover:underline">
          {t("tracker.explorer.changesLink")}
        </Link>
      </div>

      {/* Dashboard statystyk */}
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              {t("tracker.explorer.stats.total")}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-bold tabular-nums">
            {statsQ.data?.total ?? "-"}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              {t("tracker.explorer.stats.byStage")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StatBar entries={byStage} labelOf={stageLabel} lang={lang} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              {t("tracker.explorer.stats.byArea")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StatBar entries={byArea} labelOf={areaLabel} lang={lang} />
          </CardContent>
        </Card>
      </div>

      {/* Legenda + filtr obszaru */}
      <div className="mt-10 flex flex-wrap items-center justify-between gap-3">
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5" role="list">
          {STANCE_META.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                aria-hidden
                className="h-3 w-3 rounded-[3px]"
                style={{ backgroundColor: s.hex, background: s.cssVar }}
              />
              {lang === "en" ? s.en : s.pl}
            </li>
          ))}
        </ul>
        <div className="w-56">
          <Select value={area} onValueChange={setArea}>
            <SelectTrigger aria-label={t("tracker.filters.area")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("tracker.explorer.allAreas")}</SelectItem>
              {POLICY_AREAS.map((a) => (
                <SelectItem key={a.key} value={a.key}>
                  {lang === "en" ? a.en : a.pl}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Macierz koalicji dossier × państwa */}
      {itemsQ.isLoading || positionsQ.isLoading ? (
        <p className="mt-8 text-sm text-muted-foreground">{t("tracker.loading")}</p>
      ) : rows.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">{t("tracker.explorer.noData")}</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{t("tracker.explorer.title")}</caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-semibold"
                >
                  {t("tracker.explorer.dossier")}
                </th>
                {EU_COUNTRIES.map((c) => (
                  <th
                    key={c.code}
                    scope="col"
                    className="px-1 py-2 text-center text-[10px] font-medium text-muted-foreground"
                    title={lang === "en" ? c.en : c.pl}
                  >
                    {c.code}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((it) => {
                const inner = byItemCountry.get(it.id);
                const title =
                  lang === "en" ? it.title_en || it.title_pl : it.title_pl || it.title_en;
                return (
                  <tr key={it.id} className="border-t border-border/60">
                    <th
                      scope="row"
                      className="sticky left-0 z-10 max-w-[16rem] truncate bg-card px-3 py-2 text-left font-medium"
                    >
                      <Link
                        to="/tracker/$slug"
                        params={{ slug: it.slug }}
                        className="hover:text-primary"
                        title={title}
                      >
                        {title}
                      </Link>
                    </th>
                    {EU_COUNTRIES.map((c) => {
                      const stance = inner?.get(c.code);
                      if (!stance) {
                        return (
                          <td key={c.code} className="px-1 py-2 text-center">
                            <span
                              className="mx-auto block h-3.5 w-3.5 rounded-[3px] bg-secondary"
                              aria-hidden="true"
                            />
                          </td>
                        );
                      }
                      const meta = stanceMeta(stance);
                      return (
                        <td key={c.code} className="px-1 py-2 text-center">
                          <span
                            className="mx-auto block h-3.5 w-3.5 rounded-[3px]"
                            style={{ backgroundColor: meta.hex, background: meta.cssVar }}
                            title={`${lang === "en" ? c.en : c.pl}: ${stanceLabel(stance, lang)}`}
                          />
                          <span className="sr-only">
                            {(lang === "en" ? c.en : c.pl) + ": " + stanceLabel(stance, lang)}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
