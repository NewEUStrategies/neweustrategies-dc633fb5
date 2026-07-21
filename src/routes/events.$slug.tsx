// Szczegóły wydarzenia + RSVP. URL: /events/$slug
// RSVP jest trój-stanowe (going / interested / cancelled). Ponowne kliknięcie
// tego samego statusu = cofnięcie do 'cancelled'. Zmiana statusu robi UPDATE
// istniejącego wiersza (unique index event_id+user_id), więc jeden użytkownik
// zawsze ma dokładnie jeden RSVP na wydarzenie.
// Przy komplecie miejsc 'going' degraduje się SERWEROWO do 'waitlist'
// (kolejka FIFO w rsvp_event) - klient czyta wynik z odpowiedzi RPC i nigdy
// sam nie żąda statusu waitlist. Nagranie po wydarzeniu stoi za bramką
// warstwy (flaga recordings) rozstrzyganą w get_event_access.
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Calendar,
  MapPin,
  Users,
  ShieldQuestion,
  Video,
  ArrowLeft,
  Check,
  ListPlus,
  Star,
  XCircle,
  BadgeCheck,
  Lock,
  Clock,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

import {
  fetchEventAccess,
  fetchEventRsvpCounts,
  fetchEventWaitlistPosition,
  fetchPublicEventBySlug,
  rsvpEvent,
  type RsvpRequestStatus,
} from "@/lib/community/publicQueries";
import { useCommunityModules } from "@/lib/community/useCommunityModules";
import { useMembershipTiers, tierName, tierHasFeature, useCurrentTier } from "@/lib/billing/tiers";
import { useAuth } from "@/hooks/useAuth";
import { EventGroupButton } from "@/components/network/EventGroupButton";
import { AddToCalendar } from "@/components/community/AddToCalendar";
import { Button } from "@/components/ui/button";
import { CommunityDisabled } from "@/components/community/CommunityDisabled";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";
import { buildContentHead } from "@/lib/seo/meta";
import { ensureI18n as ensureCommunityI18n } from "@/lib/i18n-community";
type RsvpStatus = "going" | "interested" | "cancelled" | "waitlist";

export const Route = createFileRoute("/events/$slug")({
  component: EventDetail,
  head: ({ params }) => {
    const url = getRequestUrl() || `/events/${params.slug}`;
    const lang = activeLang(url);
    return buildContentHead({
      url,
      lang,
      type: "article",
      title:
        lang === "en" ? "Event - New European Strategies" : "Wydarzenie - New European Strategies",
      description:
        lang === "en"
          ? "Community event details, RSVP and live link."
          : "Szczegóły wydarzenia, zapis i link do transmisji.",
    });
  },
});

