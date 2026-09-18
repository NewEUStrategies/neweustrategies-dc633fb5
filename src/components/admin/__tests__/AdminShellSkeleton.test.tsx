// Szkielet powłoki panelu - pierwszy ekran `/admin`, zanim rozstrzygnie się sesja.
//
// PO CO TEN PLIK ISTNIEJE. „Wyrenderował się" nie jest tu żadnym dowodem:
// wyrenderuje się także wtedy, gdy przestanie robić to jedno, po co powstał.
// Przedmiotem dowodu jest PARYTET GEOMETRII z `AdminShell`.
//
// MECHANIZM DEFEKTU, który ten komponent zamyka. `/admin` to trasa `ssr: false`
// (sesja Supabase żyje w `localStorage`), więc dokument przychodzi z pustym
// ciałem, a pierwszy render klienta trafia na `useAuth().loading`. Malowała się
// wtedy JEDNA wyśrodkowana kropka w `min-h-screen flex items-center
// justify-center`, po czym React podmieniał ją na pełną powłokę: pasek boczny
// 14 rem, pole wyszukiwania, lista nawigacji, siatka treści. To nie jest
// dokończenie układu, tylko jego całkowita wymiana - najgrubszy pojedynczy
// wkład do CLS 0,532 zmierzonego na tej ścieżce (próg „Poor" = 0,250).
//
// DLATEGO KLASY UKŁADU SĄ PORÓWNYWANE ZE ŹRÓDŁEM `AdminShell.tsx`, a nie
// przepisane tutaj z pamięci: test przepisany z pamięci przechodzi dokładnie po
// tej zmianie, która psuje rzecz pilnowaną (ktoś zmienia pasek na `w-64`
// w powłoce i szkielet cicho przestaje pasować).
//
// GRANICA DOWODU. Nie mierzymy pikseli - happy-dom nie liczy układu, więc
// „zero przesunięcia" jest tu niemierzalne z definicji. Mierzymy JEDYNĄ rzecz,
// którą źródła ustalają: że obie powłoki deklarują te same klasy szerokości
// i ten sam korzeń. Pomiar CLS należy do RUM-u i do testów przeglądarkowych.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { AdminShellSkeleton } from "../AdminShellSkeleton";

const SHELL_SOURCE = readFileSync("src/components/admin/AdminShell.tsx", "utf8");
const ROUTE_SOURCE = readFileSync("src/routes/admin.tsx", "utf8");

afterEach(cleanup);

describe("parytet geometrii z AdminShell", () => {
  it("korzeń deklaruje te same klasy co powłoka", () => {
    const { container } = render(<AdminShellSkeleton />);
    const root = container.firstElementChild;
    expect(root).not.toBeNull();
    const className = root?.getAttribute("class") ?? "";
    for (const token of ["admin-compact", "min-h-screen", "bg-muted/30", "flex"]) {
      expect(className).toContain(token);
      // Ta sama klasa MUSI stać w źródle powłoki - inaczej parytet jest pozorny.
      expect(SHELL_SOURCE).toContain(token);
    }
  });

  it.each([
    { compact: false, width: "w-56" },
    { compact: true, width: "w-12" },
  ])("pasek boczny ma szerokość $width (compact: $compact)", ({ compact, width }) => {
    const { container } = render(<AdminShellSkeleton compact={compact} />);
    const aside = container.querySelector("aside");
    expect(aside).not.toBeNull();
    expect(aside?.getAttribute("class")).toContain(width);
    // Dowód, że to nie jest liczba wymyślona w teście: powłoka używa jej też.
    expect(SHELL_SOURCE).toContain(width);
  });

  it("pasek jest przyklejony na pełną wysokość, dokładnie jak w powłoce", () => {
    const { container } = render(<AdminShellSkeleton />);
    const className = container.querySelector("aside")?.getAttribute("class") ?? "";
    for (const token of ["sticky", "top-0", "h-screen", "border-r"]) {
      expect(className).toContain(token);
      expect(SHELL_SOURCE).toContain(token);
    }
  });

  it("`hideSidebar` zdejmuje pasek I zdejmuje `flex` z korzenia", () => {
    // Ta druga połowa jest istotna: powłoka warunkuje `flex` tym samym propem
    // (studio wydarzenia wymienia całą ramę), więc szkielet z `flex` bez paska
    // dałby inny układ treści niż powłoka, która po nim nastąpi.
    const { container } = render(<AdminShellSkeleton hideSidebar />);
    expect(container.querySelector("aside")).toBeNull();
    expect(container.firstElementChild?.getAttribute("class")).not.toContain("flex ");
  });
});

