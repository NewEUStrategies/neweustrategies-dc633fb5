// Detal dossier legislacyjnego: pasek postępu procedury, obserwowanie
// z alertami oraz oś czasu aktualizacji. Publiczny odczyt (RLS: published).
// Loader prefetchuje dossier pod head() - meta i JSON-LD (schema.org
// Legislation) renderują się w SSR, a komponent czyta ten sam cache.
import { createFileRoute, Link, notFound, type ErrorComponentProps } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeft, Bell, BellOff, ExternalLink, Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RouteErrorFallback } from "@/components/molecules/RouteErrorFallback";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentTier, tierHasFeature } from "@/lib/billing/tiers";
import {
  itemBySlugQueryOptions,
  itemUpdatesQueryOptions,
  type PolicyItem,
  type PolicyUpdate,
  useItemBySlug,
  useItemPositions,
  useItemUpdates,
  useMyFollows,
  useRelatedItems,
  useToggleFollowItem,
} from "@/lib/tracker/queries";
import { PolicyPositionsMap } from "@/components/tracker/PolicyPositionsMap";
import { TrackerFeedLink } from "@/components/tracker/TrackerFeedLink";
import { DossierFollowers } from "@/components/network/DossierFollowers";
import { POLICY_STAGES, areaLabel, isTerminal, stageIndex, stageLabel } from "@/lib/tracker/stages";
import { TRACKER_FEED_PATH } from "@/lib/tracker/feed";
import { localizedPath } from "@/lib/i18n/localePath";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import { buildContentHead } from "@/lib/seo/meta";
import { breadcrumbListJsonLd, safeJsonLd } from "@/lib/seo/jsonld";
import { ensureI18n as ensureTrackerI18n } from "@/lib/i18n-tracker";
import { ClubAnchorThreads } from "@/components/clubs/organisms/ClubAnchorThreads";
import { uiLocale } from "@/lib/i18n/format";
import { loadResilient, resilientCacheControl } from "@/lib/ssr/resilientLoad";
import { setCacheControlHeader } from "@/lib/http/responseHeaders";

/** Budżet DRUGIEJ fali (oś czasu). Krótszy niż domyślny budżet odpornego
 *  ładowania, bo ta fala biegnie PO odczycie dossier i jej czas dodaje się do
 *  TTFB, a nie biegnie równolegle. */
const TIMELINE_BUDGET_MS = 2_000;

/** Fallback zdegradowanego renderu osi czasu (patrz lib/ssr/resilientLoad). */
const NO_UPDATES: PolicyUpdate[] = [];

