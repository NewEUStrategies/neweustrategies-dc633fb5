// Nagłówek strony głównej klubów - wersja ARCHITECTURAL PRESTIGE (v5).
//
// Struktura jak rama instytucjonalna: blok tytułowy po lewej, pionowa
// szyna statystyk po prawej, subtelne rozbłyski w tle. Duży kontrast,
// ostra typografia, złote akcenty.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ClubHubAccessBadge } from "@/components/clubs/atoms/ClubHubAccessBadge";
import type { ClubHubAccess } from "@/lib/clubs/hubAccess";

export interface ClubHubStats {
  clubs: number;
  threads: number;
  /** Suma miejsc w klubach - świadomie NIE „osób": ktoś w dwóch klubach liczy się dwa razy. */
  seats: number;
  /** Liczba klubów, do których użytkownik należy aktywnie. */
  mine?: number;
}

export function ClubHubHero({
  access,
  signedIn,
  stats,
  children,
}: {
  access: ClubHubAccess | null;
  signedIn: boolean;
  stats: ClubHubStats;
  /** Slot na wyszukiwarkę / CTA w bloku tytułowym. */
  children?: ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <header className="relative mb-6 overflow-hidden rounded-md border border-border/60 bg-card/50">
      {/* Rozbłyski tła */}
      <div className="pointer-events-none absolute -right-40 -top-40 h-[50rem] w-[50rem] rounded-full bg-primary/5 blur-[180px]" />
      <div className="pointer-events-none absolute -bottom-40 -left-40 h-[40rem] w-[40rem] rounded-full bg-primary/[0.03] blur-[150px]" />

      <div className="relative z-20 p-4 md:p-6 lg:p-8">
        {/* Główna rama: tytuł + statystyki */}
        <div className="flex flex-col gap-1 lg:flex-row lg:items-stretch">
          {/* Blok tytułowy */}
          <div className="flex-1 rounded-md border border-border/60 bg-foreground/[0.02] p-6 md:p-8 lg:p-10">
            <div className="relative overflow-hidden">
              <div className="relative z-10">
                <div className="mb-6 flex items-center gap-3">
                  <span className="h-px w-8 bg-primary" />
                  <span className="text-[10px] font-black uppercase tracking-[0.5em] text-primary">
                    {t("club.hub.eyebrow")}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="font-display text-5xl font-black leading-[0.9] tracking-tighter text-foreground md:text-6xl lg:text-7xl">
                    {t("club.title")}
                  </h1>
                  {access !== null ? <ClubHubAccessBadge access={access} /> : null}
                </div>

                <p className="mt-6 max-w-md text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {signedIn ? t("club.hub.editorialSubtitle") : t("club.hub.anonLead")}
                </p>

                {children !== undefined ? (
                  <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">{children}</div>
                    {signedIn ? (
                      <Button asChild variant="outline" size="sm">
                        <a href="/kontakt">{t("club.hub.suggestNew")}</a>
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {/* Wielka litera w tle */}
              <span
                className="absolute -bottom-8 -right-4 select-none font-display text-[12rem] font-black leading-none text-foreground/[0.02] md:text-[16rem] lg:-right-8"
                aria-hidden="true"
              >
                EU
              </span>
            </div>
          </div>

          {/* Pionowa szyna statystyk */}
          <div className="grid grid-cols-3 gap-1 lg:w-72 lg:grid-cols-1">
            <StatCard value={stats.clubs} label={t("club.hub.statClubs")} />
            {signedIn && stats.mine !== undefined ? (
              <StatCard value={stats.mine} label={t("club.hub.statMineLabel")} highlight />
            ) : (
              <StatCard value={stats.seats} label={t("club.hub.statSeats")} />
            )}
            <StatCard value={stats.threads} label={t("club.hub.statThreads")} />
          </div>
        </div>
      </div>

      {/* Zaproszenie do planu - pasek pod nagłówkiem */}
      {access === "locked" ? (
        <div className="relative z-20 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 bg-primary/[0.04] px-4 py-2.5 md:px-6">
          <p className="min-w-0 text-sm">
            <span className="font-medium">{t("club.hub.upgradeTitle")}</span>{" "}
            <span className="text-muted-foreground">{t("club.hub.upgradeNote")}</span>
          </p>
          <Button asChild size="sm" className="shrink-0">
            <Link to="/pricing">{t("club.hub.upgradeCta")}</Link>
          </Button>
        </div>
      ) : null}
    </header>
  );
}

function StatCard({
  value,
  label,
  highlight = false,
}: {
  value: number;
  label: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`flex flex-col justify-between rounded-md border p-5 ${
        highlight
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border/60 bg-foreground/[0.02] hover:bg-foreground/[0.04]"
      } transition-colors`}
    >
      <span
        className={`text-[10px] font-black uppercase tracking-widest ${
          highlight ? "text-primary-foreground/80" : "text-primary"
        }`}
      >
        {label}
      </span>
      <span
        className={`mt-4 font-display text-4xl font-black tabular-nums leading-none ${
          highlight ? "text-primary-foreground" : "text-foreground"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