function EventDetail() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureCommunityI18n();
  const { slug } = useParams({ from: "/events/$slug" });
  const { t, i18n } = useTranslation();
  const lang = (i18n.language.startsWith("en") ? "en" : "pl") as "pl" | "en";
  const modules = useCommunityModules();
  const { user } = useAuth();
  const qc = useQueryClient();

  const eventQ = useQuery({
    queryKey: ["public-event", slug],
    queryFn: () => fetchPublicEventBySlug(slug),
    enabled: modules.events_enabled,
  });
  const eventId = eventQ.data?.id ?? null;

  // Własny RSVP (RLS: "rsvps owner read" - widzę tylko swój wiersz).
  const rsvpQ = useQuery({
    queryKey: ["event-rsvp", eventId, user?.id],
    queryFn: async () => {
      if (!eventId || !user) return null;
      const { data } = await supabase
        .from("event_rsvps")
        .select("id, status")
        .eq("event_id", eventId)
        .eq("user_id", user.id)
        .maybeSingle();
      return data as { id: string; status: RsvpStatus } | null;
    },
    enabled: !!eventId && !!user,
  });

  // Serwerowa ocena dostępu: linki + powód odmowy (auth/tier/rsvp).
  const accessQ = useQuery({
    queryKey: ["event-access", eventId, user?.id ?? "anon"],
    queryFn: () => fetchEventAccess(eventId!),
    enabled: !!eventId,
  });

  const countsQ = useQuery({
    queryKey: ["event-rsvp-counts", eventId],
    queryFn: () => fetchEventRsvpCounts([eventId!]),
    enabled: !!eventId,
  });

  const tiersQ = useMembershipTiers();
  const currentTierQ = useCurrentTier();

  // Pozycja FIFO na liście rezerwowej (wiersze RSVP są owner-only; liczby
  // ponad własny wiersz wyłącznie przez RPC).
  const waitlistPosQ = useQuery({
    queryKey: ["event-waitlist-position", eventId, user?.id],
    queryFn: () => fetchEventWaitlistPosition(eventId!),
    enabled: !!eventId && !!user && rsvpQ.data?.status === "waitlist",
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["event-rsvp", eventId, user?.id] });
    void qc.invalidateQueries({ queryKey: ["event-access", eventId, user?.id ?? "anon"] });
    void qc.invalidateQueries({ queryKey: ["event-rsvp-counts", eventId] });
    void qc.invalidateQueries({ queryKey: ["event-waitlist-position", eventId, user?.id] });
  };

  const rsvpM = useMutation({
    mutationFn: async (target: RsvpRequestStatus) => {
      if (!eventQ.data || !user) throw new Error("no user");
      // Ponowne kliknięcie tego samego statusu = cancel (poza samym 'cancelled').
      // Klik w aktywną listę rezerwową ponawia 'going' - to celowo idempotentne:
      // jeśli w międzyczasie zwolniło się miejsce, serwer po prostu potwierdzi
      // 'going' zamiast przypadkiem wypisać z kolejki.
      // Migracja 20260713200000 cofa granty INSERT/UPDATE/DELETE na event_rsvps -
      // jedyną ścieżką zapisu jest RPC rsvp_event (limit miejsc, kolejka FIFO,
      // bramka warstwy, egzekwowanie flagi pro_briefings).
      const nextStatus: RsvpRequestStatus =
        rsvpQ.data?.status === target && target !== "cancelled" ? "cancelled" : target;
      return rsvpEvent(eventQ.data.id, nextStatus);
    },
    onSuccess: (result) => {
      invalidate();
      if (result.status === "waitlist") {
        toast.success(
          result.waitlist_position !== null
            ? t("community.events.toastWaitlist", { position: result.waitlist_position })
            : t("community.events.toastWaitlistNoPosition"),
        );
        return;
      }
      const key =
        result.status === "going"
          ? "community.events.toastGoing"
          : result.status === "interested"
            ? "community.events.toastInterested"
            : "community.events.toastCancelled";
      toast.success(t(key));
    },
    onError: (e: unknown) => {
      // Surowe komunikaty RPC rsvp_event mapujemy na czytelne i18n.
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("full")) toast.error(t("community.events.rsvpFull"));
      else if (msg.includes("rsvp not open")) toast.error(t("community.events.rsvpNotOpenToast"));
      else if (msg.includes("membership required"))
        toast.error(t("community.events.rsvpTierError"));
      else toast.error(t("community.events.rsvpError"));
    },
  });

  if (!modules.events_enabled) return <CommunityDisabled />;
  if (eventQ.isLoading) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-12">{t("community.common.loading")}</div>
    );
  }
  if (!eventQ.data) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-12">
        <p className="text-muted-foreground">{t("community.common.loadError")}</p>
        <Link to="/events" className="mt-4 inline-block text-sm text-primary">
          {t("community.events.backToList")}
        </Link>
      </div>
    );
  }

  const ev = eventQ.data;
  const title = lang === "en" ? ev.title_en || ev.title_pl : ev.title_pl || ev.title_en;
  const desc = lang === "en" ? ev.description_en : ev.description_pl;
  const startsAt = new Date(ev.starts_at);
  const isPast = startsAt.getTime() < Date.now();
  const access = accessQ.data ?? null;
  const counts = countsQ.data?.get(ev.id);
  const going = counts?.going ?? 0;
  const waitlistCount = counts?.waitlist ?? 0;
  const seatsLeft = ev.capacity !== null ? Math.max(0, ev.capacity - going) : null;
  const isFull = seatsLeft !== null && seatsLeft === 0;
  const isWaitlisted = rsvpQ.data?.status === "waitlist";
  const isProBriefing = ev.kind === "briefing" && ev.visibility === "members";
  const membersOnly = ev.visibility === "members";

  // Nazwa wymaganej warstwy: najniższy aktywny tier o randze >= progu
  // (members podnosi próg do >=1; briefing Pro wskazuje tier z pro_briefings).
  const requiredTierName = (() => {
    const tiers = tiersQ.data ?? [];
    if (isProBriefing) {
      const withFlag = tiers.find(
        (tier) =>
          tier.features &&
          typeof tier.features === "object" &&
          !Array.isArray(tier.features) &&
          (tier.features as Record<string, unknown>).pro_briefings === true,
      );
      return withFlag ? tierName(withFlag, lang) : null;
    }
    if (!membersOnly && ev.min_tier_rank <= 0) return null;
    const minRank = membersOnly ? Math.max(ev.min_tier_rank, 1) : ev.min_tier_rank;
    const match = [...tiers].sort((a, b) => a.rank - b.rank).find((tier) => tier.rank >= minRank);
    return match ? tierName(match, lang) : null;
  })();

  const tierBlocked = access?.reason === "tier_required";

  // Najniższa warstwa z benefitem nagrań (flaga features.recordings) - do
  // czytelnego upsellu przy bramce nagrania.
  const recordingTierName = (() => {
    const tiers = tiersQ.data ?? [];
    const match = [...tiers]
      .sort((a, b) => a.rank - b.rank)
      .find((tier) => tierHasFeature(tier.features, "recordings"));
    return match ? tierName(match, lang) : null;
  })();

  // Pierwszeństwo rejestracji: okno rsvp_opens_at + wcześniejszy dostęp dla
  // członków o randze >= early_rsvp_rank. Twardo egzekwuje to rsvp_event; tu
  // rozstrzygamy tylko, co pokazać (przyciski vs komunikat "jeszcze nieotwarta").
  const rsvpOpensAt = ev.rsvp_opens_at ? new Date(ev.rsvp_opens_at) : null;
  const rsvpBeforeOpen = !!rsvpOpensAt && rsvpOpensAt.getTime() > Date.now();
  const earlyRank = ev.early_rsvp_rank ?? null;
  const myRank = currentTierQ.data?.rank ?? 0;
  const hasEarlyAccess = earlyRank !== null && myRank >= earlyRank;
  // Rejestracja zamknięta dla wołającego, dopóki nie ma wcześniejszego dostępu.
  const rsvpLockedByWindow = rsvpBeforeOpen && !hasEarlyAccess;
  const whenOpens = rsvpOpensAt
    ? rsvpOpensAt.toLocaleString(lang === "en" ? "en-GB" : "pl-PL", {
        dateStyle: "long",
        timeStyle: "short",
      })
    : "";
  const requiredEarlyTierName = (() => {
    if (earlyRank === null || earlyRank <= 0) return null;
    const tiers = tiersQ.data ?? [];
    const match = [...tiers].sort((a, b) => a.rank - b.rank).find((tier) => tier.rank >= earlyRank);
    return match ? tierName(match, lang) : null;
  })();

  return (
    <article className="container mx-auto max-w-3xl px-4 py-12 md:py-16">
      <Link
        to="/events"
        className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t("community.events.backToList")}
      </Link>

      {ev.cover_url && (
        <div className="mb-8 aspect-video overflow-hidden rounded-lg bg-muted">
          <img src={ev.cover_url} alt="" className="h-full w-full object-cover" />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {isProBriefing ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
            <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
            {t("community.events.proBriefing")}
          </span>
        ) : membersOnly ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
            <Lock className="h-3.5 w-3.5" aria-hidden="true" />
            {t("community.events.membersOnly")}
          </span>
        ) : null}
        {isFull && !isPast && (
          <span className="rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive">
            {t("community.events.capacityFull")}
          </span>
        )}
        {!isPast && rsvpBeforeOpen && earlyRank !== null && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            {t("community.events.earlyForMembers")}
          </span>
        )}
      </div>

      <h1 className="mt-3 text-4xl font-bold tracking-tight">{title}</h1>

      <dl className="mt-6 grid gap-4 rounded-lg border border-border bg-card p-5 sm:grid-cols-2">
        <MetaRow icon={<Calendar className="h-4 w-4" />} label={t("community.events.whenLabel")}>
          {startsAt.toLocaleString(lang === "en" ? "en-GB" : "pl-PL", {
            dateStyle: "long",
            timeStyle: "short",
          })}
          {ev.timezone ? ` (${ev.timezone})` : null}
        </MetaRow>
        {ev.location && (
          <MetaRow icon={<MapPin className="h-4 w-4" />} label={t("community.events.location")}>
            {ev.location}
          </MetaRow>
        )}
        {ev.capacity !== null && (
          <MetaRow icon={<Users className="h-4 w-4" />} label={t("community.events.capacityLabel")}>
            {isFull
              ? t("community.events.capacityFull")
              : t("community.events.capacityLeft", { count: seatsLeft ?? 0 })}
            {" · "}
            {t("community.events.goingCount", { count: going })}
            {waitlistCount > 0 && (
              <>
                {" · "}
                {t("community.events.waitlistCount", { count: waitlistCount })}
              </>
            )}
          </MetaRow>
        )}
        {ev.chatham_house && (
          <MetaRow icon={<ShieldQuestion className="h-4 w-4" />} label="">
            {t("community.events.chathamHouse")}
          </MetaRow>
        )}
      </dl>

      {desc && (
        <div className="prose prose-neutral mt-8 max-w-none whitespace-pre-line dark:prose-invert">
          {desc}
        </div>
      )}

      {tierBlocked && (
        <div className="mt-8 rounded-lg border border-primary/40 bg-primary/5 p-5">
          <p className="text-sm font-medium">
            {requiredTierName
              ? t("community.events.tierRequired", { tier: requiredTierName })
              : t("community.events.tierRequiredGeneric")}
          </p>
          <Button asChild className="mt-3" size="sm">
            <Link to="/pricing">{t("community.events.tierUpgradeCta")}</Link>
          </Button>
        </div>
      )}

      <div className="mt-10 flex flex-wrap items-center gap-3">
        {!isPast && access?.can_join && access.join_url && (
          <Button asChild variant="secondary">
            <a href={access.join_url} target="_blank" rel="noreferrer">
              <Video className="mr-2 h-4 w-4" aria-hidden="true" />
              {t("community.events.joinLive")}
            </a>
          </Button>
        )}
        {!isPast && !user && (
          <p className="text-sm text-muted-foreground">{t("community.events.rsvpSignInHint")}</p>
        )}
        {!isPast && user && rsvpLockedByWindow ? (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {requiredEarlyTierName
              ? t("community.events.rsvpEarlyForMembers", {
                  when: whenOpens,
                  tier: requiredEarlyTierName,
                })
              : t("community.events.rsvpNotOpen", { when: whenOpens })}
          </p>
        ) : !isPast && user ? (
          <RsvpControls
            current={rsvpQ.data?.status ?? null}
            pending={rsvpM.isPending}
            isFull={isFull}
            onChoose={(s) => rsvpM.mutate(s)}
          />
        ) : null}
        {!isPast && <AddToCalendar event={ev} lang={lang} />}
      </div>
      {!isPast && user && !rsvpLockedByWindow && rsvpBeforeOpen && hasEarlyAccess && (
        <p className="mt-3 text-sm text-amber-700 dark:text-amber-400" aria-live="polite">
          {t("community.events.rsvpEarlyAccessOpen", { when: whenOpens })}
        </p>
      )}
      {!isPast && user && rsvpQ.data && rsvpQ.data.status !== "cancelled" && (
        <p
          key={rsvpQ.data.status}
          className="mt-3 text-sm text-primary animate-fade-in"
          aria-live="polite"
        >
          {rsvpQ.data.status === "going"
            ? t("community.events.rsvpStatusGoing")
            : rsvpQ.data.status === "waitlist"
              ? typeof waitlistPosQ.data === "number"
                ? t("community.events.waitlistStatus", { position: waitlistPosQ.data })
                : t("community.events.waitlistStatusNoPosition")
              : t("community.events.rsvpStatusInterested")}
        </p>
      )}
      {/* Kolejka rezerwowa nie daje wejściówki - link do transmisji pojawia
          się dopiero po awansie na 'going' (rozstrzyga get_event_access). */}
      {!isPast && isWaitlisted && access?.reason === "waitlisted" && (
        <p className="mt-2 text-sm text-muted-foreground">{t("community.events.joinWaitlisted")}</p>
      )}

      {/* Nagranie po wydarzeniu: benefit warstwy (flaga recordings) - URL
          nie opuszcza bazy bez uprawnienia, tu tylko czytelny upsell. */}
      {isPast && !tierBlocked && access && access.watch_reason !== "none" && (
        <section className="mt-8 rounded-lg border border-border bg-card p-5">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Video className="h-4 w-4" aria-hidden="true" />
            {t("community.events.recordingGateTitle")}
          </h2>
          {access.can_watch && access.recording_url ? (
            <Button asChild variant="secondary" className="mt-3">
              <a href={access.recording_url} target="_blank" rel="noreferrer">
                <Video className="mr-2 h-4 w-4" aria-hidden="true" />
                {t("community.events.watchRecording")}
              </a>
            </Button>
          ) : access.watch_reason === "auth_required" ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {t("community.events.recordingSignInHint")}
            </p>
          ) : (
            <>
              <p className="mt-2 text-sm text-muted-foreground">
                {recordingTierName
                  ? t("community.events.recordingTierRequired", { tier: recordingTierName })
                  : t("community.events.recordingTierRequiredGeneric")}
              </p>
              <Button asChild size="sm" className="mt-3">
                <Link to="/pricing">{t("community.events.tierUpgradeCta")}</Link>
              </Button>
            </>
          )}
        </section>
      )}

      {/* Wydarzenie jako iskra: host/staff zakłada trwały krąg czatu dla
          uczestników 'going' (komponent sam znika dla pozostałych). */}
      <EventGroupButton eventId={ev.id} hostUserId={ev.host_user_id} eventStatus={ev.status} />
    </article>
  );
}

