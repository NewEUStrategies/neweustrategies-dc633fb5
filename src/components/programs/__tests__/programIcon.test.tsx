// Ikona programu badawczego + jej rejestr.
//
// `lib/programs/icons.ts` i `components/programs/ProgramIcon.tsx` to ostatnie
// dwa pliki funkcjonalności „Programy badawcze" bez ani jednej wykonanej
// linii. Rejestr wygląda na trywialny, ale niesie regułę, której złamanie
// kosztuje kilkaset kB w publicznym bundlu: ikony są importowane PO NAZWIE, a
// nie przez `import * as LucideIcons`. Namespace zaciąga całą bibliotekę na
// każdą stronę z programem - i nie widać tego ani w testach, ani w recenzji.
//
// Druga reguła jest produktowa: nazwa ikony przychodzi z bazy jako zwykły
// tekst wpisany w adminie. Literówka, pusta wartość albo nazwa ikony usuniętej
// z rejestru NIE może wysypać strony - ma spaść na Compass.
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DEFAULT_PROGRAM_ICON, PROGRAM_ICONS } from "@/lib/programs/icons";
import { ProgramIcon } from "@/components/programs/ProgramIcon";

/** Ślad kształtu ikony - dwie różne ikony Lucide dają różny `innerHTML`. */
function shape(name: string | null | undefined) {
  return render(<ProgramIcon name={name} />).container.innerHTML;
}

describe("PROGRAM_ICONS - rejestr", () => {
  it("każda pozycja NAPRAWDĘ się renderuje", () => {
    // Rejestr trafia wprost do JSX-a (`<Icon />`). Wpis, który nie jest
    // komponentem (napis z nazwą, obiekt konfiguracji, pomyłka w imporcie),
    // wywala render dopiero na produkcji - a sprawdzenie `typeof` niczego tu
    // nie dowodzi, bo ikony Lucide są obiektami `forwardRef`, nie funkcjami.
    const names = Object.keys(PROGRAM_ICONS);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const { container } = render(<ProgramIcon name={name} />);
      expect(container.querySelector("svg"), name).toBeInTheDocument();
    }
  });

  it("nie ma dwóch nazw wskazujących na TĘ SAMĄ ikonę", () => {
    // Duplikat w rejestrze daje w wybieraku admina dwa nierozróżnialne kafle.
    expect(new Set(Object.values(PROGRAM_ICONS)).size).toBe(Object.keys(PROGRAM_ICONS).length);
  });

  it("nazwy są kluczami wpisywanymi do bazy - trzymamy je w PascalCase", () => {
    // Admin zapisuje `Object.keys(PROGRAM_ICONS)`, a publiczny renderer czyta
    // po tym samym kluczu. Rozjazd wielkości liter to cichy fallback na Compass.
    expect(Object.keys(PROGRAM_ICONS).every((k) => /^[A-Z][A-Za-z]*$/.test(k))).toBe(true);
  });

  it("ikona zapasowa NALEŻY do rejestru", () => {
    // Gdyby fallback był spoza zestawu, strona pokazywałaby ikonę, której
    // redaktor nie może wybrać świadomie.
    expect(Object.values(PROGRAM_ICONS)).toContain(DEFAULT_PROGRAM_ICON);
  });
});

describe("ProgramIcon", () => {
  it("znana nazwa daje SWOJĄ ikonę, nie zapasową", () => {
    expect(shape("Shield")).not.toBe(shape(null));
    expect(shape("Globe")).not.toBe(shape("Shield"));
  });

  it("każda nazwa z rejestru rysuje się inaczej niż pozostałe", () => {
    // To jest test rejestru widziany od strony użytkownika: wybierak w
    // adminie pokazuje kafle, a nie nazwy, więc dwie identyczne ikony są
    // wyborem w ciemno.
    const shapes = Object.keys(PROGRAM_ICONS).map((name) => shape(name));
    expect(new Set(shapes).size).toBe(shapes.length);
  });

  it("nazwa spoza rejestru spada na ikonę zapasową, zamiast wywalić stronę", () => {
    // Wartość w kolumnie to zwykły tekst; ikona usunięta z rejestru zostawia
    // w bazie wiersze wskazujące na nieistniejący klucz.
    expect(shape("IkonaKtorejNieMa")).toBe(shape(null));
  });

  it("pusta nazwa i brak nazwy zachowują się tak samo", () => {
    expect(shape("")).toBe(shape(undefined));
    expect(shape("")).toBe(shape(null));
  });

  it("jest ukryta przed czytnikiem ekranu - obok stoi nazwa programu", () => {
    const { container } = render(<ProgramIcon name="Globe" />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  it("przyjmuje klasę rozmiaru z miejsca użycia", () => {
    const { container } = render(<ProgramIcon name="Globe" className="h-6 w-6" />);
    expect(container.firstElementChild).toHaveClass("h-6", "w-6");
  });
});
