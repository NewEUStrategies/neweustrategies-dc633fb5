// Moja sieć - zarządzanie relacjami (wzór LinkedIn) dla zarejestrowanych.
// Anonimowi widzą bramkę logowania; trasa jest noindex, a wszystkie RPC
// odrzucają wywołania anonimowe i egzekwują izolację tenanta w bazie.
// Zakładki: połączenia (z wyszukiwaniem w obrębie sieci), otrzymane/wysłane
// zaproszenia (odmowa jest cicha - patrz migracja 20260717123000) i sugestie
// "osoby, które możesz znać" (wspólne kontakty + afiniczność profilu).
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { BadgeCheck, MapPin, Search, UserPlus, Users, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AuthGate } from "@/components/profile/AuthGate";
import { ChatAvatar } from "@/components/chat/ChatAvatar";
import { CommunityDisabled } from "@/components/community/CommunityDisabled";
import { ConnectButton } from "@/components/network/ConnectButton";
import { useAuth } from "@/hooks/useAuth";
import { useCommunityModules } from "@/lib/community/useCommunityModules";
import { useOnlineUsers } from "@/lib/chat/presence";
import { currentLang } from "@/lib/i18n/localeRuntime";
import {
  useConnectionRequests,
  useConnectionSuggestions,
  useMyConnections,
  useNetworkCounts,
  useNetworkRealtime,
  type ConnectionRequestRow,
  type ConnectionSuggestionRow,
  type MyConnectionRow,
} from "@/lib/network/useConnections";
import { cn } from "@/lib/utils";
import "@/lib/i18n-network";

type NetworkTab = "connections" | "received" | "sent" | "suggestions";

interface NetworkSearch {
  tab?: NetworkTab;
  /** id połączenia z href powiadomienia - dziś tylko przenosi na zakładkę. */
  c?: string;
}

export const Route = createFileRoute("/network")({
  component: NetworkPage,
  validateSearch: (search: Record<string, unknown>): NetworkSearch => {
    const rawTab = typeof search.tab === "string" ? search.tab : undefined;
    const tab: NetworkTab | undefined =
      rawTab === "connections" ||
      rawTab === "received" ||
      rawTab === "sent" ||
      rawTab === "suggestions"
        ? rawTab
        : undefined;
    const c = typeof search.c === "string" && search.c.length > 0 ? search.c : undefined;
    return { tab, c };
  },
  head: () => ({
    meta: [{ title: "Moja sieć" }, { name: "robots", content: "noindex, nofollow" }],
  }),
});

