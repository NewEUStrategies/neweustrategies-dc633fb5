// Inwariant własnicielski: KAŻDA TRASA ADMINA I KAŻDA MIGRACJA MA WSKAZANEGO
// WŁAŚCICIELA TECHNICZNEGO.
//
// ── PRZYCZYNA ŹRÓDŁOWA ──────────────────────────────────────────────────────
// Audyt z 2026-08-29 zmierzył w tym repo 193 trasy administracyjne i 918
// migracji bazy BEZ wskazanego właściciela technicznego, bez umowy
// utrzymaniowej i bez procedury na wypadek niedostępności wykonawcy. Trzy
// liczby z tego samego pomiaru mówią, dlaczego to nie jest problem papierowy:
//
//   * 631 z 918 migracji (68,7%) nazywa się UUID-em nadanym przez platformę
//     budującą - z nazwy pliku nie da się odczytać NICZEGO o tym, czego
//     migracja dotyczy. Atrybucja musi iść po treści SQL, inaczej nie istnieje;
//   * `git shortlog` na całej historii daje 4 tożsamości i 2 commity człowieka
//     na 275 (0,7%) - reszta to bot platformy i agenci. Wiedza o systemie nie
//     ma nośnika osobowego, więc „kto to utrzymuje" nie ma odpowiedzi nawet
//     nieformalnej;
//   * w `.github/` nie było ani CODEOWNERS, ani szablonu PR - żadnego miejsca,
//     w którym własnicielstwo mogłoby być zapisane maszynowo.
//
// Dokument opisujący własnicielstwo zdezaktualizowałby się przy pierwszej
// nowej trasie i nikt by tego nie zauważył. Dlatego własnicielstwo jest tu
// REJESTREM (`governance/ownership.json`) sprawdzanym bramką, a nie prozą:
// nowa trasa admina albo nowa migracja, której rejestr nie pokrywa, przewraca
// CI dokładnie tak samo jak błąd typów.
//
// ── CO TA BRAMKA GWARANTUJE, A CZEGO NIE ────────────────────────────────────
// GWARANTUJE, że każda trasa i każda migracja MA przypisaną domenę, że każda
// domena ma właściciela, zastępcę i eskalację wskazane wpisami z `osoby`,
// że dokumenty utrzymaniowe istnieją, a umowa nie wygasła.
// NIE GWARANTUJE, że przypisanie jest MERYTORYCZNIE trafne - reguła jest
// heurystyką po identyfikatorach SQL. Raport podaje więc osobno liczbę
// atrybucji słabych (rozstrzygniętych jednym identyfikatorem), żeby ta
// niepewność była widoczna, a nie schowana za zieloną bramką.
//
// ── ZAPADKI (ratchet) ───────────────────────────────────────────────────────
// Progi w `governance/ownership.json` wolno WYŁĄCZNIE zacieśniać - ta sama
// zasada, którą repo stosuje do progów pokrycia w `vitest.config.ts`:
//   * `domenyBezWlasciciela` - dziś 9, bo w repo nie ma ANI JEDNEGO
//     indywidualnego uchwytu GitHub ani osobowego adresu, a wymyślanie ludzi
//     byłoby fikcją. Próg pilnuje, żeby liczba domen bez właściciela nie
//     ROSŁA, i spada przy każdym realnym obsadzeniu roli;
//   * `migracjeBezAtrybucjiDozwolone` - LISTA NAZW, nie liczba. Liczba nie
//     odróżniała pliku z linii bazowej od świeżo dodanego: przy progu 5
//     i pięciu plikach bazowych szósta migracja dawała komunikat z sześcioma
//     UUID-ami i żadnym wskazaniem, który jest nowy. Dziś na liście są cztery
//     pliki (trzy puste placeholdery i `CREATE EXTENSION pgtap`) plus pętla
//     `DO $$` sięgająca funkcji wyłącznie przez `format()`;
//   * `martweWzorceTras` - dziś 0: wzorzec tras, który nie trafia w żaden plik,
//     jest zgnilizną rejestru. Dotyczy WYŁĄCZNIE tras. Prefiksy bazy są tylko
//     raportowane jako ostrzeżenie, bo opisują rodzinę tabel, a nie plik -
//     po spłaszczeniu historii migracji przestają trafiać, choć tabele istnieją,
//     i kasowanie ich na polecenie bramki niszczyłoby poprawną informację.
//
// Czego zapadki NIE robią: nic w repo nie porównuje ich z wartością z gałęzi
// bazowej, więc podniesienie progu w tym samym commicie, który psuje pokrycie,
// przejdzie przez bramkę. Zapadka jest tu konwencją wspartą przeglądem PR-a,
// nie inwariantem maszynowym - i lepiej to napisać, niż udawać inaczej.
//
// Warstwa wykonawcza (odczyt katalogów, kod wyjścia) żyje w
// `scripts/check-ownership.ts`; ten moduł jest czysty i testowalny.

/** Osoba albo rola, na którą wskazuje domena. `obsadzone: false` to jawna luka. */
export interface OwnershipPerson {
  readonly rola: string;
  readonly organizacja: string;
  readonly kontakt: string | null;
  readonly github: string | null;
  readonly obsadzone: boolean;
  readonly zrodlo: string;
}

/** Domena produktowa - najmniejsza jednostka, dla której wskazuje się właściciela. */
export interface OwnershipDomain {
  readonly slug: string;
  readonly nazwa: string;
  readonly zakres: string;
  readonly wlasciciel: string;
  readonly zastepca: string;
  readonly eskalacja: string;
  readonly klasaSla: string;
  readonly zespolGithub: string;
  /** Wzorce nazw plików tras (`*` = dowolny ciąg; kropka jest literalna). */
  readonly trasy: readonly string[];
  /** Prefiksy identyfikatorów bazy; klucz z `$` na końcu = dopasowanie dokładne. */
  readonly obiektyBazy: readonly string[];
}

export interface OwnershipContract {
  readonly dokument: string;
  readonly runbookCiaglosci: string;
  readonly zamawiajacy: string;
  readonly wykonawca: string;
  readonly obowiazujeOd: string;
  readonly obowiazujeDo: string;
  readonly ostrzegajOdDni: number;
}

export interface OwnershipThresholds {
  readonly domenyBezWlasciciela: number;
  readonly martweWzorceTras: number;
  /**
   * Migracje, o których WIADOMO, że heurystyka ich nie rozstrzygnie - wypisane
   * z nazwy, nie policzone. Liczba nie odróżniała pliku z linii bazowej od
   * świeżo dodanego: przy progu 5 i pięciu plikach bazowych szósta migracja
   * dawała komunikat z sześcioma UUID-ami i żadnym wskazaniem, który jest nowy.
   */
  readonly migracjeBezAtrybucjiDozwolone: readonly string[];
}

export interface OwnershipRegistry {
  readonly kontraktUtrzymaniowy: OwnershipContract;
  readonly osoby: Readonly<Record<string, OwnershipPerson>>;
  readonly progi: OwnershipThresholds;
  readonly tier2: Readonly<Record<string, string>>;
  readonly domeny: readonly OwnershipDomain[];
}

/** Plik migracji podany bramce przez runner: nazwa + surowa treść SQL. */
export interface MigrationSource {
  readonly file: string;
  readonly sql: string;
}

export interface RouteAttribution {
  readonly file: string;
  readonly domain: string | null;
  /** Wzorzec, który wygrał (kolejność domen w rejestrze rozstrzyga remisy). */
  readonly pattern: string | null;
  /** Domeny inne niż zwycięska, których wzorce też trafiły w ten plik. */
  readonly alsoMatched: readonly string[];
}

