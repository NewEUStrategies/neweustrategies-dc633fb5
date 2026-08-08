// Nagłówek strony głównej klubów - wersja KOMPAKTOWA (08.2026).
//
// Poprzednia wersja zajmowała pół pierwszego ekranu: tytuł 4xl, akapit prowadzący
// pełnej szerokości, pod nim osobny pasek liczników w trzech kartach, a niżej
// kolejne moduły. Hub jest KATALOGIEM - jego zadaniem jest pokazać kluby, a nie
// opowiedzieć o module. Nagłówek mieści więc w jednym pasie: czym to jest, czy
// masz dostęp, ile tu tego jest i wyszukiwarkę (albo wejście do rejestracji).
//
// Liczniki wróciły tu z osobnego paska (`ClubStatStrip`): trzy karty z liczbą
// 2xl zajmowały tyle miejsca, co dwa kafle klubu, a mówiły mniej niż jedna
// linijka tekstu pomocniczego.
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
    <header className="mb-5 overflow-hidden rounded-xl border border-border/60 bg-card">
      <div className="grid gap-3 bg-gradient-to-br from-primary/[0.06] via-transparent to-transparent p-4 md:grid-cols-[minmax(0,1fr)_18rem] md:items-center md:gap-6 md:p-5">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
            {t("club.hub.eyebrow")}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold leading-tight sm:text-2xl">{t("club.title")}</h1>
            {access !== null ? <ClubHubAccessBadge access={access} /> : null}
          </div>
          <p className="mt-1.5 line-clamp-2 max-w-2xl text-sm text-muted-foreground">
            {signedIn ? t("club.hub.lead") : t("club.hub.anonLead")}
          </p>
          <dl className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <Stat value={t("club.hub.clubsCount", { count: stats.clubs })} separator />
            <Stat value={t("club.threadsCount", { count: stats.threads })} separator />
            <Stat value={t("club.membersCount", { count: stats.seats })} />
          </dl>
        </div>

        {children !== undefined ? <div className="w-full">{children}</div> : null}
      </div>

      {/* Zaproszenie do planu nie jest już blokiem-kartą, tylko paskiem pod
          nagłówkiem: ta sama treść, jedna trzecia wysokości. */}
      {access === "locked" ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 bg-primary/[0.04] px-4 py-2.5">
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

function Stat({ value, separator = false }: { value: string; separator?: boolean }) {
  return (
    <div className="inline-flex items-center gap-3">
      <dd className="tabular-nums">{value}</dd>
      {separator ? (
        <span aria-hidden="true" className="text-border">
          ·
        </span>
      ) : null}
    </div>
  );
}
