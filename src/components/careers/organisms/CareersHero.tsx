// Organizm: nagłówek strony kariery. Zawiera jedyny H1 strony.
//
// Interakcje: badge z licznikiem ról i panel działów przewijają do listy ról
// (panel dodatkowo ustawia filtr działu w trasie), liczby dowodowe odliczają
// przy wejściu w viewport, a wiersz "Szukamy teraz:" rotuje profile zgodne
// z realnie otwartymi rolami. Tło (aurora + siatka) jest czysto dekoracyjne
// i gaśnie przy prefers-reduced-motion.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { GridPattern } from "@/components/ui/grid-pattern";
import { TextRotate } from "@/components/ui/text-rotate";
import {
  CAREER_DEPARTMENTS,
  CAREER_ROLES,
  countRolesByDepartment,
  type CareerDepartmentId,
} from "@/lib/careers/roles";
import { CareerStat } from "../atoms/CareerStat";

const STAT_KEYS = ["people", "countries", "remote", "growth"] as const;
const ROTATING_KEYS = ["research", "policy", "marketing", "advisory", "editorial"] as const;

export function CareersHero({
  onSeeRoles,
  onOpenApplication,
  onSelectDepartment,
}: {
  onSeeRoles: () => void;
  onOpenApplication: () => void;
  onSelectDepartment: (department: CareerDepartmentId) => void;
}) {
  const { t } = useTranslation();
  const counts = useMemo(() => countRolesByDepartment(CAREER_ROLES), []);
  const rotating = ROTATING_KEYS.map((key) => t(`careers.hero.rotating.${key}`));

  return (
    <header className="relative isolate overflow-hidden rounded-[6px] border border-border/70 bg-card/50 px-5 py-10 sm:px-8 sm:py-12">
      <span aria-hidden className="crs-aurora pointer-events-none absolute inset-0 -z-10">
        <span />
        <span />
        <span />
      </span>
      <GridPattern
        width={44}
        height={44}
        className="-z-10 opacity-60 [mask-image:radial-gradient(80%_70%_at_30%_0%,black,transparent)]"
      />

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(280px,22rem)] xl:gap-12">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onSeeRoles}
            className="group inline-flex items-center gap-2 rounded-full border border-brand/40 bg-brand/10 px-3.5 py-1.5 text-xs font-semibold text-foreground transition-colors duration-200 hover:border-brand/70 hover:bg-brand/15"
          >
            <span aria-hidden className="crs-pulse-dot" />
            {t("careers.hero.badge", { value: CAREER_ROLES.length })}
            <ArrowRight
              className="h-3.5 w-3.5 text-brand-ink transition-transform duration-200 group-hover:translate-x-0.5"
              aria-hidden
            />
          </button>

          <h1 className="mt-4 text-balance text-3xl font-black leading-[1.08] tracking-tight text-foreground sm:text-4xl lg:text-5xl">
            <span className="block">{t("careers.hero.titleTop")}</span>
            <span className="crs-title-accent block">{t("careers.hero.titleAccent")}</span>
          </h1>

          <p className="mt-4 min-h-12 text-base font-medium text-foreground sm:min-h-7 sm:text-lg">
            {t("careers.hero.rotatePrefix")}{" "}
            <TextRotate
              texts={rotating}
              splitBy="words"
              rotationInterval={2900}
              staggerDurationMs={45}
              mainClassName="font-semibold text-brand-ink"
            />
          </p>

          <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            {t("careers.lead")}
          </p>

          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <Button size="lg" className="gap-2" onClick={onSeeRoles}>
              {t("careers.ctaPrimary")}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
            <Button size="lg" variant="outline" onClick={onOpenApplication}>
              {t("careers.ctaSecondary")}
            </Button>
          </div>

          <p className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground">
            <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            {t("careers.trust")}
          </p>
        </div>

        <aside
          aria-label={t("careers.hero.deptTitle")}
          className="rounded-[6px] border border-border/70 bg-background/55 p-4 backdrop-blur-sm sm:p-5"
        >
          <h2 className="text-sm font-semibold text-foreground">{t("careers.hero.deptTitle")}</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t("careers.hero.deptHint")}
          </p>
          <ul className="mt-3 space-y-1.5">
            {CAREER_DEPARTMENTS.map((dept) => (
              <li key={dept}>
                <button
                  type="button"
                  onClick={() => onSelectDepartment(dept)}
                  className="group flex w-full items-center justify-between gap-3 rounded-[6px] border border-transparent px-2.5 py-2 text-left text-sm font-medium text-foreground transition-[background-color,border-color] duration-200 hover:border-primary/40 hover:bg-primary/10"
                >
                  <span className="truncate">{t(`careers.departments.${dept}`)}</span>
                  <span className="inline-flex shrink-0 items-center gap-1.5">
                    <span className="inline-flex min-w-[1.5rem] justify-center rounded-[6px] bg-brand/15 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-brand-ink">
                      {counts[dept]}
                    </span>
                    <ArrowRight
                      className="h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-primary"
                      aria-hidden
                    />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      <dl className="mt-9 grid grid-cols-2 gap-5 border-t border-border/60 pt-6 sm:grid-cols-4">
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
