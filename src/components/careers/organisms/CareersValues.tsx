// Organizm: zasady pracy + lista benefitów.
import { useTranslation } from "react-i18next";
import { Compass, Crown, Gauge, Globe2, Check } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { JoinFeatureCard } from "@/components/membership-join/molecules/JoinFeatureCard";

const VALUES: ReadonlyArray<{ key: string; icon: LucideIcon }> = [
  { key: "evidence", icon: Compass },
  { key: "ownership", icon: Crown },
  { key: "craft", icon: Gauge },
  { key: "europe", icon: Globe2 },
];

const BENEFITS = ["b1", "b2", "b3", "b4"] as const;

export function CareersValues() {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="careers-values" className="mt-14">
      <h2
        id="careers-values"
        className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl"
      >
        {t("careers.values.title")}
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
        {t("careers.values.subtitle")}
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {VALUES.map((item, index) => (
          <JoinFeatureCard
            key={item.key}
            icon={item.icon}
            index={index}
            title={t(`careers.values.items.${item.key}.title`)}
            body={t(`careers.values.items.${item.key}.body`)}
          />
        ))}
      </div>

      <div className="mt-6 rounded-[6px] border border-border/70 bg-card/50 p-5">
        <h3 className="text-base font-semibold text-foreground">{t("careers.benefits.title")}</h3>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {BENEFITS.map((key) => (
            <li key={key} className="flex gap-2 text-sm leading-relaxed text-muted-foreground">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
              <span>{t(`careers.benefits.items.${key}`)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
