// Widget CMS builder: publiczne statystyki darowizn + CTA.
// Dane pobiera server fn `getDonationsPublicStats` (service role, tylko sumy
// w walucie zbiórki; nigdy nie ujawnia donor_email/message). Źródłem jest
// tabela public.donations (filtr status='paid' + tenant). Cel przycisku
// wyznacza konfiguracja modułu przez `DonationCta` -> `resolveDonationTarget`
// (własna kasa /donate albo zbiórka zewnętrzna), nigdy adres wpisany w kodzie.
// Warianty wizualne: hero / progress / stats-strip / compact-card /
// inline-bar / thermometer.
//
// PO EKSTRAKCJI ten plik jest KOMPOZYCJĄ, nie logiką: rozstrzygnięcie propsów
// edytora, formatowanie kwot i arytmetyka paska siedzą w `donationsWidgetModel`
// (czyste funkcje, własny test), a powtarzalne kawałki DOM w `./atoms/*`.
// Zachowanie jest identyczne - w szczególności `statsQ.data ?? FALLBACK` NADAL
// nie rozróżnia awarii odczytu i stanu wczytywania od zbiórki bez wpłat
// (dowód: `__tests__/DonationsWidgetView.test.tsx`).
import type { CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { HandHeart, Heart, Target, TrendingUp, Users } from "@/lib/lucide-shim";
import { DonationCta } from "./DonationCta";
import { getDonationsPublicStats } from "@/lib/billing/donations.functions";
import "@/lib/i18n-donations-widget";
import {
  FALLBACK,
  fmtMoney,
  resolveBarPct,
  resolveWidgetProps,
  type DonationsWidgetProps,
  type StatsShape,
} from "./donationsWidgetModel";
import { DonationProgressBar } from "./atoms/DonationProgressBar";
import { DonationRecentList } from "./atoms/DonationRecentList";
import { DonationStatBox } from "./atoms/DonationStatBox";

export type { DonationsVariant, DonationsWidgetProps, StatsShape } from "./donationsWidgetModel";

export function DonationsWidgetView(props: DonationsWidgetProps) {
  const { t, i18n } = useTranslation();

  const fetchStats = useServerFn(getDonationsPublicStats);
  const statsQ = useQuery({
    queryKey: ["donations", "public-stats"],
    queryFn: () => fetchStats(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const stats: StatsShape = statsQ.data ?? FALLBACK;

  const {
    lang,
    variant,
    href,
    cta,
    title,
    subtitle,
    goalCents,
    showMonth,
    showCount,
    showRecent,
    accent,
    currency,
    actionMode,
    progressPct,
  } = resolveWidgetProps(props, stats, { language: i18n.language, t });

  // Wspólna konfiguracja akcji darowizny - jeden tryb dla każdego wariantu
  // wizualnego, żeby CTA nie rozjechało się między nimi.
  const actionProps = { mode: actionMode };

  const money = (cents: number) => fmtMoney(cents, currency, lang);
  /** Pasek `progress`/`thermometer`: bez celu liczy darczyńców × 5, nie postęp. */
  const barPct = resolveBarPct(goalCents, progressPct, stats.count);

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
        <DonationCta
          href={href}
          label={cta}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
          style={accent ? { background: accent, color: "#fff" } : undefined}
          icon={<Heart className="h-3.5 w-3.5" aria-hidden="true" />}
          {...actionProps}
        />
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
        <DonationCta
          href={href}
          label={cta}
          className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
          style={accent ? { background: accent, color: "#fff" } : undefined}
          icon={<Heart className="h-4 w-4" aria-hidden="true" />}
          {...actionProps}
        />
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
          <DonationCta
            href={href}
            label={cta}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
            style={accent ? { background: accent, color: "#fff" } : undefined}
            icon={<Heart className="h-4 w-4" aria-hidden="true" />}
            {...actionProps}
          />
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <DonationStatBox
            icon={<HandHeart className="h-4 w-4" aria-hidden="true" />}
            label={t("donationsWidget.total")}
            value={money(stats.totalCents)}
            accent={accent}
          />
          {showMonth && (
            <DonationStatBox
              icon={<TrendingUp className="h-4 w-4" aria-hidden="true" />}
              label={t("donationsWidget.thisMonth")}
              value={money(stats.monthCents)}
              accent={accent}
            />
          )}
          {showCount && (
            <DonationStatBox
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
        <DonationProgressBar
          pct={barPct}
          accent={accent}
          trackClassName="mt-3 h-3 overflow-hidden rounded-full bg-muted"
        />
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
        <DonationCta
          href={href}
          label={cta}
          className="mt-5 inline-flex items-center gap-1.5 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
          style={accent ? { background: accent, color: "#fff" } : undefined}
          icon={<Heart className="h-4 w-4" aria-hidden="true" />}
          {...actionProps}
        />
      </div>
    );
  }

  if (variant === "thermometer") {
    return (
      <div
        className="flex flex-col items-center gap-4 rounded-xl border border-border/60 bg-card p-6 shadow-sm sm:flex-row sm:items-stretch"
        style={accentStyle}
      >
        <DonationProgressBar
          pct={barPct}
          accent={accent}
          orientation="vertical"
          trackClassName="relative mx-auto flex h-56 w-14 shrink-0 flex-col justify-end overflow-hidden rounded-full border border-border/60 bg-muted"
        >
          <div className="pointer-events-none absolute inset-x-0 top-2 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {goalCents > 0 ? `${progressPct}%` : ""}
          </div>
        </DonationProgressBar>
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
          {showRecent && (
            <DonationRecentList recent={stats.recent} currency={currency} lang={lang} t={t} />
          )}
          <DonationCta
            href={href}
            label={cta}
            className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
            style={accent ? { background: accent, color: "#fff" } : undefined}
            icon={<Heart className="h-4 w-4" aria-hidden="true" />}
            {...actionProps}
          />
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
              <DonationProgressBar
                pct={progressPct}
                accent={accent}
                trackClassName="h-2 overflow-hidden rounded-full bg-muted"
              />
              <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                {progressPct}% {t("donationsWidget.of")} {money(goalCents)}
              </div>
            </div>
          )}
        </div>
        <div className="shrink-0">
          <DonationCta
            href={href}
            label={cta}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-base font-semibold text-primary-foreground shadow-md transition hover:opacity-90"
            style={accent ? { background: accent, color: "#fff" } : undefined}
            icon={<Heart className="h-4 w-4" aria-hidden="true" />}
            {...actionProps}
          />
        </div>
      </div>
    </div>
  );
}
