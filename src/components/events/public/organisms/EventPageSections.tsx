// Organizm-scalający: sekcje treści strony wydarzenia w kolejności z bazy.
//
// KOLEJNOŚĆ I WIDOCZNOŚĆ NALEŻĄ DO ORGANIZATORA. `event_sections` oddaje
// osiem sekcji z `sort_order`, nadpisanym nagłówkiem i policzonym zamkiem -
// ten komponent tylko to rysuje. Gdyby układ stał w JSX-ie, przełącznik
// „pokaż program" w panelu byłby ozdobą.
//
// PIĘĆ SEKCJI, NIE OSIEM. Opis, zapisy i prelegenci mają na stronie wydarzenia
// własny (starszy) kod z własnymi nagłówkami, więc tutaj żyją wyłącznie te,
// które NIE MIAŁY powierzchni: program, partnerzy, materiały oraz - od tej
// zmiany - `map` i `contact`. Zamek sekcji prelegentów rozstrzyga trasa -
// obudowanie tamtego komponentu tym wrapperem dałoby dwa nagłówki jeden pod
// drugim.
//
// MAPA I KONTAKT WCHODZĄ TĄ SAMĄ MASZYNERIĄ, CO RESZTA. Adres strukturalny,
// języki treści, hashtag i adres wsparcia to treść dwóch sekcji, które już
// istnieją w bazie (`_event_default_sections()` daje im kolejność, nadpisywany
// nagłówek i widoczność). Narysowanie ich obok tego organizmu unieważniłoby
// przełącznik „pokaż dojazd" i bramkę gościa „wszystko poza kontaktami".
//
// PUSTE SEKCJE PRAKTYCZNE ODPADAJĄ TUTAJ, NIE W ŚRODKU. RPC oddaje dla mapy
// i kontaktu `has_content = NULL` („sekcja bez pojęcia treści"), więc pustkę
// liczy front - i musi to zrobić PRZED nagłówkiem, bo inaczej zostałaby karta
// „Dojazd" bez ani jednej linii pod spodem.
//
// ZAMKNIĘTA SEKCJA NIE POBIERA DANYCH. `enabled` schodzi do zapytań, więc
// gość nie wysyła zapytania o program, którego i tak nie zobaczy - a serwer
// nie liczy go dla nikogo, kto nie ma prawa go zobaczyć.
import { useTranslation } from "react-i18next";

import { uiLang } from "@/lib/i18n/format";
import {
  eventSectionHeading,
  shouldRenderSection,
  type EventSection,
  type EventSectionKey,
} from "@/lib/events/eventSections";
import { SectionLockCard } from "@/components/events/public/molecules/SectionLockCard";
import { EventPracticalSection } from "@/components/events/public/organisms/EventPracticalSection";
import {
  EVENT_PRACTICAL_SECTIONS,
  hasPracticalContent,
  isEventPracticalSection,
  type EventPracticalInfo,
} from "@/lib/events/eventPractical";
import { EventAgendaSection } from "@/components/events/public/organisms/EventAgendaSection";
import { EventSponsorsSection } from "@/components/events/public/organisms/EventSponsorsSection";
import { EventMaterialsSection } from "@/components/events/public/organisms/EventMaterialsSection";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";

ensureEventFrontI18n();

/** Sekcje, które ten organizm umie narysować. Reszta należy do trasy. */
const OWNED: readonly EventSectionKey[] = [
  "agenda",
  "sponsors",
  "materials",
  ...EVENT_PRACTICAL_SECTIONS,
];

export function EventPageSections({
  slug,
  sections,
  practical = null,
}: {
  slug: string;
  sections: readonly EventSection[];
  /** Kolumny wydarzenia dla sekcji `map` i `contact`; `null` = nie rysuj ich. */
  practical?: EventPracticalInfo | null;
}) {
  const owned = sections.filter((section) => {
    if (!OWNED.includes(section.key) || !shouldRenderSection(section)) return false;
    // Zamek zostaje ZAWSZE (karta zaproszenia jest treścią sekcji), więc
    // pustkę praktyczną sprawdzamy dopiero dla sekcji otwartej.
    if (!isEventPracticalSection(section.key) || section.isLocked) return true;
    return practical !== null && hasPracticalContent(practical, section.key);
  });
  if (owned.length === 0) return null;

  return (
    <>
      {owned.map((section) => (
        <EventPageSection key={section.key} slug={slug} section={section} practical={practical} />
      ))}
    </>
  );
}

function EventPageSection({
  slug,
  section,
  practical,
}: {
  slug: string;
  section: EventSection;
  practical: EventPracticalInfo | null;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);

  // Nadpisanie redakcji, a w jego braku napis ze słownika - JEDNYM selektorem
  // wspólnym z pozostałymi trzema miejscami rysującymi nagłówek sekcji (trasa
  // przeglądu: opis, zapisy; `EventSpeakersSection`: prelegenci). Ten organizm
  // był jedynym, który nadpisanie czytał, i dlatego mechanizm z niego wyszedł.
  const heading = eventSectionHeading(section, section.key, lang, t);

  return (
    <section id={`event-${section.key}`} className="mt-10 scroll-mt-24">
      <h2 className="text-lg font-semibold tracking-tight text-foreground">{heading}</h2>
      <div className="mt-4">
        {section.isLocked ? (
          <SectionLockCard reason={section.lockReason} sectionKey={section.key} eventSlug={slug} />
        ) : section.key === "agenda" ? (
          <EventAgendaSection slug={slug} />
        ) : section.key === "sponsors" ? (
          <EventSponsorsSection slug={slug} />
        ) : isEventPracticalSection(section.key) ? (
          // `practical !== null` jest już rozstrzygnięte przez filtr wyżej -
          // pozycja bez danych nie doszłaby do nagłówka.
          practical === null ? null : (
            <EventPracticalSection info={practical} section={section.key} />
          )
        ) : (
          <EventMaterialsSection slug={slug} />
        )}
      </div>
    </section>
  );
}
