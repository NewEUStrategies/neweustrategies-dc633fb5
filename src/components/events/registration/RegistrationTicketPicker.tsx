// Atom wyboru biletu na publicznym formularzu zapisu.
//
// DOSTEPNOSC LICZY BAZA, NIE ZEGAR PRZEGLADARKI. `availability` i `tierLocked`
// przychodza policzone w `event_registration_form()`; komponent ich nie
// przelicza, bo dwa zrodla prawdy o sprzedazy to dwie rozne odpowiedzi na
// pytanie „czy moge kupic".
//
// BILET NIEDOSTEPNY ZOSTAJE WIDOCZNY, ale nie da sie go wybrac. Ukrycie
// zamienia „sprzedaz sie skonczyla" w „takiego biletu nie ma" - uczestnik
// nie wie wtedy, czego szukac.
//
// NATYWNE `radio`, a nie przyciski: klawiatura, czytnik ekranu i walidacja
// grupy dzialaja bez jednej linii naszego kodu.
import { Lock } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  isTicketSelectable,
  type RegistrationFormTicket,
} from "@/lib/events/registrationFormSurface";
import { formatMoney } from "@/lib/billing/types";

export function RegistrationTicketPicker({
  tickets,
  value,
  onChange,
  lang,
  invalid,
}: {
  tickets: RegistrationFormTicket[];
  value: string | null;
  onChange: (ticketId: string) => void;
  lang: "pl" | "en";
  invalid: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div
      role="radiogroup"
      aria-label={t("eventRegistration.labels.chooseTicket")}
      aria-invalid={invalid ? true : undefined}
      className="grid gap-3 sm:grid-cols-2"
    >
      {tickets.map((ticket) => {
        const selectable = isTicketSelectable(ticket);
        const checked = value === ticket.id;
        const name = (lang === "en" ? ticket.nameEn : ticket.namePl) || ticket.key;
        const description = lang === "en" ? ticket.descriptionEn : ticket.descriptionPl;

        return (
          <label
            key={ticket.id}
            className={[
              "flex cursor-pointer flex-col gap-1 rounded-[6px] border p-4 transition-colors",
              checked ? "border-primary bg-primary/5" : "border-border bg-card",
              selectable ? "hover:border-primary/60" : "cursor-not-allowed opacity-60",
            ].join(" ")}
          >
            <span className="flex items-start justify-between gap-3">
              <span className="flex items-center gap-2 font-medium text-foreground">
                <input
                  type="radio"
                  name="event-ticket"
                  className="sr-only"
                  checked={checked}
                  disabled={!selectable}
                  onChange={() => onChange(ticket.id)}
                />
                <span
                  aria-hidden="true"
                  className={[
                    "h-4 w-4 shrink-0 rounded-full border",
                    checked ? "border-primary bg-primary" : "border-muted-foreground/50",
                  ].join(" ")}
                />
                {name}
              </span>
              <span className="whitespace-nowrap text-sm font-medium text-foreground">
                {ticket.priceCents === 0
                  ? t("eventRegistration.labels.free")
                  : formatMoney(ticket.priceCents, ticket.currency, lang)}
              </span>
            </span>

            {description !== "" && (
              <span className="text-sm text-muted-foreground">{description}</span>
            )}

            <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>{t(`eventRegistration.availability.${ticket.availability}`)}</span>
              <span>
                {ticket.seatsLeft === null
                  ? t("eventRegistration.labels.seatsUnlimited")
                  : t("eventRegistration.labels.seatsLeft", { count: ticket.seatsLeft })}
              </span>
              {ticket.requiresApproval && (
                <span>{t("eventRegistration.labels.requiresApproval")}</span>
              )}
              {ticket.tierLocked && (
                <span className="flex items-center gap-1 text-primary">
                  <Lock className="h-3 w-3" aria-hidden="true" />
                  {t("eventRegistration.labels.tierLocked")}
                </span>
              )}
            </span>
          </label>
        );
      })}
    </div>
  );
}
