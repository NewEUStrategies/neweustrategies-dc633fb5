// Nagłówek Hubu Klubów - wariant ARCHITECTURAL PRESTIGE (v5), wdrożony 1:1
// z zatwierdzonego prototypu:
//
//   [ eyebrow z kreską ] [ dwuwierszowy tytuł: linia 1 ink / linia 2 złoto ]
//   [ lead uppercase   ] [ watermark "EU" ]        | pionowa szyna 3 paneli
//                                                  | (środkowy wypełniony złotem)
//
// Kolory pochodzą z tokenów `.club-prestige` (src/styles.css), więc wariant
// wygląda identycznie w trybie jasnym i ciemnym - bez rozjaśnianego granatu.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ClubHubAccessBadge } from "@/components/clubs/atoms/ClubHubAccessBadge";
import type { ClubHubAccess } from "@/lib/clubs/hubAccess";

/** Kotwice sekcji katalogu, do których skacze szyna statystyk. */
export const CLUB_HUB_ANCHORS = {
  mine: "#club-mine",
  discover: "#club-discover",
} as const;

export interface ClubHubStats {
  clubs: number;
  threads: number;
  /** Suma miejsc w klubach - świadomie NIE „osób": ktoś w dwóch klubach liczy się dwa razy. */
  seats: number;
  /** Liczba klubów, do których użytkownik należy aktywnie. */
  mine?: number;
}

/** Dzieli tytuł na dwie linie (ostatnie słowo w złocie) - jak w prototypie. */
export function splitPrestigeTitle(title: string): [string, string] {
  const parts = title.trim().split(/\s+/);
  if (parts.length < 2) return [title, ""];
  return [parts.slice(0, -1).join(" "), parts[parts.length - 1]];
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
  const [lineOne, lineTwo] = splitPrestigeTitle(t("club.title"));

  return (
    <header
      className="club-prestige relative mb-6 overflow-hidden rounded-md border"
      style={{ background: "var(--cp-surface)", borderColor: "var(--cp-line)" }}
    >
      <div className="grid gap-px lg:grid-cols-[minmax(0,1fr)_18rem]">
        {/* Blok tytułowy */}
        <div className="relative overflow-hidden p-6 md:p-10 lg:p-14">
          <div className="relative z-10">
            <div className="mb-8 flex items-center gap-4">
              <span
                className="text-[10px] font-semibold uppercase tracking-[0.42em]"
                style={{ color: "var(--cp-muted)" }}
              >
                {t("club.hub.eyebrow")}
              </span>
            </div>

            <h1 className="font-display text-4xl font-black leading-[0.92] tracking-tight md:text-6xl lg:text-[4.5rem]">
              <span className="block" style={{ color: "var(--cp-ink)" }}>
                {lineOne}
              </span>
              {lineTwo !== "" ? (
                <span className="block" style={{ color: "var(--cp-gold)" }}>
                  {lineTwo}
                </span>
              ) : null}
            </h1>

            <p
              className="mt-7 max-w-md text-[11px] font-medium uppercase leading-relaxed tracking-[0.14em]"
              style={{ color: "var(--cp-muted)" }}
            >
              {signedIn ? t("club.hub.editorialSubtitle") : t("club.hub.anonLead")}
            </p>

            {access !== null ? (
              <div className="mt-5">
                <ClubHubAccessBadge access={access} />
              </div>
            ) : null}

            {children !== undefined ? (
              <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">{children}</div>
                {signedIn ? (
                  <Button asChild variant="outline" size="sm">
                    <a href="/kontakt">{t("club.hub.suggestNew")}</a>
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Watermark "EU" */}
          <span
            className="pointer-events-none absolute -bottom-10 right-2 select-none font-display text-[13rem] font-black leading-none md:text-[18rem] lg:text-[21rem]"
            style={{ color: "var(--cp-watermark)" }}
            aria-hidden="true"
          >
            EU
          </span>
        </div>

        {/* Pionowa szyna statystyk */}
        <div className="grid grid-cols-3 gap-px lg:grid-cols-1">
          <StatCard
            value={stats.clubs}
            label={t("club.hub.statClubs")}
            href={CLUB_HUB_ANCHORS.discover}
          />
          {signedIn && stats.mine !== undefined ? (
            <StatCard
              value={stats.mine}
              label={t("club.hub.statMineLabel")}
              highlight
              href={stats.mine > 0 ? CLUB_HUB_ANCHORS.mine : CLUB_HUB_ANCHORS.discover}
            />
          ) : (
            <StatCard
              value={stats.seats}
              label={t("club.hub.statSeats")}
              highlight
              href={CLUB_HUB_ANCHORS.discover}
            />
          )}
          <StatCard
            value={stats.threads}
            label={t("club.hub.statThreads")}
            href={CLUB_HUB_ANCHORS.discover}
          />
        </div>
      </div>

      {/* Zaproszenie do planu - pasek pod nagłówkiem */}
      {access === "locked" ? (
        <div
          className="relative z-20 flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5 md:px-6"
          style={{ borderColor: "var(--cp-line)", background: "var(--cp-panel)" }}
        >
          <p className="min-w-0 text-sm" style={{ color: "var(--cp-ink)" }}>
            <span className="font-medium">{t("club.hub.upgradeTitle")}</span>{" "}
            <span style={{ color: "var(--cp-muted)" }}>{t("club.hub.upgradeNote")}</span>
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
  href,
}: {
  value: number;
  label: string;
  highlight?: boolean;
  /** Kotwica w katalogu; gdy podana, panel jest realnym linkiem (a nie dekoracją). */
  href?: string;
}) {
  const body = (
    <>
      <span
        className="text-[9px] font-bold uppercase tracking-[0.28em]"
        style={{ color: highlight ? "var(--cp-gold-ink)" : "var(--cp-muted)" }}
      >
        {label}
      </span>
      <span className="font-display text-4xl font-black tabular-nums leading-none md:text-5xl">
        {value}
      </span>
    </>
  );

  const surface = {
    background: highlight ? "var(--cp-gold)" : "var(--cp-panel)",
    color: highlight ? "var(--cp-gold-ink)" : "var(--cp-ink)",
  };
  const shell = "flex flex-col justify-between gap-6 p-5 md:p-7";

  if (href === undefined) {
    return (
      <div className={shell} style={surface}>
        {body}
      </div>
    );
  }

  return (
    <a
      href={href}
      onClick={(event) => {
        // Kotwica działa też bez zmiany URL-a: płynne przewinięcie do sekcji.
        const target = document.querySelector(href);
        if (target !== null) {
          event.preventDefault();
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }}
      className={`${shell} group cursor-pointer outline-none transition-[transform,box-shadow,filter] duration-200 hover:-translate-y-0.5 hover:brightness-[1.06] focus-visible:ring-2 focus-visible:ring-offset-2`}
      style={surface}
    >
      {body}
    </a>
  );
}
