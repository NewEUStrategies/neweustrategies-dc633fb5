// Publiczny indeks trackera legislacyjnego UE. URL: /tracker - siatka
// opublikowanych dossier z filtrami (obszar polityki, etap), paskiem postępu
// procedury, następnym kamieniem milowym i licznikiem obserwujących.
// Loader prefetchuje pierwszą stronę pod tym samym kluczem, który czyta
// usePublishedItems - treść (siatka + ItemList JSON-LD) renderuje się
// serwerowo, więc crawler widzi dossier zamiast "Ładowanie"; komponent czyta
// ten sam cache bez drugiej podróży.
import { Fragment, useState, useTransition } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CalendarClock, Landmark, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RouteErrorFallback } from "@/components/molecules/RouteErrorFallback";
import { TrackerFeedLink } from "@/components/tracker/TrackerFeedLink";
import { TrackerIndexSkeleton } from "@/components/tracker/TrackerIndexSkeleton";
import {
  TRACKER_PAGE_SIZE,
  publishedItemsQueryOptions,
  followerCountsQueryOptions,
  usePublishedItems,
  useFollowerCounts,
  type PolicyItem,
} from "@/lib/tracker/queries";
import { trackerItemListJsonLd, type TrackerListEntry } from "@/lib/tracker/jsonld";
import { TRACKER_FEED_PATH } from "@/lib/tracker/feed";
import { localizedPath } from "@/lib/i18n/localePath";
import { withBudget } from "@/lib/asyncBudget";
import { setCacheControlHeader } from "@/lib/http/responseHeaders";
import { cacheControlHeader, contentCacheControl } from "@/lib/http/cachePolicy";
import {
  POLICY_STAGES,
  POLICY_AREAS,
  STAGE_LABELS,
  stageIndex,
  stageLabel,
  isTerminal,
} from "@/lib/tracker/stages";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import { buildContentHead } from "@/lib/seo/meta";
import { breadcrumbListJsonLd, safeJsonLd } from "@/lib/seo/jsonld";
import { ensureI18n as ensureTrackerI18n } from "@/lib/i18n-tracker";
import { uiLocale } from "@/lib/i18n/format";

/** Budżet ścieżki krytycznej loadera (pierwsza strona dossier) - wzorzec /blog. */
const TRACKER_LOADER_BUDGET_MS = 4_000;
/** Budżet dekoracyjnych liczników obserwujących - nie mogą podbijać TTFB. */
const TRACKER_FOLLOWERS_BUDGET_MS = 1_500;

