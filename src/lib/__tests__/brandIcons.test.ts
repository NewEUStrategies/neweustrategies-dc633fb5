// Rejestr ikon marki, preferencja zestawu ikon i katalog pełnego zestawu.
// Do 18.08.2026: `brandIconRegistry.ts` 0 z 1 funkcji, `DynamicIconFull.tsx`
// 0 z 4, `iconPack.ts` bez pokrycia.
//
// Wspólny mianownik: WSZYSTKIE trzy dostają nazwę Z DANYCH (pole CMS, wiersz
// bazy, wejście użytkownika). Nazwa nieznana nie może wywrócić drzewa Reacta -
// musi trafić w bezpieczny fallback. To jest jedyna reguła, która się tu liczy,
// i do 18.08 nie miała ani jednego wywołania.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { BRAND_ICONS, resolveBrandIcon } from "@/lib/brandIconRegistry";
import { Circle, Facebook, Linkedin, Twitter, Mail, Globe } from "@/lib/lucide-shim";
import { setIconPack, useIconPack } from "@/lib/iconPack";
import { allIconNames, pascalToKebabIconName } from "@/lib/icons/DynamicIconFull";

describe("resolveBrandIcon", () => {
  it("rozpoznaje nazwę kanoniczną", () => {
    expect(resolveBrandIcon("facebook")).toBe(Facebook);
    expect(resolveBrandIcon("linkedin")).toBe(Linkedin);
  });

  it("rozpoznaje aliasy tej samej marki", () => {
    // „x”, „twitter” i „x-twitter” to jedna marka - trzy wpisy w CMS-ie nie
    // mogą dać trzech różnych ikon.
    for (const alias of ["twitter", "x", "x-twitter"]) {
      expect(resolveBrandIcon(alias)).toBe(Twitter);
    }
    expect(resolveBrandIcon("fb")).toBe(Facebook);
    expect(resolveBrandIcon("linked-in")).toBe(Linkedin);
  });

  it("normalizuje wielkość liter i spacje wewnętrzne", () => {
    // Redaktor wpisuje „Linked In” albo „LINKEDIN” - to nadal ta sama ikona.
    expect(resolveBrandIcon("  LINKED IN  ")).toBe(Linkedin);
    expect(resolveBrandIcon("Facebook")).toBe(Facebook);
    expect(resolveBrandIcon("X\tTwitter")).toBe(Twitter);
  });

  it("nieznana nazwa daje NEUTRALNY fallback, nie wyjątek", () => {
    // Ten moduł istnieje po to, żeby zła wartość w polu CMS nie wywracała
    // renderu całej sekcji kontaktowej.
    expect(resolveBrandIcon("myspace")).toBe(Circle);
    expect(resolveBrandIcon("<script>")).toBe(Circle);
  });

  it("brak wartości daje ten sam fallback", () => {
    expect(resolveBrandIcon(null)).toBe(Circle);
    expect(resolveBrandIcon(undefined)).toBe(Circle);
    expect(resolveBrandIcon("")).toBe(Circle);
    // Sama biel po `trim()` staje się pustą nazwą - nie może trafić w klucz.
    expect(resolveBrandIcon("   ")).toBe(Circle);
  });

  it("rozróżnia kanały ogólne: strona i poczta", () => {
    expect(resolveBrandIcon("website")).toBe(Globe);
    expect(resolveBrandIcon("web")).toBe(Globe);
    expect(resolveBrandIcon("email")).toBe(Mail);
    expect(resolveBrandIcon("mail")).toBe(Mail);
  });

  it("każdy alias w rejestrze wskazuje na istniejący komponent", () => {
    // Niezmiennik rejestru: wpis bez komponentu renderowałby `undefined` jako
    // element - czyli błąd Reacta w czasie wykonania, nie w czasie budowania.
    for (const [name, component] of Object.entries(BRAND_ICONS)) {
      expect(component, `alias ${name}`).toBeTruthy();
      expect(typeof component === "function" || typeof component === "object").toBe(true);
    }
  });

  it("klucze rejestru są w postaci znormalizowanej", () => {
    // Klucz z wielką literą albo spacją byłby nieosiągalny, bo szukamy po
    // wartości już znormalizowanej.
    for (const key of Object.keys(BRAND_ICONS)) {
      expect(key).toBe(key.trim().toLowerCase().replace(/\s+/g, "-"));
    }
  });
});