function NetworkPage() {
  const { t } = useTranslation();
  const modules = useCommunityModules();
  if (!modules.connections_enabled) return <CommunityDisabled />;
  return (
    <AuthGate
      fallbackTitle={t("network.membersOnlyTitle")}
      fallbackBody={t("network.membersOnlyBody")}
    >
      <NetworkInner />
    </AuthGate>
  );
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(currentLang() === "en" ? "en-GB" : "pl-PL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Przewiń do wiersza wskazanego deep-linkiem ?c= z powiadomienia. */
function highlightRef(active: boolean) {
  return (el: HTMLLIElement | null) => {
    if (el && active) el.scrollIntoView({ block: "center" });
  };
}

/** Wspólny wiersz osoby: awatar, nazwisko, rola/instytucja, akcje po prawej. */
function PersonRow({
  userId,
  displayName,
  avatarUrl,
  jobTitle,
  company,
  location,
  slug,
  verified,
  online,
  meta,
  highlighted,
  children,
}: {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  company: string | null;
  location: string | null;
  slug: string | null;
  verified: boolean;
  online: boolean;
  meta?: string;
  highlighted?: boolean;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const details = (
    <>
      <p className="flex min-w-0 items-center gap-1.5 truncate text-sm font-semibold">
        <span className="truncate">{displayName}</span>
        {verified && (
          <BadgeCheck
            className="h-3.5 w-3.5 shrink-0 text-sky-600 dark:text-sky-400"
            aria-label={t("people.verifiedBadge")}
          />
        )}
      </p>
      {(jobTitle || company) && (
        <p className="truncate text-xs text-muted-foreground">
          {[jobTitle, company].filter(Boolean).join(" - ")}
        </p>
      )}
      {(location || meta) && (
        <p className="flex items-center gap-2 truncate text-[11px] text-muted-foreground/80">
          {location && (
            <span className="inline-flex shrink-0 items-center gap-0.5">
              <MapPin className="h-3 w-3" aria-hidden />
              {location}
            </span>
          )}
          {meta && <span className="truncate">{meta}</span>}
        </p>
      )}
    </>
  );
  return (
    <li
      ref={highlightRef(!!highlighted)}
      className={cn(
        "flex items-center gap-3 rounded-[6px] border border-border/60 bg-card p-3 transition-colors hover:border-border",
        highlighted && "border-[var(--brand)]/60 ring-1 ring-[var(--brand)]/40",
      )}
      data-user-id={userId}
    >
      <ChatAvatar name={displayName} avatarUrl={avatarUrl} online={online} size="md" />
      {slug ? (
        <Link
          to="/author/$slug"
          params={{ slug }}
          className="min-w-0 flex-1 rounded-[4px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`${t("network.viewProfile")}: ${displayName}`}
        >
          {details}
        </Link>
      ) : (
        <div className="min-w-0 flex-1">{details}</div>
      )}
      <div className="flex shrink-0 items-center gap-1.5">{children}</div>
    </li>
  );
}

function EmptyState({ text, cta }: { text: string; cta?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-3 rounded-[6px] border border-dashed border-border/70 p-10 text-center">
      <Users className="h-6 w-6 text-muted-foreground/50" aria-hidden />
      <p className="text-sm text-muted-foreground">{text}</p>
      {cta && (
        <Button asChild variant="outline" size="sm" className="gap-1.5">
          <Link to="/people">
            <Search className="h-3.5 w-3.5" aria-hidden />
            {t("network.findPeople")}
          </Link>
        </Button>
      )}
    </div>
  );
}

function LoadingList({ rows = 4 }: { rows?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-[72px] animate-pulse rounded-[6px] bg-muted/60" />
      ))}
    </div>
  );
}

