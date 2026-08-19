// People directory - internal, registered-only search over opted-in profiles.
// Anonymous visitors see a sign-in gate; the route is noindex and disallowed
// in robots.txt, and the underlying RPC rejects anonymous callers anyway.
//
// Wyszukiwanie: trgm+unaccent po stronie DB (diakrytyki bez znaczenia), filtry
// fasetowe (specjalizacja / firma / rola / lokalizacja / INTENCJA) i paginacja
// offsetowa z rzetelnym licznikiem total_count.
//
// STAN ŻYJE W URL-u (08.2026). Wcześniej fraza i filtry siedziały w useState,
// więc katalogu nie dało się ani udostępnić linkiem, ani ZAPISAĆ - a bez
// zapisanego stanu nie ma alertu "dołączył ktoś, kogo szukasz" (encja
// 'people' w saved_searches, migracja 20260807142000). Parametry są krótkie
// i czytelne, bo trafiają do href-a powiadomienia.
//
// Tryb SEMANTYCZNY (?sem=1) jest jawnym wyborem: kosztuje jedno wywołanie
// bramki embeddingów per fraza i zmienia semantykę filtra (dopasowanie po
// znaczeniu, nie po podciągu), więc nie może się włączać po cichu.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BadgeCheck,
  Compass,
  Eye,
  EyeOff,
  MapPin,
  Search,
  Sparkles,
  Trophy,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { AuthGate } from "@/components/profile/AuthGate";
import { ChatAvatar } from "@/components/chat/ChatAvatar";
import { MessageOrConnectButton } from "@/components/network/MessageOrConnectButton";
import { ProfileLinkButton } from "@/components/network/ProfileLinkButton";
import { DegreeBadge } from "@/components/network/atoms/DegreeBadge";
import { ConnectionPathTrail } from "@/components/network/molecules/ConnectionPathTrail";
import { useAuth } from "@/hooks/useAuth";

import { useOnlineUsers } from "@/lib/chat/presence";

import { useDiscoverable, useSetDiscoverable } from "@/lib/chat/useDiscoverable";
import { useCommunityModules } from "@/lib/community/useCommunityModules";
import { useUserCounter } from "@/lib/counters/usePendingCounters";
import {
  NO_CONNECTION,
  useConnectionStatuses,
  type ConnectionState,
} from "@/lib/network/useConnections";
import {
  usePeopleDirectory,
  usePeopleFacets,
  type PeopleFilters,
} from "@/lib/chat/usePeopleDirectory";
import { PEOPLE_SEMANTIC_MIN_CHARS } from "@/lib/search/peopleSemantic.functions";
import type { PersonHit } from "@/lib/chat/types";
import {
  normalizeProfileIntents,
  profileIntentLabelKey,
  type ProfileIntentCode,
} from "@/lib/profile/intents";
import {
  clearedPeopleFacets,
  hasPeopleFacetFilters,
  isPeopleSearchSaveable,
  parsePeopleSearchParams,
  type PeopleSearchParams,
} from "@/lib/profile/peopleSearchParams";
import { useBadgesForUsers, type ProfileBadgeKind } from "@/lib/profile/badges";
import { ProfileBadges } from "@/components/profile/ProfileBadges";
import { IntentChip } from "@/components/atoms/IntentChip";
import { SavedSearchesPanel } from "@/components/search/SavedSearchesPanel";
import { currentLang } from "@/lib/i18n/localeRuntime";
import { cn } from "@/lib/utils";
import { ensureI18n as ensureChatI18n } from "@/lib/i18n-chat";
import { ensureI18n as ensureNetworkI18n } from "@/lib/i18n-network";
import { ensureI18n as ensureCommunityI18n } from "@/lib/i18n-community";
import { ensureI18n as ensureProfileIntentI18n } from "@/lib/i18n-profile-intent";

export const Route = createFileRoute("/people")({
  component: PeoplePage,
  // Model stanu URL zyje w lib/profile/peopleSearchParams: ten sam walidator
  // obsluguje adres w przegladarce I snapshot z bazy przy przywracaniu
  // zapisanego wyszukiwania.
  validateSearch: parsePeopleSearchParams,
  head: () => ({
    meta: [{ title: "Osoby" }, { name: "robots", content: "noindex, nofollow" }],
  }),
});