/** Warstwa decyzyjna, w której migracja dostała domenę. */
export type MigrationTier = "identyfikatory" | "literaly" | "przekrojowe" | "brak";

export interface MigrationAttribution {
  readonly file: string;
  readonly domain: string;
  readonly tier: MigrationTier;
  /** Liczba identyfikatorów, które zagłosowały. 1 = atrybucja słaba. */
  readonly votes: number;
}

export interface OwnershipReport {
  readonly routes: {
    readonly total: number;
    readonly unmatched: readonly string[];
    readonly overlapping: readonly RouteAttribution[];
    /** Wzorce zbyt szerokie, by cokolwiek znaczyły - patrz CATCH_ALL_SHARE. */
    readonly catchAll: readonly string[];
    readonly perDomain: Readonly<Record<string, number>>;
  };
  readonly migrations: {
    readonly total: number;
    readonly noHit: readonly string[];
    /** Migracje bez atrybucji SPOZA listy bazowej - to one blokują. */
    readonly noHitNowe: readonly string[];
    /** Wpisy listy bazowej, które dziś dają się już przypisać - do usunięcia. */
    readonly noHitNieaktualne: readonly string[];
    readonly weak: number;
    readonly perDomain: Readonly<Record<string, number>>;
    readonly perTier: Readonly<Record<MigrationTier, number>>;
  };
  /** Wzorce tras, które nie trafiają w żaden plik - blokujące. */
  readonly deadRoutePatterns: readonly string[];
  /**
   * Prefiksy bazy bez trafienia - WYŁĄCZNIE ostrzeżenie. Prefiks opisuje rodzinę
   * tabel, a nie plik: po spłaszczeniu albo przycięciu historii migracji reguła
   * przestaje trafiać, mimo że tabele istnieją i mają właściciela. Kasowanie jej
   * na polecenie bramki niszczyłoby poprawną informację o własnicielstwie.
   */
  readonly deadDbRules: readonly string[];
  readonly people: {
    readonly unstaffedDomains: readonly string[];
    readonly danglingRefs: readonly string[];
    readonly ownerEqualsDeputy: readonly string[];
    /** Wpisy `obsadzone: true` bez danych kontaktowych - obsadzenie pozorne. */
    readonly staffedWithoutContact: readonly string[];
  };
  readonly documents: {
    readonly missing: readonly string[];
  };
  readonly contract: {
    readonly daysLeft: number;
    readonly expired: boolean;
    readonly warning: boolean;
  };
  readonly thresholds: OwnershipThresholds;
  readonly domains: readonly OwnershipDomain[];
}

// ── Rejestr: parsowanie z komunikatem, który mówi CO poprawić ────────────────

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`governance/ownership.json: '${where}' musi być obiektem.`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, where: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`governance/ownership.json: '${where}' musi być niepustym napisem.`);
  }
  return value;
}

function asStringOrNull(value: unknown, where: string): string | null {
  if (value === null) return null;
  return asString(value, where);
}

function asNumber(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`governance/ownership.json: '${where}' musi być liczbą.`);
  }
  return value;
}

function asStringArray(value: unknown, where: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`governance/ownership.json: '${where}' musi być tablicą napisów.`);
  }
  return value.map((item, index) => asString(item, `${where}[${index}]`));
}

export function parseRegistry(raw: unknown): OwnershipRegistry {
  const root = asRecord(raw, "<root>");

  const contractRaw = asRecord(root["kontraktUtrzymaniowy"], "kontraktUtrzymaniowy");
  const kontraktUtrzymaniowy: OwnershipContract = {
    dokument: asString(contractRaw["dokument"], "kontraktUtrzymaniowy.dokument"),
    runbookCiaglosci: asString(
      contractRaw["runbookCiaglosci"],
      "kontraktUtrzymaniowy.runbookCiaglosci",
    ),
    zamawiajacy: asString(contractRaw["zamawiajacy"], "kontraktUtrzymaniowy.zamawiajacy"),
    wykonawca: asString(contractRaw["wykonawca"], "kontraktUtrzymaniowy.wykonawca"),
    obowiazujeOd: asString(contractRaw["obowiazujeOd"], "kontraktUtrzymaniowy.obowiazujeOd"),
    obowiazujeDo: asString(contractRaw["obowiazujeDo"], "kontraktUtrzymaniowy.obowiazujeDo"),
    ostrzegajOdDni: asNumber(contractRaw["ostrzegajOdDni"], "kontraktUtrzymaniowy.ostrzegajOdDni"),
  };

  const peopleRaw = asRecord(root["osoby"], "osoby");
  const osoby: Record<string, OwnershipPerson> = {};
  for (const [id, value] of Object.entries(peopleRaw)) {
    const person = asRecord(value, `osoby.${id}`);
    if (typeof person["obsadzone"] !== "boolean") {
      throw new Error(`governance/ownership.json: 'osoby.${id}.obsadzone' musi być boolean.`);
    }
    osoby[id] = {
      rola: asString(person["rola"], `osoby.${id}.rola`),
      organizacja: asString(person["organizacja"], `osoby.${id}.organizacja`),
      kontakt: asStringOrNull(person["kontakt"], `osoby.${id}.kontakt`),
      github: asStringOrNull(person["github"], `osoby.${id}.github`),
      obsadzone: person["obsadzone"],
      zrodlo: asString(person["zrodlo"], `osoby.${id}.zrodlo`),
    };
  }

  const thresholdsRaw = asRecord(root["progi"], "progi");
  const progi: OwnershipThresholds = {
    domenyBezWlasciciela: asNumber(
      thresholdsRaw["domenyBezWlasciciela"],
      "progi.domenyBezWlasciciela",
    ),
    martweWzorceTras: asNumber(thresholdsRaw["martweWzorceTras"], "progi.martweWzorceTras"),
    migracjeBezAtrybucjiDozwolone: asStringArray(
      thresholdsRaw["migracjeBezAtrybucjiDozwolone"],
      "progi.migracjeBezAtrybucjiDozwolone",
    ),
  };

  const crossCutting = asRecord(root["identyfikatoryPrzekrojowe"], "identyfikatoryPrzekrojowe");
  const tier2Raw = asRecord(crossCutting["tier2"], "identyfikatoryPrzekrojowe.tier2");
  const tier2: Record<string, string> = {};
  for (const [id, value] of Object.entries(tier2Raw)) {
    tier2[id] = asString(value, `identyfikatoryPrzekrojowe.tier2.${id}`);
  }

  if (!Array.isArray(root["domeny"])) {
    throw new Error("governance/ownership.json: 'domeny' musi być tablicą.");
  }
  const domeny: OwnershipDomain[] = root["domeny"].map((value, index) => {
    const domain = asRecord(value, `domeny[${index}]`);
    const slug = asString(domain["slug"], `domeny[${index}].slug`);
    return {
      slug,
      nazwa: asString(domain["nazwa"], `domeny.${slug}.nazwa`),
      zakres: asString(domain["zakres"], `domeny.${slug}.zakres`),
      wlasciciel: asString(domain["wlasciciel"], `domeny.${slug}.wlasciciel`),
      zastepca: asString(domain["zastepca"], `domeny.${slug}.zastepca`),
      eskalacja: asString(domain["eskalacja"], `domeny.${slug}.eskalacja`),
      klasaSla: asString(domain["klasaSla"], `domeny.${slug}.klasaSla`),
      zespolGithub: asString(domain["zespolGithub"], `domeny.${slug}.zespolGithub`),
      trasy: asStringArray(domain["trasy"], `domeny.${slug}.trasy`),
      obiektyBazy: asStringArray(domain["obiektyBazy"], `domeny.${slug}.obiektyBazy`),
    };
  });

  if (domeny.length === 0) {
    throw new Error("governance/ownership.json: 'domeny' nie może być puste.");
  }
  const seen = new Set<string>();
  for (const domain of domeny) {
    if (seen.has(domain.slug)) {
      throw new Error(`governance/ownership.json: zduplikowany slug domeny '${domain.slug}'.`);
    }
    seen.add(domain.slug);
    if (domain.trasy.length === 0 && domain.obiektyBazy.length === 0) {
      throw new Error(
        `governance/ownership.json: domena '${domain.slug}' nie pokrywa NICZEGO ` +
          "(pusta lista tras i pusta lista obiektów bazy) - usuń ją albo daj jej zakres.",
      );
    }
  }

  // Cel każdego wpisu przekrojowego musi istnieć wśród domen. Literówka tutaj
  // NIE zapalała żadnego warunku: migracja trafiała do nieistniejącej domeny,
  // `perDomain` liczyło jej udział jako NaN, a `ownershipFailed` milczało -
  // bramka raportowała własnicielstwo, którego nie było.
  for (const [id, target] of Object.entries(tier2)) {
    if (!seen.has(target)) {
      throw new Error(
        `governance/ownership.json: 'identyfikatoryPrzekrojowe.tier2.${id}' wskazuje domenę ` +
          `'${target}', której nie ma w 'domeny'.`,
      );
    }
  }

  return { kontraktUtrzymaniowy, osoby, progi, tier2, domeny };
}

