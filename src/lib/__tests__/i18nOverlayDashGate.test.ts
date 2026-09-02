// BRAMKA: żaden słownik nie zawiera PAUZY (U+2014). Próg ZERO, repo-wide.
//
// PO CO TA BRAMKA ISTNIEJE - i dlaczego nie wystarczały te, które już były.
//
// House style tego repozytorium zakazuje pauzy „—" i stosuje dywiz „-". Reguła
// była wymuszana TESTAMI PER SŁOWNIK: 24 pliki w `src/lib/__tests__/` mają
// własną asercję („uses '-' instead of the em dash in every string"), każda
// zakresowana do JEDNEJ nakładki. Rdzeń (`locale/pl.ts`, `locale/en.ts`) był
// pilnowany, `i18n-cohesion` był pilnowany - a nakładek jest 120.
//
// Skutek: 17 pauz przeżyło w czterech nakładkach, i to nie był rozkład losowy.
// WSZYSTKIE CZTERY należały do modułu 07 („typy treści specjalne"), czyli do
// jedynego modułu, którego kampania testowa nigdy nie została dokończona:
//   i18n-admin-podcasts.ts   6   („— bez programu —", „— brak —", ...)
//   i18n-admin-tracker.ts    6
//   i18n-experts.ts          3   (w opisach SEO, czyli w treści WIDOCZNEJ
//                                 w wynikach wyszukiwania)
//   i18n-admin-team-media.ts 2
//
// Bramka per słownik jest w tym repo dobrą konwencją (sprawdza też parytet
// kluczy i interpolacje), ale na JEDNĄ regułę globalną jest złym narzędziem:
// nowa nakładka bez własnego pliku testowego wchodzi bez żadnej kontroli.
// Ten plik zamyka tę dziurę jedną asercją nad CAŁYM katalogiem.
//
// CZEGO NIE OBEJMUJE, powiedziane wprost: literałów w komponentach. Część
// komponentów panelu ma słowniki LOKALNE (`const T = { pl: {...}, en: {...} }`
// w `components/admin/experts/ExpertPicker.tsx`) i pauza w takim literale
// przechodzi obok tej bramki, bo to nie jest plik słownika. Rozszerzenie skanu
// na `src/components/**` wymagałoby odróżnienia tekstu interfejsu od pauzy
// w komentarzu i w treści testowej - to osobna praca, nie doklejka tutaj.
//
// CZYTAMY ŹRÓDŁO, nie importujemy modułów: nakładka rejestruje się EFEKTEM
// UBOCZNYM importu (`i18n.addResourceBundle`), więc zaciągnięcie 120 modułów
// do jednego pliku testowego uzależniłoby wynik od kolejności rejestracji
// i od stanu instancji i18next. Skan tekstu jest odporny na jedno i na drugie.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Pauza (em dash). Zapisana kodem znaku, żeby ten plik sam jej nie zawierał. */
const EM_DASH = "—";

const LOCALE_DIR = "src/lib/locale";
const OVERLAY_DIR = "src/lib";

/** Pliki słowników: rdzeń `locale/*.ts` + wszystkie nakładki `i18n-*.ts`. */
function dictionaryFiles(): string[] {
  const overlays = readdirSync(OVERLAY_DIR)
    .filter((f) => f.startsWith("i18n-") && f.endsWith(".ts"))
    .map((f) => `${OVERLAY_DIR}/${f}`);
  const core = readdirSync(LOCALE_DIR)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => `${LOCALE_DIR}/${f}`);
  return [...core, ...overlays].sort();
}

interface DashHit {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

function findDashes(files: readonly string[]): DashHit[] {
  const hits: DashHit[] = [];
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((text, index) => {
      if (text.includes(EM_DASH)) hits.push({ file, line: index + 1, text: text.trim() });
    });
  }
  return hits;
}

describe("bramka pauzy w słownikach", () => {
  const files = dictionaryFiles();

  it("skan obejmuje rdzeń I WSZYSTKIE nakładki - inaczej bramka nic nie znaczy", () => {
    // Kontrola samego narzędzia. Bez niej regresja w `dictionaryFiles()`
    // (literówka w prefiksie, zmiana katalogu) dawałaby PUSTĄ listę plików
    // i zieloną bramkę, która nie sprawdza niczego.
    expect(files.length, "słowników musi być ponad sto").toBeGreaterThan(100);
    expect(files, "rdzeń PL musi być w skanie").toContain("src/lib/locale/pl.ts");
    expect(files, "rdzeń EN musi być w skanie").toContain("src/lib/locale/en.ts");
    expect(files, "nakładka modułu 07 musi być w skanie").toContain(
      "src/lib/i18n-admin-podcasts.ts",
    );
  });

  it("kontrola dodatnia: narzędzie WIDZI pauzę, gdy ona jest", () => {
    // Drugi kierunek tej samej kontroli - `findDashes` musi umieć znaleźć to,
    // czego szuka, inaczej zero trafień niżej nie jest dowodem.
    const hits = findDashes(["src/lib/__tests__/i18nOverlayDashGate.fixture.ts"]);
    expect(hits.length, "atrapa z pauzą musi dać trafienie").toBe(1);
    expect(hits[0]?.line).toBeGreaterThan(0);
  });

  it("ŻADEN słownik nie zawiera pauzy", () => {
    const hits = findDashes(files);
    const report = hits.map((h) => `${h.file}:${h.line}  ${h.text}`).join("\n");
    expect(hits, `pauza (U+2014) w słowniku - house style stosuje dywiz "-":\n${report}`).toEqual(
      [],
    );
  });
});
