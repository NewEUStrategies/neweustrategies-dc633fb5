// Lista publicznych sesji Q&A. URL: /qa
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { HelpCircle, Clock } from "lucide-react";
import { publicQaSessionsQueryOptions, type PublicQaSession } from "@/lib/community/publicQueries";
import { useCommunityModules } from "@/lib/community/useCommunityModules";
import { COMMUNITY_MODULES_DEFAULTS, COMMUNITY_MODULES_KEY } from "@/lib/community/modulesSettings";
import { resolveSetting, siteSettingsQueryOptions, type SettingsMap } from "@/lib/useSiteSetting";
import { withSsrBudget } from "@/lib/asyncBudget";
import { loadResilient, resilientCacheControl } from "@/lib/ssr/resilientLoad";
import { useDegradedUntilHealed } from "@/lib/ssr/useDegradedUntilHealed";
import { setCacheControlHeader } from "@/lib/http/responseHeaders";
import { CommunityDisabled } from "@/components/community/CommunityDisabled";
import { DegradedDataNotice } from "@/components/molecules/DegradedDataNotice";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";
import { buildContentHead, splitUrl, SITE_NAME } from "@/lib/seo/meta";
import { breadcrumbListJsonLd, qaCollectionJsonLd, safeJsonLd } from "@/lib/seo/jsonld";
import { ensureI18n as ensureCommunityI18n } from "@/lib/i18n-community";

interface QaListHeadData {
  sessions: Array<{ slug: string; titlePl: string; titleEn: string }>;
  /**
   * Czy render POWSTAŁ na fallbacku. Ta sama wartość, którą loader podaje do
   * `resilientCacheControl` - dotąd zostawała w loaderze, a komponent
   * odtwarzał ją z palca ze stempla zapytania. Jedno źródło, bo to STAN
   * POCZĄTKOWY dla `useDegradedUntilHealed` (patrz komentarz w komponencie).
   */
  degraded: boolean;
}

/** Wspólny termin ŻĄDANIA - obie fazy dzielą jedno okno, nie dwa. */
const QA_LIST_SSR_BUDGET_MS = 1_400;

/**
 * Krótki termin BRAMKI MODUŁU. `site_settings` grzeje RÓWNOLEGLE loader
 * korzenia, więc 300 ms z zapasem wystarcza na dołączenie się do jego fetcha;
 * po tym czasie wchodzą `COMMUNITY_MODULES_DEFAULTS` z kodu, a lista dostaje
 * resztę budżetu. Konfiguracja NIGDY nie blokuje treści.
 */
const QA_SETTINGS_BUDGET_MS = 300;

/** Fallback listy sesji - pusta, zasiewana z `updatedAt: 0` (samoleczenie). */
const NO_QA_SESSIONS: PublicQaSession[] = [];

