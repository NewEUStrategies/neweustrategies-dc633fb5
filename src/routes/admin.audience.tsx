// /admin/audience - dashboard audytorium: lejek członka, dzienna aktywność
// i retencja kohortowa. Do tej pory platforma miała growth analytics
// (newsletter/reklamy/popupy) i RUM, ale ZERO widoku retencji/lejka -
// dane leżały nieużyte. Zasilanie: RPC admin_member_funnel /
// admin_member_activity_series / admin_member_retention (SECURITY DEFINER,
// guard admina tenanta w funkcji - patrz migracja 20260713190000).
import { createFileRoute } from "@tanstack/react-router";
import { uiLang, uiLocale } from "@/lib/i18n/format";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ensureI18n as ensureAdminAudienceI18n } from "@/lib/i18n-admin-audience";
import {
  BadgeCheck,
  CreditCard,
  Eye,
  MessageCircle,
  MessagesSquare,
  Newspaper,
  UserPlus,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Chart } from "@/components/charts/Chart";
import type { ChartConfig } from "@/lib/charts/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/audience")({
  component: AudienceDashboard,
});

interface FunnelRow {
  members_total: number;
  members_new: number;
  discoverable_total: number;
  discoverable_new: number;
  active_members: number;
  readers: number;
  commenters: number;
  chat_senders: number;
  newsletter_subscribed: number;
  paying_members: number;
}

interface SeriesRow {
  day: string;
  active_members: number;
  new_members: number;
}

interface RetentionRow {
  cohort_start: string;
  cohort_size: number;
  week_offset: number;
  active_members: number;
}

const WINDOWS = [7, 30, 90] as const;