// ── Trasy ───────────────────────────────────────────────────────────────────

/**
 * `*` to dowolny ciąg znaków; wszystko inne jest literalne - w szczególności
 * KROPKA, bo w routingu plikowym TanStack Start kropka jest separatorem
 * segmentu URL. Dzięki temu `admin.events.*` nie łapie `admin.events_.$eventId.*`
 * (podkreślnik wyprowadza trasę z layoutu katalogu do studia wydarzenia).
 */
export function globToRegExp(glob: string): RegExp {
  const body = glob
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^/]*");
  return new RegExp(`^${body}$`);
}

/**
 * Udział tras, powyżej którego POJEDYNCZY wzorzec przestaje cokolwiek znaczyć.
 *
 * Bez tego progu bramkę tras da się uciszyć JEDNĄ LINIĄ w rejestrze: wzorzec
 * `admin.*` w dowolnej domenie daje 100% pokrycia, zero niedopasowanych i zero
 * informacji o tym, kto właściwie za co odpowiada. Zmierzone na tym rejestrze:
 * najszerszy uczciwy wzorzec (`admin.events_.$eventId.*`) bierze 39 z 193 tras,
 * czyli 20,2% - próg 40% zostawia więc dwukrotny zapas dla realnych domen,
 * a zamyka drogę łapaczowi.
 */
const CATCH_ALL_SHARE = 0.4;

/**
 * Poniżej tylu tras UDZIAŁ nic nie znaczy i reguła łapacza zwraca się przeciwko
 * uczciwym wzorcom: w zbiorze dwuelementowym wzorzec trafiający jeden plik ma
 * 50% i wyglądałby na łapacza. Ta sama pułapka co przy `UBIQUITOUS_MIN_CORPUS`
 * - próg procentowy wymaga próbki, w której procent ma sens.
 */
const CATCH_ALL_MIN_ROUTES = 20;

export function attributeRoutes(
  files: readonly string[],
  domains: readonly OwnershipDomain[],
): { attributions: RouteAttribution[]; usedPatterns: Set<string> } {
  const compiled = domains.map((domain) => ({
    slug: domain.slug,
    patterns: domain.trasy.map((glob) => ({ glob, re: globToRegExp(glob) })),
  }));

  const usedPatterns = new Set<string>();
  const attributions = [...files].sort().map((file) => {
    const matched: { slug: string; glob: string }[] = [];
    for (const domain of compiled) {
      for (const pattern of domain.patterns) {
        if (pattern.re.test(file)) matched.push({ slug: domain.slug, glob: pattern.glob });
      }
    }
    if (matched.length === 0) {
      return { file, domain: null, pattern: null, alsoMatched: [] };
    }
    // Do „użytych" liczy się KAŻDY wzorzec, który trafił, a nie tylko zwycięski.
    // Inaczej wzorzec całkowicie przesłonięty przez wcześniejszą domenę byłby
    // raportowany jako MARTWY, mimo że opisuje istniejące pliki - a lekarstwo
    // („usuń regułę") skasowałoby poprawną informację o własnicielstwie.
    for (const hit of matched) usedPatterns.add(hit.glob);
    const winner = matched[0];
    const alsoMatched = [...new Set(matched.slice(1).map((hit) => hit.slug))].filter(
      (slug) => slug !== winner.slug,
    );
    return { file, domain: winner.slug, pattern: winner.glob, alsoMatched };
  });

  return { attributions, usedPatterns };
}

// ── Migracje: atrybucja po TREŚCI SQL, nie po nazwie pliku ───────────────────

/**
 * Wycina z SQL to, co nie jest odwołaniem do obiektu: komentarze liniowe
 * i blokowe oraz literały napisowe. Ciała `$$ ... $$` ZOSTAJĄ - to w nich
 * siedzi większość odwołań w funkcjach SECURITY DEFINER.
 *
 * JEDEN PRZEBIEG, NIE TRZY `replace`. Łańcuch trzech wyrażeń regularnych jest
 * tu nie do uratowania w ŻADNEJ kolejności, bo komentarz i literał wzajemnie
 * się zagnieżdżają:
 *
 *   * komentarze przed literałami → `'--'` w literale (`WHERE sep = '--'`)
 *     zjada resztę linii razem z prawdziwym SQL-em;
 *   * literały przed komentarzami → apostrof w komentarzu (`-- to nie działa`,
 *     `-- don't`) otwiera fikcyjny literał i połyka wszystko do następnego
 *     apostrofu, czasem kilka instrukcji dalej.
 *
 * Skaner stanowy nie ma tego problemu: w komentarzu apostrof jest zwykłym
 * znakiem, a w literale `--` jest zwykłym znakiem. Postgres dopuszcza
 * ZAGNIEŻDŻONE komentarze blokowe, więc bloki liczone są licznikiem
 * zagnieżdżenia, a nie leniwym dopasowaniem do pierwszego domknięcia.
 *
 * (Repo ma pokrewny skaner w `scripts/lib/sqlMigrations.ts`, pod tą samą nazwą
 * `stripSqlComments` - tamten zachowuje literały, bo bramki SQL badają ich
 * treść. Tutejszy `stripSqlNoise` wycina i komentarze, i literały; wariant
 * `stripSqlComments` niżej zachowuje literały dla warstwy 1.5.)
 */
export function stripSqlNoise(sql: string): string {
  return scanSql(sql, false);
}

/**
 * Wycina WYŁĄCZNIE komentarze, zachowując literały napisowe.
 *
 * Potrzebne w warstwie 1.5, która szuka nazw w dynamicznym SQL-u (`DO $$`,
 * `format()`), gdzie nazwa funkcji siedzi w literale. Skanowanie surowego
 * tekstu byłoby tam błędem: migracja bez ani jednej instrukcji, której CAŁA
 * treść to `-- Follow-up for club_members; no SQL yet`, dostawała domenę
 * z komentarza i wypadała z kubła „brak" - a to właśnie ten kubeł pilnuje
 * pustych placeholderów z linii bazowej.
 */
export function stripSqlComments(sql: string): string {
  return scanSql(sql, true);
}