function PeoplePage() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureChatI18n();
  ensureNetworkI18n();
  ensureCommunityI18n();
  ensureProfileIntentI18n();
  const { t } = useTranslation();
  return (
    <AuthGate
      fallbackTitle={t("people.membersOnlyTitle")}
      fallbackBody={t("people.membersOnlyBody")}
    >
      <PeopleInner />
    </AuthGate>
  );
}

function DiscoverabilityBanner() {
  const { t } = useTranslation();
  const discoverableQ = useDiscoverable();
  const setDiscoverable = useSetDiscoverable();
  const on = discoverableQ.data ?? false;

  if (discoverableQ.isLoading) return null;

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-[6px] border px-3 py-2.5",
        on ? "border-border/60 bg-muted/30" : "border-[var(--brand)]/40 bg-[var(--brand)]/5",
      )}
    >
      {on ? (
        <Eye className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
      ) : (
        <EyeOff className="h-4 w-4 shrink-0 text-[var(--brand)]" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium leading-snug">
          {on ? t("people.discoverBannerOnTitle") : t("people.discoverBannerTitle")}
        </p>
        <p className="text-xs leading-snug text-muted-foreground">
          {on ? t("people.discoverBannerOnBody") : t("people.discoverBannerBody")}
        </p>
      </div>
      <Switch
        checked={on}
        disabled={setDiscoverable.isPending}
        onCheckedChange={(next) =>
          setDiscoverable.mutate(next, {
            onSuccess: () => toast.success(t("profilePrivacy.saved")),
            onError: () => toast.error(t("profilePrivacy.saveError")),
          })
        }
        aria-label={t("profilePrivacy.discoverableLabel")}
      />
    </div>
  );
}

// Wartość "wszystkie" w Radix Select nie może być pustym stringiem.
const ALL = "__all__";

