// Organizm-scalający: sekcje treści strony wydarzenia w kolejności z bazy.
//
// KOLEJNOŚĆ I WIDOCZNOŚĆ NALEŻĄ DO ORGANIZATORA. `event_sections` oddaje
// osiem sekcji z `sort_order`, nadpisanym nagłówkiem i policzonym zamkiem -
// ten komponent tylko to rysuje. Gdyby układ stał w JSX-ie, przełącznik
// „pokaż program" w panelu byłby ozdobą.
//
// TRZY SEKCJE, NIE OSIEM. Opis, zapisy, prelegenci, mapa i kontakt mają na
// stronie wydarzenia własny (starszy) kod z własnymi nagłówkami, więc tutaj
// żyją wyłącznie te, które wcześniej NIE MIAŁY powierzchni: program, partnerzy
// i materiały. Zamek sekcji prelegentów rozstrzyga trasa - obudowanie tamtego
// komponentu tym wrapperem dałoby dwa nagłówki jeden pod drugim.
//
// ZAMKNIĘTA SEKCJA NIE POBIERA DANYCH. `enabled` schodzi do zapytań, więc
// gość nie wysyła zapytania o program, którego i tak nie zobaczy - a serwer
// nie liczy go dla nikogo, kto nie ma prawa go zobaczyć.
import { useTranslation } from "react-i18next";

import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import {
  sectionHeadingKey,
  shouldRenderSection,
  type EventSection,
  type EventSectionKey,
} from "@/lib/events/eventSections";
import { SectionLockCard } from "@/components/events/public/molecules/SectionLockCard";
import { EventAgendaSection } from "@/components/events/public/organisms/EventAgendaSection";
import { EventSponsorsSection } from "@/components/events/public/organisms/EventSponsorsSection";
import { EventMaterialsSection } from "@/components/events/public/organisms/EventMaterialsSection";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";

ensureEventFrontI18n();

/** Sekcje, które ten organizm umie narysować. Reszta należy do trasy. */
const OWNED: readonly EventSectionKey[] = ["agenda", "sponsors", "materials"];

export function EventPageSections({
  slug,
  sections,
}: {
  slug: string;
  sections: readonly EventSection[];
}) {
  const owned = sections.filter(
    (section) => OWNED.includes(section.key) && shouldRenderSection(section),
  );
  if (owned.length === 0) return null;

  return (
    <>
      {owned.map((section) => (
        <EventPageSection key={section.key} slug={slug} section={section} />
      ))}
    </>
  );
}

function EventPageSection({ slug, section }: { slug: string; section: EventSection }) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);

  const heading = pickLocalized(
    { heading_pl: section.headingPl, heading_en: section.headingEn },
    "heading",
    lang,
    t(sectionHeadingKey(section.key)),
  );

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
        ) : (
          <EventMaterialsSection slug={slug} />
        )}
      </div>
    </section>
  );
}
