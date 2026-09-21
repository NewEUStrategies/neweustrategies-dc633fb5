// Bramka: funkcja zbudowana w całości musi mieć OSTATNIE OGNIWO.
//
// KLASA DEFEKTU, KTÓREJ TO PILNUJE - i której nie widzi nic innego w repo.
// Da się zbudować funkcję kompletnie: tekst w słowniku PL i EN, kolumnę
// w bazie, hak, propsy przez trzy poziomy komponentów - i nie dopiąć jednej
// rzeczy, która czyni ją osiągalną. Wtedy:
//   * `tsc` jest zielony (wszystko się typuje),
//   * testy są zielone (nikt tego nie woła, więc nic nie pada),
//   * bramka parytetu i18n jest zielona (klucze są w obu językach),
//   * bramka rozjazdu kod<->słownik jest zielona (klucze istnieją),
//   * a funkcji NIE MA. Widać to wyłącznie w przeglądarce, przez kogoś, kto
//     wie, że ta funkcja miała istnieć.
// Wyszło to przy poz. 2 audytu: cztery pozycje z listy „martwego kodu" nie były
// śmieciem, a funkcją bez ostatniego ogniwa. Dwie z nich przywrócono w tym PR
// i one dostają tu ochronę - bo bez niej następne usunięcie przycisku wróci
// dokładnie tak samo niezauważone.
//
// DLACZEGO STATYCZNIE, A NIE RENDEREM. Render `ChatComposer` wymaga sesji,
// tenanta, klienta zapytań i nagrywania głosu; render `PostBlockEditor` -
// całego kontekstu edytora. Koszt utrzymania takiego testu jest wyższy niż
// wartość, a pytanie jest proste: czy OGNIWO jest w kodzie. Asercja
// „przycisk woła `sendQuickEmoji`" nie zależy od DOM-u.
import { readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { maskComments } from "@/lib/ci/i18nKeyUsage";

const COMPOSER = "src/components/chat/ChatComposer.tsx";
const BLOCK_EDITOR = "src/components/admin/blocks/PostBlockEditor.tsx";
const TOURS = "src/lib/onboarding/tours.ts";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/** Wszystkie pliki `.tsx` w `src` - do szukania kotwic przewodników. */
function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      out.push(...tsxFiles(path));
      continue;
    }
    if (entry.name.endsWith(".tsx")) out.push(path);
  }
  return out;
}