function RsvpControls({
  current,
  pending,
  isFull,
  onChoose,
}: {
  current: RsvpStatus | null;
  pending: boolean;
  isFull: boolean;
  onChoose: (s: RsvpRequestStatus) => void;
}) {
  const { t } = useTranslation();
  const active = current && current !== "cancelled" ? current : null;
  // Przy komplecie przycisk 'going' staje się wejściem do kolejki rezerwowej;
  // klient i tak wysyła 'going' - degradację do 'waitlist' rozstrzyga serwer.
  const waitlistMode = active === "waitlist" || (isFull && active !== "going");
  return (
    <div className="inline-flex flex-wrap items-center gap-2" role="group" aria-label="RSVP">
      <Button
        variant={active === "going" || active === "waitlist" ? "default" : "outline"}
        onClick={() => onChoose("going")}
        disabled={pending}
        aria-pressed={active === "going" || active === "waitlist"}
      >
        {waitlistMode ? (
          <ListPlus className="mr-2 h-4 w-4" aria-hidden="true" />
        ) : (
          <Check className="mr-2 h-4 w-4" aria-hidden="true" />
        )}
        {active === "waitlist"
          ? t("community.events.waitlistBadge")
          : waitlistMode
            ? t("community.events.waitlistJoin")
            : t("community.events.rsvpGoing")}
      </Button>
      <Button
        variant={active === "interested" ? "default" : "outline"}
        onClick={() => onChoose("interested")}
        disabled={pending}
        aria-pressed={active === "interested"}
      >
        <Star className="mr-2 h-4 w-4" aria-hidden="true" />
        {t("community.events.rsvpInterested")}
      </Button>
      {active && (
        <Button
          variant="ghost"
          onClick={() => onChoose("cancelled")}
          disabled={pending}
          aria-label={t("community.events.rsvpCancel")}
        >
          <XCircle className="mr-2 h-4 w-4" aria-hidden="true" />
          {t("community.events.rsvpCancel")}
        </Button>
      )}
    </div>
  );
}

function MetaRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="inline-flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </dt>
      <dd className="mt-1 text-sm text-foreground">{children}</dd>
    </div>
  );
}