function AudienceDashboard() {
  // Rejestracja słownika w chunku KOMPONENTU trasy (nie w entry) - patrz
  // komentarz przy ensureI18n w lib/i18n-admin-audience.ts.
  ensureAdminAudienceI18n();
  const { t, i18n } = useTranslation();
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(30);

  const funnelQ = useQuery({
    queryKey: ["admin", "audience", "funnel", days],
    queryFn: async (): Promise<FunnelRow | null> => {
      const { data, error } = await supabase.rpc("admin_member_funnel", {
        p_days: days,
      });
      if (error) throw error;
      return ((data as unknown as FunnelRow[]) ?? [])[0] ?? null;
    },
  });

  const seriesQ = useQuery({
    queryKey: ["admin", "audience", "series", days],
    queryFn: async (): Promise<SeriesRow[]> => {
      const { data, error } = await supabase.rpc("admin_member_activity_series", {
        p_days: days,
      });
      if (error) throw error;
      return (data as unknown as SeriesRow[]) ?? [];
    },
  });

  const retentionQ = useQuery({
    queryKey: ["admin", "audience", "retention"],
    queryFn: async (): Promise<RetentionRow[]> => {
      const { data, error } = await supabase.rpc("admin_member_retention", {
        p_weeks: 8,
      });
      if (error) throw error;
      return (data as unknown as RetentionRow[]) ?? [];
    },
  });

  const f = funnelQ.data;
  const series = seriesQ.data ?? [];

  const activityChart: ChartConfig = {
    kind: "line",
    title: t("adminAudience.activity.title"),
    description: t("adminAudience.activity.chartDescription"),
    categories: series.map((r) =>
      new Date(r.day).toLocaleDateString(uiLocale(i18n.language), {
        day: "numeric",
        month: "short",
      }),
    ),
    series: [
      {
        name: t("adminAudience.activity.active"),
        values: series.map((r) => r.active_members),
        colorSlot: 1,
      },
      {
        name: t("adminAudience.funnel.newMembers"),
        values: series.map((r) => r.new_members),
        colorSlot: 2,
      },
    ],
    stacked: false,
    unit: "",
    height: 260,
    showLegend: true,
    showGrid: true,
    showValues: false,
    animate: false,
    source: "",
  };

  const funnelSteps = f
    ? [
        {
          icon: Users,
          label: t("adminAudience.funnel.membersTotal"),
          value: f.members_total,
          sub: t("adminAudience.funnel.newInWindow", { count: f.members_new }),
        },
        {
          icon: Eye,
          label: t("adminAudience.funnel.discoverable"),
          value: f.discoverable_total,
          sub: t("adminAudience.funnel.newInWindow", { count: f.discoverable_new }),
        },
        {
          icon: BadgeCheck,
          label: t("adminAudience.funnel.activeInWindow"),
          value: f.active_members,
          sub: t("adminAudience.funnel.anyActivity"),
        },
        {
          icon: CreditCard,
          label: t("adminAudience.funnel.paying"),
          value: f.paying_members,
          sub: t("adminAudience.funnel.activeSubscriptions"),
        },
      ]
    : [];

  const sideStats = f
    ? [
        { icon: Newspaper, label: t("adminAudience.activity.readers"), value: f.readers },
        { icon: MessageCircle, label: t("adminAudience.activity.commenters"), value: f.commenters },
        {
          icon: MessagesSquare,
          label: t("adminAudience.activity.chatSenders"),
          value: f.chat_senders,
        },
        {
          icon: UserPlus,
          label: t("adminAudience.funnel.newsletter"),
          value: f.newsletter_subscribed,
        },
      ]
    : [];

  const maxFunnel = Math.max(1, ...funnelSteps.map((s) => s.value));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">{t("adminAudience.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("adminAudience.subtitle")}</p>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-border p-1">
          {WINDOWS.map((w) => (
            <Button
              key={w}
              size="sm"
              variant={days === w ? "default" : "ghost"}
              className="h-7 px-3 text-xs"
              onClick={() => setDays(w)}
            >
              {w} {t("adminAudience.days")}
            </Button>
          ))}
        </div>
      </div>

      {funnelQ.isError ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
          {t("adminAudience.funnel.error")}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <section className="lg:col-span-2 rounded-xl border border-border bg-card p-5">
            <h2 className="m-0 mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {t("adminAudience.funnel.title")}
            </h2>
            <div className="space-y-3">
              {(funnelQ.isLoading ? Array.from({ length: 4 }) : funnelSteps).map((step, i) => {
                if (!step) {
                  return <div key={i} className="h-12 animate-pulse rounded-md bg-muted/60" />;
                }
                const s = step as (typeof funnelSteps)[number];
                const pct = Math.max(2, Math.round((s.value / maxFunnel) * 100));
                const Icon = s.icon;
                return (
                  <div key={s.label}>
                    <div className="mb-1 flex items-baseline justify-between text-sm">
                      <span className="inline-flex items-center gap-1.5">
                        <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                        {s.label}
                      </span>
                      <span className="tabular-nums font-semibold">
                        {s.value}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {s.sub}
                        </span>
                      </span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-[var(--chart-1,#2563eb)]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="m-0 mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {t("adminAudience.activity.inWindow")}
            </h2>
            <dl className="m-0 space-y-3">
              {(funnelQ.isLoading ? Array.from({ length: 4 }) : sideStats).map((stat, i) => {
                if (!stat) {
                  return <div key={i} className="h-9 animate-pulse rounded-md bg-muted/60" />;
                }
                const s = stat as (typeof sideStats)[number];
                const Icon = s.icon;
                return (
                  <div key={s.label} className="flex items-center justify-between text-sm">
                    <dt className="inline-flex items-center gap-1.5 text-muted-foreground">
                      <Icon className="h-3.5 w-3.5" aria-hidden />
                      {s.label}
                    </dt>
                    <dd className="m-0 tabular-nums font-semibold">{s.value}</dd>
                  </div>
                );
              })}
            </dl>
          </section>
        </div>
      )}

      <section className="rounded-xl border border-border bg-card p-5">
        {seriesQ.isLoading ? (
          <div className="h-[300px] animate-pulse rounded-md bg-muted/60" />
        ) : series.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">{t("adminAudience.activity.empty")}</p>
        ) : (
          <Chart config={activityChart} lang={uiLang(i18n.language)} />
        )}
      </section>

      <RetentionTable rows={retentionQ.data ?? []} loading={retentionQ.isLoading} />
    </div>
  );
}

// Kohorty: wiersz = tydzień rejestracji, kolumny = aktywność w tygodniu N po
// rejestracji (procent kohorty; intensywność tła rośnie z retencją).
function RetentionTable({ rows, loading }: { rows: RetentionRow[]; loading: boolean }) {
  const { t, i18n } = useTranslation();
  const cohorts = new Map<string, { size: number; weeks: Map<number, number> }>();
  for (const r of rows) {
    const c = cohorts.get(r.cohort_start) ?? { size: r.cohort_size, weeks: new Map() };
    c.size = r.cohort_size;
    c.weeks.set(r.week_offset, r.active_members);
    cohorts.set(r.cohort_start, c);
  }
  const maxOffset = rows.reduce((m, r) => Math.max(m, r.week_offset), 0);
  const cohortKeys = Array.from(cohorts.keys()).sort((a, b) => (a < b ? 1 : -1));

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="m-0 mb-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {t("adminAudience.retention.title")}
      </h2>
      <p className="mt-0 mb-4 text-xs text-muted-foreground">
        {t("adminAudience.retention.description")}
      </p>
      {loading ? (
        <div className="h-40 animate-pulse rounded-md bg-muted/60" />
      ) : cohortKeys.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">{t("adminAudience.retention.empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1.5 pr-3 font-medium">{t("adminAudience.retention.cohort")}</th>
                <th className="py-1.5 pr-3 text-right font-medium">
                  {t("adminAudience.retention.size")}
                </th>
                {Array.from({ length: maxOffset + 1 }).map((_, w) => (
                  <th key={w} className="px-1.5 py-1.5 text-center font-medium">
                    T{w}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cohortKeys.map((key) => {
                const c = cohorts.get(key)!;
                return (
                  <tr key={key} className="border-t border-border/60">
                    <td className="py-1.5 pr-3 whitespace-nowrap">
                      {new Date(key).toLocaleDateString(uiLocale(i18n.language), {
                        day: "numeric",
                        month: "short",
                      })}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{c.size}</td>
                    {Array.from({ length: maxOffset + 1 }).map((_, w) => {
                      const active = c.weeks.get(w);
                      if (active === undefined || c.size === 0) {
                        return (
                          <td key={w} className="px-1.5 py-1.5 text-center">
                            ·
                          </td>
                        );
                      }
                      const pct = Math.round((active / c.size) * 100);
                      return (
                        <td key={w} className="px-1 py-1 text-center">
                          <span
                            className={cn(
                              "inline-block min-w-10 rounded px-1.5 py-1 tabular-nums",
                              pct >= 60
                                ? "bg-emerald-500/30"
                                : pct >= 30
                                  ? "bg-emerald-500/15"
                                  : pct > 0
                                    ? "bg-muted"
                                    : "bg-transparent text-muted-foreground",
                            )}
                            title={`${active}/${c.size}`}
                          >
                            {pct}%
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
