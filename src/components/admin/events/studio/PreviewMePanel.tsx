// Podglad studia: PRYWATNA ZAKLADKA UCZESTNIKA („Moj profil").
//
// DLACZEGO RYSUNEK, A NIE PRAWDZIWY `EventMePanel`. Panel uczestnika czyta
// tozsamosc wolajacego (`event_my_event_profile`, `event_my_agenda`,
// zaproszenia 1-1) - w szkicu niezapisanego wydarzenia nie ma ani jednego
// wiersza, a redaktor i tak nie ma prawa ogladac cudzych danych. Podglad
// pokazuje wiec ORGANIZATOROWI, jakie powierzchnie dostanie uczestnik po
// publikacji, bez wolania bazy.
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

const CARD = "rounded-[6px] border border-border bg-card p-4";

export function PreviewMePanel() {
  const { t } = useTranslation();

  const items = [
    { key: "profile", label: t("eventMe.tabs.profile"), hint: t("eventMe.profileHint") },
    { key: "schedule", label: t("eventMe.tabs.schedule"), hint: t("eventMe.agendaEmpty") },
    { key: "contacts", label: t("eventMe.tabs.contacts"), hint: t("eventMe.contactsEmpty") },
    { key: "networking", label: t("eventMe.tabs.networking"), hint: t("eventMe.networkingHint") },
    {
      key: "registration",
      label: t("eventMe.tabs.registration"),
      hint: t("eventMe.registrationHint"),
    },
  ];

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <p className="text-base font-bold">{t("eventMe.title")}</p>
        <p className="text-sm text-muted-foreground">{t("eventMe.lead")}</p>
      </header>
      <ul className="flex flex-wrap gap-2">
        {items.map((item, index) => (
          <li key={item.key}>
            <span
              className={cn(
                "inline-flex items-center rounded-[6px] border px-3 py-1.5 text-sm",
                index === 0
                  ? "border-transparent bg-foreground text-background"
                  : "border-border text-muted-foreground",
              )}
            >
              {item.label}
            </span>
          </li>
        ))}
      </ul>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.key} className={CARD}>
            <p className="text-sm font-semibold">{item.label}</p>
            <p className="mt-1 text-sm text-muted-foreground">{item.hint}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
