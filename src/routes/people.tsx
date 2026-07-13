// People directory - internal, registered-only search over opted-in profiles.
// Anonymous visitors see a sign-in gate; the route is noindex and disallowed
// in robots.txt, and the underlying RPC rejects anonymous callers anyway.
// Wyszukiwanie: trgm+unaccent po stronie DB (diakrytyki bez znaczenia),
// filtry fasetowe (specjalizacja/firma/lokalizacja) i paginacja offsetowa
// z rzetelnym licznikiem total_count.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { BadgeCheck, Eye, EyeOff, MapPin, MessageCircle, Search, Users, X } from "lucide-react";
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
import { useAuth } from "@/hooks/useAuth";
import { openChatWindow } from "@/lib/chat/chatDockBus";
import { useOnlineUsers } from "@/lib/chat/presence";
import { useStartConversation } from "@/lib/chat/useConversations";
import { useDiscoverable, useSetDiscoverable } from "@/lib/chat/useDiscoverable";
import {
  EMPTY_PEOPLE_FILTERS,
  usePeopleDirectory,
  usePeopleFacets,
  type PeopleFilters,
} from "@/lib/chat/usePeopleDirectory";
import type { PersonHit } from "@/lib/chat/types";
import { useBadgesForUsers, type ProfileBadgeKind } from "@/lib/profile/badges";
import { ProfileBadges } from "@/components/profile/ProfileBadges";
import { cn } from "@/lib/utils";
import "@/lib/i18n-chat";

export const Route = createFileRoute("/people")({
  component: PeoplePage,
  head: () => ({
    meta: [{ title: "Osoby" }, { name: "robots", content: "noindex, nofollow" }],
  }),
});

function PeoplePage() {
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
  options: { value: string; cnt: number }[];
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
            {opt.value} ({opt.cnt})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PersonCard({
  person,
  online,
  badges,
}: {
  person: PersonHit;
  online: boolean;
  badges?: ProfileBadgeKind[];
}) {
  const { t } = useTranslation();
  const start = useStartConversation();

  const details = (
    <>
      <p className="flex min-w-0 items-center gap-1.5 truncate text-sm font-semibold">
        <span className="truncate">{person.display_name}</span>
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
    </>
  );

  return (
    <li className="flex items-center gap-3 rounded-[6px] border border-border/60 bg-card p-3 transition-colors hover:border-border">
      <ChatAvatar
        name={person.display_name}
        avatarUrl={person.avatar_url}
        online={online}
        size="md"
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
      <button
        type="button"
        disabled={start.isPending}
        onClick={() =>
          start.mutate(person.id, {
            onSuccess: (conversationId) => openChatWindow({ conversationId }),
            onError: () => toast.error(t("chat.startError")),
          })
        }
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[6px] bg-primary px-3 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        aria-label={`${t("people.message")}: ${person.display_name}`}
      >
        <MessageCircle className="h-3.5 w-3.5" aria-hidden />
        <span className="hidden sm:inline">{t("people.message")}</span>
      </button>
    </li>
  );
}

function PeopleInner() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const online = useOnlineUsers();

  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<PeopleFilters>(EMPTY_PEOPLE_FILTERS);
  useEffect(() => {
    const handle = setTimeout(() => setQuery(input), 250);
    return () => clearTimeout(handle);
  }, [input]);

  const facetsQ = usePeopleFacets();
  const peopleQ = usePeopleDirectory(query, filters);
  const people = useMemo(
    () => Array.from(new Map((peopleQ.data?.pages ?? []).flat().map((p) => [p.id, p])).values()),
    [peopleQ.data],
  );
  const total = peopleQ.data?.pages[0]?.[0]?.total_count ?? people.length;
  // Sygnały zaufania: odznaki dla całej widocznej partii jednym zapytaniem.
  const badgesQ = useBadgesForUsers(people.map((p) => p.id));
  const hasActiveFilters =
    filters.specialization !== null ||
    filters.company !== null ||
    filters.location !== null ||
    filters.jobTitle !== null ||
    filters.verifiedOnly;

  if (!user) return null;

  return (
    <div className="container mx-auto max-w-5xl px-3 py-5 sm:px-4 sm:py-6">
      <header className="mb-4">
        <h1 className="text-xl font-bold leading-tight">{t("people.title")}</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("people.subtitle")}</p>
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
          onChange={(next) => setFilters((f) => ({ ...f, specialization: next }))}
          options={facetsQ.data?.specialization ?? []}
          allLabel={t("people.allSpecializations")}
          ariaLabel={t("people.filterSpecialization")}
        />
        <FacetSelect
          value={filters.company}
          onChange={(next) => setFilters((f) => ({ ...f, company: next }))}
          options={facetsQ.data?.company ?? []}
          allLabel={t("people.allCompanies")}
          ariaLabel={t("people.filterCompany")}
        />
        <FacetSelect
          value={filters.jobTitle}
          onChange={(next) => setFilters((f) => ({ ...f, jobTitle: next }))}
          options={facetsQ.data?.job_title ?? []}
          allLabel={t("people.allJobTitles")}
          ariaLabel={t("people.filterJobTitle")}
        />
        <FacetSelect
          value={filters.location}
          onChange={(next) => setFilters((f) => ({ ...f, location: next }))}
          options={facetsQ.data?.location ?? []}
          allLabel={t("people.allLocations")}
          ariaLabel={t("people.filterLocation")}
        />
        <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-[6px] border border-input bg-muted/30 px-3 text-xs">
          <Switch
            checked={filters.verifiedOnly}
            onCheckedChange={(next) => setFilters((f) => ({ ...f, verifiedOnly: next }))}
            aria-label={t("people.verifiedOnly")}
          />
          <span className="inline-flex items-center gap-1">
            <BadgeCheck className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" aria-hidden />
            {t("people.verifiedOnly")}
          </span>
        </label>
        {hasActiveFilters && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 gap-1 text-xs"
            onClick={() => setFilters(EMPTY_PEOPLE_FILTERS)}
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            {t("people.clearFilters")}
          </Button>
        )}
      </div>

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
              onClick={() => setFilters(EMPTY_PEOPLE_FILTERS)}
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
