// Siatka specjalizacji klubów - powierzchnia dla NIEZALOGOWANYCH.
//
// Zastępuje katalog "Kluby otwarte", który dla anonima był zwykle pusty:
// zamiast komunikatu o braku klubów pokazujemy osiem obszarów, w których
// program realnie działa, po trzy kafle w rzędzie. Kafel jest linkiem do
// strony specjalizacji, a pod siatką stoi jedno CTA do formularza zgłoszenia.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CLUB_SPECIALIZATIONS } from "@/lib/clubs/specializations";
import { CLUB_HUB_ANCHORS } from "@/components/clubs/organisms/ClubHubHero";

export function ClubSpecializationGrid() {
  const { t } = useTranslation();

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
          {t("club.spec.sectionLead")}
        </p>
      </header>

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CLUB_SPECIALIZATIONS.map((spec) => {
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
                    {t(`club.spec.items.${spec.key}.title`)}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--cp-muted)" }}>
                    {t(`club.spec.items.${spec.key}.lead`)}
                  </p>
                </div>
                <span
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] transition-colors"
                  style={{ color: "var(--cp-gold)" }}
                >
                  {t("club.spec.explore")}
                  <ArrowRight
                    className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-1"
                    aria-hidden="true"
                  />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

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
    </section>
  );
}