export const Route = createFileRoute("/tracker/")({
  loader: async ({ context }) => {
    const queryClient = context.queryClient;
    // SSR-krytyczna treść: pierwsza strona opublikowanych dossier pod TYM
    // SAMYM kluczem, który czyta usePublishedItems ze stanem początkowym
    // komponentu (wszystkie obszary/etapy, pierwsze okno). Defensywnie jak
    // "/" i /blog: błąd lub zwis backendu nie może dać 500 ani zawiesić
    // strumienia SSR - budżet ścina oczekiwanie, a fallback siany z
    // updatedAt: 0 jest natychmiast przeterminowany, więc przeglądarka
    // refetchuje po mount i strona sama się leczy, gdy backend wróci.
    const itemsOptions = publishedItemsQueryOptions();
    let degraded = false;
    await withBudget(
      queryClient.ensureQueryData(itemsOptions).catch(() => undefined),
      TRACKER_LOADER_BUDGET_MS,
    );
    let items = queryClient.getQueryData<PolicyItem[]>(itemsOptions.queryKey);
    if (!items) {
      degraded = true;
      // Anuluj spóźniony fetch PRZED zasiewem: gdyby rozwiązał się między
      // renderem a dehydracją, klient hydratowałby się z innymi danymi niż
      // HTML serwera i React 19 przebudowałby całą stronę po stronie klienta.
      await queryClient.cancelQueries({ queryKey: itemsOptions.queryKey, exact: true });
      items = [];
      queryClient.setQueryData(itemsOptions.queryKey, items, { updatedAt: 0 });
    }

    // Liczniki obserwujących: dekoracja kart (brak danych renderuje 0), ale
    // prefetch daje crawlerowi i pierwszemu renderowi prawdziwe liczby bez
    // mrugnięcia po hydratacji. Best-effort pod krótszym budżetem.
    if (items.length > 0) {
      const countsOptions = followerCountsQueryOptions(items.map((item) => item.id));
      await withBudget(
        queryClient.ensureQueryData(countsOptions).catch(() => undefined),
        TRACKER_FOLLOWERS_BUDGET_MS,
      );
      if (queryClient.getQueryState(countsOptions.queryKey)?.status !== "success") {
        degraded = true;
        await queryClient.cancelQueries({ queryKey: countsOptions.queryKey, exact: true });
        queryClient.setQueryData(countsOptions.queryKey, {}, { updatedAt: 0 });
      }
    }

    // ISR-owy nagłówek NA KOŃCU, bramkowany czystym renderem (wzorzec "/"):
    // zdegradowany render nigdy nie trafia do współdzielonego cache - kolejne
    // żądanie renderuje świeżo zamiast utrwalać mrugnięcie backendu na CDN.
    setCacheControlHeader(
      degraded ? cacheControlHeader({ cacheable: false }) : contentCacheControl(),
    );

    // Szczupła projekcja pod head() (ItemList JSON-LD): loaderData jest
    // serializowane do payloadu SSR, a pełne wiersze podróżują już w
    // dehydrowanym cache query - nie duplikujemy ich drugi raz.
    const entries: TrackerListEntry[] = items.map((item) => ({
      slug: item.slug,
      title_pl: item.title_pl,
      title_en: item.title_en,
      reference: item.reference,
    }));
    return { entries };
  },
  head: ({ loaderData }) => {
    const url = getRequestUrl() || "/tracker";
    const lang = activeLang(url);
    let origin = "";
    try {
      origin = new URL(url).origin;
    } catch {
      /* relative url in tests - breadcrumbs degrade to paths */
    }
    const title =
      lang === "en"
        ? "EU legislative tracker - follow key files"
        : "Tracker legislacyjny UE - śledź kluczowe dossier";
    const head = buildContentHead({
      url,
      lang,
      type: "website",
      title,
      description:
        lang === "en"
          ? "Track key EU legislative files: procedure stage, timeline of events and upcoming milestones."
          : "Śledź kluczowe dossier legislacyjne UE: etap procedury, oś czasu wydarzeń i nadchodzące kamienie milowe.",
    });
    // CollectionPage + breadcrumb: tracker pozycjonuje się jako źródło prawdy
    // o procesie legislacyjnym - strona zbiorcza dostaje jawny typ w grafie,
    // a mainEntity (ItemList węzłów Legislation z danych loadera) wystawia
    // crawlerom i asystentom AI pełną listę dossier już w SSR.
    const itemList = trackerItemListJsonLd(loaderData?.entries ?? [], origin, lang);
    const collection = {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: title,
      url,
      inLanguage: lang,
      ...(itemList ? { mainEntity: itemList } : {}),
    };
    const breadcrumbs = breadcrumbListJsonLd(
      [
        {
          label: lang === "en" ? "EU policy tracker" : "Tracker legislacyjny UE",
          href: "/tracker",
        },
      ],
      origin,
      lang,
    );
    // Autodiscovery kanału trackera: czytniki RSS i agregatory znajdują feed
    // bez znajomości konwencji URL - ten sam wzorzec, co feedy kategorii/tagu.
    const feedTitle =
      lang === "en" ? "EU legislative tracker - RSS" : "Tracker legislacyjny UE - RSS";
    return {
      ...head,
      links: [
        ...head.links,
        {
          rel: "alternate",
          type: "application/rss+xml",
          title: feedTitle,
          href: `${origin}${localizedPath(TRACKER_FEED_PATH, lang)}`,
        },
      ],
      scripts: [
        { type: "application/ld+json", children: safeJsonLd(collection) },
        { type: "application/ld+json", children: safeJsonLd(breadcrumbs) },
      ],
    };
  },
  component: TrackerIndex,
  // Zimna nawigacja klienta czeka na loader - pokazuj placeholder w kształcie
  // strony zamiast pustego ekranu (SSR nigdy tu nie trafia: loader blokuje).
  pendingComponent: () => <TrackerIndexSkeleton />,
  errorComponent: (props) => (
    <RouteErrorFallback {...props} title="Nie udało się załadować trackera" />
  ),
});

type Lang = "pl" | "en";

