// Jak PUBLICZNA powierzchnia klubów obchodzi się z językiem - bramka na WZORZEC.
//
// Ten moduł niósł największy pojedynczy dług językowy w repo: `isPl: boolean`
// deklarowany w 39 sygnaturach propsów i przekazywany w dół przez cztery
// poziomy drzewa (trasa -> ekran -> panel -> karta). Konwersja polegała na
// zdjęciu go w całości: każdy komponent wyprowadza język sam, przez `uiLang`,
// a treść z bliźniaczych kolumn idzie przez `pickLocalized`.
//
// CZEGO TA BRAMKA PILNUJE - i dlaczego akurat tego:
//
//   1. `isPl` nie wraca. Ani jako props, ani jako zmienna lokalna. Typ
//      `boolean` niczego nie podpowiadał, więc nowe miejsce montowania mogło
//      po prostu zapomnieć podać język - i dostawało wtedy `undefined`,
//      czyli "angielski", bez jednego ostrzeżenia.
//   2. Treść z bliźniaczych kolumn idzie przez `pickLocalized`. Ręczne
//      `isPl ? x_pl : x_en` NIE miało fallbacku na drugi język, więc klub czy
//      dział opisany tylko po jednemu renderował pustą etykietę.
//   3. Wynik `pickLocalized` nie jest porównywany z `null`. To jest KONKRETNY
//      błąd, który popełniłem w tej konwersji: helper zwraca "" zamiast null,
//      więc `pickLocalized(...) !== null` jest zawsze prawdziwe - zakładka
//      "Zasady" zapalała się dla klubu bez zasad, a puste blurb renderowało
//      pusty akapit. Bramka trzyma ten błąd zamkniętym.
//   4. Znaczniki BCP-47 i kody języka mieszkają w `lib/i18n/format`, nie
//      w komponencie.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIRS = [
  "src/components/clubs/molecules",
  "src/components/clubs/organisms",
  "src/components/clubs/atoms",
];

/** Czyste moduły domenowe - biorą `LocaleCode`, nie flagę. */
const LIB = "src/lib/clubs";

function tsFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => /\.tsx?$/.test(name))
    .map((name) => join(dir, name));
}

const FILES = [...DIRS.flatMap(tsFiles), ...tsFiles(LIB)]
  .filter((path) => !path.includes("__tests__"))
  .map((path) => ({ path, src: readFileSync(path, "utf8") }));

/** Kod bez komentarzy - komentarze WOLNO opisywac stary wzorzec. */
function code(src: string): string {
  return src
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

describe("publiczna powierzchnia klubów - obsługa języka", () => {
  it("obejmuje cały moduł, nie próbkę", () => {
    // Bramka bez tej asercji cicho przestaje cokolwiek sprawdzać, jeśli ktoś
    // przeniesie pliki do nowego katalogu.
    expect(FILES.length).toBeGreaterThan(60);
  });

  it("nie zna słowa `isPl`", () => {
    const offenders = FILES.filter(({ src }) => /\bisPl\b/.test(code(src))).map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it("nie wybiera treści ręcznym warunkiem na bliźniaczych kolumnach", () => {
    const offenders: string[] = [];
    for (const { path, src } of FILES) {
      for (const m of code(src).matchAll(/\?\s*[\w.]+_(?:pl|en)\s*:\s*[\w.]+_(?:pl|en)/g)) {
        offenders.push(`${path}: ${m[0].trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("nie porównuje wyniku `pickLocalized` z null", () => {
    // Helper zwraca "" gdy OBA języki są puste. `!== null` jest więc zawsze
    // prawdziwe i cicho odwraca warunek widoczności.
    const offenders: string[] = [];
    for (const { path, src } of FILES) {
      for (const m of code(src).matchAll(/pickLocalized\([^;]*?\)\s*[!=]==\s*null/g)) {
        offenders.push(`${path}: ${m[0].trim()}`);
      }
      for (const m of code(src).matchAll(/pickLocalized\([^;]*?\)\s*\?\?/g)) {
        offenders.push(`${path}: ${m[0].trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("nie wpisuje twardych znaczników BCP-47 do FORMATOWANIA", () => {
    // Celowo WĄSKO: bramka pilnuje znaczników użytych do formatowania dla
    // czytelnika (data, liczba, waluta) - te należą do `lib/i18n/format`,
    // bo jeden rozjazd daje dwa formaty daty na jednym ekranie.
    //
    // NIE dotyczy `toLocaleLowerCase("pl-PL")` / `toLocaleUpperCase("pl-PL")`.
    // Tam locale nie zależy od języka interfejsu i zależeć NIE MOŻE: normalizacja
    // hasztagu do klucza (`inlineSegments`) i sprawdzenie, czy nagłówek jest
    // kapitalikami (`ClubProse`), muszą dać ten sam wynik dla polskiego
    // i angielskiego czytelnika - inaczej ten sam hasztag rozjechałby się
    // na dwa różne klucze w zależności od tego, kto go napisał.
    const offenders: string[] = [];
    for (const { path, src } of FILES) {
      const stripped = code(src).replace(/toLocale(?:Lower|Upper)Case\("[a-zA-Z-]+"\)/g, "");
      if (stripped.includes('"pl-PL"') || stripped.includes('"en-GB"')) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });

  it("wyprowadza język interfejsu helperem, nie kopią warunku", () => {
    const offenders: string[] = [];
    for (const { path, src } of FILES) {
      if (/\(i18n\.language \?\? "pl"\)\.startsWith\(/.test(code(src))) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });

  it("nie trzyma surowych bajtów sterujących w źródle", () => {
    // `threadSources.ts` miał wpisany wprost bajt 0x00 (sentinel kubełka "bez
    // działu"), przez co `grep`, `ripgrep` i `git diff` uznawały cały moduł za
    // plik BINARNY - był niewidoczny dla wszystkich asercji powyżej.
    const offenders: string[] = [];
    for (const { path, src } of FILES) {
      // eslint-disable-next-line no-control-regex
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(src)) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });
});
