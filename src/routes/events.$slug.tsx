// Szczegóły wydarzenia + RSVP. URL: /events/$slug
// RSVP jest trój-stanowe (going / interested / cancelled). Ponowne kliknięcie
// tego samego statusu = cofnięcie do 'cancelled'. Zmiana statusu robi UPDATE
// istniejącego wiersza (unique index event_id+user_id), więc jeden użytkownik
// zawsze ma dokładnie jeden RSVP na wydarzenie.
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Calendar, MapPin, Users, ShieldQuestion, Video, ArrowLeft, Check, Star, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchPublicEventBySlug } from "@/lib/community/publicQueries";
import { useCommunityModules } from "@/lib/community/useCommunityModules";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { CommunityDisabled } from "@/components/community/CommunityDisabled";
import { getPublicTenantId } from "@/lib/community/tenant";
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
      title: lang === "en" ? "Event - New European Strategies" : "Wydarzenie - New European Strategies",
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

  const rsvpQ = useQuery({
    queryKey: ["event-rsvp", eventQ.data?.id, user?.id],
    queryFn: async () => {
      if (!eventQ.data || !user) return null;
      const { data } = await supabase
        .from("event_rsvps")
        .select("id, status")
        .eq("event_id", eventQ.data.id)
        .eq("user_id", user.id)
        .maybeSingle();
      return data as { id: string; status: RsvpStatus } | null;
    },
    enabled: !!eventQ.data && !!user,
  });

  const rsvpM = useMutation({
    mutationFn: async (target: RsvpStatus) => {
      if (!eventQ.data || !user) throw new Error("no user");
      // Ponowne kliknięcie tego samego statusu = cancel (poza samym 'cancelled').
      const nextStatus: RsvpStatus =
        rsvpQ.data?.status === target && target !== "cancelled" ? "cancelled" : target;
      if (rsvpQ.data) {
        const { error } = await supabase
          .from("event_rsvps")
          .update({ status: nextStatus, updated_at: new Date().toISOString() })
          .eq("id", rsvpQ.data.id);
        if (error) throw error;
      } else {
        const tenant_id = await getPublicTenantId();
        const { error } = await supabase.from("event_rsvps").insert({
          event_id: eventQ.data.id,
          user_id: user.id,
          tenant_id,
          status: nextStatus,
        });
        if (error) throw error;
      }
      return nextStatus;
    },
    onSuccess: (nextStatus) => {
      qc.invalidateQueries({ queryKey: ["event-rsvp", eventQ.data?.id, user?.id] });
      const key =
        nextStatus === "going"
          ? "community.events.toastGoing"
          : nextStatus === "interested"
            ? "community.events.toastInterested"
            : "community.events.toastCancelled";
      toast.success(t(key));
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Error"),
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

      <h1 className="text-4xl font-bold tracking-tight">{title}</h1>

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
          <MetaRow icon={<Users className="h-4 w-4" />} label={t("community.events.hostedBy")}>
            {ev.capacity}
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

      <div className="mt-10 flex flex-wrap items-center gap-3">
        {!isPast && ev.join_url && (
          <Button asChild variant="secondary">
            <a href={ev.join_url} target="_blank" rel="noreferrer">
              <Video className="mr-2 h-4 w-4" aria-hidden="true" />
              {t("community.events.joinLive")}
            </a>
          </Button>
        )}
        {isPast && ev.recording_url && (
          <Button asChild variant="secondary">
            <a href={ev.recording_url} target="_blank" rel="noreferrer">
              <Video className="mr-2 h-4 w-4" aria-hidden="true" />
              {t("community.events.watchRecording")}
            </a>
          </Button>
        )}
        {!isPast && !user && (
          <p className="text-sm text-muted-foreground">{t("community.events.rsvpSignInHint")}</p>
        )}
        {!isPast && user && (
          <RsvpControls
            current={rsvpQ.data?.status ?? null}
            pending={rsvpM.isPending}
            onChoose={(s) => rsvpM.mutate(s)}
          />
        )}
      </div>
      {!isPast && user && rsvpQ.data && rsvpQ.data.status !== "cancelled" && (
        <p
          key={rsvpQ.data.status}
          className="mt-3 text-sm text-primary animate-fade-in"
          aria-live="polite"
        >
          {rsvpQ.data.status === "going"
            ? t("community.events.rsvpStatusGoing")
            : t("community.events.rsvpStatusInterested")}
        </p>
      )}
    </article>
  );
}

function RsvpControls({
  current,
  pending,
  onChoose,
}: {
  current: RsvpStatus | null;
  pending: boolean;
  onChoose: (s: RsvpStatus) => void;
}) {
  const { t } = useTranslation();
  const active = current && current !== "cancelled" ? current : null;
  return (
    <div className="inline-flex flex-wrap items-center gap-2" role="group" aria-label="RSVP">
      <Button
        variant={active === "going" ? "default" : "outline"}
        onClick={() => onChoose("going")}
        disabled={pending}
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
      </div>
    </article>
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