function scanSql(sql: string, keepLiterals: boolean): string {
  let out = "";
  let i = 0;

  while (i < sql.length) {
    const char = sql[i];
    const pair = sql.slice(i, i + 2);

    if (pair === "--") {
      while (i < sql.length && sql[i] !== "\n") i += 1;
      out += " ";
      continue;
    }

    if (pair === "/*") {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        const inner = sql.slice(i, i + 2);
        if (inner === "/*") {
          depth += 1;
          i += 2;
        } else if (inner === "*/") {
          depth -= 1;
          i += 2;
        } else {
          if (sql[i] === "\n") out += "\n";
          i += 1;
        }
      }
      out += " ";
      continue;
    }

    if (char === "'") {
      const start = i;
      i += 1;
      while (i < sql.length) {
        if (sql[i] === "'") {
          // `''` to zaszytowany apostrof, nie koniec literału.
          if (sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        if (!keepLiterals && sql[i] === "\n") out += "\n";
        i += 1;
      }
      out += keepLiterals ? sql.slice(start, i) : " '' ";
      continue;
    }

    // Cudzysłowy to identyfikatory ("Nazwa Tabeli"), a nie literały - zostają.
    if (char === '"') {
      out += char;
      i += 1;
      while (i < sql.length && sql[i] !== '"') {
        out += sql[i];
        i += 1;
      }
      if (i < sql.length) {
        out += sql[i];
        i += 1;
      }
      continue;
    }

    out += char;
    i += 1;
  }

  return out;
}

const SCHEMAS = "public|storage|auth|extensions";
const QUALIFIED_RE = new RegExp(`\\b(?:${SCHEMAS})\\.([a-zA-Z_][a-zA-Z0-9_]*)`, "gi");

/**
 * Pozycje strukturalne, w których nazwa relacji albo funkcji może wystąpić BEZ
 * kwalifikacji schematem. Bez nich znika atrybucja migracji pisanych „na
 * skróty" (`UPDATE pages SET ...`), a takich jest w tym repo kilkanaście.
 */
const STRUCTURAL_RES: readonly RegExp[] = [
  /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:UNLOGGED\s+|TEMP\s+|TEMPORARY\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi,
  /\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?([a-z_][a-z0-9_]*)/gi,
  /\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi,
  /\bCREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi,
  /\bCREATE\s+MATERIALIZED\s+VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi,
  /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([a-z_][a-z0-9_]*)\s*\(/gi,
  /\bDROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi,
  /\bCREATE\s+TYPE\s+([a-z_][a-z0-9_]*)/gi,
  /\bUPDATE\s+(?:ONLY\s+)?([a-z_][a-z0-9_]*)\s+SET\b/gi,
  /\bINSERT\s+INTO\s+([a-z_][a-z0-9_]*)/gi,
  /\bDELETE\s+FROM\s+(?:ONLY\s+)?([a-z_][a-z0-9_]*)/gi,
  /\bFROM\s+(?:ONLY\s+)?([a-z_][a-z0-9_]*)/gi,
  /\b(?:INNER\s+|LEFT\s+|RIGHT\s+|FULL\s+|CROSS\s+)?(?:OUTER\s+)?JOIN\s+([a-z_][a-z0-9_]*)/gi,
  /\bREFERENCES\s+([a-z_][a-z0-9_]*)/gi,
  /\bCREATE\s+POLICY\s+(?:"[^"]*"|[a-z_][a-z0-9_]*)\s+ON\s+([a-z_][a-z0-9_]*)/gi,
  /\bDROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?(?:"[^"]*"|[a-z_][a-z0-9_]*)\s+ON\s+([a-z_][a-z0-9_]*)/gi,
  /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(?:[a-z_][a-z0-9_]*\s+)?ON\s+([a-z_][a-z0-9_]*)/gi,
  /\bCREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+[a-z_][a-z0-9_]*\s+(?:BEFORE|AFTER|INSTEAD\s+OF)[\s\S]{0,120}?\bON\s+([a-z_][a-z0-9_]*)/gi,
  /\bDROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?[a-z_][a-z0-9_]*\s+ON\s+([a-z_][a-z0-9_]*)/gi,
  /\bGRANT\s+[\s\S]{0,80}?\bON\s+(?:TABLE\s+|FUNCTION\s+|SEQUENCE\s+)?([a-z_][a-z0-9_]*)/gi,
  /\bREVOKE\s+[\s\S]{0,80}?\bON\s+(?:TABLE\s+|FUNCTION\s+|SEQUENCE\s+)?([a-z_][a-z0-9_]*)/gi,
  /\bCOMMENT\s+ON\s+(?:TABLE|COLUMN|FUNCTION|VIEW)\s+([a-z_][a-z0-9_]*)/gi,
  /\bPERFORM\s+([a-z_][a-z0-9_]*)\s*\(/gi,
];

/** Definicje obiektów - budują słownik nazw, które W OGÓLE istnieją w tej bazie. */
const DEFINITION_RES: readonly RegExp[] = [
  /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:UNLOGGED\s+|TEMP\s+|TEMPORARY\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)/gi,
  /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)/gi,
  /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?([a-z_][a-z0-9_]*)/gi,
  /\bCREATE\s+TYPE\s+(?:public\.)?"?([a-z_][a-z0-9_]*)/gi,
  /\bALTER\s+TYPE\s+(?:public\.)?"?([a-z_][a-z0-9_]*)/gi,
];

/**
 * Słowa kluczowe SQL i wewnętrzne obiekty Postgresa. Pozycje strukturalne
 * łapią je razem z nazwami tabel (`FROM pg_proc`, `CREATE TABLE ... (id uuid)`),
 * a bez odsiania zaśmiecają i słownik, i punktację.
 */
const SQL_STOPWORDS: ReadonlySet<string> = new Set(
  `select from where and or not null true false table view index trigger function
policy on to as set values insert update delete create drop alter add column constraint primary key
foreign references unique check default returns language plpgsql sql security definer invoker begin end
if then else elsif loop for in out inout declare exists case when using with only cascade restrict
public storage auth extensions pg_catalog information_schema jsonb text uuid boolean integer bigint
timestamptz timestamp date numeric json array record void trigger_set row rows new old tg_op
pg_proc pg_namespace pg_class pg_attribute pg_policies pg_indexes pg_trigger pg_type pg_tables
pg_constraint pg_get_function_identity_arguments format execute perform raise notice exception
schema extension grant revoke authenticated anon service_role postgres current_user session_user
coalesce nullif greatest least count sum avg min max now jsonb_set jsonb_build_object to_jsonb
lateral unnest generate_series information_schema_tables dual`
    .split(/\s+/)
    .filter(Boolean),
);

/**
 * Ogólne opakowania czasownikowe - zdejmowane przed dopasowaniem do prefiksów.
 *
 * `seed_`, `apply_`, `purge_`, `prune_` są tu, a NIE w regułach domenowych,
 * bo są czasownikami, nie dziedziną: `seed_pricing_defaults` to cennik
 * (monetyzacja), a nie „platforma, bo seeduje". Zmierzone na korpusie: reguła
 * domenowa `seed_` przeciągała 6 migracji katalogu cennikowego do domeny
 * przekrojowej.
 */
const WRAPPER_RE =
  /^(admin_|get_|set_|is_|has_|assert_|tg_|_tg_|fn_|trg_|rpc_|do_|try_|ensure_|sync_|refresh_|recompute_|backfill_|migrate_|upsert_|list_|count_|check_|validate_|guard_|touch_|handle_|on_|after_|before_|seed_|apply_|purge_|prune_)/;

/** Identyfikator krótszy niż to albo o takim prefiksie to zmienna, nie obiekt. */
function isNoiseIdentifier(id: string): boolean {
  return id.length < 4 || id.startsWith("v_") || id.startsWith("_") || id.startsWith("pg_");
}

export function extractIdentifiers(sql: string): Set<string> {
  const cleaned = stripSqlNoise(sql);
  const ids = new Set<string>();

  QUALIFIED_RE.lastIndex = 0;
  let match = QUALIFIED_RE.exec(cleaned);
  while (match !== null) {
    ids.add(match[1].toLowerCase());
    match = QUALIFIED_RE.exec(cleaned);
  }

  for (const re of STRUCTURAL_RES) {
    re.lastIndex = 0;
    let hit = re.exec(cleaned);
    while (hit !== null) {
      const id = hit[1].toLowerCase();
      if (!SQL_STOPWORDS.has(id)) ids.add(id);
      hit = re.exec(cleaned);
    }
  }

  return ids;
}

/**
 * Słownik nazw, które gdziekolwiek w korpusie są DEFINIOWANE albo wystąpiły
 * kwalifikowane schematem. Wszystko poza nim (nazwy CTE, aliasy tabel, zmienne
 * PL/pgSQL - `visible`, `base`, `cand`, `ranked`, `ctx`) jest szumem: bez tego
 * filtra korpus dawał 1653 identyfikatory zamiast 1350.
 */
export function buildVocabulary(sources: readonly MigrationSource[]): Set<string> {
  const vocabulary = new Set<string>();
  for (const source of sources) {
    const cleaned = stripSqlNoise(source.sql);

    QUALIFIED_RE.lastIndex = 0;
    let match = QUALIFIED_RE.exec(cleaned);
    while (match !== null) {
      vocabulary.add(match[1].toLowerCase());
      match = QUALIFIED_RE.exec(cleaned);
    }

    for (const re of DEFINITION_RES) {
      re.lastIndex = 0;
      let hit = re.exec(cleaned);
      while (hit !== null) {
        vocabulary.add(hit[1].toLowerCase());
        hit = re.exec(cleaned);
      }
    }
  }
  for (const id of [...vocabulary]) {
    if (SQL_STOPWORDS.has(id) || isNoiseIdentifier(id)) vocabulary.delete(id);
  }
  return vocabulary;
}

interface RuleIndex {
  /** Klucze posortowane malejąco po długości - najdłuższy (najbardziej szczegółowy) wygrywa. */
  readonly keys: readonly string[];
  readonly domainOf: Readonly<Record<string, string>>;
}

export function buildRuleIndex(domains: readonly OwnershipDomain[]): RuleIndex {
  const domainOf: Record<string, string> = {};
  for (const domain of domains) {
    for (const key of domain.obiektyBazy) {
      if (domainOf[key] !== undefined && domainOf[key] !== domain.slug) {
        throw new Error(
          `governance/ownership.json: prefiks '${key}' przypisany do dwóch domen ` +
            `('${domainOf[key]}' i '${domain.slug}').`,
        );
      }
      domainOf[key] = domain.slug;
    }
  }
  const keys = Object.keys(domainOf).sort((a, b) => b.length - a.length);
  return { keys, domainOf };
}

/** Zwraca [domena, klucz reguły] albo null. Klucz jest potrzebny do wykrywania reguł martwych. */
export function matchIdentifier(id: string, rules: RuleIndex): [string, string] | null {
  const candidates = [id];
  let current = id;
  for (let i = 0; i < 3; i += 1) {
    const stripped = current.replace(WRAPPER_RE, "");
    if (stripped === current) break;
    current = stripped;
    candidates.push(current);
  }

  for (const candidate of candidates) {
    for (const key of rules.keys) {
      if (key.endsWith("$")) {
        if (candidate === key.slice(0, -1)) return [rules.domainOf[key], key];
      } else if (candidate.startsWith(key)) {
        return [rules.domainOf[key], key];
      }
    }
  }
  // Ostatnia szansa: nazwa z prefiksem czasownikowym spoza listy (`purge_club_x`).
  // Wygrywa dopasowanie NAJWCZEŚNIEJSZE, a przy równej pozycji najdłuższe -
  // rzeczownik główny stoi w nazwie funkcji przed dopełnieniami. Sama „najdłuższy
  // klucz wygrywa" dawała tu błędy: `mark_push_subscription_failed` trafiał
  // w `subscription` (monetyzacja) zamiast w stojące wcześniej `push_` (platforma).
  let bestKey: string | null = null;
  let bestAt = Number.MAX_SAFE_INTEGER;
  for (const key of rules.keys) {
    if (key.endsWith("$") || key.length < 5) continue;
    const at = id.indexOf(key);
    if (at === -1) continue;
    // `rules.keys` jest posortowane malejąco po długości, więc przy równej
    // pozycji pierwszy trafiony jest zarazem najdłuższy.
    if (at < bestAt) {
      bestAt = at;
      bestKey = key;
    }
  }
  if (bestKey !== null) return [rules.domainOf[bestKey], bestKey];
  return null;
}

const UBIQUITOUS_SHARE = 0.2;

/**
 * Poniżej tylu plików częstość dokumentowa NIE NIESIE INFORMACJI i próg 20%
 * odwraca się przeciwko regule: w korpusie jednoplikowym KAŻDY identyfikator
 * występuje w 100% plików, więc wszystkie zostałyby uznane za przekrojowe,
 * warstwa 1 nie miałaby czym punktować i wszystko spadłoby do kubła „brak".
 * Dla małych zbiorów (testy jednostkowe, pojedynczy katalog przy diagnostyce)
 * zostaje więc wyłącznie KURATOROWANA lista przekrojowa z rejestru - ona jest
 * decyzją, a nie statystyką, więc działa niezależnie od rozmiaru korpusu.
 */
const UBIQUITOUS_MIN_CORPUS = 50;

export function attributeMigrations(
  sources: readonly MigrationSource[],
  registry: OwnershipRegistry,
): { attributions: MigrationAttribution[]; usedRules: Set<string> } {
  const rules = buildRuleIndex(registry.domeny);
  const priority = registry.domeny.map((domain) => domain.slug);
  const fallback = priority[priority.length - 1];
  const vocabulary = buildVocabulary(sources);

  const perFile = new Map<string, string[]>();
  const documentFrequency = new Map<string, number>();
  for (const source of sources) {
    const ids = [...extractIdentifiers(source.sql)].filter((id) => vocabulary.has(id));
    perFile.set(source.file, ids);
    for (const id of ids) documentFrequency.set(id, (documentFrequency.get(id) ?? 0) + 1);
  }

  const ubiquitous = new Set<string>();
  if (sources.length >= UBIQUITOUS_MIN_CORPUS) {
    for (const [id, count] of documentFrequency) {
      if (count > sources.length * UBIQUITOUS_SHARE) ubiquitous.add(id);
    }
  }
  for (const id of Object.keys(registry.tier2)) {
    if (documentFrequency.has(id)) ubiquitous.add(id);
  }

  const usedRules = new Set<string>();
  const attributions = [...sources]
    .sort((a, b) => (a.file < b.file ? -1 : 1))
    .map((source): MigrationAttribution => {
      const ids = perFile.get(source.file) ?? [];
      const scores = new Map<string, number>();
      let votes = 0;

      const vote = (domain: string, weight: number): void => {
        votes += 1;
        scores.set(domain, (scores.get(domain) ?? 0) + weight);
      };

      for (const id of ids) {
        if (ubiquitous.has(id)) continue;
        const hit = matchIdentifier(id, rules);
        if (hit === null) continue;
        usedRules.add(hit[1]);
        vote(hit[0], 1 / Math.log2(1 + (documentFrequency.get(id) ?? 1)));
      }
      let tier: MigrationTier = "identyfikatory";

      // Warstwa 1.5: dynamiczny SQL i bloki `DO $$` trzymają nazwy funkcji
      // w LITERAŁACH, które `stripSqlNoise` wycina. Skanujemy więc surowy tekst,
      // ale tylko po nazwach >= 8 znaków - krótsze dają fałszywe trafienia.
      if (votes === 0) {
        const raw = stripSqlComments(source.sql).toLowerCase();
        for (const id of vocabulary) {
          if (ubiquitous.has(id) || id.length < 8 || !raw.includes(id)) continue;
          const hit = matchIdentifier(id, rules);
          if (hit === null) continue;
          usedRules.add(hit[1]);
          vote(hit[0], 1 / Math.log2(1 + (documentFrequency.get(id) ?? 1)));
        }
        if (votes > 0) tier = "literaly";
      }

      // Warstwa 2: identyfikatory przekrojowe nie są WYRZUCANE, tylko ODŁOŻONE.
      // Migracja robiąca wyłącznie `GRANT ... ON public.profiles` należy do
      // tożsamości, a nie do kubła „nie wiadomo".
      if (votes === 0) {
        for (const id of ids) {
          const domain = registry.tier2[id];
          if (domain === undefined) continue;
          vote(domain, 1);
        }
        if (votes > 0) tier = "przekrojowe";
      }

      if (votes === 0) {
        return { file: source.file, domain: fallback, tier: "brak", votes: 0 };
      }

      let best = fallback;
      let bestScore = -1;
      for (const slug of priority) {
        const score = scores.get(slug) ?? 0;
        if (score > bestScore + 1e-12) {
          bestScore = score;
          best = slug;
        }
      }
      return { file: source.file, domain: best, tier, votes };
    });

  return { attributions, usedRules };
}

// ── Raport ──────────────────────────────────────────────────────────────────

export interface OwnershipInput {
  readonly registry: OwnershipRegistry;
  readonly routeFiles: readonly string[];
  readonly migrations: readonly MigrationSource[];
  /** Ścieżki dokumentów wymaganych przez rejestr wraz z informacją, czy istnieją. */
  readonly documentExists: Readonly<Record<string, boolean>>;
  /** Dzień odniesienia dla ważności umowy (format `YYYY-MM-DD`). */
  readonly today: string;
}

function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    throw new Error(`Nieprawidłowa data w rejestrze albo wejściu bramki: '${from}' / '${to}'.`);
  }
  return Math.round((end - start) / 86_400_000);
}

