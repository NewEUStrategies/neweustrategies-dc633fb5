// Testy jedynego źródła prawdy dla kolorystyki widgetu „Ikony social”.
//
// Ten moduł nie renderuje niczego, ale rozstrzyga DWIE rzeczy naraz: co maluje
// renderer (podgląd w builderze ORAZ strona publiczna) i co pokazuje panel
// właściwości jako „faktycznie użyty kolor”. Rozejście się tych dwóch odczytów
// jest niewidoczne w testach renderujących - panel po prostu kłamie o kolorze,
// który redakcja właśnie widzi na kanwie.
//
// Dlatego dowodem są tu KONKRETNE łańcuchy CSS i domknięcie katalogu platform:
// dołożenie platformy do jednej mapy, a zapomnienie o drugiej, musi tu spaść.
import { describe, expect, it } from "vitest";
import {
  SOCIAL_HOVER_GRADIENT,
  SOCIAL_HOVER_ICON_COLOR,
  SOCIAL_HOVER_TEXT_COLOR,
  SOCIAL_IDLE_ICON_COLOR,
  SOCIAL_OFFICIAL_COLOR,
  socialBrandGradient,
  socialIdleColorHint,
  type SocialPlatformKey,
} from "@/lib/builder/socialBrand";

/** Katalog z typu - jeśli dojdzie platforma, ta lista rośnie razem z nim. */
const PLATFORMS: readonly SocialPlatformKey[] = [
  "facebook",
  "x",
  "youtube",
  "instagram",
  "linkedin",
  "spotify",
  "newsletter",
];

describe("socialBrandGradient", () => {
  it("platforma zwykła składa dwustopniowy gradient z własnych stopni", () => {
    expect(socialBrandGradient("facebook")).toBe(
      "linear-gradient(135deg, #1877F2 0%, #0C5FD1 100%)",
    );
    expect(socialBrandGradient("linkedin")).toBe(
      "linear-gradient(135deg, #0A66C2 0%, #004182 100%)",
    );
  });

  it("instagram dostaje TRZYSTOPNIOWY gradient marki, nie parę from/to", () => {
    // Marka Instagrama jest rozpoznawalna po środkowym różu - dwa stopnie
    // dawałyby pomarańcz przechodzący wprost w purpurę.
    const css = socialBrandGradient("instagram");
    expect(css).toBe("linear-gradient(135deg, #F58529 0%, #DD2A7B 55%, #8134AF 100%)");
    expect(css).toContain("#DD2A7B 55%");
    expect(css).not.toBe(
      `linear-gradient(135deg, ${SOCIAL_HOVER_GRADIENT.instagram.from} 0%, ${SOCIAL_HOVER_GRADIENT.instagram.to} 100%)`,
    );
  });

  it("newsletter to NASZA marka - gradient jedzie na tokenie --brand", () => {
    const css = socialBrandGradient("newsletter");
    expect(css).toBe(
      "linear-gradient(135deg, color-mix(in oklab, var(--brand) 64%, #17110C) 0%, color-mix(in oklab, var(--brand) 40%, #0F0C0A) 52%, color-mix(in oklab, var(--brand) 16%, #0B0B10) 100%)",
    );
    // Trzy odwołania do tokenu: gdyby któryś stopień utwardzono na hex,
    // zmiana koloru marki przestałaby się propagować na hover newslettera.
    expect(css?.match(/var\(--brand\)/g)).toHaveLength(3);
  });

  it("platforma spoza katalogu daje undefined - brak gradientu, nie pusty CSS", () => {
    // `undefined` pozwala wołającemu POMINĄĆ deklarację. Pusty łańcuch
    // nadpisałby gradient odziedziczony z motywu.
    expect(socialBrandGradient("tiktok")).toBeUndefined();
    expect(socialBrandGradient("")).toBeUndefined();
    expect(socialBrandGradient("FACEBOOK")).toBeUndefined();
  });

  it("nazwa własna spoza katalogu (nie z prototypu) daje undefined", () => {
    expect(socialBrandGradient("mastodon")).toBeUndefined();
    expect(socialBrandGradient("threads")).toBeUndefined();
  });

  it("każda platforma z katalogu ma poprawny, niepusty gradient", () => {
    for (const key of PLATFORMS) {
      const css = socialBrandGradient(key);
      expect(css, `brak gradientu dla ${key}`).toBeTruthy();
      expect(css).toMatch(/^linear-gradient\(135deg, .+ 0%, .+ 100%\)$/);
    }
  });
});

describe("socialIdleColorHint", () => {
  it("podpis pokazuje OBA tryby, rozdzielone dywizem", () => {
    expect(socialIdleColorHint("x")).toBe("light: #9E9E9E - dark: #FFFFFF");
    expect(socialIdleColorHint("facebook")).toBe("light: #7BB0F8 - dark: #1877F2");
  });

  it("newsletter pokazuje token, nie wyliczony hex", () => {
    // Panel ma mówić prawdę o tym, co jest w CSS: dla naszej marki to zmienna.
    expect(socialIdleColorHint("newsletter")).toBe("light: var(--brand) - dark: #FFFFFF");
  });

  it("platforma spoza katalogu daje PUSTY podpis, nie „undefined” w UI", () => {
    expect(socialIdleColorHint("tiktok")).toBe("");
    expect(socialIdleColorHint("")).toBe("");
  });

  it("podpis dla KAŻDEJ platformy zgadza się z mapą kolorów spoczynkowych", () => {
    // Ten test broni parytetu panel <-> renderer: podpis jest tylko widokiem
    // tej samej mapy, z której renderer bierze kolor ikony.
    for (const key of PLATFORMS) {
      const tone = SOCIAL_IDLE_ICON_COLOR[key];
      expect(socialIdleColorHint(key)).toBe(`light: ${tone.light} - dark: ${tone.dark}`);
    }
  });
});