export const Route = createFileRoute("/tracker/$slug")({
  // 404 ROZSTRZYGA LOADER, NIE KOMPONENT (naprawa N4, 2026-09-02).
  //
  // Do dziś loader robił `.catch(() => null)` i oddawał `{ item: null }`, więc
  // slug, którego NIE MA (literówka w linku, usunięte dossier, cudzy tenant),
  // wychodził jako pełnowartościowa strona ze statusem HTTP 200 i napisem
  // „Nie znaleziono dossier." Skutek: crawler indeksował adres jako
  // ISTNIEJĄCY (soft 404), a monitoring linków nie miał czego zgłosić.
  //
  // ROZRÓŻNIENIE, KTÓRE JEST TU CAŁĄ TREŚCIĄ (ta sama doktryna, co
  // `eventShellLoader`): 404 wolno oprzeć WYŁĄCZNIE na CZYSTYM odczycie, który
  // wrócił pusty. Awaria transportu znaczy „nie wiem", a 404 z niewiedzy
  // wyrzuciłoby żywe dossier z indeksu na czas blipu backendu - dlatego
  // `degraded` prowadzi do strony 200 z `robots: noindex, follow` z `head()`
  // (adres wraca do indeksu sam, gdy backend wróci), a nie do twardego 404.
  //
  // OŚ CZASU JEDZIE DRUGĄ FALĄ (naprawa N4, 2026-09-02). Do dziś loader grzał
  // wyłącznie wiersz dossier, więc oś czasu była w całości kliencka - a KANAŁ
  // `/tracker/rss.xml` linkuje pozycje WPROST do wpisu (`#update-<id>`, patrz
  // komentarz przy kotwicy niżej). Czytnik i crawler otwierały więc adres
  // z fragmentem, którego w oddanym dokumencie NIE BYŁO: przewinięcie nie
  // miało do czego doskoczyć, a treść, którą kanał już obiecał, schodziła
  // dopiero po hydratacji. Klucz osi zawiera identyfikator dossier, więc ta
  // fala jest z konstrukcji sekwencyjna - dostaje krótszy budżet, a jej blip
  // degraduje nagłówek cache'a, nigdy nie wywraca strony.
  //
  // ODRZUCONE ŚWIADOMIE Z TEJ FALI: stanowiska państw (mapa ładuje osobno
  // ~200 kB geometrii i tak, a jej tabela alternatywna montuje się razem
  // z danymi), powiązane akty (sekcja pod całą treścią) i lista własnych
  // obserwacji (dana czytelnika, nie treść - nie ma prawa wejść do cache'a
  // wspólnego). Zapadka na dzisiejszej liczbie odczytów klienckich stoi
  // w `trackerDossierRoute.test.tsx`.
  loader: async ({ params, context }) => {
    const queryClient = context.queryClient;
    let item: PolicyItem | null = null;
    let degraded = false;
    try {
      item = await queryClient.ensureQueryData(itemBySlugQueryOptions(params.slug));
    } catch {
      degraded = true;
    }
    if (!degraded && !item) {
      // Zdegradowany render nie może utrwalić się na brzegu: kolejni czytelnicy
      // dostawaliby zapamiętane „nie znaleziono" długo po powrocie bazy.
      setCacheControlHeader(resilientCacheControl(false));
      throw notFound();
    }
    if (item) {
      const updates = await loadResilient(
        queryClient,
        itemUpdatesQueryOptions(item.id),
        NO_UPDATES,
        { budgetMs: TIMELINE_BUDGET_MS },
      );
      degraded = degraded || updates.degraded;
    }
    setCacheControlHeader(resilientCacheControl(degraded));
    return { item };
  },
  head: ({ loaderData, params }) => {
    const url = getRequestUrl() || `/tracker/${params.slug}`;
    const lang = activeLang(url);
    const item = loaderData?.item ?? null;
    if (!item) {
      return buildContentHead({
        url,
        lang,
        type: "website",
        title: lang === "en" ? "EU policy tracker" : "Tracker legislacyjny UE",
        description:
          lang === "en" ? "EU legislative file tracker." : "Tracker dossier legislacyjnych UE.",
        robots: "noindex, follow",
      });
    }
    let origin = "";
    try {
      origin = new URL(url).origin;
    } catch {
      /* relative url in tests */
    }
    const title = lang === "en" ? item.title_en || item.title_pl : item.title_pl || item.title_en;
    const summary =
      (lang === "en" ? item.summary_en || item.summary_pl : item.summary_pl || item.summary_en) ??
      "";
    const head = buildContentHead({
      url,
      lang,
      type: "article",
      title: `${title} - ${lang === "en" ? "EU policy tracker" : "Tracker legislacyjny UE"}`,
      description: summary || title,
    });
    // schema.org Legislation - naturalny typ dla dossier legislacyjnego;
    // legislationIdentifier niesie referencję procedury (np. 2022/0155(COD)).
    const legislation = {
      "@context": "https://schema.org",
      "@type": "Legislation",
      name: title,
      ...(summary ? { description: summary } : {}),
      url,
      inLanguage: lang,
      ...(item.reference ? { legislationIdentifier: item.reference } : {}),
      legislationJurisdiction: {
        "@type": "AdministrativeArea",
        name: "European Union",
      },
      dateModified: item.updated_at,
      ...(item.source_url ? { sameAs: item.source_url } : {}),
    };
    const breadcrumbs = breadcrumbListJsonLd(
      [
        {
          label: lang === "en" ? "EU policy tracker" : "Tracker legislacyjny UE",
          href: "/tracker",
        },
        { label: title, href: `/tracker/${item.slug}` },
      ],
      origin,
      lang,
    );
    // Autodiscovery kanału trackera także ze strony dossier: czytnik dodany z
    // konkretnego dossier subskrybuje strumień zmian całego trackera (kanał
    // per-dossier byłby jednym wpisem na kwartał - patrz komentarz w feed.ts).
    return {
      ...head,
      links: [
        ...head.links,
        {
          rel: "alternate",
          type: "application/rss+xml",
          title: lang === "en" ? "EU legislative tracker - RSS" : "Tracker legislacyjny UE - RSS",
          href: `${origin}${localizedPath(TRACKER_FEED_PATH, lang)}`,
        },
      ],
      scripts: [
        { type: "application/ld+json", children: safeJsonLd(legislation) },
        { type: "application/ld+json", children: safeJsonLd(breadcrumbs) },
      ],
    };
  },
  component: TrackerDetail,
  // Ten sam ekran, co gałąź `!item` w komponencie - różni się WYŁĄCZNIE
  // statusem odpowiedzi (404 kontra 200 przy degradacji), a to jest cała
  // sprawa dla crawlera.
  notFoundComponent: () => <TrackerNotFound />,
  errorComponent: (props) => <TrackerErrorFallback {...props} />,
});