export const Route = createFileRoute("/qa")({
  component: QaListPage,
  // Loader zwraca wyłącznie serializowalne stringi i nigdy nie wywraca trasy -
  // markup listy jest opcjonalny, awaria backendu degraduje do samych metatagów.
  //
  // ZASIEW, NIE GOŁY FETCH. Wcześniej loader wołał `fetchPublicQaSessions()`
  // wprost, więc jego praca kończyła się na `head()`: markup listy w wyjściu
  // serwera był PUSTY (`query.isLoading`), a przeglądarka pobierała te same
  // sesje drugi raz po hydratacji. Teraz idzie przez `ensureQueryData` na
  // WSPÓLNYM kluczu (`publicQaSessionsQueryOptions`), więc lista jest w HTML
  // z serwera i nie jest ponawiana.
  //
  // BRAMKA MODUŁU jak w `/polls`: mapa `site_settings` jest już rozgrzana
  // przez root loader, więc `ensureQueryData` deduplikuje z jego fetchem,
  // a wyłączony moduł nie kosztuje ANI JEDNEGO zapytania o sesje.
  loader: async ({ context }): Promise<QaListHeadData> => {
    const deadlineAt = Date.now() + QA_LIST_SSR_BUDGET_MS;
    // Bramka modułu POD TERMINEM. Wcześniej było tu gołe `await
    // ensureQueryData` - odczyt KONFIGURACJI mógł więc zjeść cały budżet SSR,
    // zanim padło pierwsze zapytanie o TREŚĆ. Termin liczy się TYLKO na
    // serwerze (patrz docblock `withSsrBudget`), więc w przeglądarce
    // `settings === undefined` znaczy wyłącznie ODRZUCONY odczyt, a nie
    // „ustawienia nie zdążyły" - domyślki nie zamrażają już powierzchni.
    await withSsrBudget(
      context.queryClient.ensureQueryData(siteSettingsQueryOptions).catch(() => undefined),
      QA_SETTINGS_BUDGET_MS,
      deadlineAt,
    );
    const settings = context.queryClient.getQueryData<SettingsMap>(
      siteSettingsQueryOptions.queryKey,
    );
    const modules = resolveSetting(settings, COMMUNITY_MODULES_KEY, COMMUNITY_MODULES_DEFAULTS);
    // Render na DOMYŚLKACH modułu nie jest prawdą tenanta, więc nie wolno go
    // rozdać kolejnym czytelnikom z brzegu - to ten sam kontrakt, co przy
    // fallbacku danych.
    const settingsDegraded = settings === undefined;
    if (!modules.qa_enabled) {
      setCacheControlHeader(resilientCacheControl(settingsDegraded));
      return { sessions: [], degraded: settingsDegraded };
    }
    // Lista sesji jest treścią POD zgięciem i czyta ją `useQuery` (nie
    // suspense), więc blip degraduje do pustej listy i dociąga się po
    // hydratacji - zero rzutu, zero HTTP 500.
    const sessions = await loadResilient(
      context.queryClient,
      publicQaSessionsQueryOptions(),
      NO_QA_SESSIONS,
      { deadlineAt, label: "qa-sessions" },
    );
    setCacheControlHeader(resilientCacheControl(settingsDegraded || sessions.degraded));
    return {
      degraded: settingsDegraded || sessions.degraded,
      sessions: sessions.data.slice(0, 50).map((s) => ({
        slug: s.slug,
        titlePl: s.title_pl,
        titleEn: s.title_en,
      })),
    };
  },
  head: ({ loaderData }) => {
    const url = getRequestUrl() || "/qa";
    const lang = activeLang(url);
    const title = lang === "en" ? "Q&A sessions" : "Sesje Q&A";
    const description =
      lang === "en"
        ? "Ask questions to experts and upvote the best community questions."
        : "Zadawaj pytania ekspertom i głosuj na najlepsze pytania społeczności.";
    const head = buildContentHead({
      url,
      lang,
      type: "website",
      title,
      // Marka w tytule karty przeglądarki/SERP; og:title zostaje krótki.
      documentTitle: `${title} - ${SITE_NAME}`,
      description,
    });
    const { origin } = splitUrl(url);
    const collection = qaCollectionJsonLd({
      origin,
      lang,
      path: "/qa",
      name: title,
      description,
      sessions: (loaderData?.sessions ?? []).map((s) => ({
        slug: s.slug,
        title: (lang === "en" ? s.titleEn : s.titlePl) || s.slug,
      })),
    });
    const breadcrumbs = breadcrumbListJsonLd([{ label: title, href: "/qa" }], origin, lang);
    return {
      ...head,
      scripts: [
        { type: "application/ld+json", children: safeJsonLd(collection) },
        { type: "application/ld+json", children: safeJsonLd(breadcrumbs) },
      ],
    };
  },
});

function statusBadge(status: string, t: (k: string) => string) {
  if (status === "open" || status === "answering") return t("community.qa.openSession");
  if (status === "closed") return t("community.qa.closedSession");
  return t("community.qa.scheduledSession");
}

