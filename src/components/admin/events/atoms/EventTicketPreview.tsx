// Atom: podgląd karty biletu tak, jak zobaczy ją osoba rejestrująca się.
//
// TERMIN SPRZEDAŻY CZYTAMY W STREFIE WYDARZENIA. Pole formularza jest zegarem
// w tej strefie (`ticketDraft`), a karta publiczna pokazuje go w niej - dawne
// `new Date(pole)` czytało napis w strefie przeglądarki i pokazywało go
// w strefie serwisu (inna godzina w Londynie). Napis nieczytelny jako data
// (`2026-13-45T99:99`) rzucał przy tym `RangeError` z `toISOString()` w trakcie
// renderu; teraz wiersz terminu po prostu znika.
import { useTranslation } from "react-i18next";
import { eventLocalInputToIso } from "@/lib/events/eventLocalInput";
import { formatEventDateTime } from "@/lib/events/timezone";
import { ensureI18n as ensureRegistrationI18n } from "@/lib/i18n-admin-event-registration";

export function EventTicketPreview({
  name,
  description,
  priceLabel,
  taxAdded = false,
  salesTo,
  salesToSaved = null,
  timeZone,
  lang,
}: {
  name: string;
  description: string;
  /** `null` = etykieta ceny wyłączona. */
  priceLabel: string | null;
  /** Podatek doliczany w kasie - karta publiczna dopisuje wtedy „+ podatek". */
  taxAdded?: boolean;
  /** Wartość pola datetime-local (zegar w `timeZone`) lub pusty napis. */
  salesTo: string;
  /** Chwila z bazy, z której powstało pole (nietknięte pole oddaje ją bez zmian). */
  salesToSaved?: string | null;
  /** Strefa wydarzenia (IANA) - w niej jest pole i w niej pokazujemy termin. */
  timeZone: string;
  lang: "pl" | "en";
}) {
  ensureRegistrationI18n();
  const { t } = useTranslation();
  const untilIso = eventLocalInputToIso(salesTo, timeZone, salesToSaved);
  // Napis niepełny (w trakcie wpisywania) nie jest ani terminem, ani „zawsze" -
  // wiersz terminu znika, dopóki pole nie da się odczytać.
  const until =
    salesTo.trim() === ""
      ? t("adminEventRegistration.tickets.studio.previewAlways")
      : untilIso === null
        ? null
        : t("adminEventRegistration.tickets.studio.previewUntil", {
            date: formatEventDateTime(untilIso, timeZone, lang),
          });
  return (
    <section
      aria-label={t("adminEventRegistration.tickets.studio.preview")}
      className="space-y-2 rounded-[6px] border border-border bg-muted/40 p-3"
    >
      <p className="text-sm font-semibold text-foreground">
        {t("adminEventRegistration.tickets.studio.preview")}
      </p>
      <p className="text-xs text-muted-foreground">
        {t("adminEventRegistration.tickets.studio.previewHint")}
      </p>
      <div className="space-y-1 rounded-[6px] border border-border bg-card p-3">
        <div className="flex items-start justify-between gap-2">
          <span className="font-medium text-foreground">
            {name === "" ? t("adminEventRegistration.tickets.studio.previewName") : name}
          </span>
          {priceLabel !== null ? (
            <span className="flex shrink-0 flex-col items-end text-sm font-medium text-foreground">
              <span>{priceLabel}</span>
              {taxAdded ? (
                <span className="text-xs font-normal text-muted-foreground">
                  {t("adminEventRegistration.tickets.studio.previewPlusTax")}
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
        {description.trim() !== "" ? (
          <p className="line-clamp-3 text-xs text-muted-foreground">{description}</p>
        ) : null}
        {until === null ? null : <p className="text-xs text-muted-foreground">{until}</p>}
      </div>
    </section>
  );
}