/**
 * Ekran awarii trasy mówiący JĘZYKIEM STRONY. Wcześniej `errorComponent` podawał
 * tytuł zahardkodowanym literałem, więc czytelnik wersji angielskiej dostawał
 * jedyny polski napis na całej stronie. `errorComponent` renderuje się jak każdy
 * komponent, więc wolno mu wziąć zdanie ze słownika - klucz `tracker.loadError`
 * istnieje w PL i EN, więc nie dopisujemy nowego.
 */
function TrackerErrorFallback(props: ErrorComponentProps) {
  ensureTrackerI18n();
  const { t } = useTranslation();
  return <RouteErrorFallback {...props} title={t("tracker.loadError")} />;
}

/** Ekran „nie ma takiego dossier" - dwujęzyczny, z drogą powrotu do listy. */
function TrackerNotFound() {
  ensureTrackerI18n();
  const { t } = useTranslation();
  return (
    <div className="container mx-auto max-w-3xl px-4 py-12 text-center">
      <p className="text-sm text-muted-foreground">{t("tracker.notFound")}</p>
      <Button asChild variant="outline" size="sm" className="mt-4">
        <Link to="/tracker">{t("tracker.backToIndex")}</Link>
      </Button>
    </div>
  );
}

type Lang = "pl" | "en";

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

