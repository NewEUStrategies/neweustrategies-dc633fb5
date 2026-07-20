// Globalny feed "co się zmieniło": ostatnie wpisy osi czasu ze WSZYSTKICH
// opublikowanych dossier, grupowane po dniach, z plakietką zmiany etapu.
// URL: /tracker/changes. Publiczny odczyt (RLS: tylko opublikowane dossier).
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ExternalLink, Landmark } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RouteErrorFallback } from "@/components/molecules/RouteErrorFallback";
import { useRecentUpdates, type RecentUpdate } from "@/lib/tracker/queries";
import { areaLabel, stageLabel } from "@/lib/tracker/stages";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import { buildContentHead } from "@/lib/seo/meta";
import { ensureI18n as ensureTrackerI18n } from "@/lib/i18n-tracker";
export const Route = createFileRoute("/tracker/changes")({
  head: () => {
    const url = getRequestUrl() || "/tracker/changes";
    const lang = activeLang(url);
    return buildContentHead({
      url,
      lang,
      type: "website",
      title:
        lang === "en"
          ? "What changed - EU legislative tracker"
          : "Co się zmieniło - tracker legislacyjny UE",
      description:
        lang === "en"
          ? "The latest updates across all tracked EU legislative files."
          : "Najnowsze aktualizacje wszystkich śledzonych dossier legislacyjnych UE.",
    });
  },
  component: TrackerChangesPage,
  errorComponent: (props) => <RouteErrorFallback {...props} title="Tracker" />,
});

type Lang = "pl" | "en";

/** Grupuje wpisy po dacie zdarzenia (happened_on, ISO yyyy-mm-dd). */
function groupByDay(items: RecentUpdate[]): { day: string; items: RecentUpdate[] }[] {
  const map = new Map<string, RecentUpdate[]>();
  for (const it of items) {
    const list = map.get(it.happened_on) ?? [];
    list.push(it);
    map.set(it.happened_on, list);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([day, list]) => ({ day, items: list }));
}

function dayLabel(iso: string, lang: Lang, t: (k: string) => string): string {
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const yesterday = new Date(today.getTime() - 86_400_000).toISOString().slice(0, 10);
  if (iso === todayIso) return t("tracker.changes.today");
  if (iso === yesterday) return t("tracker.changes.yesterday");
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(lang === "pl" ? "pl-PL" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

const PAGE = 40;

function TrackerChangesPage() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureTrackerI18n();
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === "en" ? "en" : "pl";
  const [limit, setLimit] = useState(PAGE);
  const updatesQ = useRecentUpdates(limit);

  const groups = useMemo(() => groupByDay(updatesQ.data ?? []), [updatesQ.data]);
  const canLoadMore = (updatesQ.data?.length ?? 0) >= limit;

  return (
    <div className="container mx-auto max-w-3xl px-4 py-10">
      <Link
        to="/tracker"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t("tracker.backToIndex")}
      </Link>

      <h1 className="flex items-start gap-2 text-2xl font-bold md:text-3xl">
        <Landmark className="mt-1 h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
        {t("tracker.changes.title")}
      </h1>
      <p className="mt-3 text-muted-foreground">{t("tracker.changes.intro")}</p>

      {updatesQ.isLoading ? (
        <p className="mt-8 text-sm text-muted-foreground">{t("tracker.loading")}</p>
      ) : groups.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">{t("tracker.changes.empty")}</p>
      ) : (
        <div className="mt-8 space-y-8">
          {groups.map((group) => (
            <section key={group.day}>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {dayLabel(group.day, lang, t)}
              </h2>
              <ol className="mt-3 space-y-3 border-l border-border/70 pl-5">
                {group.items.map((u) => {
                  const note = lang === "en" ? u.note_en || u.note_pl : u.note_pl || u.note_en;
                  const itemTitle =
                    lang === "en"
                      ? u.item_title_en || u.item_title_pl
                      : u.item_title_pl || u.item_title_en;
                  return (
                    <li key={u.id} className="relative">
                      <span
                        className="absolute -left-[23px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary"
                        aria-hidden="true"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary" className="text-xs">
                          {areaLabel(u.policy_area, lang)}
                        </Badge>
                        {u.stage_to && (
                          <Badge variant="outline" className="text-xs">
                            {u.stage_from
                              ? t("tracker.stageChange", {
                                  from: stageLabel(u.stage_from, lang),
                                  to: stageLabel(u.stage_to, lang),
                                })
                              : t("tracker.stageSet", { to: stageLabel(u.stage_to, lang) })}
                          </Badge>
                        )}
                      </div>
                      <Link
                        to="/tracker/$slug"
                        params={{ slug: u.item_slug }}
                        className="mt-1 block font-medium hover:text-primary"
                      >
                        {itemTitle}
                      </Link>
                      <p className="mt-0.5 text-sm text-muted-foreground">{note}</p>
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
            </section>
          ))}
          {canLoadMore && (
            <div className="pt-2 text-center">
              <Button variant="outline" onClick={() => setLimit((n) => n + PAGE)}>
                {t("tracker.changes.loadMore")}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