describe("katalog kolorów marek - domknięcie", () => {
  it("każda platforma ma kolor spoczynkowy dla OBU trybów", () => {
    for (const key of PLATFORMS) {
      const tone = SOCIAL_IDLE_ICON_COLOR[key];
      expect(tone, `brak tonów dla ${key}`).toBeDefined();
      expect(tone.light).toBeTruthy();
      expect(tone.dark).toBeTruthy();
    }
  });

  it("każda platforma ma parę stopni hoveru", () => {
    for (const key of PLATFORMS) {
      const stops = SOCIAL_HOVER_GRADIENT[key];
      expect(stops, `brak stopni dla ${key}`).toBeDefined();
      expect(stops.from).toBeTruthy();
      expect(stops.to).toBeTruthy();
    }
  });

  it("newsletter NIE MA koloru oficjalnego - to marka własna, nie zewnętrzna", () => {
    expect(SOCIAL_OFFICIAL_COLOR.newsletter).toBeUndefined();
    expect(Object.keys(SOCIAL_OFFICIAL_COLOR).sort()).toEqual([
      "facebook",
      "instagram",
      "linkedin",
      "spotify",
      "x",
      "youtube",
    ]);
  });

  it("każdy kolor oficjalny to pełny hex - zasila style inline renderera", () => {
    for (const [key, color] of Object.entries(SOCIAL_OFFICIAL_COLOR)) {
      expect(color, `zły format koloru dla ${key}`).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it("ikona i tekst na hoverze są BIAŁE w obu trybach", () => {
    // Gradienty hoveru są ciemne w każdym wariancie, więc biel jest jedynym
    // kolorem, który spełnia kontrast bez rozgałęziania na tryb.
    expect(SOCIAL_HOVER_ICON_COLOR).toBe("#FFFFFF");
    expect(SOCIAL_HOVER_TEXT_COLOR).toBe("#FFFFFF");
  });

  it("dark mode zostawia SUROWY kolor marki, light go rozjaśnia", () => {
    // Kontrakt z komentarza modułu, zapisany liczbami: dla platform
    // zewnętrznych ton dark jest dokładnie kolorem oficjalnym.
    for (const [key, official] of Object.entries(SOCIAL_OFFICIAL_COLOR)) {
      if (key === "x") continue; // czarny nie ma jak być ikoną na czarnym tle
      expect(SOCIAL_IDLE_ICON_COLOR[key].dark).toBe(official);
      expect(SOCIAL_IDLE_ICON_COLOR[key].light).not.toBe(official);
    }
  });

  it("X w dark mode dostaje biel zamiast oficjalnej czerni", () => {
    // Jedyny świadomy wyjątek od reguły wyżej - marka X jest czarna, a czarna
    // ikona na ciemnym tle byłaby niewidoczna.
    expect(SOCIAL_OFFICIAL_COLOR.x).toBe("#000000");
    expect(SOCIAL_IDLE_ICON_COLOR.x.dark).toBe("#FFFFFF");
  });
});

describe("katalog kolorów marek - klucze spoza katalogu", () => {
  // NAPRAWIONE 2026-10-18 (był `it.fails`): KLUCZ Z PROTOTYPU OBJECT NIE
  // PRZECHODZI JUŻ PRZEZ STRAŻNIKA KATALOGU.
  //
  // WEJSCIE: platforma o nazwie pokrywającej się z właściwością
  //   `Object.prototype` - „constructor", „toString", „valueOf",
  //   „hasOwnProperty", „__proto__". Klucz platformy jedzie z `content` widgetu
  //   (repeater ikon), więc pochodzi z danych: importu obcej treści, migracji z
  //   WordPressa albo ręcznej edycji JSON-a dokumentu.
  // BYŁO: indeksowanie zwykłych obiektów szło po łańcuchu prototypów, więc
  //   `SOCIAL_HOVER_GRADIENT["constructor"]` zwracał funkcję `Object` i
  //   strażnik odmowy nie działał - gradient „undefined 0%, undefined 100%"
  //   (CSS odrzucał go w całości) i podpis panelu „light: undefined - dark:
  //   undefined".
  // KONTRAKT: oba katalogi są czytane przez `Object.hasOwn`, więc każda nazwa
  //   spoza katalogu - także z prototypu - kończy się „brak gradientu" i
  //   „pusty podpis", a słowo „undefined" nie trafia ani do CSS, ani do panelu.
  it("gradient dla klucza z prototypu jest undefined", () => {
    expect(socialBrandGradient("constructor")).toBeUndefined();
    expect(socialBrandGradient("toString")).toBeUndefined();
    expect(socialBrandGradient("__proto__")).toBeUndefined();
  });

  it("podpis dla klucza z prototypu jest pusty", () => {
    expect(socialIdleColorHint("valueOf")).toBe("");
    expect(socialIdleColorHint("hasOwnProperty")).toBe("");
    expect(socialIdleColorHint("__proto__")).toBe("");
  });
});
