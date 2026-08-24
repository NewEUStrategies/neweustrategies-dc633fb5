// EB-912: JEDNA FUNKCJA, CZTERY MIEJSCA - bramka przyjęcia wspólnego modułu strefy.
//
// PO CO TA BRAMKA ISTNIEJE. Projekt frontu (docs/PROJEKT_FRONT_WYDARZENIA_2026-08-23.md,
// sekcja 4.4) opisał defekt, który nie jest błędem w jednym pliku, lecz ROZJAZDEM
// MIĘDZY CZTEREMA: data wydarzenia liczyła się w czterech miejscach i tylko jedno
// z nich znało `events.timezone`. Taki defekt wraca sam, bo nic go nie pilnuje -
// wystarczy, że ktoś doda piąty widok i napisze w nim `toLocaleString`.
//
// Testy jednostkowe modułu `timezone.ts` dowodzą, że funkcja liczy poprawnie.
// NIE dowodzą, że ktokolwiek jej używa. Ta bramka pilnuje właśnie tego drugiego:
// powierzchnia wydarzeń NIE formatuje dat sama.
//
// RATCHET, NIE MUR. Lista `MIGRATED` musi rosnąć, a `PENDING` maleć. Bramka jest
// czerwona, gdy plik z `MIGRATED` znów formatuje datę u siebie albo gdy dług
// w `PENDING` się zwiększa. Zmniejszenie długu jest raportowane, nie karane -
// ten sam idiom co `check:i18n-hardcoded` i `check:unknown-casts`.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Wywołania, które liczą datę BEZ strefy wydarzenia. */
const OWN_FORMATTING =
  /\.toLocaleString\(|\.toLocaleDateString\(|\.toLocaleTimeString\(|new Intl\.DateTimeFormat\(/g;

const TIMEZONE_IMPORT = /from "@\/lib\/events\/timezone"/;

/** Pliki, które JUŻ przeszły na wspólny moduł. Ta lista ma tylko rosnąć. */
const MIGRATED = [
  "src/routes/events.tsx",
  "src/components/builder/organisms/widget-view/EventsListView.tsx",
  "src/components/builder/organisms/widget-view/EventCountdownCardView.tsx",
  "src/components/admin/events/organisms/EventsListManager.tsx",
] as const;

/**
 * Dług, który został - z górnym limitem zmierzonym, nie zgadniętym.
 *
 * `events.$slug.tsx` nadal ma jedno własne formatowanie. Zejdzie razem z przejściem
 * tej trasy na kontrakt `event_page_header` (ta trasa jest przebudowywana osobno).
 */
const PENDING: ReadonlyArray<{ file: string; maxOwnFormatting: number }> = [
  { file: "src/routes/events.$slug.tsx", maxOwnFormatting: 1 },
];

function read(file: string): string {
  return readFileSync(resolve(process.cwd(), file), "utf8");
}

function countOwnFormatting(source: string): number {
  return source.match(OWN_FORMATTING)?.length ?? 0;
}

describe("EB-912 - powierzchnia wydarzeń nie formatuje dat sama", () => {
  it.each(MIGRATED)("%s liczy datę wyłącznie przez wspólny moduł", (file) => {
    const source = read(file);
    expect(TIMEZONE_IMPORT.test(source)).toBe(true);
    expect(countOwnFormatting(source)).toBe(0);
  });

  it.each(PENDING)("$file nie zwiększa długu formatowania", ({ file, maxOwnFormatting }) => {
    const count = countOwnFormatting(read(file));
    expect(count).toBeLessThanOrEqual(maxOwnFormatting);
    if (count < maxOwnFormatting) {
      // Dług zmalał - to jest dobra wiadomość, ale lista musi za tym pójść,
      // inaczej bramka przestaje pilnować czegokolwiek.
      console.warn(
        `[EB-912] ${file}: ${maxOwnFormatting} -> ${count}. Zaktualizuj PENDING w dół albo przenieś plik do MIGRATED.`,
      );
    }
  });

  it("karta listy publicznej podaje strefę obok godziny", () => {
    // Sama godzina w obcej strefie jest gorsza niż brak godziny: uczestnik czyta
    // ją jako swoją. Dlatego karta MUSI wołać etykietę strefy, nie tylko format.
    const source = read("src/routes/events.tsx");
    expect(source).toContain("eventTimeZoneLabel");
    expect(source).toContain("formatEventDateTime");
  });

  it("widget odliczania bierze strefę z wiersza wydarzenia, nie z przeglądarki", () => {
    const source = read("src/components/builder/organisms/widget-view/EventCountdownCardView.tsx");
    expect(source).toContain("formatEventDateTime(");
    expect(source).toMatch(/eventRow\?\.timezone/);
  });
});
