// Test jednostkowy bramki JEDNOJĘZYCZNEGO tekstu dla użytkownika.
//
// KONWENCJA REPO: inwariant CI ma test, bo inaczej skaner nie ma jak umrzeć na
// czerwono, gdy przestanie cokolwiek widzieć - a pusta bramka brzmi identycznie
// jak zielona. Dlatego detektor jest sprawdzany na źródłach SYNTETYCZNYCH
// (napisy w tym pliku), a nie na repo: test na repo jest kruchy i wolny,
// a zmiana w cudzym pliku oblewałaby test detektora.
//
// KAŻDE WYKLUCZENIE MA PARĘ: przypadek dowodzący, że bramka go NIE łapie, i stojący
// obok przypadek GRANICZNY, który łapie. Wykluczenie bez pary jest dziurą,
// nie decyzją - po roku nikt nie odróżni „tego nie mierzymy świadomie” od
// „to się zepsuło i nikt nie zauważył”.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  MONOLINGUAL_USER_TEXT_BASELINE,
  blankStringBodies,
  compareWithRatchet,
  countsByFile,
  countsByKind,
  isHumanText,
  isScannable,
  ratchetFailed,
  renderBaselineSource,
  renderRatchetReport,
  scanMonolingualUserText,
  type MonolingualHit,
  type ScannedSource,
} from "@/lib/ci/monolingualUserText";

const one = (source: string): MonolingualHit[] =>
  scanMonolingualUserText([{ file: "a.tsx", source }]);

const texts = (source: string): string[] => one(source).map((hit) => hit.text);

describe("monolingualUserText - klasyfikacja", () => {
  it("tekst dziecka JSX to dług do słownika", () => {
    const [hit] = one("<span>Zapisz teraz</span>");
    expect(hit.kind).toBe("jsx-text");
    expect(hit.text).toBe("Zapisz teraz");
  });

  it("literał w propsie docierającym do użytkownika ma WŁASNĄ klasę na props", () => {
    // Klasy są rozdzielone, bo mają różną wagę: `aria-label` czyta czytnik
    // ekranu, `alt` idzie też do wyszukiwarki, `placeholder` widzi tylko ten,
    // kto stoi w pustym polu.
    expect(one('<input placeholder="Szukaj wpisu" />')[0].kind).toBe("prop-placeholder");
    expect(one('<button title="Zamknij okno" />')[0].kind).toBe("prop-title");
    expect(one('<button aria-label="Zamknij okno" />')[0].kind).toBe("prop-aria-label");
    expect(one('<div aria-description="Opis pola" />')[0].kind).toBe("prop-aria-description");
    expect(one('<img src={x} alt="Logo instytutu" />')[0].kind).toBe("prop-alt");
    expect(one('<Column label="Data utworzenia" />')[0].kind).toBe("prop-label");
  });

  it("`aria-label` NIE liczy się dwa razy jako `label`", () => {
    // Gdyby krótszy wzorzec zjadał dłuższy, jedno miejsce dawałoby dwa
    // trafienia i liczba długu byłaby zawyżona o cały `aria-label`.
    expect(one('<button aria-label="Zamknij okno" />').map((hit) => hit.kind)).toEqual([
      "prop-aria-label",
    ]);
  });

  it("tekst złamany przez prettiera na kilka linii liczy się RAZ", () => {
    const source = ['<p className="lead">', "  Długie zdanie po polsku.", "</p>"].join("\n");
    expect(texts(source)).toEqual(["Długie zdanie po polsku."]);
  });

  it("numer linii wskazuje linię, w której stoi NAPIS, nie tag otwierający", () => {
    const source = ["<div>", '  <p className="x">', "    Zdanie do przekładu.", "  </p>", "</div>"];
    expect(one(source.join("\n"))[0].line).toBe(3);
  });

  it("rozkład na klasy jest raportowalny - każda klasa ma inną naprawę", () => {
    const source = ["<span>Zapisz teraz</span>", '<input placeholder="Szukaj wpisu" />'].join("\n");
    expect(countsByKind(one(source)).get("jsx-text")).toBe(1);
    expect(countsByKind(one(source)).get("prop-placeholder")).toBe(1);
  });

  it("liczba trafień per plik to postać wpisu w zamrożonym długu", () => {
    const hits = scanMonolingualUserText([
      { file: "a.tsx", source: "<span>Zapisz teraz</span>" },
      { file: "b.tsx", source: "<b>Anuluj wszystko</b>\n<i>Usuń wpis</i>" },
    ]);
    expect([...countsByFile(hits)]).toEqual([
      ["a.tsx", 1],
      ["b.tsx", 2],
    ]);
  });
});

