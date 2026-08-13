// Organizm: nagłówek strony kariery. Zawiera jedyny H1 strony.
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { JoinStat } from "@/components/membership-join/atoms/JoinStat";

const STAT_KEYS = ["people", "countries", "remote", "growth"] as const;

export function CareersHero({
  onSeeRoles,
  onOpenApplication,
}: {
  onSeeRoles: () => void;
  onOpenApplication: () => void;
}) {
  const { t } = useTranslation();

  return (
    <header className="relative isolate overflow-hidden rounded-[6px] border border-border/70 bg-card/50 px-5 py-10 sm:px-8 sm:py-14">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(120%_120%_at_10%_-10%,color-mix(in_oklab,var(--primary)_18%,transparent),transparent_60%)]"
      />
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
        {t("careers.eyebrow")}
      </p>
      <h1 className="mt-3 max-w-3xl text-balance text-3xl font-black leading-[1.1] tracking-tight text-foreground sm:text-4xl lg:text-5xl">
        {t("careers.title")}
      </h1>
      <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
        {t("careers.lead")}
      </p>

      <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <Button
          size="lg"
          onClick={onSeeRoles}
          className="group h-12 gap-2 rounded-[6px] px-6 text-sm font-semibold shadow-[0_14px_30px_-18px_color-mix(in_oklab,var(--primary)_85%,transparent)] transition-transform duration-200 hover:-translate-y-0.5"
        >
          {t("careers.ctaPrimary")}
          <ArrowRight
            className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
            aria-hidden
          />
        </Button>
        <Button
          size="lg"
          variant="outline"
          onClick={onOpenApplication}
          className="h-12 rounded-[6px] border-primary/45 px-6 text-sm font-semibold text-foreground transition-colors duration-200 hover:border-primary hover:bg-primary/10"
        >
          {t("careers.ctaSecondary")}
        </Button>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">{t("careers.trust")}</p>

      <dl className="mt-9 grid grid-cols-2 gap-5 border-t border-border/60 pt-6 sm:grid-cols-4">
        {STAT_KEYS.map((key) => (
          <JoinStat
            key={key}
            value={t(`careers.stats.${key}.value`)}
            label={t(`careers.stats.${key}.label`)}
          />
        ))}
      </dl>
    </header>
  );
}
