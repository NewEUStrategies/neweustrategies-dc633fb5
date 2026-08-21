// Bramka parytetu eksportu RODO: czy paczka ZAWIERA to, co manifest deklaruje.
//
// TRZY KIERUNKI DOWODU I TO, KTÓRE JUŻ ISTNIEJĄ. Zakres eksportu ma dziś dwie
// zapory pilnujące, żeby nic cudzego nie wyszło (`exportOwnerScope.gate.test.ts`,
// art. 15 ust. 4) oraz bramkę rejestr ⇄ server fn porównującą ZBIÓR KLUCZY
// literału `sections` z `EXPORT_SECTION_IDS` (`exportManifest.test.ts`,
// „bramka: rejestr ⇄ server fn"). Ta druga pokrywa już punkty 1, 2, 4 i 5
// z zamówienia na ten plik: brak i nadmiar sekcji, przypięcie
// `PERSONAL_DATA_EXPORT_FORMAT` oraz strukturę rejestru (unikalność, pokrycie
// grupami, grupy niepuste). Powtarzanie ich tutaj byłoby duplikatem, nie zaporą,
// więc ten plik ich NIE powtarza - i mówi to wprost, bo inaczej następna osoba
// napisze je po raz trzeci.
//
// CZEGO NIKT NIE PILNUJE - I CO TEN PLIK DODAJE.
//
//   A. KLUCZ NIE JEST DOWODEM EMISJI. Istniejąca bramka porównuje NAZWY kluczy.
//      Klucz o wartości stałej - `foo: Promise.resolve({ data: null, error: null })` -
//      przechodzi ją w całości i emituje pustkę. Sekcja zadeklarowana, kluczem
//      obecna, danymi nieistniejąca, a użytkownik widzi `"foo": null` i czyta to
//      jako „nie korzystam". Tu każda sekcja musi wskazywać na REALNE źródło.
//
//   B. WYŁĄCZENIA NIE SĄ SPRAWDZANE WOBEC EMITERA. `EXPORT_EXCLUSIONS` ma siedem
//      wpisów z uzasadnieniem prawnym, a nic nie sprawdza, czy emiter faktycznie
//      ich nie wypuszcza. Wyłączenie, które mimo to jedzie w paczce, unieważnia
//      swoje własne uzasadnienie: `club_admin_notes` obiecuje, że notatka komisji
//      NIE trafi do pliku kandydata, i to jest obietnica wobec członków komisji,
//      nie wobec kandydata.
//
//   C. MANIFEST MUSI JECHAĆ W PLIKU, NIE W LOGU. Dowodem wykonania art. 15 jest
//      PLIK, który dostaje osoba - nie wpis w logach serwera. Manifest i rozjazd
//      (`drift`) muszą być w zwracanym payloadzie.
//
//   D. UCIĘCIE PACZKI NIE JEST NIGDZIE ZAPISANE. Osiem sekcji ma sufit wierszy.
//      Paczka ucięta wygląda dokładnie jak kompletna - patrz `it.fails` na końcu.
//
// DLACZEGO BRAMKA JEST STATYCZNA, A NIE INTEGRACYJNA. Ten sam argument, co
// w nagłówku `exportOwnerScope.gate.test.ts` i `exportManifest.test.ts`: budowa
// zapytań jest mocno typowana na klienta Supabase, a wstrzyknięcie atrapy
// wymagałoby rozszczelnienia tych typów - czyli oddania własności, której bramka
// ma pilnować. Test integracyjny musiałby mieć realną bazę z danymi w 52
// sekcjach; ta bramka przenosi dowód z czasu wykonania do czasu review.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - ZAKRESU WŁAŚCICIELA: `exportOwnerScope.gate.test.ts` (nie tykamy go).
// - PARYTETU ZBIORU KLUCZY, PRZYPIĘCIA WERSJI FORMATU I STRUKTURY REJESTRU:
//   `exportManifest.test.ts` (punkty 1, 2, 4, 5 zamówienia - patrz wyżej).
// - POLITYK I PROCEDUR: `profile_export_rls_scope_test.sql` dowodzi zawężenia
//   RLS, a `club_export_my_data` (wraz z pominięciem `admin_note` po stronie
//   bazy) ma własne asercje w migracjach i pgTAP. Vitest ich nie przepisuje.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EXPORT_EXCLUSIONS,
  EXPORT_SECTION_GROUPS,
  EXPORT_SECTION_GROUP_OF,
  EXPORT_SECTION_IDS,
  buildExportManifest,
} from "../exportManifest";