describe("monolingualUserText - wykluczenia i ich przypadki graniczne", () => {
  it("PLIKI TESTOWE i słowniki są poza skanem, zwykły komponent nie", () => {
    // Napis w teście jest DANYMI testu (`getByText("Zapisz")`), a słownik
    // trzyma tekst obu języków z definicji - to jest jego zadanie.
    expect(isScannable("src/components/X.tsx")).toBe(true);
    expect(isScannable("src/routes/admin.users.tsx")).toBe(true);
    expect(isScannable("src/components/__tests__/X.test.tsx")).toBe(false);
    expect(isScannable("src/components/X.test.tsx")).toBe(false);
    expect(isScannable("src/components/X.spec.tsx")).toBe(false);
    expect(isScannable("src/test/clubs/networkScreenStubs.tsx")).toBe(false);
    expect(isScannable("src/lib/i18n-club.tsx")).toBe(false);
    expect(isScannable("src/lib/locale/pl.tsx")).toBe(false);
  });

  it("plik `.ts` jest poza skanem, `.tsx` w skanie", () => {
    // Dziecko JSX i props JSX mogą istnieć wyłącznie w `.tsx`; skan `.ts` dałby
    // wyłącznie fałszywe trafienia z porównań `a > b`.
    expect(isScannable("src/lib/x.ts")).toBe(false);
    expect(isScannable("src/lib/x.tsx")).toBe(true);
  });

  it("KOMENTARZ nie jest tekstem dla użytkownika, ta sama linia bez `//` jest", () => {
    // Bez maskowania bramka liczyłaby własną dokumentację i przykłady w opisach.
    expect(one("// <span>Zapisz teraz</span>")).toEqual([]);
    expect(one('/* <input placeholder="Szukaj wpisu" /> */')).toEqual([]);
    expect(texts("<span>Zapisz teraz</span>")).toEqual(["Zapisz teraz"]);
  });

  it("PROPS TECHNICZNY nie jest mierzony, ten sam napis w propsie użytkownika jest", () => {
    // `className`, `id`, `href`, `type`, `role`, `data-*`, `key` i `name`
    // formularza nie docierają do człowieka - ich treść to selektor, adres albo
    // klucz. Allowlista propsów robi to z definicji, ale bez testu nikt nie wie,
    // czy to decyzja, czy przypadek.
    expect(one('<div className="Zamknij okno" />')).toEqual([]);
    expect(one('<div id="Zamknij okno" />')).toEqual([]);
    expect(one('<a href="Zamknij okno" />')).toEqual([]);
    expect(one('<input type="Zamknij okno" />')).toEqual([]);
    expect(one('<div role="Zamknij okno" />')).toEqual([]);
    expect(one('<div data-slot="Zamknij okno" />')).toEqual([]);
    expect(one('<Row key="Zamknij okno" />')).toEqual([]);
    expect(one('<input name="Zamknij okno" />')).toEqual([]);
    expect(texts('<button title="Zamknij okno" />')).toEqual(["Zamknij okno"]);
  });

  it("`data-title` to `data-*`, nie `title` - prefiks nie może przemycić propsa", () => {
    expect(one('<div data-title="Zamknij okno" />')).toEqual([]);
    expect(texts('<div title="Zamknij okno" />')).toEqual(["Zamknij okno"]);
  });

  it("`aria-labelledby` trzyma IDENTYFIKATOR, `aria-label` trzyma napis", () => {
    expect(one('<div aria-labelledby="pole-opis" />')).toEqual([]);
    expect(texts('<div aria-label="Pole opisu" />')).toEqual(["Pole opisu"]);
  });

  it("WŁAŚCIWOŚĆ OBIEKTU jest poza zasięgiem, props JSX nie", () => {
    // Kształt `nazwa: "literał"` jest nierozróżnialny od konfiguracji i danych
    // seed - 2 205 wystąpień, świadomie poza bramką (nagłówek modułu).
    expect(one('const col = { title: "Data utworzenia" };')).toEqual([]);
    expect(texts('<Column title="Data utworzenia" />')).toEqual(["Data utworzenia"]);
  });

  it("SZABLON W LITERALE (mail HTML) nie jest drzewem JSX, ten sam znacznik w JSX jest", () => {
    // Tekst wewnątrz napisu to osobna powierzchnia (maile, SQL, HTML podglądu) -
    // osobna klasa i osobna bramka. Tu liczymy drzewo JSX.
    expect(one("const html = `<td>Witaj ponownie</td>`;")).toEqual([]);
    expect(texts("<td>Witaj ponownie</td>")).toEqual(["Witaj ponownie"]);
  });

  it("cudzysłowy WEWNĄTRZ literału regularnego nie rozjeżdżają skanera", () => {
    // To jedyny fałszywy alarm z pomiaru wdrożeniowego: `.replace(/…"[^"]*"…/)`
    // ma cztery cudzysłowy w regexie, a skaner liczący ich parzystość od tego
    // miejsca odsłaniał literały zamiast je gasić - i „widział” szablon HTML
    // jako dziecko JSX.
    const source = [
      'const clean = raw.replace(/on[a-z]+\\s*=\\s*"[^"]*"/gi, "");',
      "const html = `<style>body{color:red}</style>`;",
    ].join("\n");
    expect(one(source)).toEqual([]);
  });

  it("dzielenie NIE jest literałem regularnym - inaczej skaner gasiłby kod", () => {
    expect(blankStringBodies('const r = a / b; const s = "x";')).toBe(
      'const r = a / b; const s = " ";',
    );
  });

  it("apostrof W ŚRODKU SŁOWA nie gasi resztki pliku", () => {
    // `abc'x'` jest w JS błędem składni, więc apostrof po znaku identyfikatora
    // NIE otwiera literału. Bez tej reguły jeden apostrof w tekście JSX
    // wygaszałby plik do następnego cudzysłowu, czyli ZANIŻAŁ pomiar.
    expect(texts("<p>Don't</p>\n<span>Zapisz teraz</span>")).toEqual(["Zapisz teraz"]);
  });

  it("tagowany szablon zostaje szablonem - reguła apostrofu nie dotyczy backticka", () => {
    expect(blankStringBodies("const s = styled.div`color:red`;")).toBe(
      "const s = styled.div`         `;",
    );
  });

  it("WARTOŚĆ BEZ SŁOWA nie jest tekstem, wartość ze słowem jest", () => {
    // Liczba, separator, pojedynczy znak interpunkcyjny i jedna litera nie mają
    // czego przełożyć - próg to dwie litery pod rząd.
    expect(one("<span>2024</span>")).toEqual([]);
    expect(one("<span>—</span>")).toEqual([]);
    expect(one("<span>:</span>")).toEqual([]);
    expect(one("<span>x</span>")).toEqual([]);
    expect(texts("<span>Rok wydania</span>")).toEqual(["Rok wydania"]);
  });

  it("URL, e-mail i ścieżka nie są tekstem, opis pola jest", () => {
    expect(one('<input placeholder="https://example.com" />')).toEqual([]);
    expect(one('<input placeholder="osoba@instytucja.eu" />')).toEqual([]);
    expect(one('<input placeholder="/admin/wpisy" />')).toEqual([]);
    expect(texts('<input placeholder="Adres strony" />')).toEqual(["Adres strony"]);
  });

  it("KOD JĘZYKA nie jest tekstem, nazwa języka jest", () => {
    // Kanoniczny zapis kodu to `uiLang(i18n.language)` - do słownika nie ma tu
    // czego przenieść. Dotyczy też listy kodów i kodu z dwukropkiem jako
    // etykietą (`PL:`).
    expect(one('<input placeholder="pl, en" />')).toEqual([]);
    expect(one("<span>PL:</span>")).toEqual([]);
    expect(texts("<span>Polski i angielski</span>")).toEqual(["Polski i angielski"]);
  });

  it("JEDNOSTKA i MIARA nie są tekstem, opis odstępu jest", () => {
    // „px” ma dwie litery pod rząd, więc bez własnej reguły `-2px` liczyłby się
    // jako napis. Jednostka jest ta sama w każdym języku.
    expect(one('<input placeholder="px" />')).toEqual([]);
    expect(one('<input placeholder="-2px" />')).toEqual([]);
    expect(one("<span>1200px</span>")).toEqual([]);
    expect(one("<span>1.5rem</span>")).toEqual([]);
    expect(texts('<input placeholder="Odstęp w pikselach" />')).toEqual(["Odstęp w pikselach"]);
  });

  it("MASKA FORMATU nie jest tekstem, opis pola czasu jest", () => {
    expect(one('<input placeholder="MM:SS" />')).toEqual([]);
    expect(one('<input placeholder="DD.MM.YYYY" />')).toEqual([]);
    expect(texts('<input placeholder="Czas trwania odcinka" />')).toEqual(["Czas trwania odcinka"]);
  });

  it("SKRÓT W WERSALIKACH jest językowo neutralny, napis przycisku nie", () => {
    // `PDF`, `CSV`, `EUR`, `RSS` to to samo słowo w PL i EN - przeniesienie do
    // słownika nie daje tłumaczowi nic do zrobienia. Granica na czterech
    // znakach jest świadoma i dowodzi jej przypadek graniczny obok.
    expect(one("<span>PDF</span>")).toEqual([]);
    expect(one("<span>CSV</span>")).toEqual([]);
    expect(one("<span>EUR</span>")).toEqual([]);
    expect(texts("<span>ZAPISZ</span>")).toEqual(["ZAPISZ"]);
  });

  it("NAGŁÓWEK TECHNICZNY EKSPORTU CSV to konwencja repo, etykieta kolumny nie", () => {
    // `CSV_COLUMNS` w `subscriberTable.ts` i `REGISTRATION_CSV_COLUMNS`
    // w `lib/events/registrationsCsv.ts` są `satisfies keyof Row`, czyli
    // nazwami kolumn bazy - zmiana ich na tekst z słownika zepsułaby plik
    // eksportu, a nie naprawiła tłumaczenia. Ten sam kształt ma każdy
    // identyfikator w kodzie.
    expect(one("<span>created_at</span>")).toEqual([]);
    expect(one('<Column label="waitlist_position" />')).toEqual([]);
    expect(one('<Column label="consent-marketing-at" />')).toEqual([]);
    expect(one("<span>obj.pole</span>")).toEqual([]);
    expect(texts('<Column label="Data utworzenia" />')).toEqual(["Data utworzenia"]);
  });

  it("DOMENA bez protokołu nie jest tekstem, nazwa serwisu jest", () => {
    expect(one('<input placeholder="example.org" />')).toEqual([]);
    expect(one('<input placeholder="mysite.wordpress.com" />')).toEqual([]);
    expect(texts('<input placeholder="Nazwa serwisu" />')).toEqual(["Nazwa serwisu"]);
  });

  it("SŁOWO KLUCZOWE CSS/HTML nie jest tekstem, słowo z interfejsu jest", () => {
    expect(one('<input placeholder="auto" />')).toEqual([]);
    expect(one('<input placeholder="none" />')).toEqual([]);
    expect(texts('<input placeholder="Automatycznie" />')).toEqual(["Automatycznie"]);
  });

  it("PUSTY `alt` to obrazek dekoracyjny, `alt` z treścią to dług", () => {
    // Pusty `alt` jest ŚWIADOMYM zapisem dostępności („czytnik ekranu ma to
    // pominąć”), a nie brakiem tłumaczenia.
    expect(one('<img src={x} alt="" />')).toEqual([]);
    expect(texts('<img src={x} alt="Logo instytutu" />')).toEqual(["Logo instytutu"]);
  });

  it("KOD, KTÓRY WYGLĄDA JAK JSX, nie jest liczony", () => {
    // Strzałka, porównanie, generyk i owinięty warunek to najczęstsze źródła
    // fałszywych alarmów w skanerze regexowym - i najtańszy sposób, żeby
    // bramka straciła zaufanie.
    expect(one("const f = (a) => a.b < c;")).toEqual([]);
    expect(one("if (count > total) { doIt(); }")).toEqual([]);
    expect(one("const m = useMemo<Foo>(() => build(), []);")).toEqual([]);
    expect(one("{count > 0 && (\n  <Foo />\n)}")).toEqual([]);
  });

  it("dziecko będące WYRAŻENIEM już przechodzi przez tłumaczenie", () => {
    // `{t("admin.save")}` i `{label}` mają swoje bramki (`i18nKeyUsage`,
    // `i18nDefaultValue`) - tu nie ma czego liczyć.
    expect(one("<span>{label}</span>")).toEqual([]);
    expect(one('<span>{t("admin.save")}</span>')).toEqual([]);
    expect(one("<Foo\n  bar={1}\n>\n  {value}\n</Foo>")).toEqual([]);
  });

  it("`isHumanText` jest osobno testowalne - to ono trzyma wszystkie wykluczenia", () => {
    expect(isHumanText("Zapisz teraz")).toBe(true);
    expect(isHumanText("")).toBe(false);
    expect(isHumanText("   ")).toBe(false);
    expect(isHumanText("12")).toBe(false);
    expect(isHumanText("pl")).toBe(false);
  });
});