export function analyzeOwnership(input: OwnershipInput): OwnershipReport {
  const { registry } = input;

  const routes = attributeRoutes(input.routeFiles, registry.domeny);
  const routesPerDomain: Record<string, number> = {};
  for (const domain of registry.domeny) routesPerDomain[domain.slug] = 0;
  for (const attribution of routes.attributions) {
    if (attribution.domain !== null) routesPerDomain[attribution.domain] += 1;
  }

  const migrations = attributeMigrations(input.migrations, registry);
  const migrationsPerDomain: Record<string, number> = {};
  for (const domain of registry.domeny) migrationsPerDomain[domain.slug] = 0;
  const perTier: Record<MigrationTier, number> = {
    identyfikatory: 0,
    literaly: 0,
    przekrojowe: 0,
    brak: 0,
  };
  for (const attribution of migrations.attributions) {
    migrationsPerDomain[attribution.domain] += 1;
    perTier[attribution.tier] += 1;
  }

  // Wzorzec-łapacz: formalnie daje pokrycie, faktycznie kasuje własnicielstwo.
  const patternHits = new Map<string, number>();
  for (const attribution of routes.attributions) {
    if (attribution.pattern === null) continue;
    patternHits.set(attribution.pattern, (patternHits.get(attribution.pattern) ?? 0) + 1);
  }
  const catchAll = (
    routes.attributions.length < CATCH_ALL_MIN_ROUTES ? [] : [...patternHits.entries()]
  )
    .filter(([, hits]) => hits > routes.attributions.length * CATCH_ALL_SHARE)
    .map(([glob, hits]) => `'${glob}' bierze ${hits} z ${routes.attributions.length} tras`)
    .sort();

  const deadRoutePatterns: string[] = [];
  const deadDbRules: string[] = [];
  for (const domain of registry.domeny) {
    for (const glob of domain.trasy) {
      if (!routes.usedPatterns.has(glob)) deadRoutePatterns.push(`${domain.slug}: '${glob}'`);
    }
    for (const key of domain.obiektyBazy) {
      if (!migrations.usedRules.has(key)) deadDbRules.push(`${domain.slug}: '${key}'`);
    }
  }

  const unstaffedDomains: string[] = [];
  const danglingRefs: string[] = [];
  const ownerEqualsDeputy: string[] = [];
  for (const domain of registry.domeny) {
    for (const [label, id] of [
      ["właściciel", domain.wlasciciel],
      ["zastępca", domain.zastepca],
      ["eskalacja", domain.eskalacja],
    ] as const) {
      if (registry.osoby[id] === undefined) {
        danglingRefs.push(`${domain.slug}.${label} -> '${id}' (brak wpisu w 'osoby')`);
      }
    }
    if (domain.wlasciciel === domain.zastepca) {
      ownerEqualsDeputy.push(domain.slug);
    }
    const owner = registry.osoby[domain.wlasciciel];
    if (owner !== undefined && !owner.obsadzone) unstaffedDomains.push(domain.slug);
  }

  // Obsadzenie pozorne: samo przestawienie `obsadzone` na `true` przy wpisie
  // zaślepce oznaczyłoby WSZYSTKIE domeny jako mające właściciela, bo wszystkie
  // wskazują ten jeden wpis. Obsadzony znaczy: ma się z kim skontaktować.
  const staffedWithoutContact = Object.entries(registry.osoby)
    .filter(
      ([, person]) =>
        person.obsadzone && (person.kontakt === null || person.organizacja === "NIEOBSADZONE"),
    )
    .map(([id, person]) =>
      person.kontakt === null
        ? `${id}: 'obsadzone: true' bez pola 'kontakt'`
        : `${id}: 'obsadzone: true' przy organizacji 'NIEOBSADZONE'`,
    )
    .sort();

  const missingDocuments = Object.entries(input.documentExists)
    .filter(([, exists]) => !exists)
    .map(([path]) => path)
    .sort();

  const daysLeft = daysBetween(input.today, registry.kontraktUtrzymaniowy.obowiazujeDo);

  const noHit = migrations.attributions
    .filter((attribution) => attribution.tier === "brak")
    .map((attribution) => attribution.file);
  const allowedNoHit = new Set(registry.progi.migracjeBezAtrybucjiDozwolone);
  const presentMigrations = new Set(input.migrations.map((source) => source.file));

  return {
    routes: {
      total: routes.attributions.length,
      unmatched: routes.attributions
        .filter((attribution) => attribution.domain === null)
        .map((attribution) => attribution.file),
      overlapping: routes.attributions.filter((attribution) => attribution.alsoMatched.length > 0),
      catchAll,
      perDomain: routesPerDomain,
    },
    migrations: {
      total: migrations.attributions.length,
      noHit,
      noHitNowe: noHit.filter((file) => !allowedNoHit.has(file)),
      noHitNieaktualne: [...allowedNoHit]
        .filter((file) => !noHit.includes(file) && presentMigrations.has(file))
        .sort(),
      weak: migrations.attributions.filter((attribution) => attribution.votes === 1).length,
      perDomain: migrationsPerDomain,
      perTier,
    },
    deadRoutePatterns,
    deadDbRules,
    people: { unstaffedDomains, danglingRefs, ownerEqualsDeputy, staffedWithoutContact },
    documents: { missing: missingDocuments },
    contract: {
      daysLeft,
      expired: daysLeft < 0,
      warning: daysLeft >= 0 && daysLeft <= registry.kontraktUtrzymaniowy.ostrzegajOdDni,
    },
    thresholds: registry.progi,
    domains: registry.domeny,
  };
}

