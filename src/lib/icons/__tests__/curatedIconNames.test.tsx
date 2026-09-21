// PARYTET DWÓCH LIST OPISUJĄCYCH TEN SAM ZESTAW.
//
// Skład zestawu kuratorowanego żyje w `DynamicIcon.tsx` jako mapa nazwa ->
// KOMPONENT (bo tylko tak działa tree-shaking nazwanych importów), a bramka CI
// `check:menu-icons` potrzebuje samych NAZW, bez Reacta i bez `lucide-react`
// (biegnie pod bun-em, w jobie bez builda). Stąd druga lista:
// `curatedIconNames.ts`.
//
// Dwie listy to ryzyko rozjazdu, a rozjazd byłby tu CICHY I GROŹNY: bramka
// mierzyłaby zestaw, którego już nie ma, i przepuszczała nazwy ściągające pełny
// rejestr ikon (473 KB źródeł, 109 KB gzip) do przeglądarki każdego anonima.
// Ten plik zamienia ryzyko w czerwony test - w OBIE strony.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Pełny rejestr podmieniamy znacznikiem: jego pojawienie się znaczy, że nazwa
// z listy NIE renderuje się synchronicznie, czyli lista kłamie.
vi.mock("../DynamicIconFull", () => ({
  default: ({ iconKey }: { iconKey: string }) => <span data-testid="pelny">{iconKey}</span>,
}));

import { CURATED_ICON_KEYS, DynamicIcon } from "../DynamicIcon";
import { CURATED_ICON_NAMES, isCuratedIconName, normalizeIconName } from "../curatedIconNames";

describe("CURATED_ICON_NAMES kontra mapa CURATED", () => {
  it("opisuje DOKŁADNIE te same ikony co mapa komponentów", () => {
    const zMapy = [...CURATED_ICON_KEYS].map(normalizeIconName).sort();
    expect([...CURATED_ICON_NAMES].sort()).toEqual(zMapy);
  });

  it("nie powtarza nazwy i trzyma je w kebab-case", () => {
    expect(new Set(CURATED_ICON_NAMES).size).toBe(CURATED_ICON_NAMES.length);
    expect(CURATED_ICON_NAMES.filter((name) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name))).toEqual([]);
  });

  it("każda nazwa z listy renderuje się SYNCHRONICZNIE, bez leniwego chunka", () => {
    // To jest dowód najmocniejszy: lista nie tylko zgadza się z mapą literalnie,
    // ale każda jej pozycja przechodzi przez PRAWDZIWY resolwer bez sięgnięcia
    // po pełny rejestr.
    for (const name of CURATED_ICON_NAMES) {
      const { container, unmount } = render(<DynamicIcon name={name} />);
      expect(container.querySelector("svg"), name).toBeTruthy();
      expect(screen.queryByTestId("pelny"), name).toBeNull();
      unmount();
    }
  });
});

describe("normalizeIconName - ta sama ścieżka co w resolwerze", () => {
  it.each([
    ["graduation-cap", "graduation-cap"],
    ["GraduationCap", "graduation-cap"],
    ["graduation_cap", "graduation-cap"],
    ["  graduation cap  ", "graduation-cap"],
    ["LogIn", "log-in"],
    ["logIn", "log-in"],
    ["building-2", "building-2"],
    ["Building2", "building-2"],
    ["BarChart3", "bar-chart-3"],
  ])("%s -> %s", (raw, expected) => {
    expect(normalizeIconName(raw)).toBe(expected);
  });

  it("pusta wartość oddaje pusty napis - to `bez ikony`, nie usterka", () => {
    for (const raw of ["", "   ", null, undefined]) {
      expect(normalizeIconName(raw as unknown as string)).toBe("");
    }
  });
});

describe("isCuratedIconName", () => {
  it("rozpoznaje ikonę z zestawu niezależnie od zapisu", () => {
    expect(isCuratedIconName("calendar-days")).toBe(true);
    expect(isCuratedIconName("CalendarDays")).toBe(true);
  });

  it("odrzuca nazwę spoza zestawu i nazwę pustą", () => {
    // `pencil-ruler` jest w panelu wydarzeń - poprawna nazwa lucide, która
    // mimo to kosztuje leniwy chunk, więc w chrome nie ma prawa się pojawić.
    expect(isCuratedIconName("pencil-ruler")).toBe(false);
    expect(isCuratedIconName("")).toBe(false);
  });
});