function QaListPage() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureCommunityI18n();
  const { t, i18n } = useTranslation();
  const lang = (i18n.language.startsWith("en") ? "en" : "pl") as "pl" | "en";
  const modules = useCommunityModules();
  const query = useQuery({
    ...publicQaSessionsQueryOptions(),
    enabled: modules.qa_enabled,
  });

  // STEMPEL FALLBACKU, nie nowy stan. `loadResilient` zasiewa pustą listę
  // z `updatedAt: 0`, więc stempel zerowy znaczy „dane są, ale nie są prawdą
  // backendu". Bez tego rozróżnienia zdegradowany render wyglądałby dokładnie
  // jak „nie ma jeszcze sesji" - a to jest kłamstwo w treści (patrz komentarz
  // w components/molecules/DegradedDataNotice). Odczyt szedł dotąd z palca po
  // `query.dataUpdatedAt`: dawał to samo, ale BEZ bramki hydratacji i bez
  // ponowienia. Flaga z loadera jest tu stanem POCZĄTKOWYM, stempel zapytania -
  // prawdą po hydratacji (patrz `lib/ssr/useDegradedUntilHealed.ts`).
  const { degraded: ssrDegraded } = Route.useLoaderData();
  const { degraded, retry } = useDegradedUntilHealed(
    publicQaSessionsQueryOptions().queryKey,
    ssrDegraded,
  );

  if (!modules.qa_enabled) return <CommunityDisabled />;

  return (
    <div className="container mx-auto max-w-4xl px-4 py-12 md:py-16">
      <header className="mb-10">
        <h1 className="text-4xl font-bold tracking-tight">{t("community.qa.title")}</h1>
        <p className="mt-3 text-muted-foreground">{t("community.qa.subtitle")}</p>
      </header>

      {query.isLoading && <p className="text-muted-foreground">{t("community.common.loading")}</p>}
      {/* Wspólna warstwa degradacji zamiast gołego akapitu: to ona niesie
          przycisk ponowienia, więc czytelnik ma co zrobić z komunikatem.
          `query.isError` zostaje osobno - błąd przy CZYSTYM starcie (bez
          zasiewu) nie jest degradacją renderu i haka nie dotyczy. */}
      {degraded && <DegradedDataNotice onRetry={retry} />}
      {!degraded && query.isError && (
        <p className="text-destructive">{t("community.common.loadError")}</p>
      )}

      {!degraded && query.data && query.data.length === 0 && (
        <p className="text-muted-foreground">{t("community.qa.empty")}</p>
      )}

      <ul className="grid gap-4 md:grid-cols-2">
        {(query.data ?? []).map((s) => (
          <QaCard key={s.id} session={s} lang={lang} statusLabel={statusBadge(s.status, t)} />
        ))}
      </ul>
    </div>
  );
}

function QaCard({
  session,
  lang,
  statusLabel,
}: {
  session: PublicQaSession;
  lang: "pl" | "en";
  statusLabel: string;
}) {
  const { t } = useTranslation();
  const title =
    lang === "en" ? session.title_en || session.title_pl : session.title_pl || session.title_en;
  const intro = lang === "en" ? session.intro_en : session.intro_pl;
  const fmt = (v: string | null) =>
    v
      ? new Date(v).toLocaleString(lang === "en" ? "en-GB" : "pl-PL", {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : null;

  return (
    <li className="group relative rounded-lg border border-border bg-card p-5 transition hover:border-primary/60">
      <div className="mb-2 flex items-center justify-between gap-2 text-xs">
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
          {statusLabel}
        </span>
        {session.opens_at && (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            {fmt(session.opens_at)}
          </span>
        )}
      </div>
      <h2 className="text-lg font-semibold leading-snug">
        <Link
          to="/qa/$slug"
          params={{ slug: session.slug }}
          className="after:absolute after:inset-0"
        >
          {title}
        </Link>
      </h2>
      {intro && <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{intro}</p>}
      <span className="mt-4 inline-block text-sm font-medium text-primary">
        {t("community.qa.viewSession")} -&gt;
      </span>
    </li>
  );
}