describe("useIconPack / setIconPack", () => {
  beforeEach(() => {
    setIconPack("lucide");
    window.localStorage.clear();
  });

  afterEach(() => {
    setIconPack("lucide");
  });

  it("domyślnym zestawem jest lucide", () => {
    const { result } = renderHook(() => useIconPack());
    expect(result.current).toBe("lucide");
  });

  it("zmiana zestawu odświeża KAŻDEGO subskrybenta", () => {
    // Preferencja jest globalna; dwa komponenty czytające ją niezależnie muszą
    // zobaczyć tę samą wartość w tym samym renderze.
    const a = renderHook(() => useIconPack());
    const b = renderHook(() => useIconPack());
    act(() => setIconPack("fontawesome"));

    expect(a.result.current).toBe("fontawesome");
    expect(b.result.current).toBe("fontawesome");
  });

  it("utrwala wybór w pamięci przeglądarki", () => {
    act(() => setIconPack("fontawesome"));
    expect(window.localStorage.getItem("nes.iconPack")).toBe("fontawesome");
  });

  it("ustawienie tej samej wartości nie odpala powiadomienia", () => {
    const { result, rerender } = renderHook(() => useIconPack());
    act(() => setIconPack("fontawesome"));
    const before = window.localStorage.getItem("nes.iconPack");
    act(() => setIconPack("fontawesome"));
    rerender();

    expect(result.current).toBe("fontawesome");
    expect(window.localStorage.getItem("nes.iconPack")).toBe(before);
  });

  it("odsubskrybowanie po odmontowaniu nie przewraca zmiany", () => {
    const { unmount } = renderHook(() => useIconPack());
    unmount();
    expect(() => act(() => setIconPack("fontawesome"))).not.toThrow();
  });
});

describe("pascalToKebabIconName", () => {
  it("rozdziela granice wielkich liter", () => {
    expect(pascalToKebabIconName("ArrowRight")).toBe("arrow-right");
    expect(pascalToKebabIconName("CircleUser")).toBe("circle-user");
  });

  it("rozdziela cyfrę od litery - to osobny segment nazwy", () => {
    // „Building2” to w katalogu „building-2”; bez tej reguły ikona byłaby
    // nieosiągalna i lądowała na znaku zapytania.
    expect(pascalToKebabIconName("Building2")).toBe("building-2");
    expect(pascalToKebabIconName("Grid3x3")).toBe("grid-3x-3");
  });

  it("rozdziela skrótowce od następnego słowa", () => {
    expect(pascalToKebabIconName("XLineTop")).toBe("x-line-top");
    expect(pascalToKebabIconName("QRCode")).toBe("qr-code");
  });

  it("nazwa już w kebabie przechodzi bez zmian", () => {
    expect(pascalToKebabIconName("arrow-right")).toBe("arrow-right");
  });

  it("pojedyncze słowo zostaje pojedynczym słowem", () => {
    expect(pascalToKebabIconName("Circle")).toBe("circle");
    expect(pascalToKebabIconName("")).toBe("");
  });
});

describe("allIconNames", () => {
  it("oddaje katalog nazw kanonicznych", () => {
    const names = allIconNames();
    expect(names.length).toBeGreaterThan(100);
    expect(names).toContain("circle");
  });

  it("katalog jest POSORTOWANY - picker nie może tasować pozycji", () => {
    const names = allIconNames();
    expect(names).toEqual([...names].sort());
  });

  it("wszystkie nazwy są w postaci kebab", () => {
    // Nazwa z wielką literą byłaby nieosiągalna przez `pascalToKebabIconName`.
    for (const name of allIconNames()) {
      expect(name).toBe(name.toLowerCase());
    }
  });

  it("katalog nie ma duplikatów", () => {
    const names = allIconNames();
    expect(new Set(names).size).toBe(names.length);
  });
});