const SOURCE = "src/lib/profile/export.functions.ts";
const src = readFileSync(SOURCE, "utf8");

/**
 * Źródło z wyciętymi komentarzami, z zachowaniem numeracji linii (komentarz
 * zamieniony na spacje tej samej długości).
 *
 * PO CO. Nazwa wyłączenia `club_admin_notes` ZAWIERA napis `admin_note`, a stoi
 * w komentarzu przy sekcji klubowej. Skan po surowym pliku zgłaszałby więc
 * naruszenie za każdym razem, gdy ktoś uczciwie opisze, czego nie eksportuje -
 * czyli karałby dokładnie za dobrą praktykę. Bramka ma czytać KOD.
 */
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
  .replace(/\/\/[^\n]*/g, (line) => " ".repeat(line.length));

/** Napis w kodzie NIE jako fragment dłuższego identyfikatora. */
function findToken(token: string): number {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const leading = /^[A-Za-z0-9_]/.test(token) ? "(?<![A-Za-z0-9_])" : "";
  const trailing = /[A-Za-z0-9_]$/.test(token) ? "(?![A-Za-z0-9_])" : "";
  return code.search(new RegExp(`${leading}${escaped}${trailing}`));
}

/** Numer linii w oryginalnym pliku dla podanego przesunięcia. */
function lineAt(offset: number): number {
  return src.slice(0, offset).split("\n").length;
}

/** Wyrażenie bez białych znaków - sekcje są wielolinijkowe (`supabase\n  .from`). */
function squeeze(value: string): string {
  return value.replace(/\s+/g, "");
}

/** Ciało literału `sections` - jedyny fragment, w którym mieszkają sekcje. */
function sectionsBlock(): string {
  const start = src.indexOf("const sections: Record<string, PromiseLike<SectionResult>> = {");
  expect(start, "literał `sections` musi istnieć - inaczej bramka jest pusta").toBeGreaterThan(-1);
  const end = src.indexOf("\n    };", start);
  expect(end, "literał `sections` musi być domknięty").toBeGreaterThan(start);
  return src.slice(start, end);
}

interface Section {
  readonly id: string;
  readonly line: number;
  /** Wyrażenie po dwukropku, aż do następnej sekcji - to ono ma emitować dane. */
  readonly expression: string;
}

/** Sekcje literału wraz z wyrażeniem, które je wypełnia. */
function sections(): Section[] {
  const block = sectionsBlock();
  const offset = src.indexOf(block);
  const heads = [...block.matchAll(/^ {6}([a-z][a-z0-9_]*):/gm)];
  return heads.map((match, index) => {
    const from = (match.index ?? 0) + match[0].length;
    const to = index + 1 < heads.length ? (heads[index + 1].index ?? block.length) : block.length;
    return {
      id: match[1],
      line: src.slice(0, offset + (match.index ?? 0)).split("\n").length,
      // Wyrażenie ściśnięte: sekcje są wielolinijkowe (`supabase` w jednej linii,
      // `.from("tabela")` w następnej), więc dopasowanie po surowym tekście
      // przegapiłoby KAŻDĄ z nich i bramka byłaby czerwona bez powodu.
      expression: squeeze(block.slice(from, to)),
    };
  });
}

