// Moduł "jak to działa" - stopka merytoryczna huba.
//
// Nie jest ozdobą. Kluby mają trzy reguły, których nie da się wywnioskować
// z interfejsu, a każda z nich zmienia to, CO ktoś napisze: reguła Chatham
// House (wypowiedź wolno cytować, autora nie), premoderacja w części klubów,
// i to, że wątki zakłada moderacja, a nie każdy. Jeśli czytelnik dowie się
// o nich dopiero po odrzuceniu wpisu, dowie się za późno.
import { useTranslation } from "react-i18next";
import { PenLine, ShieldQuestion, UsersRound } from "lucide-react";

const CARDS = [
  { key: "chatham", Icon: ShieldQuestion },
  { key: "moderation", Icon: UsersRound },
  { key: "threads", Icon: PenLine },
] as const;

export function ClubHowItWorks() {
  const { t } = useTranslation();

  return (
    <section aria-labelledby="club-how-heading" className="mt-4">
      <h2 id="club-how-heading" className="mb-3 text-lg font-semibold">
        {t("club.hub.howTitle")}
      </h2>
      <ul className="grid gap-3 sm:grid-cols-3">
        {CARDS.map(({ key, Icon }) => (
          <li key={key} className="rounded-lg border border-border/60 bg-card p-4">
            <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
            <h3 className="mt-2 font-medium">{t(`club.hub.how.${key}.title`)}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t(`club.hub.how.${key}.body`)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
