// PLAKIETKI GRUP UCZESTNIKA - JEDEN RYSUNEK NA CAŁY MODUŁ.
//
// Grupa (przepustka) decyduje, kto kogo widzi i z kim może się umówić, więc
// jest FAKTEM o osobie, nie ozdobą listy. Zanim ten atom powstał, etykiety
// rysował wyłącznie katalog uczestników - właściciel profilu nie miał gdzie
// sprawdzić, do której grupy przypisał go organizator w „Grupy i uprawnienia".
//
// Kolor jest z bazy (`event_groups.color`), nie z motywu: to organizator
// nadaje grupie barwę i musi ona być ta sama na każdej powierzchni.
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { Badge } from "@/components/ui/badge";
import type { AttendeeGroupTag } from "@/lib/events/publicEventApi";

export function eventGroupName(group: AttendeeGroupTag, lang: "pl" | "en"): string {
  return pickLocalized({ name_pl: group.namePl, name_en: group.nameEn }, "name", lang);
}

export function EventGroupTags({
  groups,
  lang,
  className = "",
}: {
  groups: readonly AttendeeGroupTag[];
  lang: "pl" | "en";
  className?: string;
}) {
  if (groups.length === 0) return null;
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`.trim()}>
      {groups.map((group) => (
        <Badge
          key={group.id}
          variant="outline"
          className="max-w-full whitespace-normal break-words [overflow-wrap:anywhere]"
          style={group.color === null ? undefined : { borderColor: group.color }}
        >
          {eventGroupName(group, lang)}
        </Badge>
      ))}
    </div>
  );
}