export function ownershipFailed(report: OwnershipReport): boolean {
  return (
    report.routes.unmatched.length > 0 ||
    report.routes.catchAll.length > 0 ||
    report.migrations.noHitNowe.length > 0 ||
    report.people.unstaffedDomains.length > report.thresholds.domenyBezWlasciciela ||
    report.people.danglingRefs.length > 0 ||
    report.people.ownerEqualsDeputy.length > 0 ||
    report.people.staffedWithoutContact.length > 0 ||
    report.deadRoutePatterns.length > report.thresholds.martweWzorceTras ||
    report.documents.missing.length > 0 ||
    report.contract.expired
  );
}

function bar(count: number, total: number): string {
  if (total === 0) return "";
  return "█".repeat(Math.max(1, Math.round((count / total) * 24)));
}

export function renderOwnershipReport(report: OwnershipReport): string {
  const lines: string[] = [];
  const failed = ownershipFailed(report);

  lines.push(
    `${failed ? "✗" : "✓"} [ownership] ${report.routes.total} tras admina i ` +
      `${report.migrations.total} migracji wobec ${report.domains.length} domen rejestru.`,
  );
  lines.push("");
  lines.push("  domena                       trasy   migracje  SLA      właściciel");
  lines.push("  ───────────────────────────  ─────   ────────  ───────  ──────────");
  for (const domain of report.domains) {
    const owned = !report.people.unstaffedDomains.includes(domain.slug);
    lines.push(
      `  ${domain.slug.padEnd(27)}  ${String(report.routes.perDomain[domain.slug]).padStart(5)}   ` +
        `${String(report.migrations.perDomain[domain.slug]).padStart(8)}  ${domain.klasaSla.padEnd(7)}  ` +
        `${owned ? "wskazany" : "NIEOBSADZONY"}`,
    );
  }
  lines.push("");
  lines.push(
    `  Atrybucja migracji: ${report.migrations.perTier.identyfikatory} po identyfikatorach, ` +
      `${report.migrations.perTier.literaly} po literałach, ` +
      `${report.migrations.perTier.przekrojowe} po przekrojowych, ` +
      `${report.migrations.perTier.brak} bez trafienia ` +
      `(${report.thresholds.migracjeBezAtrybucjiDozwolone.length} dopuszczone z nazwy). ${bar(
        report.migrations.perTier.identyfikatory,
        report.migrations.total,
      )}`,
  );
  lines.push(
    `  Atrybucje słabe (jeden identyfikator): ${report.migrations.weak} - ` +
      "bramka gwarantuje POKRYCIE, nie trafność; te wpisy warto przejrzeć ręcznie.",
  );

  if (report.routes.overlapping.length > 0) {
    lines.push(
      `  Tras dopasowanych przez więcej niż jedną domenę: ${report.routes.overlapping.length} ` +
        "- rozstrzygnięte kolejnością domen w rejestrze (pierwsza wygrywa).",
    );
  }

  const problems: string[] = [];
  if (report.routes.unmatched.length > 0) {
    problems.push(
      `TRASY BEZ WŁAŚCICIELA (${report.routes.unmatched.length}) - dopisz wzorzec do ` +
        "'domeny[].trasy' w governance/ownership.json:",
      ...report.routes.unmatched.map((file) => `    • src/routes/${file}`),
    );
  }
  if (report.migrations.noHitNowe.length > 0) {
    problems.push(
      `MIGRACJE BEZ WŁAŚCICIELA (${report.migrations.noHitNowe.length}) - bramka nie potrafi ` +
        "wskazać domeny z treści SQL. Dopisz prefiks tabeli do 'domeny[].obiektyBazy' " +
        "(zwykle to wystarczy) albo, jeśli migracja naprawdę nie dotyczy żadnej domeny, " +
        "dopisz jej NAZWĘ do 'progi.migracjeBezAtrybucjiDozwolone' z uzasadnieniem w PR-ze. " +
        "NIE podnoś progu - progu tu nie ma, jest lista:",
      ...report.migrations.noHitNowe.map((file) => `    • supabase/migrations/${file}`),
    );
  }
  if (report.routes.catchAll.length > 0) {
    problems.push(
      "WZORZEC-ŁAPACZ - formalnie daje pokrycie, faktycznie kasuje własnicielstwo. " +
        "Rozbij go na wzorce per domena:",
      ...report.routes.catchAll.map((entry) => `    • ${entry}`),
    );
  }
  if (report.people.staffedWithoutContact.length > 0) {
    problems.push(
      "OBSADZENIE POZORNE - wpis ma 'obsadzone: true', ale nie ma się z kim skontaktować:",
      ...report.people.staffedWithoutContact.map((entry) => `    • ${entry}`),
    );
  }
  if (report.people.danglingRefs.length > 0) {
    problems.push(
      "WSKAZANIE NA NIEISTNIEJĄCĄ OSOBĘ:",
      ...report.people.danglingRefs.map((ref) => `    • ${ref}`),
    );
  }
  if (report.people.ownerEqualsDeputy.length > 0) {
    problems.push(
      "WŁAŚCICIEL = ZASTĘPCA (zerowy bus factor, domena ma JEDEN punkt awarii):",
      ...report.people.ownerEqualsDeputy.map((slug) => `    • ${slug}`),
    );
  }
  if (report.people.unstaffedDomains.length > report.thresholds.domenyBezWlasciciela) {
    problems.push(
      `DOMEN BEZ OBSADZONEGO WŁAŚCICIELA: ${report.people.unstaffedDomains.length} > próg ` +
        `${report.thresholds.domenyBezWlasciciela}. Ten próg wolno WYŁĄCZNIE obniżać.`,
    );
  }
  if (report.deadRoutePatterns.length > report.thresholds.martweWzorceTras) {
    problems.push(
      `MARTWE WZORCE TRAS: ${report.deadRoutePatterns.length} > próg ` +
        `${report.thresholds.martweWzorceTras}. Wzorzec nie trafia w żaden plik - ` +
        "usuń go z 'domeny[].trasy' i uruchom `bun run generate:codeowners`:",
      ...report.deadRoutePatterns.map((rule) => `    • ${rule}`),
    );
  }
  if (report.documents.missing.length > 0) {
    problems.push(
      "BRAK DOKUMENTU WYMAGANEGO PRZEZ REJESTR:",
      ...report.documents.missing.map((path) => `    • ${path}`),
    );
  }
  if (report.contract.expired) {
    problems.push(
      `UMOWA UTRZYMANIOWA WYGASŁA ${-report.contract.daysLeft} dni temu. Bramka świeci na ` +
        "czerwono, dopóki umowa nie zostanie przedłużona, a 'kontraktUtrzymaniowy.obowiazujeDo' " +
        "w governance/ownership.json zaktualizowane. To jest cel tego pola: umowa, o której " +
        "nikt nie pamięta, nie jest umową utrzymaniową.",
    );
  }

  if (problems.length > 0) {
    lines.push("");
    lines.push("  ── DO NAPRAWY ────────────────────────────────────────────────────────────");
    for (const problem of problems) lines.push(`  ${problem}`);
  }

  const warnings: string[] = [];
  if (report.deadDbRules.length > 0) {
    warnings.push(
      `${report.deadDbRules.length} prefiksów bazy nie trafia dziś w żadną migrację ` +
        "(historia migracji bywa spłaszczana, więc to NIE jest błąd): " +
        `${report.deadDbRules.slice(0, 6).join(", ")}` +
        `${report.deadDbRules.length > 6 ? ", …" : ""}.`,
    );
  }
  if (report.migrations.noHitNieaktualne.length > 0) {
    warnings.push(
      "Lista 'migracjeBezAtrybucjiDozwolone' wymienia migracje, które dziś DAJĄ SIĘ " +
        `przypisać - usuń je z listy: ${report.migrations.noHitNieaktualne.join(", ")}.`,
    );
  }
  if (report.contract.warning) {
    warnings.push(
      `Umowa utrzymaniowa wygasa za ${report.contract.daysLeft} dni - uruchom przedłużenie.`,
    );
  }
  if (
    report.people.unstaffedDomains.length > 0 &&
    report.people.unstaffedDomains.length <= report.thresholds.domenyBezWlasciciela
  ) {
    warnings.push(
      `${report.people.unstaffedDomains.length} z ${report.domains.length} domen nadal bez ` +
        "obsadzonego właściciela technicznego (w progu, więc bramka przechodzi): " +
        `${report.people.unstaffedDomains.join(", ")}.`,
    );
  }
  if (warnings.length > 0) {
    lines.push("");
    lines.push("  ── OSTRZEŻENIA (nie blokują) ─────────────────────────────────────────────");
    for (const warning of warnings) lines.push(`  ! ${warning}`);
  }

  return lines.join("\n");
}