/**
 * Źródła danych, które NAPRAWDĘ coś emitują. Lista jest jawna z premedytacją:
 * nowy sposób pobrania danych ma się zgłosić czerwonym testem i dostać wpis tutaj
 * (czyli decyzję w review), a nie przejść jako „coś tam pewnie robi".
 */
const EMITTERS = [
  "supabase.from(",
  "supabase.rpc(",
  // Kluby: jedno RPC rozbite na osiem zadeklarowanych sekcji.
  "clubSection(",
  // Sieć kontaktów: RPC stronicujące, sklejane do sufitu.
  "fetchNetworkPages(",
] as const;

/**
 * Wyłączenie → napisy, których obecność w emiterze unieważniłaby jego
 * uzasadnienie. Pusta lista znaczy „tego wyłączenia nie da się sprawdzić
 * statycznie" i wymaga zdania wyjaśniającego - patrz kanarek niżej.
 */
const EXCLUSION_FORBIDDEN_TOKENS: Readonly<Record<string, readonly string[]>> = {
  // Notatka komisji naboru o kandydacie. Baza jej nie zwraca (`club_export_my_data`),
  // ale gdyby ktoś dopisał tu `.from("club_applications").select("admin_note")`,
  // obietnica wobec członków komisji przestałaby obowiązywać bez ani jednego
  // czerwonego testu.
  club_admin_notes: ["admin_note"],
  // Logi bezpieczeństwa i ślad audytowy - art. 17 ust. 3 lit. e.
  security_and_audit_logs: [
    "auth_attempts",
    "login_attempts",
    "security_events",
    "audit_log",
    "ip_address",
    "ip_hash",
  ],
  // Zdarzenia analityczne bez identyfikatora konta - nie są danymi osobowymi.
  pseudonymous_analytics: ["analytics_events", "web_vitals", "page_views"],
  // Treść binarna: eksport niesie metadane i ścieżki, nie pliki.
  attachment_binaries: ["storage.from(", ".download("],
  // Opublikowane treści autorskie żyją pod własnymi adresami publicznymi.
  published_authored_content: ['.from("posts")', '.from("podcast_episodes")'],
  // Cudze wiadomości: emiter ma sięgać po WŁASNE (`chat_messages_sent`), a nie
  // po wiersze rozmówców - filtr właściciela pilnuje tego osobno.
  messages_authored_by_others: [],
  // Cudze wypowiedzi w klubach - jak wyżej, po stronie RPC.
  club_content_authored_by_others: [],
};

describe("A. każda zadeklarowana sekcja jest REALNIE emitowana", () => {
  const all = sections();

  it("skan widzi wszystkie sekcje rejestru - kanarek zasięgu", () => {
    // Bez tego bramka po refaktorze literału robi się pusta i zielona.
    expect(all).toHaveLength(EXPORT_SECTION_IDS.length);
    // Dolna granica bezwzględna: rejestr liczy dziś 52 sekcje w dziewięciu
    // grupach. Bez tej liczby bramka po zwężeniu rejestru byłaby zielona na
    // eksporcie, z którego wypadła połowa obszarów produktu.
    expect(all.length).toBeGreaterThanOrEqual(50);
  });

  it("żadna sekcja nie jest wypełniona stałą - klucz nie jest dowodem emisji", () => {
    // To jest cała treść tej bramki. `foo: Promise.resolve({ data: null, error:
    // null })` przechodzi parytet ZBIORU KLUCZY w exportManifest.test.ts, a
    // emituje pustkę: sekcja zadeklarowana, kluczem obecna, danymi nieistniejąca.
    // Użytkownik czyta `"foo": null` jako „nie korzystam", nie jako lukę.
    const silent = all
      .filter((section) => !EMITTERS.some((emitter) => section.expression.includes(emitter)))
      .map((section) => `${SOURCE}:${section.line} ${section.id} - brak realnego źródła danych`);
    expect(silent).toEqual([]);
  });

  it("każda GRUPA dziedzinowa ma emisję - żaden obszar produktu nie milczy", () => {
    // Grupa jest częścią kontraktu widzianego przez konsumenta pliku: jej brak
    // znaczy „ten obszar mnie nie dotyczy", a nie „ten obszar wypadł z eksportu".
    const emitted = new Set(all.map((section) => section.id));
    const silentGroups = Object.entries(EXPORT_SECTION_GROUPS)
      .filter(([, ids]) => !ids.some((id) => emitted.has(id)))
      .map(([group]) => group);
    expect(silentGroups).toEqual([]);
  });

  it("każda emitowana sekcja ma grupę - plik nie może nieść danych bez opisu", () => {
    // Art. 12 RODO: przejrzystość. Sekcja bez grupy to kolumna bez nagłówka -
    // użytkownik dostaje dane, których nie umie zinterpretować.
    const orphans = all
      .filter((section) => EXPORT_SECTION_GROUP_OF[section.id] === undefined)
      .map((section) => `${SOURCE}:${section.line} ${section.id}`);
    expect(orphans).toEqual([]);
  });
});

