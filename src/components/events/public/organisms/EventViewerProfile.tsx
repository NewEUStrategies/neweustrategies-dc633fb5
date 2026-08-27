// Organizm: KARTA PROFILU WIDZA w lewej kolumnie przeglądu - ODNOŚNIK
// I ŹRÓDŁO FAKTÓW. Sam rysunek karty mieszka w molekule `EventViewerCard`, bo
// tę samą kartę musi pokazać podgląd w studiu, który tego organizmu zamontować
// nie może: odnośnik „Edytuj” jest `<Link>`-iem, a podgląd stoi poza drzewem
// tras (`<Link>` bez `RouterProvider` rzuca) i klik wyprowadziłby redaktora ze
// studia z niezapisanym szkicem w formularzu.
//
// FAKTY LICZY WSPÓLNY HOOK (`useViewerCardFacts`), nie ten plik - patrz jego
// nagłówek. Tu zostaje wyłącznie decyzja „co jest odnośnikiem".
//
// GOŚĆ NIE WIDZI KARTY WCALE - i to jest jedyna poprawna odpowiedź. Wzorzec
// (zrzut 38) pokazuje stronę OCZAMI ZALOGOWANEGO uczestnika; dla
// niezalogowanego nie ma ani zdjęcia, ani stanowiska, ani czego edytować,
// a atrapa „Zaloguj się, żeby zobaczyć swój profil” zajmowałaby całą kolumnę
// treścią o nas samych. Kolumna zostaje wtedy przy karcie „kiedy, gdzie, ile
// miejsc”, która ma dane niezależnie od tego, kto patrzy.
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";

import { useViewerCardFacts } from "@/lib/profile/useViewerCard";
import { EventViewerCard } from "@/components/events/public/molecules/EventViewerCard";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";

ensureEventFrontI18n();

/**
 * Adres edycji profilu - ten sam literał, co pozycja „edit” w `ProfileNav`.
 * `/profile/edit` jest jedynym ekranem, na którym da się zmienić zdjęcie,
 * stanowisko i organizację, czyli dokładnie te pola, które ta karta pokazuje.
 */
const PROFILE_EDIT_PATH = "/profile/edit";

export function EventViewerProfile() {
  const { t } = useTranslation();
  const viewer = useViewerCardFacts();

  if (viewer === null) return null;

  return (
    <EventViewerCard
      name={viewer.name}
      jobTitle={viewer.jobTitle}
      company={viewer.company}
      avatarUrl={viewer.avatarUrl}
      editSlot={
        <Link
          to={PROFILE_EDIT_PATH}
          className="rounded-[4px] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("eventFront.viewer.edit")}
        </Link>
      }
    />
  );
}
