// Detal dossier legislacyjnego: pasek postępu procedury, obserwowanie
// z alertami oraz oś czasu aktualizacji. Publiczny odczyt (RLS: published).
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeft, Bell, BellOff, ExternalLink, Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RouteErrorFallback } from "@/components/molecules/RouteErrorFallback";
import { useAuth } from "@/hooks/useAuth";
import {
  useItemBySlug,
  useItemUpdates,
  useMyFollows,
  useToggleFollowItem,
} from "@/lib/tracker/queries";
import { POLICY_STAGES, areaLabel, isTerminal, stageIndex, stageLabel } from "@/lib/tracker/stages";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import { buildContentHead } from "@/lib/seo/meta";
import "@/lib/i18n-tracker";

export const Route = createFileRoute("/tracker/$slug")({
  component: TrackerDetail,
  errorComponent: (props) => (
    <RouteErrorFallback {...props} title="Nie udało się załadować dossier" />
  ),
});

type Lang = "pl" | "en";

function formatDate(iso: string | null, lang: Lang): string | null {
  if (!iso) return null;
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(lang === "pl" ? "pl-PL" : "en-GB", {
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
      <div className="flex items-center gap-1" aria-label={t("tracker.progressLabel")}>
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
  const { slug } = Route.useParams();
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === "en" ? "en" : "pl";
  const { user, tenantId } = useAuth();

  const itemQ = useItemBySlug(slug);
  const item = itemQ.data;
  const updatesQ = useItemUpdates(item?.id);
  const myFollows = useMyFollows(user?.id);
  const toggleFollow = useToggleFollowItem();

  if (itemQ.isLoading) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-12 text-sm">{t("tracker.loading")}</div>
    );
  }
  if (!item) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-12 text-center">
        <p className="text-sm text-muted-foreground">{t("tracker.notFound")}</p>
        <Button asChild variant="outline" size="sm" className="mt-4">
          <Link to="/tracker">{t("tracker.backToIndex")}</Link>
        </Button>
      </div>
    );
  }

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
                — {formatDate(item.next_milestone_at, lang)}
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
        <span className="text-xs text-muted-foreground">{t("tracker.followHint")}</span>
      </div>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">{t("tracker.timeline")}</h2>
        {(updatesQ.data?.length ?? 0) === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t("tracker.timelineEmpty")}</p>
        ) : (
          <ol className="mt-4 space-y-4 border-l border-border/70 pl-5">
            {updatesQ.data!.map((u) => {
              const note = lang === "en" ? u.note_en || u.note_pl : u.note_pl || u.note_en;
              return (
                <li key={u.id} className="relative">
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