/** Data (YYYY-MM-DD) sformatowana wg języka; T00:00:00 trzyma dzień w lokalnej strefie. */
function formatDate(iso: string | null, lang: Lang): string | null {
  if (!iso) return null;
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(uiLocale(lang), {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Kompaktowa oś postępu: 6 kropek z łącznikami, wypełnione do bieżącego etapu. */
function StageRail({ stage, lang }: { stage: string; lang: Lang }) {
  if (isTerminal(stage)) {
    // Dossier zakończone poza pozytywną ścieżką - czerwona etykieta zamiast paska.
    return (
      <div className="text-xs font-semibold uppercase tracking-wide text-destructive">
        {stageLabel(stage, lang)}
      </div>
    );
  }
  const idx = stageIndex(stage);
  return (
    <div
      className="flex items-center"
      role="img"
      aria-label={`${stageLabel(stage, lang)} (${idx + 1}/${POLICY_STAGES.length})`}
    >
      {POLICY_STAGES.map((s, i) => (
        <Fragment key={s}>
          {i > 0 && (
            <div className={`h-0.5 flex-1 min-w-3 ${i <= idx ? "bg-primary" : "bg-border"}`} />
          )}
          <div
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${i <= idx ? "bg-primary" : "bg-border"}`}
          />
        </Fragment>
      ))}
      <span className="ml-3 text-xs text-muted-foreground whitespace-nowrap">
        {stageLabel(stage, lang)}
      </span>
    </div>
  );
}

function ItemCard({ item, followers, lang }: { item: PolicyItem; followers: number; lang: Lang }) {
  const { t } = useTranslation();
  const title = lang === "en" ? item.title_en || item.title_pl : item.title_pl || item.title_en;
  const milestone =
    lang === "en"
      ? item.next_milestone_en || item.next_milestone_pl
      : item.next_milestone_pl || item.next_milestone_en;
  const milestoneDate = formatDate(item.next_milestone_at, lang);

  return (
    <Link
      to="/tracker/$slug"
      params={{ slug: item.slug }}
      className="flex flex-col gap-3 p-5 rounded-lg border border-border bg-card hover:bg-muted/40 transition-colors"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline">
          {POLICY_AREAS.find((a) => a.key === item.policy_area)?.[lang] ?? item.policy_area}
        </Badge>
        {item.importance === 3 && <Badge>{t("tracker.keyFile")}</Badge>}
        {item.reference && (
          <span className="text-[11px] text-muted-foreground font-mono">{item.reference}</span>
        )}
      </div>
      <h2 className="font-medium leading-snug">{title}</h2>
      <StageRail stage={item.stage} lang={lang} />
      {(milestone || milestoneDate) && (
        <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <CalendarClock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            {milestone}
            {milestone && milestoneDate ? " · " : ""}
            {milestoneDate}
          </span>
        </div>
      )}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-auto">
        <Users className="w-3.5 h-3.5" />
        {t("tracker.followers", { count: followers })}
      </div>
    </Link>
  );
}

function TrackerIndex() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureTrackerI18n();
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === "en" ? "en" : "pl";
  const [area, setArea] = useState("all");
  const [stage, setStage] = useState("all");
  const [limit, setLimit] = useState(TRACKER_PAGE_SIZE);
  const [isPending, startTransition] = useTransition();

  const setAreaAndReset = (next: string) => {
    setArea(next);
    setLimit(TRACKER_PAGE_SIZE);
  };
  const setStageAndReset = (next: string) => {
    setStage(next);
    setLimit(TRACKER_PAGE_SIZE);
  };

  const { data: items, isLoading } = usePublishedItems(
    {
      area: area === "all" ? undefined : area,
      stage: stage === "all" ? undefined : stage,
    },
    limit,
  );
  const { data: followerCounts } = useFollowerCounts((items ?? []).map((item) => item.id));
  // Pełne okno = prawdopodobnie jest dalszy ciąg (dokładny count nie jest
  // wart drugiej podróży; ostatnie kliknięcie zwróci niepełną stronę).
  const canLoadMore = (items ?? []).length >= limit;

  return (
    <div className="container mx-auto px-4 py-10 max-w-5xl space-y-8">
      <header className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <Landmark className="w-5 h-5 text-primary" />
        </div>
        <div className="space-y-1">
          <h1 className="font-display text-3xl">{t("tracker.title")}</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">{t("tracker.intro")}</p>
          <div className="flex flex-wrap gap-3 pt-1 text-sm">
            <Link to="/tracker/explorer" className="text-primary hover:underline">
              {t("tracker.explorer.link")}
            </Link>
            <Link to="/tracker/changes" className="text-primary hover:underline">
              {t("tracker.explorer.changesLink")}
            </Link>
            <TrackerFeedLink />
          </div>
        </div>
      </header>

      {/* Filtry: obszar polityki + etap procedury */}
      <div className="flex flex-wrap gap-3">
        <Select value={area} onValueChange={setAreaAndReset}>
          <SelectTrigger className="w-52" aria-label={t("tracker.filters.area")}>
            <SelectValue placeholder={t("tracker.filters.area")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("tracker.filters.allAreas")}</SelectItem>
            {POLICY_AREAS.map((a) => (
              <SelectItem key={a.key} value={a.key}>
                {a[lang]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={stage} onValueChange={setStageAndReset}>
          <SelectTrigger className="w-52" aria-label={t("tracker.filters.stage")}>
            <SelectValue placeholder={t("tracker.filters.stage")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("tracker.filters.allStages")}</SelectItem>
            {STAGE_LABELS.map((s) => (
              <SelectItem key={s.key} value={s.key}>
                {s[lang]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-16 text-center">{t("tracker.loading")}</p>
      ) : (items ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground py-16 text-center">{t("tracker.empty")}</p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {(items ?? []).map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                followers={followerCounts?.[item.id] ?? 0}
                lang={lang}
              />
            ))}
          </div>
          {canLoadMore && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                disabled={isPending}
                onClick={() => startTransition(() => setLimit((n) => n + TRACKER_PAGE_SIZE))}
              >
                {isPending ? t("tracker.loading") : t("tracker.loadMore")}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
