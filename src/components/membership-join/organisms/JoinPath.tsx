// Organizm: ścieżka dołączenia (trzy kroki) - lista uporządkowana, bo kolejność
// niesie znaczenie także poza warstwą wizualną.
import { useTranslation } from "react-i18next";

import { JoinStepCard } from "../molecules/JoinStepCard";

const STEPS = ["account", "profile", "plan"] as const;

export function JoinPath() {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="join-steps" className="mt-14">
      <h2 id="join-steps" className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
        {t("membershipJoin.steps.title")}
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
        {t("membershipJoin.steps.subtitle")}
      </p>
      <ol className="mt-6 grid gap-4 md:grid-cols-3">
        {STEPS.map((key, index) => (
          <JoinStepCard
            key={key}
            step={index + 1}
            title={t(`membershipJoin.steps.items.${key}.title`)}
            body={t(`membershipJoin.steps.items.${key}.body`)}
          />
        ))}
      </ol>
    </section>
  );
}
