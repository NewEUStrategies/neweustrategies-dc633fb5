// Widget CMS builder: publiczne statystyki darowizn + CTA na /support.
// Dane pobiera server fn `getDonationsPublicStats` (service role, tylko sumy;
// nigdy nie ujawnia donor_email/message). Synchronizacja z /admin/donations
// jest domenowa - obie ścieżki czytają tę samą tabelę public.donations,
// filtr status='paid' + tenant. Warianty wizualne: hero / progress /
// stats-strip / compact-card / inline-bar / thermometer.
import { useMemo, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { HandHeart, Heart, Target, TrendingUp, Users } from "@/lib/lucide-shim";
import { AppLink } from "@/components/atoms/AppLink";
import { getDonationsPublicStats } from "@/lib/billing/donations.functions";
import "@/lib/i18n-donations-widget";

export type DonationsVariant =
  | "hero"
  | "progress"
  | "stats-strip"
  | "compact-card"
  | "inline-bar"
  | "thermometer";

export interface DonationsWidgetProps {
  variant?: DonationsVariant;
  title?: string;
  subtitle?: string;
  cta?: string;
  href?: string;
  goalCents?: number;
  currency?: string;
  showMonth?: boolean;
  showCount?: boolean;
  showRecent?: boolean;
  accent?: string;
  lang?: "pl" | "en";
}

interface StatsShape {
  totalCents: number;
  monthCents: number;
  count: number;
  monthCount: number;
  currency: string;
  recent: { amount_cents: number; currency: string; created_at: string }[];
}

const FALLBACK: StatsShape = {
  totalCents: 0,
  monthCents: 0,
  count: 0,
  monthCount: 0,
  currency: "PLN",
  recent: [],
};

function fmtMoney(cents: number, currency: string, lang: "pl" | "en"): string {
  try {
    return new Intl.NumberFormat(lang === "pl" ? "pl-PL" : "en-GB", {
      style: "currency",
      currency,
      maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(0)} ${currency}`;
  }
}

function fmtRelative(iso: string, lang: "pl" | "en"): string {
  const then = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - then);
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (mins < 60) return lang === "pl" ? `${mins} min temu` : `${mins} min ago`;
  if (hours < 24) return lang === "pl" ? `${hours} godz. temu` : `${hours}h ago`;
  return lang === "pl" ? `${days} dni temu` : `${days}d ago`;
}

export function DonationsWidgetView(props: DonationsWidgetProps) {
  const { t, i18n } = useTranslation();
  const lang: "pl" | "en" = props.lang ?? (i18n.language === "en" ? "en" : "pl");
  const variant: DonationsVariant = props.variant ?? "hero";
  const href = props.href?.trim() || "/support";
  const cta = props.cta?.trim() || t("donationsWidget.cta", "Wesprzyj");
  const title =
    props.title?.trim() || (lang === "pl" ? "Mecenat obywatelski" : "Citizen patronage");
  const subtitle = props.subtitle?.trim() ?? "";
  const goalCents = Math.max(0, Number(props.goalCents ?? 0) || 0);
  const showMonth = props.showMonth !== false;
  const showCount = props.showCount !== false;
  const showRecent = props.showRecent === true;
  const accent = props.accent?.trim() || "";

  const fetchStats = useServerFn(getDonationsPublicStats);
  const statsQ = useQuery({
    queryKey: ["donations", "public-stats"],
    queryFn: () => fetchStats(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const stats: StatsShape = statsQ.data ?? FALLBACK;
  const currency = props.currency?.trim() || stats.currency || "PLN";

  const money = (cents: number) => fmtMoney(cents, currency, lang);
  const progressPct = useMemo(() => {
    if (goalCents <= 0) return 0;
    return Math.min(100, Math.round((stats.totalCents / goalCents) * 100));
  }, [goalCents, stats.totalCents]);

  const accentStyle: CSSProperties = accent
    ? ({ ["--donation-accent" as never]: accent } as CSSProperties)
    : {};

  // -----------------------------------------------------------------------
  // Warianty
  // -----------------------------------------------------------------------
  if (variant === "inline-bar") {
    return (
      <div
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-card px-4 py-3 shadow-sm"
        style={accentStyle}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-primary"
            style={{
              background: accent
                ? `color-mix(in oklab, ${accent} 15%, transparent)`
                : "color-mix(in oklab, hsl(var(--primary)) 12%, transparent)",
              color: accent || undefined,
            }}
          >
            <HandHeart className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{title}</div>
            <div className="truncate text-xs text-muted-foreground tabular-nums">
              {t("donationsWidget.total")}: <strong>{money(stats.totalCents)}</strong>
              {showCount && stats.count > 0 && (
                <>
                  {" · "}
                  {stats.count} {t("donationsWidget.donors").toLowerCase()}
                </>
              )}
            </div>
          </div>
        </div>
        <AppLink
          href={href}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
          style={accent ? { background: accent, color: "#fff" } : undefined}
        >
          <Heart className="h-3.5 w-3.5" aria-hidden="true" />
          {cta}
        </AppLink>
      </div>
    );
  }

  if (variant === "compact-card") {
    return (
      <aside
        className="rounded-xl border border-border/60 bg-card p-5 shadow-sm"
        style={accentStyle}
      >
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          <HandHeart className="h-4 w-4" aria-hidden="true" />
          {title}
        </div>
        <div className="mt-3 font-display text-3xl font-bold tabular-nums leading-none">
          {money(stats.totalCents)}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">{t("donationsWidget.total")}</div>
        {showMonth && (
          <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
            <span>
              {t("donationsWidget.thisMonth")}:{" "}
              <strong className="tabular-nums text-foreground">{money(stats.monthCents)}</strong>
            </span>
          </div>
        )}
        {subtitle && <p className="mt-3 text-sm text-muted-foreground">{subtitle}</p>}
        <AppLink
          href={href}
          className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
          style={accent ? { background: accent, color: "#fff" } : undefined}
        >
          <Heart className="h-4 w-4" aria-hidden="true" />
          {cta}
        </AppLink>
      </aside>
    );
  }

  if (variant === "stats-strip") {
    return (
      <div className="rounded-xl border border-border/60 bg-card p-6 shadow-sm" style={accentStyle}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("donationsWidget.total")}
            </div>
            <div className="font-display text-2xl font-bold">{title}</div>
          </div>
          <AppLink
            href={href}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
            style={accent ? { background: accent, color: "#fff" } : undefined}
          >
            <Heart className="h-4 w-4" aria-hidden="true" />
            {cta}
          </AppLink>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <StatBox
            icon={<HandHeart className="h-4 w-4" aria-hidden="true" />}
            label={t("donationsWidget.total")}
            value={money(stats.totalCents)}
            accent={accent}
          />
          {showMonth && (
            <StatBox
              icon={<TrendingUp className="h-4 w-4" aria-hidden="true" />}
              label={t("donationsWidget.thisMonth")}
              value={money(stats.monthCents)}
              accent={accent}
            />
          )}
          {showCount && (
            <StatBox
              icon={<Users className="h-4 w-4" aria-hidden="true" />}
              label={t("donationsWidget.donors")}
              value={String(stats.count)}
              accent={accent}
            />
          )}
        </div>
        {subtitle && <p className="mt-4 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
    );
  }

  if (variant === "progress") {
    return (
      <div className="rounded-xl border border-border/60 bg-card p-6 shadow-sm" style={accentStyle}>
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          <Target className="h-4 w-4" aria-hidden="true" />
          {title}
        </div>
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
          <div className="font-display text-3xl font-bold tabular-nums">
            {money(stats.totalCents)}
          </div>
          {goalCents > 0 && (
            <div className="text-sm text-muted-foreground tabular-nums">
              {t("donationsWidget.of")} <strong>{money(goalCents)}</strong> ({progressPct}%)
            </div>
          )}
        </div>
        <div className="mt-3 h-3 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all duration-700"
            style={{
              width: `${goalCents > 0 ? progressPct : Math.min(100, stats.count * 5)}%`,
              background: accent || undefined,
            }}
          />
        </div>
        {(showMonth || showCount) && (
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
            {showMonth && (
              <span>
                {t("donationsWidget.thisMonth")}:{" "}
                <strong className="tabular-nums text-foreground">{money(stats.monthCents)}</strong>
              </span>
            )}
            {showCount && (
              <span>
                {t("donationsWidget.donors")}:{" "}
                <strong className="tabular-nums text-foreground">{stats.count}</strong>
              </span>
            )}
          </div>
        )}
        {subtitle && <p className="mt-3 text-sm text-muted-foreground">{subtitle}</p>}
        <AppLink
          href={href}
          className="mt-5 inline-flex items-center gap-1.5 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
          style={accent ? { background: accent, color: "#fff" } : undefined}
        >
          <Heart className="h-4 w-4" aria-hidden="true" />
          {cta}
        </AppLink>
      </div>
    );
  }

  if (variant === "thermometer") {
    return (
      <div
        className="flex flex-col items-center gap-4 rounded-xl border border-border/60 bg-card p-6 shadow-sm sm:flex-row sm:items-stretch"
        style={accentStyle}
      >
        <div className="relative mx-auto flex h-56 w-14 shrink-0 flex-col justify-end overflow-hidden rounded-full border border-border/60 bg-muted">
          <div
            className="w-full rounded-full bg-primary transition-all duration-700"
            style={{
              height: `${goalCents > 0 ? progressPct : Math.min(100, stats.count * 5)}%`,
              background: accent || undefined,
            }}
          />
          <div className="pointer-events-none absolute inset-x-0 top-2 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {goalCents > 0 ? `${progressPct}%` : ""}
          </div>
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <Target className="h-4 w-4" aria-hidden="true" />
            {title}
          </div>
          <div className="mt-2 font-display text-3xl font-bold tabular-nums">
            {money(stats.totalCents)}
          </div>
          {goalCents > 0 && (
            <div className="text-sm text-muted-foreground tabular-nums">
              {t("donationsWidget.of")} {money(goalCents)}
            </div>
          )}
          {subtitle && <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>}
          {showRecent && stats.recent.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
              {stats.recent.map((r, i) => (
                <li key={i} className="flex items-center justify-between gap-2">
                  <span className="tabular-nums">{money(r.amount_cents)}</span>
                  <span>{fmtRelative(r.created_at, lang)}</span>
                </li>
              ))}
            </ul>
          )}
          <AppLink
            href={href}
            className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
            style={accent ? { background: accent, color: "#fff" } : undefined}
          >
            <Heart className="h-4 w-4" aria-hidden="true" />
            {cta}
          </AppLink>
        </div>
      </div>
    );
  }

  // Domyślny: hero
  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-border/60 bg-card p-8 shadow-sm"
      style={accentStyle}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-20 blur-3xl"
        style={{
          background: accent || "hsl(var(--primary))",
        }}
      />
      <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
            <HandHeart className="h-3.5 w-3.5" aria-hidden="true" />
            {title}
          </div>
          {subtitle && <p className="mt-3 max-w-xl text-base text-muted-foreground">{subtitle}</p>}
          <div className="mt-5 flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <div>
              <div className="font-display text-4xl font-black tabular-nums sm:text-5xl">
                {money(stats.totalCents)}
              </div>
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("donationsWidget.total")}
              </div>
            </div>
            {showMonth && (
              <div>
                <div className="font-display text-xl font-bold tabular-nums">
                  {money(stats.monthCents)}
                </div>
                <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {t("donationsWidget.thisMonth")}
                </div>
              </div>
            )}
            {showCount && (
              <div>
                <div className="font-display text-xl font-bold tabular-nums">{stats.count}</div>
                <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {t("donationsWidget.donors")}
                </div>
              </div>
            )}
          </div>
          {goalCents > 0 && (
            <div className="mt-4 max-w-sm">
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-700"
                  style={{
                    width: `${progressPct}%`,
                    background: accent || undefined,
                  }}
                />
              </div>
              <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                {progressPct}% {t("donationsWidget.of")} {money(goalCents)}
              </div>
            </div>
          )}
        </div>
        <div className="shrink-0">
          <AppLink
            href={href}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-base font-semibold text-primary-foreground shadow-md transition hover:opacity-90"
            style={accent ? { background: accent, color: "#fff" } : undefined}
          >
            <Heart className="h-4 w-4" aria-hidden="true" />
            {cta}
          </AppLink>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function StatBox({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/60 p-4">
      <div
        className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground"
        style={accent ? { color: accent } : undefined}
      >
        {icon}
        {label}
      </div>
      <div className="mt-1 font-display text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}
