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
import { useEffect, useState } from "react";
import { Check, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  customPriceLabel,
  isTicketSelectable,
  visibleTickets,
  type RegistrationFormTicket,
} from "@/lib/events/registrationFormSurface";
import { formatMoney } from "@/lib/billing/types";
import { fetchRevealedTickets } from "@/lib/events/eventCodesApi";
import { rememberEventCode } from "@/lib/events/eventCodeMemory";
import { formatEventDateTime } from "@/lib/events/timezone";

export function RegistrationTicketPicker({
  tickets,
  value,
  onChange,
  lang,
  invalid,
  eventId,
}: {
  tickets: RegistrationFormTicket[];
  value: string | null;
  onChange: (ticketId: string) => void;
  lang: "pl" | "en";
  invalid: boolean;
  /** Włącza pole kodu dostępu (odsłanianie ukrytych biletów). */
  eventId?: string;
}) {
  const { t } = useTranslation();
  // Klucz z linku czytamy po hydratacji - SSR nie zna query stringa klienta.
  const [requestedKey, setRequestedKey] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [revealNote, setRevealNote] = useState<string | null>(null);
  const hasHidden = tickets.some((ticket) => ticket.isHidden === true);

  const applyCode = async (raw: string) => {
    if (!eventId || raw.trim() === "") return;
    rememberEventCode(eventId, raw);
    const ids = await fetchRevealedTickets(eventId, raw);
    setRevealed(ids);
    setRevealNote(
      ids.length > 0
        ? t("eventRegistration.payment.revealFound", { count: ids.length })
        : t("eventRegistration.payment.revealNone"),
    );
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setRequestedKey(params.get("ticket"));
    const fromUrl = params.get("code");
    if (fromUrl) {
      setCode(fromUrl.toUpperCase());
      void applyCode(fromUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const shown = visibleTickets(tickets, requestedKey).concat(
    tickets.filter(
      (ticket) =>
        ticket.isHidden === true && ticket.key !== requestedKey && revealed.includes(ticket.id),
    ),
  );

  return (
    <div className="space-y-3">
    {eventId && hasHidden && (
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex-1 space-y-1 text-sm">
          <span className="font-medium">{t("eventRegistration.payment.revealLabel")}</span>
          <input
            value={code}
            maxLength={64}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder={t("eventRegistration.payment.promoPlaceholder")}
            className="h-10 w-full rounded-[6px] border border-input bg-background px-3 text-sm uppercase outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <button
          type="button"
          onClick={() => void applyCode(code)}
          className="h-10 rounded-[6px] border border-border px-4 text-sm font-medium hover:bg-muted"
        >
          {t("eventRegistration.payment.revealApply")}
        </button>
      </div>
    )}
    {revealNote && (
      <p role="status" className="text-xs text-muted-foreground">
        {revealNote}
      </p>
    )}
    <div
      role="radiogroup"
      aria-label={t("eventRegistration.labels.chooseTicket")}
      aria-invalid={invalid ? true : undefined}
      className="grid gap-3 sm:grid-cols-2"
    >
      {shown.map((ticket) => {
        const selectable = isTicketSelectable(ticket);
        const checked = value === ticket.id;
        const name = (lang === "en" ? ticket.nameEn : ticket.namePl) || ticket.key;
        const description = lang === "en" ? ticket.descriptionEn : ticket.descriptionPl;
        const benefits = (lang === "en" ? ticket.benefitsEn : ticket.benefitsPl) ?? [];
        // Faza cenowa bywa nieobecna (starsze wydarzenia / RPC bez faz) - brak
        // fazy nie moze wywracac calego wyboru biletu.
        const phase = ticket.phase ?? null;
        const phaseLabel =
          phase === null
            ? ""
            : (lang === "en" ? phase.labelEn : phase.labelPl) ||
              (phase.source === "standard" ? "" : t("eventRegistration.labels.phaseEarlyBird"));
        const phaseEnds =
          phase === null || phase.endsAt === null
            ? ""
            : t("eventRegistration.labels.phaseEndsAt", {
                date: formatEventDateTime(phase.endsAt, null, lang),
              });
        const phaseNote =
          phaseLabel === ""
            ? null
            : [phaseLabel, phaseEnds].filter((part) => part !== "").join(" - ");

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
              <span className="flex flex-col items-end gap-0.5 whitespace-nowrap text-sm font-medium text-foreground">
                <span>
                  {ticket.showPriceLabel === false
                    ? null
                    : (customPriceLabel(ticket, lang) ??
                      (ticket.effectivePriceCents === 0
                        ? t("eventRegistration.labels.free")
                        : formatMoney(ticket.effectivePriceCents, ticket.currency, lang)))}
                </span>
                {/* Cena bazowa pojawia sie WYLACZNIE wtedy, gdy prog realnie
                    obniza kwote - przekreslenie przy tej samej liczbie udaje
                    promocje, ktorej nie ma. */}
                {ticket.effectivePriceCents < ticket.priceCents && (
                  <span className="text-xs font-normal text-muted-foreground line-through">
                    {formatMoney(ticket.priceCents, ticket.currency, lang)}
                  </span>
                )}
              </span>
            </span>

            {description !== "" && (
              <span className="text-sm text-muted-foreground">{description}</span>
            )}

            {/* PROG CENOWY MOWI, DO KIEDY. „Taniej" bez terminu nie sklania do
                decyzji, a data konca liczona jest w bazie - tu tylko formatujemy. */}
            {phaseNote !== null && (
              <span className="w-fit rounded-[6px] bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {phaseNote}
              </span>
            )}

            {benefits.length > 0 && (
              <span className="mt-1 flex flex-col gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("eventRegistration.labels.benefitsTitle")}
                </span>
                <ul className="flex flex-col gap-1">
                  {benefits.map((benefit) => (
                    <li key={benefit} className="flex items-start gap-2 text-sm text-foreground">
                      <Check
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary"
                        aria-hidden="true"
                      />
                      <span>{benefit}</span>
                    </li>
                  ))}
                </ul>
              </span>
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
              {ticket.requiresAccessCode && (
                <span>
                  {ticket.accessCodeHint === ""
                    ? t("eventRegistration.labels.accessCodeRequired")
                    : ticket.accessCodeHint}
                </span>
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
    </div>
  );
}