describe("B. wyłączenia kontra emiter", () => {
  it("każde wyłączenie ma wpis w tabeli napisów zabronionych - kanarek listy", () => {
    // Wyłączenie dopisane do rejestru bez wpisu tutaj byłoby uzasadnieniem
    // prawnym bez żadnej zapory: obietnica w pliku, zero sprawdzenia w kodzie.
    const unchecked = EXPORT_EXCLUSIONS.filter(
      (exclusion) => EXCLUSION_FORBIDDEN_TOKENS[exclusion.id] === undefined,
    ).map((exclusion) => exclusion.id);
    expect(unchecked).toEqual([]);
  });

  it("tabela napisów nie zawiera martwych wpisów", () => {
    // Wpis dla wyłączenia, którego już nie ma, to reguła pilnująca niczego -
    // i mylący ślad przy następnym review zakresu.
    const declared = new Set(EXPORT_EXCLUSIONS.map((exclusion) => exclusion.id));
    const stale = Object.keys(EXCLUSION_FORBIDDEN_TOKENS).filter((id) => !declared.has(id));
    expect(stale).toEqual([]);
  });

  it("emiter nie wypuszcza niczego, co wyłączenie obiecało pominąć", () => {
    const offenders: string[] = [];
    for (const exclusion of EXPORT_EXCLUSIONS) {
      for (const token of EXCLUSION_FORBIDDEN_TOKENS[exclusion.id] ?? []) {
        const at = findToken(token);
        if (at === -1) continue;
        offenders.push(`${SOURCE}:${lineAt(at)} „${token}" łamie wyłączenie ${exclusion.id}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("wyłączenia sprawdzalne statycznie są w przewadze - lista nie jest fasadą", () => {
    // Dwa wyłączenia (cudze wiadomości, cudze wypowiedzi w klubach) mają pustą
    // listę napisów z premedytacją: pilnuje ich FILTR WŁAŚCICIELA, a nie brak
    // tabeli w kodzie - emiter MUSI sięgać po `chat_messages_sent`. Gdyby pustych
    // wpisów było więcej niż sprawdzanych, ta bramka udawałaby zaporę.
    const checkable = Object.values(EXCLUSION_FORBIDDEN_TOKENS).filter(
      (tokens) => tokens.length > 0,
    );
    expect(checkable.length).toBeGreaterThan(EXPORT_EXCLUSIONS.length / 2);
  });
});

describe("C. manifest jedzie w PLIKU, nie w logu", () => {
  it("zwracany payload niesie manifest", () => {
    // Dowodem wykonania art. 15 jest plik, który dostaje osoba - nie wpis
    // w logach serwera, do którego ona nie ma dostępu.
    expect(src).toMatch(/return \{[\s\S]*\bmanifest:/);
    expect(src).toContain("buildExportManifest(");
  });

  it("rozjazd deklaracja ⇄ implementacja też ląduje w pliku, nie tylko w logu", () => {
    // Manifest bez rozjazdu podpisywałby paczkę jako komplet w chwili, w której
    // sam kod już wie, że komplet to nie jest.
    expect(src).toContain("diffExportManifest(");
    expect(src).toMatch(/\{ \.\.\.manifest, drift \}/);
  });

  it("lista sekcji poległych pochodzi z REALNYCH błędów przebiegu", () => {
    // `buildExportManifest([])` na sztywno dałby paczkę, która twierdzi, że
    // wszystko się udało, także wtedy, gdy RLS odmówił połowy sekcji.
    expect(src).toMatch(/buildExportManifest\(Object\.keys\(errors\)\)/);
  });

  it("sekcja, która poległa, jest w manifeście wymieniona jako nieudana", () => {
    // Asercja na module (nie na źródle): kontrakt `failed` jest tym, co czyta
    // konsument pliku, i on decyduje, czy brak sekcji to luka, czy odmowa.
    const manifest = buildExportManifest(["chat_messages_sent", "club_applications"]);
    expect(manifest.failed).toEqual(["chat_messages_sent", "club_applications"]);
    expect(manifest.sections).toContain("chat_messages_sent");
  });

  it("odwzorowanie sekcja → grupa jest ZAMROŻONE", () => {
    // Manifest jedzie do pliku użytkownika. Mutacja tej mapy w runtime
    // przegrupowałaby paczkę bez śladu w kodzie.
    expect(Object.isFrozen(EXPORT_SECTION_GROUP_OF)).toBe(true);
  });
});

describe("D. sufit wierszy - ucięcie paczki", () => {
  it("osiem sekcji ma sufit wierszy i to jest świadoma decyzja", () => {
    // Eksport ma być plikiem, nie zrzutem bazy - sufit sam w sobie jest w porządku.
    expect([...src.matchAll(/\.limit\((ROW_LIMIT|MESSAGE_LIMIT)\)/g)]).toHaveLength(8);
  });

  // DEFEKT ZGŁOSZONY, NIE NAPRAWIONY (§7: nie zmieniamy zachowania produkcyjnego,
  // żeby test przeszedł).
  //
  // Osiem sekcji ucina się na 2000 wierszach (wiadomości na 5000), sieć kontaktów
  // przestaje stronicować na 2000, a `club_export_my_data` dostaje `p_limit`.
  // Paczka ucięta jest w pliku NIEROZRÓŻNIALNA od kompletnej: `ExportManifest`
  // niesie `format`, `sections`, `groups`, `failed` i `excluded` - i ani jednego
  // pola mówiącego „tej sekcji jest więcej, niż tu widzisz".
  //
  // KONSEKWENCJA. Osoba z 2500 zakładkami dostaje plik podpisany jako komplet
  // z 2000 pozycjami i nie ma jak zauważyć braku - dokładnie ta klasa defektu,
  // dla której ten manifest powstał (rozjazd deklaracji z zawartością), tylko
  // przesunięta z osi „które sekcje" na oś „ile wierszy". Art. 15 ust. 3 mówi
  // o kopii danych, nie o pierwszych dwóch tysiącach.
  //
  // DLACZEGO NIE NAPRAWIAM. Poprawka jest projektowa, nie redakcyjna: albo
  // manifest zyskuje pole `truncated` z licznikami (zmiana kontraktu, czyli
  // bump `PERSONAL_DATA_EXPORT_FORMAT` do v3), albo eksport przestaje ucinać
  // i przechodzi na paczkowanie asynchroniczne. Wybór należy do inspektora
  // ochrony danych, nie do testu.
  it.fails("manifest MÓWI, gdy sekcja została ucięta na sufcie wierszy", () => {
    const manifest = buildExportManifest([]);
    expect(Object.keys(manifest)).toContain("truncated");
  });
});
