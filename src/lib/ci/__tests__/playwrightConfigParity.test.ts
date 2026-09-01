// PARYTET DWÓCH KONFIGURACJI PLAYWRIGHTA - bramka na rozjazd, który raz już
// przepuścił czerwień na runnerze.
//
// CO SIĘ STAŁO. `playwright.artifact.config.ts` twierdził w nagłówku, że specy
// `boot-artifact` i `boot-timing` są „uruchamiane WYŁĄCZNIE przez tę
// konfigurację, nigdy przez zwykłe `bun run test:e2e`". Zdanie było
// nieprawdziwe: domyślna `playwright.config.ts` ma `testDir: "./e2e"` i BIERZE
// CAŁY KATALOG, więc oba specy pojechały po DEV-SERVERZE. Zmierzone na runnerze
// (przebieg 33512138275, job `e2e`): `readyMs` 19 963 ms wobec budżetu 6 000,
// `staticGraphCount` = 0 („dokument nie pobrał domknięcia statycznego" - bo
// w dev domknięcia statycznego NIE MA) i sonda uznała boot za martwy po
// 15 001 ms. Trzy czerwone asercje, z których żadna nie mówiła nic o produkcie.
//
// DLACZEGO KOMENTARZ NIE WYSTARCZY - i dlaczego ten plik istnieje. Wzorzec żyje
// w DWÓCH plikach: `testMatch` w konfiguracji artefaktowej i `testIgnore`
// w domyślnej. Nic w Playwrightcie nie wiąże ich ze sobą, więc dopisanie
// trzeciego specu artefaktowego do jednego wzorca i zapomnienie o drugim jest
// niewidoczne do pierwszego czerwonego przebiegu CI - a wtedy czerwień będzie
// wyglądała na awarię produktu, nie na błąd konfiguracji. Tu ten rozjazd jest
// niewyrażalny: bramka porównuje oba wzorce znak w znak i sprawdza, że PODZIAŁ
// plików między konfiguracje jest PEŁNY i ROZŁĄCZNY.
//
// TRZECI WARUNEK, najważniejszy z praktycznego punktu widzenia: spec nieobjęty
// ŻADNĄ konfiguracją nie jest uruchamiany przez nic. Taki plik wygląda
// w repozytorium jak test, a jest martwym kodem - dokładnie ta klasa, którą to
// zadanie zamyka w kilku innych miejscach.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DEFAULT_CONFIG = "playwright.config.ts";
const ARTIFACT_CONFIG = "playwright.artifact.config.ts";
const E2E_DIR = "e2e";

/**
 * Wyciąga literał wyrażenia regularnego stojący po podanym kluczu.
 *
 * Czytamy ŹRÓDŁO, a nie zaimportowaną konfigurację, i to jest świadome:
 * `defineConfig` Playwrighta wymaga jego runtime'u, a jedyne, co tu sprawdzamy,
 * to zgodność DWÓCH LITERAŁÓW. Import ściągałby całą paczkę testową do procesu
 * vitesta po to, żeby porównać dwa napisy.
 */
function regexLiteralAfter(source: string, key: string): string {
  const match = new RegExp(`${key}:\\s*(/(?:[^/\\\\\\n]|\\\\.)+/[gimsuy]*)`).exec(source);
  if (!match) throw new Error(`nie znalazłem literału wyrażenia dla klucza \`${key}\``);
  return match[1];
}

/** Literał `/wzorzec/flagi` -> działający `RegExp`. */
function toRegExp(literal: string): RegExp {
  const lastSlash = literal.lastIndexOf("/");
  return new RegExp(literal.slice(1, lastSlash), literal.slice(lastSlash + 1));
}

const defaultSource = readFileSync(DEFAULT_CONFIG, "utf8");
const artifactSource = readFileSync(ARTIFACT_CONFIG, "utf8");

const ignoreLiteral = regexLiteralAfter(defaultSource, "testIgnore");
const matchLiteral = regexLiteralAfter(artifactSource, "testMatch");

/** Pliki specyfikacji w `e2e/` - płasko, bo Playwright też tak je tu widzi. */
const specs = readdirSync(E2E_DIR)
  .filter((name) => name.endsWith(".spec.ts"))
  .sort();

describe("parytet konfiguracji Playwrighta", () => {
  it("oba pliki opisują TEN SAM zbiór specyfikacji artefaktowych", () => {
    // Znak w znak, nie „równoważnie": dwa różne, przypadkiem zgodne wzorce
    // rozjadą się przy pierwszej zmianie jednego z nich.
    expect(
      ignoreLiteral,
      `\`testIgnore\` w ${DEFAULT_CONFIG} musi być dosłownie tym samym wzorcem, ` +
        `co \`testMatch\` w ${ARTIFACT_CONFIG}`,
    ).toBe(matchLiteral);
  });

  it("w katalogu e2e SĄ specy artefaktowe - inaczej ta bramka pilnuje pustki", () => {
    // Kontrola pozytywna. Gdyby wzorzec przestał do czegokolwiek pasować,
    // wszystkie asercje niżej byłyby spełnione trywialnie.
    const artifactSpecs = specs.filter((name) => toRegExp(matchLiteral).test(name));
    expect(artifactSpecs.length, "wzorzec artefaktowy nie pasuje do żadnego pliku").toBeGreaterThan(
      0,
    );
    expect(artifactSpecs).toContain("boot-artifact.spec.ts");
    expect(artifactSpecs).toContain("boot-timing.spec.ts");
  });

  it("PODZIAŁ JEST ROZŁĄCZNY: żaden spec nie jedzie obiema konfiguracjami", () => {
    // Spec uruchamiany dwiema konfiguracjami zapłaci dwa razy, a w jednej
    // z nich zmierzy nie to, co miał - to jest dokładnie ta awaria, którą ta
    // bramka zamyka.
    const ignored = toRegExp(ignoreLiteral);
    const matched = toRegExp(matchLiteral);
    const both = specs.filter((name) => matched.test(name) && !ignored.test(name));
    expect(both, "spec artefaktowy nie jest wykluczony z konfiguracji dev-serwera").toEqual([]);
  });

  it("PODZIAŁ JEST PEŁNY: żaden spec nie wypadł z obu konfiguracji", () => {
    // Plik, którego nie bierze ani jedna konfiguracja, wygląda jak test,
    // a jest martwym kodem.
    const ignored = toRegExp(ignoreLiteral);
    const matched = toRegExp(matchLiteral);
    const orphans = specs.filter((name) => ignored.test(name) && !matched.test(name));
    expect(orphans, "spec wykluczony z dev-serwera i nieobjęty konfiguracją artefaktową").toEqual(
      [],
    );
  });

  it("konfiguracja artefaktowa NIE przejmuje cudzego serwera", () => {
    // `reuseExistingServer: true` pozwoliłby zmierzyć dev-server z poprzedniego
    // przebiegu i przejść na zielono, nie dotykając artefaktu - czyli oddać ten
    // sam fałszywy pomiar, tylko odwrotną stroną.
    expect(artifactSource).toMatch(/reuseExistingServer:\s*false/);
  });

  it("obie konfiguracje mierzą INNE porty - inaczej biją się o serwer", () => {
    const portOf = (source: string): string => {
      const match = /const PORT = (\d+);/.exec(source);
      if (!match) throw new Error("nie znalazłem stałej PORT");
      return match[1];
    };
    expect(portOf(defaultSource)).not.toBe(portOf(artifactSource));
  });
});
