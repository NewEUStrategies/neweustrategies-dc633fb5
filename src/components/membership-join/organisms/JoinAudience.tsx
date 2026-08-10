// Organizm: segmenty odbiorców - trzy karty odpowiadające na pytanie
// "czy ta oferta jest dla mnie".
import { useTranslation } from "react-i18next";
import { Briefcase, GraduationCap, Landmark } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { JoinFeatureCard } from "../molecules/JoinFeatureCard";

const SEGMENTS: ReadonlyArray<{ key: string; icon: LucideIcon }> = [
  { key: "policy", icon: Landmark },
  { key: "business", icon: Briefcase },
  { key: "academia", icon: GraduationCap },
];

export function JoinAudience() {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="join-audience" className="mt-14">
      <h2
        id="join-audience"
        className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl"
      >
        {t("membershipJoin.audience.title")}
      </h2>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {SEGMENTS.map((segment, index) => (
          <JoinFeatureCard
            key={segment.key}
            icon={segment.icon}
            index={index}
            title={t(`membershipJoin.audience.items.${segment.key}.title`)}
            body={t(`membershipJoin.audience.items.${segment.key}.body`)}
          />
        ))}
      </div>
    </section>
  );
}
