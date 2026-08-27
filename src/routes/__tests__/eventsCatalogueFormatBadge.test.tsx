// KAFEL KATALOGU `/events`: plakietka formatu bierze się z `events.format`.
//
// CO TEN PLIK DOWODZI I DLACZEGO ISTNIEJE.
//
// Studio wydarzenia ma na ekranie „Informacje ogólne" droplistę „Format"
// z trzema wartościami (`onsite` / `online` / `hybrid`) i zapisuje ją do
// kolumny `events.format`. Kafel katalogu rysował plakietkę z CZEGOŚ INNEGO:
//
//   {event.kind === "online" && (… <Video /> online …)}
//
// `events.kind` to kolumna LEGACY z zupełnie innej dziedziny -
// `CHECK (kind IN ('webinar','briefing','roundtable','ama','in_person','hybrid'))`
// z `supabase/migrations/20260713093000_events_module.sql:34`, i żadna
// późniejsza migracja tego ograniczenia nie rusza. Wartości `'online'` ta
// kolumna NIE MOŻE PRZYJĄĆ, więc warunek nie był „nieaktualny" - był MARTWY:
// plakietka nie mogła się pokazać ani jednego razu, przy żadnym wydarzeniu.
// Jednocześnie `events.format`, które redakcja naprawdę ustawia, nie miało na
// stronie publicznej ANI JEDNEGO ujścia.
//
// Dlatego asercje mierzą DWIE rzeczy naraz, i to jest sedno tego pliku:
//   * że plakietka pokazuje wartość z `format` (trzy wartości, trzy napisy),
//   * że NIE pokazuje wartości z `kind` - wiersz z `kind: "online"`
//     i `format: "onsite"` musi dać „Na miejscu". Bez tej pary test przeszedłby
//     także wtedy, gdyby ktoś przywrócił stary warunek OBOK nowego.
//
// NAPISY SĄ BRANE ZE SŁOWNIKA, nie wpisane tutaj. `realT` przypina `t` do tej
// samej instancji i18next, której używa aplikacja (patrz `src/test/i18nReal.ts`
// i historia konwersji `defaultValue`), więc usunięcie klucza ze słownika
// OBLEWA ten test, zamiast go cicho przepuścić.
//
// PRZY OKAZJI: FALLBACK OPISU. Kafel liczył `desc` bez zapasowego języka,
// inaczej niż tytuł w linii obok. Wydarzenie opisane tylko po polsku miało dla
// czytelnika z interfejsem EN sam tytuł - mimo że redakcja opis wpisała. Ostatni
// przypadek pilnuje, żeby to nie wróciło.
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";

import i18n from "@/lib/i18n";
import "@/lib/i18n-community";
import { realT } from "@/test/i18nReal";
import { publicEventRow } from "@/test/events/publicEventRow";

// Kafel linkuje do `/events/$slug`, trasy której w drzewie testowym nie ma.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

const { EventCard } = await import("../events.index");

/** Napisy formatu ze słownika - jedno źródło dla asercji obu języków. */
const LABEL = {
  pl: {
    onsite: realT("pl")("community.events.formatOnsite"),
    online: realT("pl")("community.events.formatOnline"),
    hybrid: realT("pl")("community.events.formatHybrid"),
  },
  en: {
    onsite: realT("en")("community.events.formatOnsite"),
    online: realT("en")("community.events.formatOnline"),
    hybrid: realT("en")("community.events.formatHybrid"),
  },
} as const;

/** Kafel bez okładki: `OptimizedImage` nie jest przedmiotem tego dowodu. */
function renderCard(overrides: Parameters<typeof publicEventRow>[0], lang: "pl" | "en") {
  return render(
    <ul>
      <EventCard event={publicEventRow({ cover_url: null, ...overrides })} lang={lang} />
    </ul>,
  );
}

beforeAll(async () => {
  await i18n.changeLanguage("pl");
});

afterEach(async () => {
  // KOLEJNOŚĆ MA ZNACZENIE: najpierw odmontowanie, potem powrót do polskiego.
  // `changeLanguage` przy zamontowanym kafelku jest aktualizacją Reacta poza
  // `act(...)` - React wypisuje wtedy ostrzeżenie, a test przechodzi, więc
  // ostrzeżenie zostaje w logu CI na zawsze.
  cleanup();
  await i18n.changeLanguage("pl");
});

describe("kafel katalogu /events - plakietka formatu", () => {
  it("pokazuje napis ze słownika dla każdej z trzech wartości `events.format`", async () => {
    await i18n.changeLanguage("pl");
    for (const value of ["onsite", "online", "hybrid"] as const) {
      const { container } = renderCard({ format: value }, "pl");
      expect(container.textContent).toContain(LABEL.pl[value]);
      cleanup();
    }
  });

  it("ten sam kafel po angielsku bierze angielski napis z tego samego klucza", async () => {
    await i18n.changeLanguage("en");
    const { container } = renderCard({ format: "onsite" }, "en");
    expect(container.textContent).toContain(LABEL.en.onsite);
    // Kontrola, że to naprawdę inny napis, a nie polski fallback pod nazwą EN -
    // gdyby klucz EN zniknął, i18next oddałby polszczyznę i asercja wyżej
    // przeszłaby na „Na miejscu".
    expect(LABEL.en.onsite).not.toBe(LABEL.pl.onsite);
  });

  it("CZYTA `format`, NIE `kind` - wiersz z kind:'online' i format:'onsite' mówi „Na miejscu”", async () => {
    await i18n.changeLanguage("pl");
    const { container } = renderCard({ format: "onsite", kind: "online" }, "pl");
    const text = container.textContent ?? "";
    expect(text).toContain(LABEL.pl.onsite);
    // Stary, martwy warunek rysował dosłowne, nieprzetłumaczone „online".
    expect(text).not.toContain("online");
  });

  it("nieznana wartość formatu nie daje plakietki ani nie wypuszcza surowej wartości", async () => {
    await i18n.changeLanguage("pl");
    const { container } = renderCard({ format: "teleportacja" }, "pl");
    const text = container.textContent ?? "";
    expect(text).not.toContain("teleportacja");
    // Brak plakietki, a nie plakietka z pustym napisem: pusta plakietka czyta
    // się w rzędzie metadanych jak uszkodzone dane.
    for (const value of ["onsite", "online", "hybrid"] as const) {
      expect(text).not.toContain(LABEL.pl[value]);
    }
  });

  it("opis ma zapasowy język - wydarzenie opisane tylko po polsku jest czytelne w EN", async () => {
    await i18n.changeLanguage("en");
    const { container } = renderCard(
      { description_pl: "Dwa dni o bezpieczeństwie gospodarczym.", description_en: null },
      "en",
    );
    expect(container.textContent).toContain("Dwa dni o bezpieczeństwie gospodarczym.");
  });
});
