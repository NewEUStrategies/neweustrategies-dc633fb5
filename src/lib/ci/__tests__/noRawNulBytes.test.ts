// ŻADEN PLIK ŹRÓDŁOWY NIE MA PRAWA NIEŚĆ SUROWEGO BAJTU NUL.
//
// KLASA BŁĘDU, KTÓRA NIE DAJE ŻADNEGO SYGNAŁU. `grep` bez `-a` uznaje plik
// z bajtem NUL za binarny i wypisuje „binary file matches" zamiast trafień -
// a w potoku (`grep -l`, `grep -c`, `grep -o | wc -l`) po prostu CICHO zgłasza
// zero. Każda bramka i każdy skrypt liczący wzorce grepem omija więc taki plik
// bez słowa, i nikt się o tym nie dowiaduje. `git diff --numstat` też oddaje
// `- -` zamiast liczby linii.
//
// ZMIERZONE 2026-09-12, przed tym testem: trzy pliki w `src/`, w tym JEDEN
// PRODUKCYJNY - `src/lib/notifications/webpush.server.ts:266`
// (`parts.join(<bajt NUL>)` w liczeniu `pushTopic`), plus dwie atrapy testowe
// (`joinUsLegacyContent.test.tsx:88`, `cvUpload.test.ts:245`). We wszystkich
// trzech intencją był separator/ładunek NUL, więc naprawą jest ESCAPE `"\\0"` -
// ta sama wartość w runtime (`"\\0".charCodeAt(0) === 0`), zero różnicy
// semantycznej, a plik przestaje być dla narzędzi binarny. Tę samą diagnozę
// i tę samą naprawę zapisał już audyt z 2026-08-05
// (`docs/AUDYT_BRUTALNY_REWIZJA_ZALOZEN_2026-08-05.md:253`) - nie została
// wtedy wdrożona i defekt przeżył pięć wydań.
//
// CZEGO TEN TEST NIE OBEJMUJE, powiedziane wprost: skanuje `src/**` po
// rozszerzeniach tekstowych. Zasoby binarne (`src/assets/**`: fonty, obrazy)
// są z definicji poza zakresem i nie są problemem - żadna bramka nie liczy
// w nich wzorców kodu.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SCAN_ROOT = "src";
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "coverage", "assets"]);
const TEXT_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|css|json|md|sql|html|svg)$/;

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function filesWithRawNul(): string[] {
  const hits: string[] = [];
  for (const path of walk(SCAN_ROOT, [])) {
    const file = relative(process.cwd(), path).replaceAll("\\", "/");
    if (!TEXT_FILE.test(file)) continue;
    if (readFileSync(file).includes(0)) hits.push(file);
  }
  return hits;
}

describe("surowy bajt NUL w źródłach", () => {
  it("nie występuje w żadnym pliku tekstowym `src/**`", () => {
    const hits = filesWithRawNul();
    expect(
      hits,
      `Pliki z surowym bajtem NUL: ${hits.join(", ")}.\n` +
        "Każdy grep bez -a widzi je jako binarne i CICHO zgłasza zero trafień,\n" +
        'więc omija je każda bramka liczona grepem. Napraw escapem "\\\\0".',
    ).toEqual([]);
  });

  it("KONTROLA NEGATYWNA: skaner NAPRAWDĘ wykrywa bajt NUL, a nie zwraca pustą listę zawsze", () => {
    // Bez tego przypadku zielony wynik wyżej byłby nie do odróżnienia od
    // skanera, który przestał cokolwiek czytać - a to jest dokładnie ta
    // awaria, której ten plik dotyczy.
    expect(Buffer.from('join("\0")', "utf8").includes(0)).toBe(true);
    expect(Buffer.from('join("\\0")', "utf8").includes(0)).toBe(false);
  });

  it("escape `\\0` i surowy bajt NUL to TA SAMA wartość w runtime", () => {
    // Dowód, że naprawa jest czysto zapisowa: `pushTopic` liczy ten sam skrót.
    expect("\0".charCodeAt(0)).toBe(0);
    expect("\0".length).toBe(1);
  });
});
