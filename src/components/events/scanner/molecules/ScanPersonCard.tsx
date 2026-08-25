// Molekuła: karta osoby przy bramce.
//
// TYLE, ILE POTRZEBA DO DECYZJI, I ANI POLA WIĘCEJ. Baza celowo nie oddaje tu
// adresu poczty ani telefonu (`_event_onsite_person_card`), bo urządzenie
// bramkowe bywa zgubione, a operator i tak ich nie użyje. Zostaje to, co
// pozwala potwierdzić tożsamość i wydać właściwy identyfikator: imię,
// nazwisko, firma, stanowisko, bilet, grupa i stan identyfikatora.
//
// KOLOR GRUPY JEST OBRAMOWANIEM, NIE TŁEM. Grupy bywają pomalowane wartościami
// spoza palety serwisu; użyte jako tło potrafią zjeść kontrast tekstu.
import { BadgeCheck, Building2, IdCard, User } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { formatEventDateTime } from "@/lib/events/timezone";
import type { ScanPerson } from "@/lib/events/scannerApi";
import { ensureI18n as ensureScannerI18n } from "@/lib/i18n-event-scanner";

ensureScannerI18n();

export function ScanPersonCard({
  person,
  timezone,
}: {
  person: ScanPerson;
  timezone: string | null;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);

  const name = [person.firstName, person.lastName]
    .filter((part): part is string => part !== null && part.trim() !== "")
    .join(" ");
  const ticket = pickLocalized(
    { name_pl: person.ticketNamePl, name_en: person.ticketNameEn },
    "name",
    lang,
  );
  const group = pickLocalized(
    { name_pl: person.groupNamePl, name_en: person.groupNameEn },
    "name",
    lang,
  );

  return (
    <div
      className="rounded-[6px] border border-border bg-card p-4"
      style={
        person.groupColor === null
          ? undefined
          : { borderLeftColor: person.groupColor, borderLeftWidth: "4px" }
      }
    >
      <p className="flex items-center gap-2 text-lg font-semibold text-foreground">
        <User className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        {name === "" ? t("eventScanner.person.unnamed") : name}
      </p>

      {(person.jobTitle !== null || person.company !== null) && (
        <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
          <Building2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          {[person.jobTitle, person.company]
            .filter((part): part is string => part !== null && part.trim() !== "")
            .join(" · ")}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {ticket !== "" && (
          <Badge variant="secondary">
            {t("eventScanner.person.ticket")}: {ticket}
          </Badge>
        )}
        {group !== "" && (
          <Badge variant="outline">
            {t("eventScanner.person.group")}: {group}
          </Badge>
        )}
        {person.registrationStatus !== null && (
          <Badge variant="outline">{person.registrationStatus}</Badge>
        )}
        <Badge variant={person.badgePrinted ? "secondary" : "outline"} className="gap-1.5">
          {person.badgePrinted ? (
            <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <IdCard className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {person.badgePrinted
            ? t("eventScanner.person.badgePrinted")
            : t("eventScanner.person.badgeNotPrinted")}
        </Badge>
      </div>

      {person.badgePrinted && person.badgePrintedAt !== null && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("eventScanner.person.badgePrintedAt", {
            when: formatEventDateTime(person.badgePrintedAt, timezone, lang),
          })}
        </p>
      )}
    </div>
  );
}
