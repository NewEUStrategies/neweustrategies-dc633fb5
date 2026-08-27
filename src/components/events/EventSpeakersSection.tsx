// Sekcja "Prelegenci" na stronie wydarzenia (/events/$slug). Prelegenci
// pochodza z relacji event_speakers (kolejnosc sort_order) wzbogaconej o
// profil prelegenta i eksperta (RPC get_public_speakers). Klik otwiera
// SpeakerProfileDialog. Sekcja znika, gdy wydarzenie nie ma prelegentow.
//
// TO JEST ZAPOWIEDZ, NIE DRUGA LISTA - I TAK MA ZOSTAC. Uklad poziomych chipow
// jest zamierzony i rozny od siatki na zakladce `/events/<slug>/speakers`
// (`EventSpeakersGrid`, cztery kolumny, kwadratowe zdjecie). Rozny UKLAD jest
// decyzja wlasciciela; rozne FAKTY nie byly. Plakietka eksperta stala tylko
// tutaj, a organizacja tylko w siatce - wiec ta sama osoba miala na jednej
// powierzchni afiliacje bez tytulu eksperta, a na drugiej odwrotnie. Oba fakty
// stoja teraz w obu miejscach i pilnuje tego bramka
// `__tests__/eventSpeakerFactParity.gate.test.tsx`.
//
// NAGLOWEK IDZIE Z JEDNEGO KLUCZA, WSPOLNEGO Z ZAMKIEM. Ten sam <h2> ma na
// przegladzie dwa miejsca rysowania: to (sekcja otwarta) i trase (sekcja
// zamknieta rysuje naglowek nad `SectionLockCard`). Dopoki szly z dwoch
// slownikow - `community.events.speakersTitle` tutaj i `sectionHeadingKey()`
// tam - zmiana nazwy sekcji w slowniku sekcji przestawialaby naglowek WYLACZNIE
// gosciom bez dostepu. Jeden klucz zamyka ten rozjazd; jest nim klucz sekcji,
// bo to on jest wartoscia domyslna dla nadpisania z bazy
// (`event_page_sections.heading_*`) i to jego uzywa kazda inna sekcja strony.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { speakersQueryOptions } from "@/lib/builder/speakersQuery";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { sectionHeadingKey } from "@/lib/events/eventSections";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";
import { SpeakerChip } from "./SpeakerChip";
import { SpeakerExpertBadge } from "./SpeakerExpertBadge";
import { SpeakerProfileDialog, type SpeakerDialogFallback } from "./SpeakerProfileDialog";

ensureEventFrontI18n();

export function EventSpeakersSection({ eventId, lang }: { eventId: string; lang: "pl" | "en" }) {
  const { t } = useTranslation();
  const speakersQ = useQuery({
    ...speakersQueryOptions({ source: "event", eventId, limit: 50 }, lang),
    enabled: !!eventId,
  });
  const [dialogSpeaker, setDialogSpeaker] = useState<{
    userId: string;
    fallback: SpeakerDialogFallback;
  } | null>(null);

  const speakers = speakersQ.data ?? [];
  if (speakers.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">{t(sectionHeadingKey("speakers"))}</h2>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {speakers.map((speaker) => {
          // Rola przez KANONICZNY selektor, ten sam, ktorego uzywa siatka:
          // recznie pisany lancuch `||` czytal napis z samych bialych znakow
          // jako wypelniony, wiec ta sama osoba mogla miec tu pusta linie roli,
          // a w siatce stanowisko z profilu.
          const role = pickLocalized(speaker, "headline", lang, speaker.job_title ?? "");
          return (
            <li key={speaker.user_id}>
              <SpeakerChip
                name={speaker.display_name ?? ""}
                role={role}
                organization={speaker.company ?? ""}
                photoUrl={speaker.avatar_url}
                size="lg"
                onClick={() =>
                  setDialogSpeaker({
                    userId: speaker.user_id,
                    fallback: {
                      name: speaker.display_name ?? "",
                      role,
                      photo: speaker.avatar_url ?? undefined,
                    },
                  })
                }
                trailing={speaker.is_expert ? <SpeakerExpertBadge /> : undefined}
              />
            </li>
          );
        })}
      </ul>

      {dialogSpeaker && (
        <SpeakerProfileDialog
          userId={dialogSpeaker.userId}
          lang={lang}
          open
          onOpenChange={(open) => {
            if (!open) setDialogSpeaker(null);
          }}
          fallback={dialogSpeaker.fallback}
        />
      )}
    </section>
  );
}
