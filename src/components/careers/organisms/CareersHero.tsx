// Organizm: nagłówek strony kariery. Zawiera jedyny H1 strony.
//
// Kompozycja jednokolumnowa, redakcyjna: badge z żywym licznikiem ról
// (klik przewija do listy), H1 z LOGO organizacji z ustawień systemu
// (theme_options.logo - wariant jasny/ciemny przełączany klasą `.dark`,
// bez migotania przy SSR), rotujący wiersz profili zgodnych z realnie
// otwartymi rolami i liczby dowodowe odliczające przy wejściu w viewport.
// Tło: wyłącznie miękka poświata marki (crs-aurora), gasnąca przy
// prefers-reduced-motion.
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TextRotate } from "@/components/ui/text-rotate";
import { useSiteSetting } from "@/lib/useSiteSetting";
import { useCareerOffers } from "@/lib/careers/useCareerContent";
import { CareerStat } from "../atoms/CareerStat";

const STAT_KEYS = ["people", "countries", "remote", "growth"] as const;
const ROTATING_KEYS = ["research", "policy", "marketing", "advisory", "editorial"] as const;

// Ten sam kształt ustawienia, którym Header rysuje logo serwisu.
type ThemeLogoCfg = {
  logo?: {
    main?: string;
    main_dark?: string;
  };
};

const THEME_DEFAULTS: ThemeLogoCfg = {};

export function CareersHero({
  onSeeRoles,
  onOpenApplication,
}: {
  onSeeRoles: () => void;
  onOpenApplication: () => void;
}) {
  const { t } = useTranslation();
  const { offers } = useCareerOffers();

  const themeLogo = useSiteSetting<ThemeLogoCfg>("theme_options", THEME_DEFAULTS).logo ?? {};
  const logoLight = themeLogo.main || themeLogo.main_dark || "";
  const logoDark = themeLogo.main_dark || themeLogo.main || "";
  const logoAlt = t("careers.hero.titleAccent");
  const rotating = ROTATING_KEYS.map((key) => t(`careers.hero.rotating.${key}`));

  return (
    <header className="relative isolate overflow-hidden rounded-[6px] border border-border/70 bg-card/50 px-5 py-12 sm:px-10 sm:py-16">
      <span aria-hidden className="crs-aurora pointer-events-none absolute inset-0 -z-10">
        <span />
        <span />
        <span />
      </span>

      <div className="max-w-3xl">
        <button
          type="button"
          onClick={onSeeRoles}
          className="group inline-flex items-center gap-2 rounded-[6px] border border-brand/40 bg-brand/10 px-3 py-1.5 text-xs font-semibold text-foreground transition-colors duration-200 hover:border-brand/70 hover:bg-brand/15"
        >
          <span aria-hidden className="crs-pulse-dot" />
          {t("careers.hero.badge", { value: offers.length })}
          <ArrowRight
            className="h-3.5 w-3.5 text-brand-ink transition-transform duration-200 group-hover:translate-x-0.5"
            aria-hidden
          />
        </button>

        <h1 className="mt-5 text-balance text-3xl font-black leading-[1.08] tracking-tight text-foreground sm:text-4xl lg:text-5xl">
          <span className="block">{t("careers.hero.titleTop")}</span>
          {logoLight ? (
            logoLight === logoDark ? (
              <img
                src={logoLight}
                alt={logoAlt}
                className="mt-4 block h-9 w-auto max-w-full sm:h-11 lg:h-12"
                loading="eager"
                decoding="async"
              />
            ) : (
              <>
                <img
                  src={logoLight}
                  alt={logoAlt}
                  className="mt-4 block h-9 w-auto max-w-full sm:h-11 lg:h-12 dark:hidden"
                  loading="eager"
                  decoding="async"
                />
                <img
                  src={logoDark}
                  alt={logoAlt}
                  className="mt-4 hidden h-9 w-auto max-w-full sm:h-11 lg:h-12 dark:block"
                  loading="eager"
                  decoding="async"
                />
              </>
            )
          ) : (
            <span className="block text-brand-ink">{logoAlt}</span>
          )}
        </h1>

        <p className="mt-5 min-h-12 text-base font-medium text-foreground sm:min-h-7 sm:text-lg">
          {t("careers.hero.rotatePrefix")}{" "}
          <TextRotate
            texts={rotating}
            splitBy="words"
            rotationInterval={2900}
            staggerDurationMs={45}
            mainClassName="font-semibold text-brand-ink"
          />
        </p>

        <p className="mt-3 text-base leading-relaxed text-muted-foreground sm:text-lg">
          {t("careers.lead")}
        </p>

        {/* Styl CTA przejęty z edycji na main (h-12, poświata, strzałka na hover). */}
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
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
      </div>

      <dl className="mt-10 grid grid-cols-2 gap-5 border-t border-border/60 pt-6 sm:grid-cols-4">
        {STAT_KEYS.map((key) => (
          <CareerStat
            key={key}
            value={t(`careers.stats.${key}.value`)}
            label={t(`careers.stats.${key}.label`)}
          />
        ))}
      </dl>
    </header>
  );
}