describe("szybka emotka w czacie - ostatnie ogniwo", () => {
  const source = read(COMPOSER);

  it("`sendQuickEmoji` jest WOŁANE, nie tylko zdefiniowane", () => {
    // Dokładnie ten stan zastałem: funkcja z komentarzem opisującym zachowanie,
    // zero wywołań, i dialog wyglądu obiecujący użytkownikowi, że to działa.
    expect(source).toMatch(/const sendQuickEmoji = /);
    // Deklaracja to `const sendQuickEmoji = (emoji …) =>`, więc NIE pasuje do
    // wzorca wywołania - licznik zlicza wyłącznie wołania. W stanie, który
    // zastałem, było ich zero.
    const calls = [...source.matchAll(/sendQuickEmoji\(/g)].length;
    expect(calls, "`sendQuickEmoji` zdefiniowane, ale nigdy nie wołane").toBeGreaterThanOrEqual(1);
  });

  it("przycisk pojawia się dokładnie wtedy, co obiecuje słownik", () => {
    // `chat.appearance.quickEmojiHint`: „Jedno dotknięcie wysyła ją, gdy pole
    // tekstu jest puste". Warunek w kodzie musi mówić to samo.
    //
    // 2026-09-01: warunek WYPROWADZIŁ SIĘ z JSX-a do czystej reguły
    // `quickEmojiVisible` w `src/lib/chat/composerRules.ts`. Bramka idzie za
    // nim i jest przez to ŚCIŚLEJSZA niż wcześniej: sprawdza OBA ogniwa -
    // że kompozytor bramkuje przycisk tą regułą ORAZ że reguła mówi dokładnie
    // to, co obiecuje słownik. Wcześniej sprawdzała tylko pierwsze.
    //
    // Nagłówek tego pliku mówił „render `ChatComposer` wymaga sesji, tenanta,
    // klienta zapytań i nagrywania głosu, więc koszt testu renderowego jest
    // wyższy niż wartość". Ta przesłanka przestała być prawdziwa: warunek ma
    // dziś dowód jednostkowy (`src/lib/chat/__tests__/composerRules.test.ts`)
    // i dowód renderowy (`src/components/chat/__tests__/ChatComposer.test.tsx`,
    // „szybka emotka jest widoczna tylko przy pustym polu"). Bramka statyczna
    // ZOSTAJE mimo to - ona pilnuje OGNIWA (czy przycisk w ogóle jest podpięty),
    // a nie arytmetyki warunku.
    expect(source).toMatch(/\{quickEmojiVisible\(surface\) && \(/);
    expect(source).toMatch(/onClick=\{\(\) => sendQuickEmoji\(\)\}/);

    const rules = read("src/lib/chat/composerRules.ts");
    expect(rules).toMatch(
      /export function quickEmojiVisible\(ctx: ComposerSurfaceContext\): boolean \{\s*return isComposerEmpty\(ctx\);/,
    );
    expect(rules).toMatch(
      /function isComposerEmpty\(ctx: ComposerSurfaceContext\): boolean \{\s*return !ctx\.editing && ctx\.text\.trim\(\)\.length === 0 && !ctx\.staged;/,
    );
  });

  it("przycisk ma etykietę z KLUCZA, nie z kodu - i emotkę użytkownika", () => {
    expect(source).toMatch(/aria-label=\{t\("chat\.quickEmojiSend", \{ emoji: quickEmoji \}\)\}/);
  });

  it("obietnica ze słownika nadal istnieje w OBU językach", () => {
    // Gdyby ktoś usunął sekcję wyboru emotki, przycisk zostałby bez sensu -
    // a ta bramka ma wtedy kazać przeczytać, po co on tam jest.
    const dict = read("src/lib/i18n-chat.ts");
    expect(dict).toContain('quickEmojiSend: "Wyślij {{emoji}}"');
    expect(dict).toContain('quickEmojiSend: "Send {{emoji}}"');
    expect(dict).toMatch(/quickEmojiHint/);
  });
});

describe("przewodniki onboardingu - każdy krok ma kotwicę i render", () => {
  const tours = read(TOURS);
  const anchors = [...tours.matchAll(/anchor:\s*"([a-z0-9-]+)"/g)].map((match) => match[1]);

  it("skan realnie widzi kroki - kanarek zasięgu", () => {
    expect(anchors.length).toBeGreaterThanOrEqual(8);
  });

  it("KAŻDY krok celuje w kotwicę, która istnieje w drzewie", () => {
    // To jest dokładnie defekt, który znalazłem: krok `blocks-canvas` celował
    // w `data-tour="blocks-canvas"`, którego nikt nie renderował, więc drugi
    // krok przewodnika po prostu nie miał się do czego przypiąć.
    //
    // KOMENTARZE MASKUJEMY - i to nie jest ostrożność na zapas. Pierwsza wersja
    // tej asercji przechodziła po usunięciu prawdziwego atrybutu, bo w tym
    // samym pliku stał MÓJ komentarz cytujący `data-tour="blocks-canvas"`.
    // Bramka liczyła własną dokumentację jako dowód - czyli była zielona
    // i ślepa naraz, dokładnie jak skaner z poz. 6 przed poprawką.
    const rendered = new Set(
      tsxFiles("src")
        .flatMap((file) => [...maskComments(read(file)).matchAll(/data-tour="([a-z0-9-]+)"/g)])
        .map((match) => match[1]),
    );
    const orphaned = anchors.filter((anchor) => !rendered.has(anchor));
    expect(orphaned, "kroki przewodnika bez kotwicy w drzewie").toEqual([]);
  });

  it("edytor bloków RENDERUJE przewodnik, nie tylko go liczy", () => {
    // Hak `useOnboardingTour` był wołany, kotwice stały w drzewie, teksty PL/EN
    // czekały w słowniku - brakowało tej jednej linii, więc nowy redaktor nie
    // zobaczył przewodnika ani razu.
    const source = read(BLOCK_EDITOR);
    expect(source).toMatch(/useOnboardingTour\(\{\s*id: "blocks"/);
    expect(source).toMatch(/<CoachmarkTour controller=\{tour\} \/>/);
  });

  it("każdy kontroler przewodnika ma swój render `<CoachmarkTour>`", () => {
    // Ogólniej niż wyżej: gdziekolwiek ktoś zawoła hak, musi też wyrenderować
    // nakładkę - inaczej powtarza ten sam błąd w nowym miejscu.
    //
    // PLIKI TESTOWE SĄ POZA ZAKRESEM i to nie jest osłabienie bramki. Reguła
    // mówi o SKLEJENIU PRODUKCYJNYM: panel, który liczy kroki przewodnika, a
    // nie rysuje nakładki, nie pokaże jej użytkownikowi ani razu. Test
    // jednostkowy haka wywołuje go z zamysłem - bez nakładki, bo przedmiotem
    // dowodu jest sam hak (`src/lib/onboarding/__tests__/useOnboardingTour.test.tsx`).
    // Wciągnięcie go na listę winnych zmuszałoby do renderowania organizmu w
    // teście modułu, czyli do zepsucia testu, żeby zadowolić skaner.
    const offenders = tsxFiles("src")
      .filter((file) => !file.includes(`${sep}__tests__${sep}`))
      .map((file) => ({ file, source: read(file) }))
      .filter(({ source }) => /useOnboardingTour\(/.test(source))
      .filter(({ source }) => !/<CoachmarkTour\b/.test(source))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("kanarek: bramka NADAL łapie plik produkcyjny bez nakładki", () => {
    // Bez tego kanarka zawężenie zakresu wyżej mogłoby po cichu wyłączyć całą
    // regułę (np. gdyby ktoś rozszerzył filtr na cały `src`).
    const scanned = tsxFiles("src").filter((file) => !file.includes(`${sep}__tests__${sep}`));
    expect(scanned.some((file) => file.includes("content-model"))).toBe(true);
    expect(scanned.filter((file) => /useOnboardingTour\(/.test(read(file))).length).toBeGreaterThan(
      0,
    );
  });
});
