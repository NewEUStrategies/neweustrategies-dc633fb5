// Siatka specjalizacji klubów - pierwsza powierzchnia nawigacyjna huba,
// wspólna dla anonima i osoby zalogowanej.
//
// Katalog klubów nie stoi już na hubie płaską listą: najpierw wybiera się
// obszar, a kluby pokazuje strona specjalizacji. Dla anonima kafel prowadzi
// do strony sprzedażowej obszaru, dla zalogowanego - do tej samej strony,
// która pod opisem wypisuje realne kluby (licznik na kaflu mówi ile).
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  buildSpecializationViews,
  fallbackSpecializationSources,
} from "@/lib/clubs/specializations";
import { useClubSpecializations } from "@/lib/clubs/useClubSpecializations";
import { CLUB_HUB_ANCHORS } from "@/components/clubs/organisms/ClubHubHero";

export function ClubSpecializationGrid({ signedIn = false }: { signedIn?: boolean }) {
  const { t, i18n } = useTranslation();
  const isPl = (i18n.language ?? "pl").startsWith("pl");
  const listQ = useClubSpecializations();

  const rows = listQ.data ?? [];
  const specs = buildSpecializationViews(
    rows.length > 0 ? rows : fallbackSpecializationSources(),
    isPl,
    (key) => t(key),
  );

  return (
    <section
      id={CLUB_HUB_ANCHORS.specializations.slice(1)}
      className="club-prestige mb-10 scroll-mt-28"
    >
      <header className="mb-6 max-w-3xl">
        <p
          className="text-[10px] font-semibold uppercase tracking-[0.42em]"
          style={{ color: "var(--cp-muted)" }}
        >
          {t("club.spec.eyebrow")}
        </p>
        <h2
          className="mt-3 font-display text-2xl font-black leading-tight tracking-tight md:text-3xl"
          style={{ color: "var(--cp-ink)" }}
        >
          {t("club.spec.sectionTitle")}
        </h2>
        <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--cp-muted)" }}>
          {signedIn ? t("club.spec.sectionLeadMember") : t("club.spec.sectionLead")}
        </p>
      </header>

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {specs.map((spec) => {
          const Icon = spec.icon;
          return (
            <li key={spec.slug}>
              <Link
                to="/club/specialization/$slug"
                params={{ slug: spec.slug }}
                className="group relative flex h-full flex-col justify-between gap-6 overflow-hidden rounded-md border p-5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[color:var(--cp-gold)] md:p-6"
                style={{ borderColor: "var(--cp-line)", background: "var(--cp-panel)" }}
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] origin-left scale-x-0 transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-x-100 group-focus-visible:scale-x-100"
                  style={{ background: "var(--cp-gold)" }}
                />
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <Icon
                      className="h-5 w-5 shrink-0"
                      style={{ color: "var(--cp-gold)" }}
                      aria-hidden="true"
                    />
                    <span
                      className="font-display text-xs font-bold tabular-nums tracking-[0.2em]"
                      style={{ color: "var(--cp-muted)" }}
                    >
                      {spec.index}
                    </span>
                  </div>
                  <h3
                    className="mt-4 font-display text-lg font-bold leading-snug"
                    style={{ color: "var(--cp-ink)" }}
                  >
                    {spec.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--cp-muted)" }}>
                    {spec.lead}
                  </p>
                </div>
                <span className="flex items-center justify-between gap-3">
                  <span
                    className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] transition-colors"
                    style={{ color: "var(--cp-gold)" }}
                  >
                    {signedIn ? t("club.spec.browseClubs") : t("club.spec.explore")}
                    <ArrowRight
                      className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-1"
                      aria-hidden="true"
                    />
                  </span>
                  {signedIn ? (
                    <span
                      className="text-[11px] font-semibold tabular-nums"
                      style={{ color: "var(--cp-muted)" }}
                    >
                      {t("club.spec.clubCount", { count: spec.clubCount })}
                    </span>
                  ) : null}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      {signedIn ? null : (
        <div className="mt-7 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          <Button
            asChild
            size="lg"
            className="border-0"
            style={{ background: "var(--cp-gold)", color: "var(--cp-gold-ink)" }}
          >
            <Link to="/club/apply">{t("club.spec.applyCta")}</Link>
          </Button>
          <p className="text-sm" style={{ color: "var(--cp-muted)" }}>
            {t("club.spec.applyLead")}
          </p>
        </div>
      )}
    </section>
  );
}