// ── CODEOWNERS ──────────────────────────────────────────────────────────────

/**
 * Generuje `.github/CODEOWNERS` z rejestru.
 *
 * ── KOLEJNOŚĆ JEST ODWRÓCONA I TO NIE JEST POMYŁKA ──────────────────────────
 * Ta bramka i GitHub rozstrzygają nakładające się wzorce PRZECIWNIE:
 * `attributeRoutes` bierze PIERWSZE trafienie w kolejności rejestru, a GitHub
 * dla CODEOWNERS bierze OSTATNIE trafienie w kolejności pliku. Emisja domen
 * „po kolei" dałaby więc plik, który po aktywacji kierowałby przeglądy DOKŁADNIE
 * ODWROTNIE niż mówi rejestr: `admin.settings.privacy.tsx` należy w rejestrze do
 * `zgodnosc-i-prywatnosc` (domena wcześniejsza, wzorzec dokładny), ale
 * `admin.settings.*` z `tozsamosc-i-uprawnienia` stałby niżej w pliku i wygrał
 * u GitHuba. Dlatego domeny wychodzą tu w kolejności ODWROTNEJ - wtedy „ostatni
 * wygrywa" GitHuba odtwarza „pierwszy wygrywa" rejestru.
 *
 * ── DLACZEGO REGUŁY SĄ ZAKOMENTOWANE ────────────────────────────────────────
 * Dopóki właściciele nie są obsadzeni, reguły wychodzą zakomentowane: plik
 * wskazujący nieistniejący zespół jest wprawdzie poprawny składniowo, ale przy
 * ochronie gałęzi z opcją „Require review from Code Owners" zablokowałby KAŻDY
 * merge - bramka własnicielska nie ma prawa zatrzymać wydania PRZYPADKIEM.
 * (Wygaśnięcie umowy zatrzymuje wydanie ŚWIADOMIE i po 60 dniach ostrzeżeń -
 * to inna sytuacja niż cicha blokada przez literówkę w nazwie zespołu.)
 *
 * ── CO TEN PLIK POKRYWA, A CZEGO NIE ────────────────────────────────────────
 * WYŁĄCZNIE trasy. Migracje mają w rejestrze własnicieli, ale NIE DA SIĘ ich
 * wyrazić w CODEOWNERS: pliki migracji nazywają się znacznikiem czasu (a 68,7%
 * z nich UUID-em), więc nie istnieje wzorzec ścieżki, który oddzielałby domeny.
 * Własnicielstwo migracji egzekwuje `bun run check:ownership`, nie ten plik.
 */
