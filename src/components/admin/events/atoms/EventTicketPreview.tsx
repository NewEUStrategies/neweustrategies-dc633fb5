// Atom: podgląd karty biletu tak, jak zobaczy ją osoba rejestrująca się.
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-event-registration";
import { formatEventDateTime } from "@/lib/events/timezone";

export function EventTicketPreview({
  name,
  description,
  priceLabel,
  taxAdded = false,
  salesTo,
  lang,
}: {
  name: string;
  description: string;
  /** `null` = etykieta ceny wyłączona. */
  priceLabel: string | null;
  /** Podatek doliczany w kasie - karta publiczna dopisuje wtedy „+ podatek". */
  taxAdded?: boolean;
  /** Wartość pola datetime-local lub pusty napis. */
  salesTo: string;
  lang: "pl" | "en";
}) {
  const { t } = useTranslation();
  const until =
    salesTo.trim() === ""
      ? t("adminEventRegistration.tickets.studio.previewAlways")
      : t("adminEventRegistration.tickets.studio.previewUntil", {
          date: formatEventDateTime(new Date(salesTo).toISOString(), null, lang),
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
        <p className="text-xs text-muted-foreground">{until}</p>
      </div>
    </section>
  );
}