describe("dekoracyjność", () => {
  it("cały blok jest ukryty przed technologią asystującą", () => {
    // Ta sama doktryna, co w `EventsListSkeleton`: kilkanaście pustych
    // prostokątów ogłoszonych czytnikowi ekranu to szum, nie komunikat.
    const { container } = render(<AdminShellSkeleton />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  it("nie ma w środku ANI JEDNEGO znaku tekstu", () => {
    // Napis w bloku `aria-hidden` jest napisem, którego nikt nie usłyszy -
    // a w tym pliku byłby dodatkowo napisem JEDNOJĘZYCZNYM, bo szkielet stoi
    // przed rozstrzygnięciem słownika i nie ma jak go przetłumaczyć.
    const { container } = render(<AdminShellSkeleton />);
    expect((container.textContent ?? "").trim()).toBe("");
  });

  it("nie ma w środku ani jednej kontrolki - nie ma czego kliknąć ani sfokusować", () => {
    const { container } = render(<AdminShellSkeleton />);
    expect(container.querySelectorAll("button, a, input, [tabindex]").length).toBe(0);
  });
});

describe("niezależność", () => {
  it("nie potrzebuje słownika ani routera - renderuje się na gołym React", () => {
    // To jest cały sens tego komponentu: stoi PRZED rozstrzygnięciem sesji,
    // więc nie wolno mu czekać na cokolwiek, co samo się jeszcze ładuje.
    // Brak atrap w tym pliku (`vi.mock`) jest tu dowodem, a nie przeoczeniem.
    expect(() => render(<AdminShellSkeleton />)).not.toThrow();
  });
});

// PROP, KTÓREGO PRODUKCJA NIE USTAWIA, JEST PROPEM MARTWYM - a tu był gorszy
// niż martwy. `AdminShell` zwija pasek do 48 px, gdy najemca ma `style-4`
// (albo gdy trasa jest edytorem). Szkielet, który tego nie wie, maluje 224 px
// i sam produkuje przesunięcie o 176 px - czyli dokładnie to, które
// `lib/admin/sidebarStylePreference.ts` ma zdejmować. Defekt był NIEWIDOCZNY
// dla testów renderujących sam szkielet, bo szkielet obsługiwał `compact`
// poprawnie; brakowało WOŁAJĄCEGO. Dlatego asercja idzie po ŹRÓDLE trasy.
describe("trasa panelu faktycznie steruje szerokością szkieletu", () => {
  it("routes/admin.tsx przekazuje `compact` do szkieletu", () => {
    const usage = /<AdminShellSkeleton[^/]*\/>/s.exec(ROUTE_SOURCE)?.[0] ?? "";
    expect(usage).not.toBe("");
    expect(usage).toContain("compact=");
  });

  it("decyzja o zwinięciu ma JEDNO źródło - `isCompactSidebarRoute`", () => {
    // Powłoka i trasa muszą pytać tę samą funkcję. Dopóki predykat był
    // literałem regexpowym wewnątrz powłoki, trasa nie miała jak go poznać.
    expect(SHELL_SOURCE).toContain("isCompactSidebarRoute");
    expect(ROUTE_SOURCE).toContain("isCompactSidebarRoute");
    // I nikt nie przepisuje go z pamięci obok.
    expect(SHELL_SOURCE).not.toMatch(/\/\^\\\/admin\\\/\(posts\|pages\)/);
    expect(ROUTE_SOURCE).not.toMatch(/\/\^\\\/admin\\\/\(posts\|pages\)/);
  });

  it("szkielet bierze pod uwagę ZAPAMIĘTANY wariant paska, nie tylko trasę", () => {
    // Bez tego członu najemca ze `style-4` dostaje 224 px na każdym ekranie
    // panelu poza edytorami - czyli w większości wejść.
    expect(ROUTE_SOURCE).toContain("readRememberedSidebarStyle");
    expect(ROUTE_SOURCE).toContain("style-4");
  });
});
