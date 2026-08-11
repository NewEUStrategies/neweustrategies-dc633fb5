// Nagłówek strony głównej klubów - wersja EDYTORIALNA (v4).
//
// Rozszerzona, premium powierzchnia huba: duży tytuł, status dostępu,
// liczniki w kartach po prawej oraz pas wartości (Dostęp / Debatuj / Sieć).
// Układ oddziela katalog od opowieści o produkcie, ale robi to na tyle
// kompaktowo, że pierwszy klub wciąż mieści się blisko góry ekranu.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { KeyRound, MessagesSquare, Users2 } from "lucide-react";
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
  /** Slot na prawą kolumnę: wyszukiwarka dla zalogowanego, CTA dla anonima. */
  children?: ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <header className="mb-6 overflow-hidden rounded-xl border border-border/60 bg-card">
      <div className="bg-gradient-to-br from-primary/[0.05] via-transparent to-transparent p-4 md:p-6">
        <div className="grid gap-6 lg:grid-cols-[1fr_22rem] lg:items-start">
          {/* Lewa kolumna: tytuł i lead */}
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
              {t("club.hub.eyebrow")}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2.5">
              <h1 className="font-display text-3xl font-bold leading-[1.05] tracking-tight sm:text-4xl">
                {t("club.title")}
              </h1>
              {access !== null ? <ClubHubAccessBadge access={access} /> : null}
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-[15px]">
              {signedIn ? t("club.hub.editorialSubtitle") : t("club.hub.anonLead")}
            </p>
          </div>

          {/* Prawa kolumna: liczniki */}
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <StatCard
              value={stats.clubs}
              label={t("club.hub.statClubs")}
            />
            {signedIn && stats.mine !== undefined ? (
              <StatCard
                value={stats.mine}
                label={t("club.myClubs")}
                highlight
              />
            ) : (
              <StatCard
                value={stats.seats}
                label={t("club.hub.statSeats")}
              />
            )}
            <StatCard
              value={stats.threads}
              label={t("club.hub.statThreads")}
            />
          </div>
        </div>

        {/* Pas wartości */}
        <div className="mt-6 grid gap-3 border-t border-border/60 pt-5 sm:grid-cols-3">
          <ValueProp
            icon={KeyRound}
            title={t("club.hub.valueAccess")}
            body={t("club.hub.valueAccessDesc")}
          />
          <ValueProp
            icon={MessagesSquare}
            title={t("club.hub.valueDebate")}
            body={t("club.hub.valueDebateDesc")}
          />
          <ValueProp
            icon={Users2}
            title={t("club.hub.valueNetwork")}
            body={t("club.hub.valueNetworkDesc")}
          />
        </div>

        {/* Slot pod wartościami: wyszukiwarka / CTA */}
        {children !== undefined ? (
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">{children}</div>
            {signedIn ? (
              <Button asChild variant="outline" size="sm">
                <a href="/kontakt">{t("club.hub.suggestNew")}</a>
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Zaproszenie do planu - pasek pod nagłówkiem */}
      {access === "locked" ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 bg-primary/[0.04] px-4 py-2.5 md:px-6">
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
      className={`rounded-lg border p-3 text-center sm:p-4 ${
        highlight
          ? "border-primary/30 bg-primary/[0.06]"
          : "border-border/60 bg-muted/30"
      }`}
    >
      <div className="font-display text-2xl font-bold tabular-nums leading-none sm:text-3xl">
        {value}
      </div>
      <div className="mt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

function ValueProp({
  icon: Icon,
  title,
  body,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/40">
        <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold leading-tight">{title}</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground sm:text-sm">{body}</p>
      </div>
    </div>
  );
}