function FacetSelect({
  value,
  onChange,
  options,
  allLabel,
  ariaLabel,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  options: { value: string; label?: string; cnt: number }[];
  allLabel: string;
  ariaLabel: string;
}) {
  if (options.length === 0) return null;
  return (
    <Select value={value ?? ALL} onValueChange={(next) => onChange(next === ALL ? null : next)}>
      <SelectTrigger
        aria-label={ariaLabel}
        className="h-9 w-auto min-w-[140px] max-w-[220px] rounded-[6px] bg-muted/30 text-xs"
      >
        <SelectValue placeholder={allLabel} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label ?? opt.value} ({opt.cnt})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Fragment "czego szukam" w języku interfejsu, z fallbackiem na drugi. */
function seekingText(person: PersonHit, lang: string): string | null {
  const primary = lang === "en" ? person.seeking_en : person.seeking_pl;
  const secondary = lang === "en" ? person.seeking_pl : person.seeking_en;
  const value = (primary ?? "").trim() || (secondary ?? "").trim();
  return value.length > 0 ? value : null;
}

function PersonCard({
  person,
  online,
  badges,
  connection,
}: {
  person: PersonHit;
  online: boolean;
  badges?: ProfileBadgeKind[];
  connection?: ConnectionState;
}) {
  const { t } = useTranslation();
  const lang = currentLang();
  const intents = useMemo(() => normalizeProfileIntents(person.open_to), [person.open_to]);
  const seeking = seekingText(person, lang);

  const details = (
    <>
      <p className="flex min-w-0 items-center gap-1.5 truncate text-sm font-semibold">
        <span className="truncate">{person.display_name}</span>
        {/* Stopień oddalenia tuż przy nazwisku - tam, gdzie czytelnik szuka
            odpowiedzi na pytanie „czy to ktoś z mojego świata?". */}
        <DegreeBadge degree={connection?.degree ?? 0} />
        <ProfileBadges badges={badges} className="shrink-0" />
      </p>
      {(person.job_title || person.current_company) && (
        <p className="truncate text-xs text-muted-foreground">
          {[person.job_title, person.current_company].filter(Boolean).join(" - ")}
        </p>
      )}
      {(person.specialization || person.location) && (
        <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground/80">
          {person.specialization && <span className="truncate">{person.specialization}</span>}
          {person.location && (
            <span className="inline-flex shrink-0 items-center gap-0.5">
              <MapPin className="h-3 w-3" aria-hidden />
              {person.location}
            </span>
          )}
        </p>
      )}
      {/* Intencja: JEDYNY sygnał na karcie, który mówi PO CO się kontaktować. */}
      {seeking && (
        <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-foreground/75">{seeking}</p>
      )}
      {/* Dowód społeczny: wspólne kontakty z batchowanego connection_statuses. */}
      {(connection?.mutualCount ?? 0) > 0 && (
        <p className="truncate text-[11px] font-medium text-[var(--brand)]">
          {t("network.mutual", { count: connection?.mutualCount ?? 0 })}
        </p>
      )}
      {/* ...i KTĘDY ta droga biegnie. Bez `interactive`, bo cały blok danych
          jest już linkiem do profilu (zagnieżdżone <a> to nieprawidłowy HTML). */}
      {connection && (
        <ConnectionPathTrail
          degree={connection.degree}
          bridge={connection.bridge}
          targetName={person.display_name}
          targetAvatarUrl={person.avatar_url}
          targetSlug={person.slug}
          interactive={false}
          className="mt-0.5"
        />
      )}
    </>
  );

  return (
    <li className="flex flex-col gap-2 rounded-[6px] border border-border/60 bg-card p-3 transition-colors hover:border-border">
      <div className="flex items-center gap-3">
        <ChatAvatar
          name={person.display_name}
          avatarUrl={person.avatar_url}
          online={online}
          size="md"
          to={person.slug ? `/author/${person.slug}` : undefined}
        />
        {person.slug ? (
          <Link
            to="/author/$slug"
            params={{ slug: person.slug }}
            className="min-w-0 flex-1 rounded-[4px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`${t("people.viewProfile")}: ${person.display_name}`}
          >
            {details}
          </Link>
        ) : (
          <div className="min-w-0 flex-1">{details}</div>
        )}
        <div className="flex shrink-0 items-center gap-1.5">
          {person.slug && (
            <ProfileLinkButton slug={person.slug} displayName={person.display_name} compact />
          )}
          {/* Status z batchowanego RPC - bez mapy nie renderujemy przycisku,
              żeby każda karta nie odpytywała o status osobno. */}
          {connection && (
            <MessageOrConnectButton
              userId={person.id}
              displayName={person.display_name}
              displayAvatar={person.avatar_url}
              compact
              connectionState={connection}
            />
          )}
        </div>
      </div>
      {intents.length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label={t("profileIntent.openToLabel")}>
          {intents.map((code) => (
            <li key={code}>
              <IntentChip
                readOnly
                label={t(`profileIntent.openToShort.${code}`)}
                ariaLabel={t(profileIntentLabelKey(code))}
              />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function PeopleInner() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const online = useOnlineUsers();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  // Fraza: lokalny input + debounce do URL-a. URL jest źródłem prawdy dla
  // zapytania, ale nie może zmieniać się na każde wciśnięcie klawisza.
  const [input, setInput] = useState(search.q ?? "");
  useEffect(() => {
    setInput(search.q ?? "");
    // Reagujemy WYŁĄCZNIE na zmianę z zewnątrz (przywrócony zapis, link,
    // przycisk "wstecz") - stąd zależność od search.q, nie od input.
  }, [search.q]);
  useEffect(() => {
    const next = input.trim();
    if (next === (search.q ?? "")) return;
    const handle = setTimeout(() => {
      void navigate({
        search: (prev: PeopleSearchParams) => ({ ...prev, q: next.length > 0 ? next : undefined }),
        replace: true,
      });
    }, 250);
    return () => clearTimeout(handle);
  }, [input, search.q, navigate]);

  const query = search.q ?? "";
  const filters: PeopleFilters = useMemo(
    () => ({
      specialization: search.specialization ?? null,
      company: search.company ?? null,
      location: search.location ?? null,
      jobTitle: search.role ?? null,
      verifiedOnly: search.verified === "1",
      openTo: normalizeProfileIntents(search.open ?? ""),
      semantic: search.sem === "1",
    }),
    [search],
  );

  const patch = (next: Partial<PeopleSearchParams>) => {
    void navigate({ search: (prev: PeopleSearchParams) => ({ ...prev, ...next }), replace: true });
  };

  const facetsQ = usePeopleFacets();
  const {
    people: peopleQ,
    semanticActive,
    semanticUnavailable,
  } = usePeopleDirectory(query, filters);
  const people = useMemo(
    () => Array.from(new Map((peopleQ.data?.pages ?? []).flat().map((p) => [p.id, p])).values()),
    [peopleQ.data],
  );
  const total = peopleQ.data?.pages[0]?.[0]?.total_count ?? people.length;
  // Sygnały zaufania: odznaki dla całej widocznej partii jednym zapytaniem.
  const badgesQ = useBadgesForUsers(people.map((p) => p.id));
  // Statusy sieci kontaktów dla widocznych kart - jeden batchowany RPC.
  const modules = useCommunityModules();
  const connectionsQ = useConnectionStatuses(
    modules.connections_enabled ? people.map((p) => p.id) : [],
  );
  const pendingInvites = useUserCounter("connections_pending");

  const intentOptions = useMemo(
    () =>
      (facetsQ.data?.open_to ?? []).map((opt) => ({
        value: opt.value,
        label: t(`profileIntent.openToShort.${opt.value}`),
        cnt: opt.cnt,
      })),
    [facetsQ.data?.open_to, t],
  );
  const activeIntent: ProfileIntentCode | null = filters.openTo[0] ?? null;

  const hasActiveFilters = hasPeopleFacetFilters(search);
  const canSave = isPeopleSearchSaveable(search);
  const clearFilters = () => patch(clearedPeopleFacets());

  if (!user) return null;

  return (
    <div className="container mx-auto max-w-5xl px-3 py-5 sm:px-4 sm:py-6">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold leading-tight">{t("people.title")}</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("people.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            asChild
            variant="outline"
            size="sm"
            className="gap-1.5 transition-colors hover:border-brand/40 hover:bg-brand/10 hover:text-brand"
          >
            <Link to="/contributors">
              <Trophy className="h-3.5 w-3.5 transition-colors" aria-hidden />
              {t("community.reputation.boardLink")}
            </Link>
          </Button>
          {modules.connections_enabled && (
            <Button
              asChild
              variant="outline"
              size="sm"
              className="gap-1.5 transition-colors hover:border-brand/40 hover:bg-brand/10 hover:text-brand"
            >
              <Link to="/network">
                <Users className="h-3.5 w-3.5 transition-colors" aria-hidden />
                {t("network.networkLink")}
                {pendingInvites > 0 && (
                  <span
                    className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--brand)] px-1 text-[10px] font-semibold text-white"
                    aria-label={t("network.pendingBadge", { count: pendingInvites })}
                  >
                    {pendingInvites}
                  </span>
                )}
              </Link>
            </Button>
          )}
        </div>
      </header>

      <div className="mb-4">
        <DiscoverabilityBanner />
      </div>

      <div className="relative mb-3">
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("people.searchPlaceholder")}
          aria-label={t("people.searchPlaceholder")}
          className="h-10 w-full rounded-[6px] border border-input bg-muted/30 !pl-[42px] pr-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FacetSelect
          value={filters.specialization}
          onChange={(next) => patch({ specialization: next ?? undefined })}
          options={facetsQ.data?.specialization ?? []}
          allLabel={t("people.allSpecializations")}
          ariaLabel={t("people.filterSpecialization")}
        />
        <FacetSelect
          value={filters.company}
          onChange={(next) => patch({ company: next ?? undefined })}
          options={facetsQ.data?.company ?? []}
          allLabel={t("people.allCompanies")}
          ariaLabel={t("people.filterCompany")}
        />
        <FacetSelect
          value={filters.jobTitle}
          onChange={(next) => patch({ role: next ?? undefined })}
          options={facetsQ.data?.job_title ?? []}
          allLabel={t("people.allJobTitles")}
          ariaLabel={t("people.filterJobTitle")}
        />
        <FacetSelect
          value={filters.location}
          onChange={(next) => patch({ location: next ?? undefined })}
          options={facetsQ.data?.location ?? []}
          allLabel={t("people.allLocations")}
          ariaLabel={t("people.filterLocation")}
        />
        {/* Faseta INTENCJI - "pokaż wszystkich otwartych na konsorcja". */}
        <FacetSelect
          value={activeIntent}
          onChange={(next) => patch({ open: next ?? undefined })}
          options={intentOptions}
          allLabel={t("people.allIntents")}
          ariaLabel={t("people.filterIntent")}
        />
        <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-[6px] border border-input bg-muted/30 px-3 text-xs">
          <Switch
            checked={filters.verifiedOnly}
            onCheckedChange={(next) => patch({ verified: next ? "1" : undefined })}
            aria-label={t("people.verifiedOnly")}
          />
          <span className="inline-flex items-center gap-1">
            <BadgeCheck className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" aria-hidden />
            {t("people.verifiedOnly")}
          </span>
        </label>
        {/* Tryb semantyczny: zmienia SEMANTYKĘ dopasowania, więc jest jawnym
            przełącznikiem, nie ukrytą heurystyką. */}
        <label
          className={cn(
            "inline-flex h-9 cursor-pointer items-center gap-2 rounded-[6px] border px-3 text-xs transition-colors",
            filters.semantic
              ? "border-[var(--brand)]/40 bg-[var(--brand)]/5"
              : "border-input bg-muted/30",
          )}
          title={t("people.semanticHint", { min: PEOPLE_SEMANTIC_MIN_CHARS })}
        >
          <Switch
            checked={filters.semantic}
            onCheckedChange={(next) => patch({ sem: next ? "1" : undefined })}
            aria-label={t("people.semanticMode")}
          />
          <span className="inline-flex items-center gap-1">
            <Sparkles
              className={cn(
                "h-3.5 w-3.5",
                semanticActive ? "text-[var(--brand)]" : "text-muted-foreground",
              )}
              aria-hidden
            />
            {t("people.semanticMode")}
          </span>
        </label>
        {hasActiveFilters && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 gap-1 text-xs"
            onClick={clearFilters}
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            {t("people.clearFilters")}
          </Button>
        )}
      </div>

      {/* Zapisane wyszukiwania katalogu osób (encja 'people'): nazwany snapshot
          stanu URL + dzwonek alertu "dołączył ktoś, kogo szukasz". */}
      <details className="mb-4 rounded-[6px] border border-border/60 bg-muted/20 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium">
          {t("people.savedSearchesTitle")}
        </summary>
        <div className="pt-3">
          <SavedSearchesPanel
            entity="people"
            current={search}
            canSave={canSave}
            onApply={(params) => void navigate({ search: () => parsePeopleSearchParams(params) })}
          />
        </div>
      </details>

      {filters.semantic && semanticUnavailable && (
        <p className="mb-3 rounded-[4px] border border-amber-500/40 bg-amber-500/5 px-2.5 py-1.5 text-[11px] leading-snug text-amber-700 dark:text-amber-400">
          {t("people.semanticUnavailable")}
        </p>
      )}
      {semanticActive && (
        <p className="mb-3 flex items-center gap-1.5 text-[11px] text-[var(--brand)]">
          <Compass className="h-3 w-3 shrink-0" aria-hidden />
          {t("people.semanticActive")}
        </p>
      )}

      {!peopleQ.isLoading && people.length > 0 && (
        <p className="mb-3 text-xs text-muted-foreground">
          {t("people.shownOfTotal", { shown: people.length, total })}
        </p>
      )}

      {peopleQ.isError ? (
        <div className="flex flex-col items-center gap-3 rounded-[6px] border border-dashed border-border/70 p-10 text-center">
          <p className="text-sm text-muted-foreground">{t("people.loadError")}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void peopleQ.refetch()}>
            {t("people.retry")}
          </Button>
        </div>
      ) : peopleQ.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-[72px] animate-pulse rounded-[6px] bg-muted/60" />
          ))}
        </div>
      ) : people.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-[6px] border border-dashed border-border/70 p-10 text-center">
          <Users className="h-6 w-6 text-muted-foreground/50" aria-hidden />
          <p className="text-sm text-muted-foreground">
            {hasActiveFilters
              ? t("people.emptyFiltered")
              : query
                ? t("people.empty")
                : t("people.emptyDirectory")}
          </p>
          {hasActiveFilters && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={clearFilters}
            >
              {t("people.clearFilters")}
            </Button>
          )}
        </div>
      ) : (
        <>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {people.map((person) => (
              <PersonCard
                key={person.id}
                person={person}
                online={online.has(person.id)}
                badges={badgesQ.data?.get(person.id)}
                connection={
                  connectionsQ.data
                    ? (connectionsQ.data.get(person.id) ?? NO_CONNECTION)
                    : undefined
                }
              />
            ))}
          </ul>
          {peopleQ.hasNextPage && (
            <div className="mt-4 flex justify-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={peopleQ.isFetchingNextPage}
                onClick={() => void peopleQ.fetchNextPage()}
              >
                {peopleQ.isFetchingNextPage ? t("people.loadingMore") : t("people.showMore")}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