function ConnectionsTab({ highlightId }: { highlightId?: string }) {
  const { t } = useTranslation();
  const online = useOnlineUsers();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const handle = setTimeout(() => setQuery(input), 250);
    return () => clearTimeout(handle);
  }, [input]);

  const connectionsQ = useMyConnections(query);
  const connections = useMemo(
    () =>
      Array.from(
        new Map(
          (connectionsQ.data?.pages ?? []).flat().map((c: MyConnectionRow) => [c.user_id, c]),
        ).values(),
      ),
    [connectionsQ.data],
  );

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("network.searchPlaceholder")}
          aria-label={t("network.searchPlaceholder")}
          className="h-10 w-full rounded-[6px] border border-input bg-muted/30 !pl-[42px] pr-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      {connectionsQ.isError ? (
        <ErrorBox retry={() => void connectionsQ.refetch()} />
      ) : connectionsQ.isLoading ? (
        <LoadingList />
      ) : connections.length === 0 ? (
        <div className="space-y-6">
          <EmptyState
            text={query ? t("network.emptyConnectionsFiltered") : t("network.emptyConnections")}
            cta={!query}
          />
          {/* Zimny start: zamiast pustego pokoju od razu podpowiadamy pierwsze
              zaproszenia (sugestie wspolnych kontaktow/dossier/wydarzen). */}
          {!query && (
            <section aria-label={t("network.coldStartTitle")}>
              <h2 className="mb-3 text-sm font-semibold">{t("network.coldStartTitle")}</h2>
              <SuggestionsTab />
            </section>
          )}
        </div>
      ) : (
        <>
          <ul className="grid gap-3 sm:grid-cols-2">
            {connections.map((c) => (
              <PersonRow
                key={c.user_id}
                userId={c.user_id}
                displayName={c.display_name}
                avatarUrl={c.avatar_url}
                jobTitle={c.job_title}
                company={c.current_company}
                location={c.location}
                slug={c.slug}
                verified={c.verified}
                online={online.has(c.user_id)}
                meta={
                  c.connected_at
                    ? t("network.connectedAt", { date: formatDate(c.connected_at) })
                    : undefined
                }
                highlighted={highlightId === c.connection_id}
              >
                <ConnectButton
                  userId={c.user_id}
                  displayName={c.display_name}
                  state={{
                    status: "connected",
                    connectionId: c.connection_id,
                    mutualCount: 0,
                    canInvite: false,
                  }}
                  compact
                />
              </PersonRow>
            ))}
          </ul>
          {connectionsQ.hasNextPage && (
            <div className="flex justify-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={connectionsQ.isFetchingNextPage}
                onClick={() => void connectionsQ.fetchNextPage()}
              >
                {connectionsQ.isFetchingNextPage ? t("network.loadingMore") : t("network.showMore")}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RequestsTab({
  direction,
  highlightId,
}: {
  direction: "in" | "out";
  highlightId?: string;
}) {
  const { t } = useTranslation();
  const online = useOnlineUsers();
  const requestsQ = useConnectionRequests(direction);

  if (requestsQ.isError) return <ErrorBox retry={() => void requestsQ.refetch()} />;
  if (requestsQ.isLoading) return <LoadingList rows={2} />;
  const rows = requestsQ.data ?? [];
  if (rows.length === 0) {
    return (
      <EmptyState
        text={direction === "in" ? t("network.emptyReceived") : t("network.emptySent")}
        cta={direction === "out"}
      />
    );
  }

  return (
    <ul className="grid gap-3">
      {rows.map((r: ConnectionRequestRow) => (
        <li
          key={r.connection_id}
          ref={highlightRef(highlightId === r.connection_id)}
          className={cn(
            "rounded-[6px] border border-border/60 bg-card p-3 transition-colors hover:border-border",
            highlightId === r.connection_id &&
              "border-[var(--brand)]/60 ring-1 ring-[var(--brand)]/40",
          )}
        >
          <div className="flex items-center gap-3">
            <ChatAvatar
              name={r.display_name}
              avatarUrl={r.avatar_url}
              online={online.has(r.user_id)}
              size="md"
            />
            <div className="min-w-0 flex-1">
              {r.slug ? (
                <Link
                  to="/author/$slug"
                  params={{ slug: r.slug }}
                  className="rounded-[4px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <p className="flex min-w-0 items-center gap-1.5 truncate text-sm font-semibold">
                    <span className="truncate">{r.display_name}</span>
                    {r.verified && (
                      <BadgeCheck
                        className="h-3.5 w-3.5 shrink-0 text-sky-600 dark:text-sky-400"
                        aria-label={t("people.verifiedBadge")}
                      />
                    )}
                  </p>
                </Link>
              ) : (
                <p className="truncate text-sm font-semibold">{r.display_name}</p>
              )}
              {(r.job_title || r.current_company) && (
                <p className="truncate text-xs text-muted-foreground">
                  {[r.job_title, r.current_company].filter(Boolean).join(" - ")}
                </p>
              )}
              <p className="text-[11px] text-muted-foreground/80">
                {t("network.requestedAt", { date: formatDate(r.requested_at) })}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {direction === "in" ? (
                <ConnectButton
                  userId={r.user_id}
                  displayName={r.display_name}
                  state={{
                    status: "pending_in",
                    connectionId: r.connection_id,
                    mutualCount: 0,
                    canInvite: false,
                  }}
                  compact
                />
              ) : (
                <ConnectButton
                  userId={r.user_id}
                  displayName={r.display_name}
                  state={{
                    status: "pending_out",
                    connectionId: r.connection_id,
                    mutualCount: 0,
                    canInvite: false,
                  }}
                  compact
                />
              )}
            </div>
          </div>
          {direction === "in" && r.message && (
            <blockquote className="mt-2 rounded-[4px] border-l-2 border-[var(--brand)]/50 bg-muted/40 px-3 py-2 text-xs italic text-muted-foreground">
              {r.message}
            </blockquote>
          )}
        </li>
      ))}
    </ul>
  );
}

function SuggestionsTab() {
  const { t } = useTranslation();
  const online = useOnlineUsers();
  const suggestionsQ = useConnectionSuggestions(12);

  if (suggestionsQ.isError) return <ErrorBox retry={() => void suggestionsQ.refetch()} />;
  if (suggestionsQ.isLoading) return <LoadingList />;
  const rows = suggestionsQ.data ?? [];
  if (rows.length === 0) return <EmptyState text={t("network.emptySuggestions")} cta />;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t("network.suggestionsHint")}</p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {rows.map((s: ConnectionSuggestionRow) => (
          <PersonRow
            key={s.user_id}
            userId={s.user_id}
            displayName={s.display_name}
            avatarUrl={s.avatar_url}
            jobTitle={s.job_title}
            company={s.current_company}
            location={s.location}
            slug={s.slug}
            verified={s.verified}
            online={online.has(s.user_id)}
            meta={
              [
                s.mutual_count > 0 ? t("network.mutual", { count: s.mutual_count }) : null,
                s.shared_follows > 0
                  ? t("network.sharedDossiers", { count: s.shared_follows })
                  : null,
                s.shared_events > 0 ? t("network.sharedEvents", { count: s.shared_events }) : null,
              ]
                .filter(Boolean)
                .join(" · ") || undefined
            }
          >
            <ConnectButton userId={s.user_id} displayName={s.display_name} compact />
          </PersonRow>
        ))}
      </ul>
    </div>
  );
}

function ErrorBox({ retry }: { retry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-3 rounded-[6px] border border-dashed border-border/70 p-10 text-center">
      <p className="text-sm text-muted-foreground">{t("network.loadError")}</p>
      <Button type="button" variant="outline" size="sm" onClick={retry}>
        {t("network.retry")}
      </Button>
    </div>
  );
}

function NetworkInner() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate({ from: "/network" });
  const { tab, c } = Route.useSearch();
  const active: NetworkTab = tab ?? "connections";
  const countsQ = useNetworkCounts();
  useNetworkRealtime();

  if (!user) return null;
  const counts = countsQ.data;

  const tabLabel = (key: NetworkTab, count: number | undefined) => (
    <span className="inline-flex items-center gap-1.5">
      {t(`network.tabs.${key}`)}
      {typeof count === "number" && count > 0 && (
        <span
          className={cn(
            "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold",
            key === "received"
              ? "bg-[var(--brand)] text-[var(--brand-foreground,white)]"
              : "bg-muted text-muted-foreground",
          )}
        >
          {count}
        </span>
      )}
    </span>
  );

  return (
    <div className="container mx-auto max-w-5xl px-3 py-5 sm:px-4 sm:py-6">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold leading-tight">
            <UsersRound className="h-5 w-5 text-[var(--brand)]" aria-hidden />
            {t("network.title")}
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("network.subtitle")}</p>
        </div>
        <Button asChild variant="outline" size="sm" className="gap-1.5">
          <Link to="/people">
            <UserPlus className="h-3.5 w-3.5" aria-hidden />
            {t("network.findPeople")}
          </Link>
        </Button>
      </header>

      <Tabs
        value={active}
        onValueChange={(next) =>
          void navigate({
            search: (prev: Record<string, unknown>) => ({ ...prev, tab: next as NetworkTab }),
            replace: true,
          })
        }
        className="mb-4"
      >
        <TabsList className="h-9 w-full justify-start overflow-x-auto rounded-[6px] bg-muted/40 sm:w-auto">
          <TabsTrigger value="connections" className="rounded-[4px] text-xs">
            {tabLabel("connections", Number(counts?.connections ?? 0) || undefined)}
          </TabsTrigger>
          <TabsTrigger value="received" className="rounded-[4px] text-xs">
            {tabLabel("received", Number(counts?.pending_in ?? 0) || undefined)}
          </TabsTrigger>
          <TabsTrigger value="sent" className="rounded-[4px] text-xs">
            {tabLabel("sent", Number(counts?.pending_out ?? 0) || undefined)}
          </TabsTrigger>
          <TabsTrigger value="suggestions" className="rounded-[4px] text-xs">
            {tabLabel("suggestions", undefined)}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {active === "connections" && <ConnectionsTab highlightId={c} />}
      {active === "received" && <RequestsTab direction="in" highlightId={c} />}
      {active === "sent" && <RequestsTab direction="out" highlightId={c} />}
      {active === "suggestions" && <SuggestionsTab />}
    </div>
  );
}
