// /admin/audience - dashboard audytorium: lejek członka, dzienna aktywność
// i retencja kohortowa. Do tej pory platforma miała growth analytics
// (newsletter/reklamy/popupy) i RUM, ale ZERO widoku retencji/lejka -
// dane leżały nieużyte. Zasilanie: RPC admin_member_funnel /
// admin_member_activity_series / admin_member_retention (SECURITY DEFINER,
// guard admina tenanta w funkcji - patrz migracja 20260713190000).
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { i18n } = useTranslation();
  const isPl = (i18n.language ?? "pl").startsWith("pl");
  const L = (pl: string, en: string) => (isPl ? pl : en);
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(30);

  const funnelQ = useQuery({
    queryKey: ["admin", "audience", "funnel", days],
    queryFn: async (): Promise<FunnelRow | null> => {
      const { data, error } = await supabase.rpc(
        "admin_member_funnel" as never,
        {
          p_days: days,
        } as never,
      );
      if (error) throw error;
      return ((data as unknown as FunnelRow[]) ?? [])[0] ?? null;
    },
  });

  const seriesQ = useQuery({
    queryKey: ["admin", "audience", "series", days],
    queryFn: async (): Promise<SeriesRow[]> => {
      const { data, error } = await supabase.rpc(
        "admin_member_activity_series" as never,
        {
          p_days: days,
        } as never,
      );
      if (error) throw error;
      return (data as unknown as SeriesRow[]) ?? [];
    },
  });

  const retentionQ = useQuery({
    queryKey: ["admin", "audience", "retention"],
    queryFn: async (): Promise<RetentionRow[]> => {
      const { data, error } = await supabase.rpc(
        "admin_member_retention" as never,
        {
          p_weeks: 8,
        } as never,
      );
      if (error) throw error;
      return (data as unknown as RetentionRow[]) ?? [];
    },
  });

  const f = funnelQ.data;
  const series = seriesQ.data ?? [];

  const activityChart: ChartConfig = {
    kind: "line",
    title: L("Aktywność członków", "Member activity"),
    description: L(
      "Dziennie aktywni członkowie (odczyty, komentarze, czat, zakładki, obserwacje) i nowe rejestracje.",
      "Daily active members (reads, comments, chat, bookmarks, follows) and new sign-ups.",
    ),
    categories: series.map((r) =>
      new Date(r.day).toLocaleDateString(isPl ? "pl-PL" : "en-US", {
        day: "numeric",
        month: "short",
      }),
    ),
    series: [
      {
        name: L("Aktywni", "Active"),
        values: series.map((r) => r.active_members),
        colorSlot: 1,
      },
      {
        name: L("Nowi członkowie", "New members"),
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
          label: L("Członkowie łącznie", "Members total"),
          value: f.members_total,
          sub: L(`+${f.members_new} w oknie`, `+${f.members_new} in window`),
        },
        {
          icon: Eye,
          label: L("Widoczni w katalogu (opt-in)", "Discoverable (opt-in)"),
          value: f.discoverable_total,
          sub: L(`+${f.discoverable_new} w oknie`, `+${f.discoverable_new} in window`),
        },
        {
          icon: BadgeCheck,
          label: L("Aktywni w oknie", "Active in window"),
          value: f.active_members,
          sub: L("dowolna aktywność", "any activity"),
        },
        {
          icon: CreditCard,
          label: L("Płacący", "Paying"),
          value: f.paying_members,
          sub: L("aktywne subskrypcje", "active subscriptions"),
        },
      ]
    : [];

  const sideStats = f
    ? [
        { icon: Newspaper, label: L("Czytający", "Readers"), value: f.readers },
        { icon: MessageCircle, label: L("Komentujący", "Commenters"), value: f.commenters },
        {
          icon: MessagesSquare,
          label: L("Piszący na czacie", "Chat senders"),
          value: f.chat_senders,
        },
        {
          icon: UserPlus,
          label: L("Subskrybenci newslettera", "Newsletter subscribers"),
          value: f.newsletter_subscribed,
        },
      ]
    : [];

  const maxFunnel = Math.max(1, ...funnelSteps.map((s) => s.value));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">
            {L("Audytorium i retencja", "Audience & retention")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {L(
              "Lejek członka, dzienna aktywność i kohorty retencji.",
              "Member funnel, daily activity and retention cohorts.",
            )}
          </p>
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
              {w} {L("dni", "days")}
            </Button>
          ))}
        </div>
      </div>

      {funnelQ.isError ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
          {L("Nie udało się pobrać danych lejka.", "Failed to load funnel data.")}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <section className="lg:col-span-2 rounded-xl border border-border bg-card p-5">
            <h2 className="m-0 mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {L("Lejek członka", "Member funnel")}
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
              {L("Aktywność w oknie", "Activity in window")}
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
          <p className="m-0 text-sm text-muted-foreground">
            {L("Brak danych aktywności w tym oknie.", "No activity data in this window.")}
          </p>
        ) : (
          <Chart config={activityChart} lang={isPl ? "pl" : "en"} />
        )}
      </section>

      <RetentionTable rows={retentionQ.data ?? []} loading={retentionQ.isLoading} isPl={isPl} />
    </div>
  );
}

// Kohorty: wiersz = tydzień rejestracji, kolumny = aktywność w tygodniu N po
// rejestracji (procent kohorty; intensywność tła rośnie z retencją).
function RetentionTable({
  rows,
  loading,
  isPl,
}: {
  rows: RetentionRow[];
  loading: boolean;
  isPl: boolean;
}) {
  const L = (pl: string, en: string) => (isPl ? pl : en);
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
        {L("Retencja kohortowa (tygodnie)", "Cohort retention (weeks)")}
      </h2>
      <p className="mt-0 mb-4 text-xs text-muted-foreground">
        {L(
          "Odsetek członków z danego tygodnia rejestracji aktywnych w kolejnych tygodniach.",
          "Share of members from each sign-up week active in subsequent weeks.",
        )}
      </p>
      {loading ? (
        <div className="h-40 animate-pulse rounded-md bg-muted/60" />
      ) : cohortKeys.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">
          {L("Brak rejestracji w analizowanym okresie.", "No sign-ups in the analysed period.")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1.5 pr-3 font-medium">{L("Kohorta", "Cohort")}</th>
                <th className="py-1.5 pr-3 text-right font-medium">{L("Osoby", "Size")}</th>
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
                      {new Date(key).toLocaleDateString(isPl ? "pl-PL" : "en-US", {
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
