// Organizm: filary członkostwa (cztery karty korzyści).
import { useTranslation } from "react-i18next";
import { BookOpen, Landmark, Network, Target } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { JoinFeatureCard } from "../molecules/JoinFeatureCard";

const PILLARS: ReadonlyArray<{ key: string; icon: LucideIcon }> = [
  { key: "knowledge", icon: BookOpen },
  { key: "network", icon: Network },
  { key: "clubs", icon: Landmark },
  { key: "impact", icon: Target },
];

export function JoinPillars() {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="join-pillars" className="mt-14">
      <h2
        id="join-pillars"
        className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl"
      >
        {t("membershipJoin.pillars.title")}
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
        {t("membershipJoin.pillars.subtitle")}
      </p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {PILLARS.map((pillar, index) => (
          <JoinFeatureCard
            key={pillar.key}
            icon={pillar.icon}
            index={index}
            title={t(`membershipJoin.pillars.items.${pillar.key}.title`)}
            body={t(`membershipJoin.pillars.items.${pillar.key}.body`)}
          />
        ))}
      </div>
    </section>
  );
}