/** Pełny pasek postępu z etykietami sześciu etapów pozytywnej ścieżki. */
function ProgressRail({ stage, lang }: { stage: string; lang: Lang }) {
  const { t } = useTranslation();
  if (isTerminal(stage)) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm font-semibold text-destructive">
        {stageLabel(stage, lang)}
      </div>
    );
  }
  const idx = stageIndex(stage);
  return (
    <div>
      {/* `aria-label` NA GOŁYM `<div>` JEST IGNOROWANY (axe: aria-prohibited-attr,
          waga serious): element bez roli nie ma nazwy dostępnej, więc pasek
          postępu procedury nie istniał dla czytnika ekranu - a to jedyna
          informacja o etapie nad zgięciem. `role="img"` z etykietą niosącą
          etap I pozycję na osi, tak samo jak `StageRail` w indeksie. */}
      <div
        className="flex items-center gap-1"
        role="img"
        aria-label={`${t("tracker.progressLabel")}: ${stageLabel(stage, lang)} (${idx + 1}/${POLICY_STAGES.length})`}
      >
        {POLICY_STAGES.map((s, i) => (
          <div key={s} className="flex flex-1 items-center gap-1">
            <div
              className={`h-2 flex-1 rounded-full ${i <= idx ? "bg-primary" : "bg-muted"}`}
              aria-hidden="true"
            />
          </div>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1 sm:grid-cols-6">
        {POLICY_STAGES.map((s, i) => (
          <span
            key={s}
            className={`text-[11px] ${i === idx ? "font-semibold text-foreground" : "text-muted-foreground"}`}
          >
            {stageLabel(s, lang)}
          </span>
        ))}
      </div>
    </div>
  );
}

function TrackerDetail() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureTrackerI18n();
  const { slug } = Route.useParams();
  const navigate = Route.useNavigate();
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === "en" ? "en" : "pl";
  const { user, tenantId } = useAuth();

  const itemQ = useItemBySlug(slug);
  const item = itemQ.data;
  const updatesQ = useItemUpdates(item?.id);
  const positionsQ = useItemPositions(item?.id);
  const relatedQ = useRelatedItems(item?.id);
  const myFollows = useMyFollows(user?.id);
  const toggleFollow = useToggleFollowItem();
  // Monitoring regulacyjny (obserwowanie + alerty) to benefit Pro. Podgląd
  // dossier jest publiczny; samo śledzenie egzekwuje serwer (RLS na
  // eu_policy_follows), a tu dajemy miękki upsell zamiast surowego błędu.
  const currentTier = useCurrentTier();
  const canMonitor = tierHasFeature(currentTier.data?.features ?? null, "regulatory_monitoring");

  if (itemQ.isLoading) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-12 text-sm">{t("tracker.loading")}</div>
    );
  }
  // Ta gałąź zostaje mimo `notFound()` w loaderze: dosięga jej render
  // ZDEGRADOWANY (backend nie odpowiedział, więc loader świadomie nie rzucił
  // 404) oraz odświeżenie z komponentu, które zastaje dossier już wycofane.
  if (!item) return <TrackerNotFound />;

  const title = lang === "en" ? item.title_en || item.title_pl : item.title_pl || item.title_en;
  const summary =
    lang === "en" ? item.summary_en || item.summary_pl : item.summary_pl || item.summary_en;
  const isFollowing = (myFollows.data ?? []).includes(item.id);
  const milestone =
    lang === "en"
      ? item.next_milestone_en || item.next_milestone_pl
      : item.next_milestone_pl || item.next_milestone_en;

  const onToggleFollow = () => {
    if (!user || !tenantId) {
      toast.info(t("tracker.signInToFollow"));
      return;
    }
    // Nie-Pro: nie próbujemy insertu (RLS by odrzucił) - kierujemy na ofertę.
    // Odobserwować (usunąć istniejącą obserwację) można zawsze.
    if (!isFollowing && !canMonitor) {
      toast.info(t("tracker.monitorProOnly"), {
        action: {
          label: t("tracker.monitorSeePlans"),
          onClick: () => void navigate({ to: "/pricing" }),
        },
      });
      return;
    }
    toggleFollow.mutate(
      { itemId: item.id, userId: user.id, tenantId, on: !isFollowing },
      { onError: () => toast.error(t("tracker.followError")) },
    );
  };

  return (
    <div className="container mx-auto max-w-3xl px-4 py-10">
      <Link
        to="/tracker"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t("tracker.backToIndex")}
      </Link>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{areaLabel(item.policy_area, lang)}</Badge>
        {item.importance >= 3 && <Badge>{t("tracker.keyFile")}</Badge>}
      </div>

      <h1 className="mt-3 flex items-start gap-2 text-2xl font-bold md:text-3xl">
        <Landmark className="mt-1 h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
        {title}
      </h1>

      {summary && <p className="mt-3 text-muted-foreground">{summary}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {item.reference && (
          <span className="text-muted-foreground">
            {t("tracker.reference")}:{" "}
            <span className="font-medium text-foreground">{item.reference}</span>
          </span>
        )}
        {item.rapporteur && (
          <span className="text-muted-foreground">
            {t("tracker.rapporteur")}:{" "}
            <span className="font-medium text-foreground">{item.rapporteur}</span>
          </span>
        )}
        {item.committee && (
          <span className="text-muted-foreground">
            {t("tracker.committee")}:{" "}
            <span className="font-medium text-foreground">{item.committee}</span>
          </span>
        )}
        {item.lead_dg && (
          <span className="text-muted-foreground">
            {t("tracker.leadDg")}:{" "}
            <span className="font-medium text-foreground">{item.lead_dg}</span>
          </span>
        )}
        {item.source_url && (
          <a
            href={item.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            {t("tracker.source")}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        )}
      </div>

      <div className="mt-6">
        <ProgressRail stage={item.stage} lang={lang} />
      </div>

      {milestone && (
        <div className="mt-6 rounded-md border border-border/60 bg-muted/30 px-4 py-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {t("tracker.nextMilestone")}
          </div>
          <div className="mt-0.5 text-sm font-medium">
            {milestone}
            {item.next_milestone_at && (
              <span className="text-muted-foreground">
                {" "}
                - {formatDate(item.next_milestone_at, lang)}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="mt-6 flex items-center gap-3">
        <Button
          variant={isFollowing ? "secondary" : "default"}
          disabled={toggleFollow.isPending}
          onClick={onToggleFollow}
        >
          {isFollowing ? (
            <BellOff className="mr-2 h-4 w-4" aria-hidden="true" />
          ) : (
            <Bell className="mr-2 h-4 w-4" aria-hidden="true" />
          )}
          {isFollowing ? t("tracker.following") : t("tracker.follow")}
        </Button>
        <span className="text-xs text-muted-foreground">
          {!canMonitor && !isFollowing ? t("tracker.monitorProOnly") : t("tracker.followHint")}
        </span>
      </div>

      {/* Sygnal spolecznosci: kto jeszcze sledzi to dossier (tylko zalogowani,
          tylko widoczne profile) + szybkie nawiazanie kontaktu. */}
      <DossierFollowers itemId={item.id} />

      {(positionsQ.data?.length ?? 0) > 0 && (
        <section className="mt-10" aria-label={t("tracker.positions.title")}>
          <PolicyPositionsMap
            positions={positionsQ.data!}
            lang={lang}
            title={t("tracker.positions.title")}
            description={t("tracker.positions.description")}
          />
        </section>
      )}

      {/* Szew z klubami dyskusyjnymi: wątki przypięte do TEGO dossier. Sekcja
          znika w całości, gdy nie ma czego pokazać - także wtedy, gdy wątki są,
          ale czytelnik nie ma do nich dostępu. */}
      <ClubAnchorThreads anchorType="eu_policy_item" anchorId={item.id} className="mt-10" />

      {(relatedQ.data?.length ?? 0) > 0 && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold">{t("tracker.related.title")}</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {relatedQ.data!.map((r) => (
              <li key={r.related_item_id}>
                <Link
                  to="/tracker/$slug"
                  params={{ slug: r.slug }}
                  className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm transition hover:border-primary/50 hover:bg-muted/40"
                >
                  <Badge variant="outline" className="shrink-0 text-xs">
                    {t(`tracker.related.relation.${r.relation}`, { defaultValue: r.relation })}
                  </Badge>
                  <span className="truncate font-medium">
                    {lang === "en" ? r.title_en || r.title_pl : r.title_pl || r.title_en}
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {stageLabel(r.stage, lang)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-10">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">{t("tracker.timeline")}</h2>
          <TrackerFeedLink className="text-xs" />
        </div>
        {(updatesQ.data?.length ?? 0) === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t("tracker.timelineEmpty")}</p>
        ) : (
          <ol className="mt-4 space-y-4 border-l border-border/70 pl-5">
            {updatesQ.data!.map((u) => {
              const note = lang === "en" ? u.note_en || u.note_pl : u.note_pl || u.note_en;
              return (
                // Kotwica wpisu osi czasu: pozycje kanału RSS trackera linkują
                // wprost do zmiany (`#update-<id>`), więc cel MUSI istnieć w
                // dokumencie. scroll-mt trzyma wpis pod sticky nagłówkiem.
                <li key={u.id} id={`update-${u.id}`} className="relative scroll-mt-24">
                  <span
                    className="absolute -left-[23px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary"
                    aria-hidden="true"
                  />
                  <div className="text-xs text-muted-foreground">
                    {formatDate(u.happened_on, lang)}
                  </div>
                  {u.stage_to && (
                    <div className="mt-0.5">
                      <Badge variant="outline" className="text-xs">
                        {u.stage_from
                          ? t("tracker.stageChange", {
                              from: stageLabel(u.stage_from, lang),
                              to: stageLabel(u.stage_to, lang),
                            })
                          : t("tracker.stageSet", { to: stageLabel(u.stage_to, lang) })}
                      </Badge>
                    </div>
                  )}
                  <p className="mt-1 text-sm">{note}</p>
                  {u.source_url && (
                    <a
                      href={u.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-0.5 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      {t("tracker.source")}
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
