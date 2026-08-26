// Organizm: informacje praktyczne wydarzenia - treść sekcji `map` i `contact`.
//
// PODZIAŁ NA DWIE SEKCJE JEST REGUŁĄ, NIE UKŁADEM. Co należy do „Dojazdu",
// a co do „Kontaktu", i dlaczego nie może to być jedna karta - rozstrzyga
// `lib/events/eventPractical` (osobna widoczność sekcji i bramka gościa
// „wszystko poza kontaktami"). Ten plik rysuje to, co tamta reguła wybrała.
//
// SEKCJA BEZ ANI JEDNEJ INFORMACJI NIE RENDERUJE SIĘ WCALE - i odsiewa ją już
// `EventPageSections` tym samym predykatem, żeby nie został sam nagłówek.
// Warunek tutaj jest drugą linią: komponent użyty wprost też nie może oddać
// pustej karty.
import { Globe, Hash, LifeBuoy, MapPin } from "lucide-react";
import { useTranslation } from "react-i18next";

import { uiLang } from "@/lib/i18n/format";
import { eventAddressLine, eventMapUrl } from "@/lib/events/eventAddress";
import { eventLanguageLabel } from "@/lib/events/eventLanguages";
import {
  eventHashtag,
  eventSupportEmail,
  hasPracticalContent,
  type EventPracticalInfo,
  type EventPracticalSectionKey,
} from "@/lib/events/eventPractical";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";

ensureEventFrontI18n();

export function EventPracticalSection({
  info,
  section,
}: {
  info: EventPracticalInfo;
  section: EventPracticalSectionKey;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);

  if (!hasPracticalContent(info, section)) return null;

  if (section === "map") {
    const mapUrl = eventMapUrl(info);
    return (
      <dl className="grid gap-4 rounded-lg border border-border bg-card p-5">
        <PracticalRow
          icon={<MapPin className="h-4 w-4" />}
          label={t("eventFront.practical.addressLabel")}
        >
          <span>{eventAddressLine(info)}</span>
          {mapUrl !== null && (
            <>
              {" · "}
              {/* Odnośnik wychodzi z serwisu do map - bez uchwytu do okna
                  i bez przekazywania rankingu. */}
              <a
                href={mapUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="text-primary underline-offset-4 hover:underline"
              >
                {t("eventFront.practical.showOnMap")}
              </a>
            </>
          )}
        </PracticalRow>
      </dl>
    );
  }

  const hashtag = eventHashtag(info);
  const supportEmail = eventSupportEmail(info);

  return (
    <dl className="grid gap-4 rounded-lg border border-border bg-card p-5 sm:grid-cols-2">
      {info.languages.length > 0 && (
        <PracticalRow
          icon={<Globe className="h-4 w-4" />}
          label={t("eventFront.practical.languagesLabel")}
        >
          {/* Nazwy języków bierze `Intl.DisplayNames` (CLDR), a nie słownik
              i18n - kod języka jest DANYMI, nie tekstem interfejsu. */}
          {info.languages.map((code) => eventLanguageLabel(code, lang)).join(", ")}
        </PracticalRow>
      )}
      {hashtag !== "" && (
        <PracticalRow
          icon={<Hash className="h-4 w-4" />}
          label={t("eventFront.practical.hashtagLabel")}
        >
          <a
            href={`https://x.com/search?q=${encodeURIComponent(`#${hashtag}`)}`}
            target="_blank"
            rel="noopener noreferrer nofollow"
            aria-label={t("eventFront.practical.hashtagSearch", { hashtag: `#${hashtag}` })}
            className="text-primary underline-offset-4 hover:underline"
          >
            #{hashtag}
          </a>
        </PracticalRow>
      )}
      {supportEmail !== "" && (
        <PracticalRow
          icon={<LifeBuoy className="h-4 w-4" />}
          label={t("eventFront.practical.supportLabel")}
        >
          <a
            href={`mailto:${supportEmail}`}
            className="text-primary underline-offset-4 hover:underline"
          >
            {supportEmail}
          </a>
        </PracticalRow>
      )}
    </dl>
  );
}

function PracticalRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="inline-flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </dt>
      <dd className="mt-1 text-sm text-foreground">{children}</dd>
    </div>
  );
}
