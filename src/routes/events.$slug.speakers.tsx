// Zakładka PRELEGENCI wydarzenia: `/events/$slug/speakers`.
//
// WZORZEC: docs/zrzuty/swapcard-2026-08-23/39-preview-speakers-grid.png -
// siatka kart po cztery w wierszu, kwadratowe zdjęcie, pod nim wyśrodkowane
// nazwisko, rola i organizacja. Rysuje ją `EventSpeakersGrid`.
//
// KLIK W KARTĘ OTWIERA DIALOG, NIE OSOBNĄ STRONĘ - decyzja właściciela. Dialog
// nie powstaje tutaj drugi raz: `SpeakerProfileDialog` istnieje i jest tym
// samym, który otwiera sekcja prelegentów na przeglądzie i widget `speakers`.
// Drugi dialog profilu znaczyłby dwa rysunki jednego profilu i dwie chwile,
// w których się rozjeżdżają.
//
// SIATKA CHCE `eventId`, A TRASA MA `slug`. Identyfikator bierzemy z tej samej
// migawki wydarzenia, co powłoka (`["public-event", slug]`), więc to nie jest
// drugie zapytanie - react-query oddaje wynik z cache.
import { useState } from "react";
import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { fetchPublicEventBySlug } from "@/lib/community/publicQueries";
import { uiLang } from "@/lib/i18n/format";
import { EventModulePage } from "@/components/events/public/molecules/EventModulePage";
import { EventSpeakersGrid } from "@/components/events/public/organisms/EventSpeakersGrid";
import {
  SpeakerProfileDialog,
  type SpeakerDialogFallback,
} from "@/components/events/SpeakerProfileDialog";
import { pickLocalized } from "@/lib/i18n/pickLocalized";

export const Route = createFileRoute("/events/$slug/speakers")({
  component: EventSpeakersTab,
});

function EventSpeakersTab() {
  const { slug } = useParams({ from: "/events/$slug/speakers" });
  const { i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const eventQ = useQuery({
    queryKey: ["public-event", slug],
    queryFn: () => fetchPublicEventBySlug(slug),
  });
  const eventId = eventQ.data?.id ?? "";

  // Dane awaryjne dialogu bierzemy z wiersza, w który uczestnik kliknął -
  // dzięki temu okno ma nazwisko i zdjęcie od pierwszej klatki, jeszcze zanim
  // dojedzie pełny profil.
  const [selected, setSelected] = useState<{
    userId: string;
    fallback: SpeakerDialogFallback;
  } | null>(null);

  return (
    <EventModulePage slug={slug} module="speakers">
      <EventSpeakersGrid
        eventId={eventId}
        onSelect={(speaker) =>
          setSelected({
            userId: speaker.user_id,
            fallback: {
              name: speaker.display_name ?? "",
              // Ta sama kolejność, co w karcie siatki: `headline` w języku
              // interfejsu, a w jego braku stanowisko z profilu - inaczej ta
              // sama osoba byłaby „Prezesem” na karcie i bez roli w oknie.
              role: pickLocalized(speaker, "headline", lang, speaker.job_title ?? ""),
              photo: speaker.avatar_url ?? undefined,
            },
          })
        }
      />
      {selected !== null && (
        <SpeakerProfileDialog
          userId={selected.userId}
          lang={lang}
          open
          onOpenChange={(open) => {
            if (!open) setSelected(null);
          }}
          fallback={selected.fallback}
        />
      )}
    </EventModulePage>
  );
}