describe("monolingualUserText - ratchet", () => {
  const hits = one("<span>Zapisz teraz</span>");

  it("plik poza baseline'em z długiem oblewa - nowy kod startuje od zera", () => {
    const report = compareWithRatchet(hits, new Map());
    expect(report.fresh.map((entry) => entry.file)).toEqual(["a.tsx"]);
    expect(ratchetFailed(report)).toBe(true);
  });

  it("wzrost w znanym pliku oblewa", () => {
    const report = compareWithRatchet(hits, new Map([["a.tsx", 0]]));
    expect(report.grown).toEqual([{ file: "a.tsx", was: 0, now: 1 }]);
    expect(ratchetFailed(report)).toBe(true);
  });

  it("stan równy baseline'owi przechodzi", () => {
    expect(ratchetFailed(compareWithRatchet(hits, new Map([["a.tsx", 1]])))).toBe(false);
  });

  it("POPRAWA nie oblewa, ale jest raportowana do odświeżenia listy", () => {
    // Inaczej każde ścięcie kilku napisów wymuszałoby edycję baseline'u w tym
    // samym commicie - i zniechęcało do drobnych porządków.
    const report = compareWithRatchet(hits, new Map([["a.tsx", 5]]));
    expect(ratchetFailed(report)).toBe(false);
    expect(report.improved).toEqual([{ file: "a.tsx", was: 5, now: 1 }]);
  });

  it("plik wyczyszczony do zera też jest raportowany jako poprawa", () => {
    const report = compareWithRatchet([], new Map([["a.tsx", 3]]));
    expect(report.improved).toEqual([{ file: "a.tsx", was: 3, now: 0 }]);
    expect(ratchetFailed(report)).toBe(false);
  });

  it("KOMPENSACJA MIĘDZY PLIKAMI nie przechodzi - to sedno ratchetu per plik", () => {
    // Globalny licznik byłby tu zielony: pięć wystąpień mniej w `a.tsx`
    // i jedno więcej w `b.tsx` daje sumę mniejszą niż baseline. Lista per plik
    // widzi, że `b.tsx` poszedł w GÓRĘ.
    const moved = scanMonolingualUserText([
      { file: "a.tsx", source: "<span>Zapisz teraz</span>" },
      { file: "b.tsx", source: "<span>Anuluj wszystko</span>" },
    ]);
    const report = compareWithRatchet(
      moved,
      new Map([
        ["a.tsx", 6],
        ["b.tsx", 0],
      ]),
    );
    expect(report.total).toBeLessThan(6);
    expect(report.grown).toEqual([{ file: "b.tsx", was: 0, now: 1 }]);
    expect(ratchetFailed(report)).toBe(true);
  });

  it("raport nazywa pliki i tłumaczy, dlaczego to jest dług", () => {
    const rendered = renderRatchetReport(compareWithRatchet(hits, new Map()), 0);
    expect(rendered).toContain("a.tsx");
    expect(rendered).toContain("i18n-monolingual");
  });

  it("zielony raport podaje zmierzoną liczbę, nie samo „OK”", () => {
    // Bramka, która na zielono nie mówi ILE widzi, nie da się odróżnić od
    // bramki, która przestała cokolwiek widzieć.
    const rendered = renderRatchetReport(compareWithRatchet(hits, new Map([["a.tsx", 1]])), 1);
    expect(rendered).toContain("1 znanych wystąpień w 1 plikach");
  });

  it("odświeżona lista jest gotowa do wklejenia w baseline", () => {
    expect(renderBaselineSource(hits)).toBe('  ["a.tsx", 1],');
  });
});

