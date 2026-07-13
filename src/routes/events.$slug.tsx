// Szczegóły wydarzenia + RSVP. URL: /events/$slug
// RSVP jest trój-stanowe (going / interested / cancelled); ponowne kliknięcie
// aktywnego statusu cofa do 'cancelled'. Zapis idzie WYŁĄCZNIE przez RPC
// rsvp_event (limit miejsc pod FOR UPDATE, bramka warstwy/pro_briefings,
// jeden wiersz na użytkownika przez ON CONFLICT), a linki transmisji/nagrania
// przez get_event_access - join_url/recording_url są odcięte od klienta
// grantem kolumnowym.
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
  Lock,
  Star,
  XCircle,
  BadgeCheck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchEventAccess,
  fetchEventRsvpCounts,
  fetchPublicEventBySlug,
  rsvpEvent,
} from "@/lib/community/publicQueries";
import { useCommunityModules } from "@/lib/community/useCommunityModules";
import { useMembershipTiers, tierName } from "@/lib/billing/tiers";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { CommunityDisabled } from "@/components/community/CommunityDisabled";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";
import { buildContentHead } from "@/lib/seo/meta";
import "@/lib/i18n-community";

type RsvpStatus = "going" | "interested" | "cancelled";

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

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["event-rsvp", eventId, user?.id] });
    void qc.invalidateQueries({ queryKey: ["event-access", eventId, user?.id ?? "anon"] });
    void qc.invalidateQueries({ queryKey: ["event-rsvp-counts", eventId] });
  };

  const rsvpM = useMutation({
    mutationFn: (target: RsvpStatus) => {
      // Ponowne kliknięcie aktywnego statusu = cofnięcie (poza 'cancelled');
      // RPC robi upsert po (event_id, user_id), więc wiersz jest zawsze jeden.
      const nextStatus: RsvpStatus =
        rsvpQ.data?.status === target && target !== "cancelled" ? "cancelled" : target;
      return rsvpEvent(eventId!, nextStatus).then((res) => res.status as RsvpStatus);
    },
    onSuccess: (nextStatus) => {
      invalidate();
      const key =
        nextStatus === "going"
          ? "community.events.toastGoing"
          : nextStatus === "interested"
            ? "community.events.toastInterested"
            : "community.events.toastCancelled";
      toast.success(t(key));
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("events: full")) toast.error(t("community.events.rsvpFull"));
      else if (msg.includes("events: membership required"))
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
  const seatsLeft = ev.capacity !== null ? Math.max(0, ev.capacity - going) : null;
  const isFull = seatsLeft !== null && seatsLeft === 0;
  const currentStatus: RsvpStatus | null = rsvpQ.data?.status ?? null;
  const isGoing = currentStatus === "going";
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
        {isPast && access?.can_watch && access.recording_url && (
          <Button asChild variant="secondary">
            <a href={access.recording_url} target="_blank" rel="noreferrer">
              <Video className="mr-2 h-4 w-4" aria-hidden="true" />
              {t("community.events.watchRecording")}
            </a>
          </Button>
        )}
        {isPast && access?.reason === "tier_required" && (
          <p className="text-sm text-muted-foreground">{t("community.events.recordingTierHint")}</p>
        )}
        {!isPast && !user && (
          <p className="text-sm text-muted-foreground">{t("community.events.rsvpSignInHint")}</p>
        )}
        {!isPast && user && !tierBlocked && (
          <RsvpControls
            current={currentStatus}
            pending={rsvpM.isPending}
            goingDisabled={!isGoing && isFull}
            onChoose={(s) => rsvpM.mutate(s)}
          />
        )}
      </div>
      {!isPast && user && currentStatus && currentStatus !== "cancelled" && (
        <p
          key={currentStatus}
          className="mt-3 text-sm text-primary animate-fade-in"
          aria-live="polite"
        >
          {currentStatus === "going"
            ? t("community.events.rsvpStatusGoing")
            : t("community.events.rsvpStatusInterested")}
        </p>
      )}
      {!isPast && user && !tierBlocked && !isGoing && access?.reason === "rsvp_required" && (
        <p className="mt-2 text-sm text-muted-foreground">{t("community.events.joinAfterRsvp")}</p>
      )}
    </article>
  );
}

function RsvpControls({
  current,
  pending,
  goingDisabled,
  onChoose,
}: {
  current: RsvpStatus | null;
  pending: boolean;
  /** Komplet miejsc: 'going' zablokowane, dopóki ktoś nie zwolni miejsca. */
  goingDisabled: boolean;
  onChoose: (s: RsvpStatus) => void;
}) {
  const { t } = useTranslation();
  const active = current && current !== "cancelled" ? current : null;
  return (
    <div className="inline-flex flex-wrap items-center gap-2" role="group" aria-label="RSVP">
      <Button
        variant={active === "going" ? "default" : "outline"}
        onClick={() => onChoose("going")}
        disabled={pending || (goingDisabled && active !== "going")}
        aria-pressed={active === "going"}
      >
        <Check className="mr-2 h-4 w-4" aria-hidden="true" />
        {t("community.events.rsvpGoing")}
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