export function renderCodeowners(registry: OwnershipRegistry): string {
  const routePatternCount = registry.domeny.reduce((sum, domain) => sum + domain.trasy.length, 0);

  const lines: string[] = [
    "# PLIK GENEROWANY - nie edytuj ręcznie.",
    "# Źródło: governance/ownership.json  |  Generator: bun run generate:codeowners",
    "# Bramka spójności: bun run check:codeowners",
    "#",
    `# ${routePatternCount} wzorców tras administracyjnych w ${registry.domeny.length} domenach.`,
    "# Ten plik pokrywa WYŁĄCZNIE trasy. Własnicielstwo migracji bazy nie da się",
    "# wyrazić ścieżką (nazwy to znaczniki czasu i UUID-y) - egzekwuje je bramka",
    "# `bun run check:ownership` na podstawie tego samego rejestru.",
    "#",
    "# UWAGA NA KOLEJNOŚĆ: GitHub stosuje regułę OSTATNIEGO trafienia, a rejestr",
    "# regułę PIERWSZEGO, więc domeny są tu wypisane w kolejności ODWROTNEJ niż",
    "# w governance/ownership.json. Nie sortuj tego pliku.",
    "#",
    "# Zakres każdej domeny, klasa SLA i ścieżka eskalacji: governance/ownership.json",
    "# Umowa utrzymaniowa: " + registry.kontraktUtrzymaniowy.dokument,
    "# Niedostępność wykonawcy: " + registry.kontraktUtrzymaniowy.runbookCiaglosci,
    "",
  ];

  const unstaffed = registry.domeny.filter(
    (domain) => registry.osoby[domain.wlasciciel]?.obsadzone !== true,
  );
  if (unstaffed.length > 0) {
    lines.push(
      "# UWAGA: reguły poniżej są ZAKOMENTOWANE, bo " +
        `${unstaffed.length} z ${registry.domeny.length} domen nie ma obsadzonego właściciela,`,
      "# a zespoły GitHub o tych nazwach nie istnieją jeszcze w organizacji. Aktywna reguła",
      "# wskazująca nieistniejący zespół zablokowałaby merge przy ochronie gałęzi z opcją",
      '# "Require review from Code Owners". Kolejność: załóż zespół -> ustaw `obsadzone: true`',
      "# w governance/ownership.json -> `bun run generate:codeowners`.",
      "",
    );
  }

  for (const domain of [...registry.domeny].reverse()) {
    const owner = registry.osoby[domain.wlasciciel];
    const deputy = registry.osoby[domain.zastepca];
    const active = owner?.obsadzone === true;
    const prefix = active ? "" : "# ";
    lines.push(
      `# ── ${domain.nazwa} (${domain.slug}) · SLA ${domain.klasaSla} ──`,
      `#    właściciel: ${owner?.rola ?? "?"} | zastępca: ${deputy?.rola ?? "?"}`,
    );
    for (const glob of domain.trasy) {
      lines.push(`${prefix}/src/routes/${glob} ${domain.zespolGithub}`);
    }
    lines.push("");
  }

  // Sam rejestr: reguła zostaje ZAKOMENTOWANA, dopóki nie wskazuje zespołu.
  // `@NewEUStrategies` to uchwyt ORGANIZACJI, a nie użytkownika ani zespołu -
  // GitHub odrzuca taki wpis jako błąd składni i podświetla CAŁY plik, więc
  // aktywna wersja musi poczekać na `@NewEUStrategies/<zespół>`.
  const steward = registry.osoby["organizacja-nes"];
  lines.push(
    "# ── Rejestr własnicielstwa pilnuje sam siebie ──",
    `# Zmiana rejestru wymaga zgody właściciela biznesowego (${registry.kontraktUtrzymaniowy.zamawiajacy}).`,
    `# Odkomentuj, gdy powstanie zespół: /governance/ ${steward?.github ?? "@NewEUStrategies"}/<zespół>`,
    "",
  );

  return lines.join("\n");
}