// Katalogi pomijane przy przechodzeniu drzewa - nie ma w nich źródeł repo.
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "coverage"]);

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full.replaceAll("\\", "/"));
  }
  return out;
}

/**
 * SELF-TEST NA REALNYM `src/` - to on JEST bramką.
 *
 * Bramka nie ma skryptu w `package.json`: jest zwykłym plikiem vitesta, więc
 * biegnie z każdym uruchomieniem `src/lib/ci` i da się ją wpiąć do
 * `check:i18n-parity` dopisaniem jednej ścieżki. Detektor jest sprawdzony wyżej
 * na źródłach syntetycznych - tutaj sprawdzamy tylko KIERUNEK długu w repo.
 */
describe("monolingualUserText - self-test na realnym src/", () => {
  const files = walk("src", []).filter(isScannable);
  const sources: ScannedSource[] = files.map((file) => ({
    file,
    source: readFileSync(file, "utf8"),
  }));
  const hits = scanMonolingualUserText(sources);
  const baseline = new Map(MONOLINGUAL_USER_TEXT_BASELINE);
  const report = compareWithRatchet(hits, baseline);

  it("skaner nadal COKOLWIEK widzi - pusta bramka brzmi jak zielona", () => {
    expect(files.length).toBeGreaterThan(1000);
    expect(hits.length).toBeGreaterThan(0);
  });

  it("ratchet trzyma kierunek: ani nowego pliku z długiem, ani wzrostu", () => {
    // Komunikat niesie ODŚWIEŻONĄ listę, bo bramka bez ścieżki naprawy jest
    // wyłączana, nie naprawiana.
    const failure = ratchetFailed(report)
      ? [renderRatchetReport(report, baseline.size), "", renderBaselineSource(hits)].join("\n")
      : "";
    expect(failure).toBe("");
  });

  it("zamrożony dług nie rośnie ponad stan wdrożeniowy", () => {
    // 713 wystąpień w 163 plikach - stan ZMIERZONY, nie przepisany. Suma może
    // tylko maleć; wpisy per plik pilnuje test wyżej.
    expect(report.total).toBeLessThanOrEqual(713);
    expect(baseline.size).toBe(163);
  });
});
