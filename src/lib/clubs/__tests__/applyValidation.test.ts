// Walidacja zgłoszenia do klubu (`/club/apply`) - 204 linie produkcyjne, zero
// testów do dziś. Audyt 14.08 nazwał ten obszar wprost: rekomendacja R2 stawia
// ŚCIEŻKĘ WEJŚCIA DO KLUBU na pierwszym miejscu w module o T/P 0,11, bo błąd
// tutaj nie jest usterką UI - to brama do przestrzeni, w której leżą dokumenty
// innych członków.
//
// CZEGO TEN TEST PILNUJE, A CZEGO NIE. Granicą bezpieczeństwa jest
// `club_apply_submit` (SECURITY DEFINER) i to on decyduje o przyjęciu - ta
// warstwa ma dwa zadania, oba testowalne bez bazy:
//
//   1. NIE PUŚCIĆ formularza, który serwer i tak odrzuci (koszt: runda po
//      sieci i komunikat ogólny zamiast błędu przy polu);
//   2. NAZWAĆ błąd KLUCZEM i18n, nie zdaniem - bo ta sama walidacja obsługuje
//      PL i EN, a zdanie zaszyte w kodzie omija bramkę parytetu.
//
// Zestaw pól jest zamknięty (`CLUB_APPLY_FIELDS`), więc trzecia warstwa testu
// jest kontraktowa: każdy klucz, który walidacja potrafi zwrócić, MUSI mieć
// zdanie w PL i w EN. To ten sam wzorzec defektu, co w `i18nDictionaries.test`
// - klucz nieobecny w OBU słownikach przechodzi przez parytet niewidzialny,
// a kandydat dostaje goły `club.spec.apply.errors.motivationShort` pod polem,
// którego nie umie poprawić.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Bundle sprawdzamy jako LITERAŁY - instancja i18next jest tu zbędna i wciąga
// serwerowy graf lokalizacji do happy-dom. Ten sam skrót, co w
// `i18nDictionaries.test.ts`.
vi.mock("@/lib/i18n", () => ({
  default: { addResourceBundle: () => undefined },
}));

import { clubEn, clubPl } from "@/lib/i18n-club";
import {
  CLUB_APPLY_AVAILABILITY,
  CLUB_APPLY_FIELDS,
  CLUB_APPLY_INDUSTRY,
  CLUB_APPLY_SENIORITY,
  EMPTY_CLUB_APPLY,
  clubApplySchema,
  clubApplyValid,
  validateClubApply,
  type ClubApplyField,
  type ClubApplyValues,
} from "../applyValidation";

/** Zgłoszenie, które MUSI przechodzić - baza dla wariantów jednopolowych. */
const VALID: ClubApplyValues = {
  firstName: "Anna",
  lastName: "Kowalska",
  email: "anna.kowalska@example.eu",
  phone: "+48 22 123 45 67",
  company: "Instytut Analiz Publicznych",
  jobPosition: "Dyrektorka programu",
  seniority: "director",
  industry: "public_administration",
  country: "Polska",
  city: "Warszawa",
  linkedinUrl: "https://www.linkedin.com/in/anna-kowalska/",
  yearsExperience: "12",
  expertise: "Regulacje rynku energii i bezpieczeństwo dostaw w regionie CEE.",
  languages: "polski, angielski, francuski",
  specialization: "energy",
  clubId: "club-energy-cee",
  motivation: "Chcę pracować nad rekomendacjami dla regionu razem z praktykami tej dziedziny.",
  goals: "Wspólne stanowisko CEE na rewizję rynku mocy.",
  contribution: "Dane z dwunastu lat postępowań regulacyjnych.",
  availability: "monthly",
  referralSource: "Konferencja NES 2026",
  consent: true,
  marketingConsent: false,
};

/** Wariant bazy z jedną podmianą - czyta się lepiej niż spread w każdym `it`. */
function withField<K extends keyof ClubApplyValues>(
  field: K,
  value: ClubApplyValues[K],
): ClubApplyValues {
  return { ...VALID, [field]: value };
}

type Tree = Record<string, unknown>;

function readKey(tree: Tree, path: string): unknown {
  let node: unknown = tree;
  for (const part of path.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Tree)[part];
  }
  return node;
}

/**
 * Wszystkie klucze, jakie schemat POTRAFI zwrócić - czytane ze ŹRÓDŁA modułu,
 * nie z listy przepisanej ręcznie do testu.
 *
 * DLACZEGO ZE ŹRÓDŁA, A NIE Z LISTY. Lista w teście starzeje się cicho: nowe
 * pole z nowym komunikatem dokłada klucz, o którym test nie wie, i bramka i18n
 * niżej zostaje zielona przy braku tłumaczenia. Czytanie literałów z pliku
 * wiąże test z faktem, a nie z jego kopią.
 *
 * DLACZEGO Z PLIKU, A NIE Z `schema.toString()`. Zod trzyma komunikaty
 * w strukturze, nie w kodzie funkcji - `toString()` na schemacie nie zawiera
 * literałów kluczy (sprawdzone: zwraca zero dopasowań). Skan tekstu źródła jest
 * jedyną drogą, która widzi WSZYSTKIE klucze, także te w gałęziach `refine`.
 * Ten sam wzorzec, co `clubEgressGuards.test.ts:107`.
 */
const APPLY_VALIDATION_SOURCE = readFileSync(
  join(process.cwd(), "src/lib/clubs/applyValidation.ts"),
  "utf8",
);

function declaredErrorKeys(): string[] {
  const found = new Set<string>();
  // Klucze są składane szablonem `${K}.nazwa`, gdzie K = "club.spec.apply.errors".
  for (const match of APPLY_VALIDATION_SOURCE.matchAll(/\$\{K\}\.([A-Za-z]+)/g)) {
    found.add(`club.spec.apply.errors.${match[1]}`);
  }
  return [...found];
}

describe("validateClubApply - komplet poprawny", () => {
  it("przepuszcza zgłoszenie wypełnione poprawnie", () => {
    const errors = validateClubApply(VALID);
    expect(errors).toEqual({});
    expect(clubApplyValid(errors)).toBe(true);
  });

  it("przepuszcza zgłoszenie bez pól nieobowiązkowych", () => {
    const errors = validateClubApply({
      ...VALID,
      city: "",
      linkedinUrl: "",
      yearsExperience: "",
      languages: "",
      contribution: "",
      referralSource: "",
      clubId: "",
    });
    expect(errors).toEqual({});
  });

  it("pusty formularz nie jest poprawny, a `EMPTY_CLUB_APPLY` ma wszystkie pola", () => {
    expect(clubApplyValid(validateClubApply(EMPTY_CLUB_APPLY))).toBe(false);
    // Brakujące pole w stanie początkowym oznacza `undefined` w kontrolce i
    // ostrzeżenie Reacta o przejściu z niekontrolowanej na kontrolowaną.
    for (const field of CLUB_APPLY_FIELDS) {
      expect(EMPTY_CLUB_APPLY, `brak pola ${field} w stanie początkowym`).toHaveProperty(field);
    }
    expect(EMPTY_CLUB_APPLY.consent).toBe(false);
    expect(EMPTY_CLUB_APPLY.marketingConsent).toBe(false);
  });
});

describe("validateClubApply - zgoda na przetwarzanie danych (RODO)", () => {
  // Zgoda jest jedynym polem, którego brak jest ODMOWĄ PRAWNĄ, nie usterką
  // formularza: bez niej zgłoszenia nie wolno przetworzyć, więc walidacja nie
  // może jej przepuścić ani wtedy, gdy reszta formularza jest wzorowa.
  it("brak zgody blokuje zgłoszenie mimo poprawnej reszty", () => {
    const errors = validateClubApply(withField("consent", false));
    expect(errors.consent).toBe("club.spec.apply.errors.consentRequired");
  });

  it("zgoda marketingowa jest nieobowiązkowa i nie blokuje zgłoszenia", () => {
    expect(validateClubApply({ ...VALID, marketingConsent: false })).toEqual({});
    expect(validateClubApply({ ...VALID, marketingConsent: true })).toEqual({});
  });
});

describe("validateClubApply - jeden komunikat na pole", () => {
  it("pole naruszające dwie reguły dostaje DOKŁADNIE jeden klucz", () => {
    // Jednoznakowy `firstName` w formularzu, w którym brakuje też innych pól:
    // interesuje nas liczba kluczy PRZY POLU, nie liczba błędów w formularzu.
    const errors = validateClubApply(withField("firstName", "A"));
    expect(Object.keys(errors)).toEqual(["firstName"]);
    expect(typeof errors.firstName).toBe("string");
  });

  it("mapa błędów nigdy nie wychodzi poza zamknięty zestaw pól", () => {
    const errors = validateClubApply(EMPTY_CLUB_APPLY);
    const allowed = new Set<string>(CLUB_APPLY_FIELDS);
    for (const key of Object.keys(errors)) {
      expect(allowed, `nieznane pole w mapie błędów: ${key}`).toContain(key);
    }
    // Kanarek zasięgu: gdyby walidacja przestała cokolwiek zwracać, pętla wyżej
    // przechodziłaby pusta i zielona.
    expect(Object.keys(errors).length).toBeGreaterThan(8);
  });
});

describe("validateClubApply - pola obowiązkowe", () => {
  const REQUIRED: ReadonlyArray<[ClubApplyField, string]> = [
    ["firstName", ""],
    ["lastName", ""],
    ["email", ""],
    ["phone", ""],
    ["company", ""],
    ["jobPosition", ""],
    ["seniority", ""],
    ["industry", ""],
    ["country", ""],
    ["expertise", ""],
    ["specialization", ""],
    ["motivation", ""],
    ["goals", ""],
    ["availability", ""],
  ];

  it.each(REQUIRED)("puste pole %s zgłasza błąd", (field, empty) => {
    const errors = validateClubApply(withField(field, empty));
    expect(errors[field], `pole ${field} przeszło jako puste`).toBeDefined();
  });

  it("białe znaki nie zaliczają się jako wypełnienie", () => {
    // `z.string().trim()` przycina PRZED sprawdzeniem długości, więc spacje nie
    // mogą wystarczyć - inaczej komisja dostaje zgłoszenie z pustym polem.
    for (const field of ["firstName", "lastName", "company", "country"] as const) {
      expect(validateClubApply(withField(field, "   "))[field], field).toBeDefined();
    }
  });
});

describe("validateClubApply - e-mail i telefon (kanały kontaktu komisji)", () => {
  it.each([
    "anna@example.eu",
    "anna.kowalska+klub@example.co.uk",
    "a.k@instytut-analiz.example.pl",
  ])("przepuszcza poprawny adres %s", (email) => {
    expect(validateClubApply(withField("email", email)).email).toBeUndefined();
  });

  it.each(["anna", "anna@", "@example.eu", "anna example@x.eu", "anna@example"])(
    "odrzuca niepoprawny adres %s",
    (email) => {
      expect(validateClubApply(withField("email", email)).email).toBeDefined();
    },
  );

  it("odrzuca adres dłuższy niż 254 znaki", () => {
    const long = `${"a".repeat(250)}@example.eu`;
    expect(validateClubApply(withField("email", long)).email).toBeDefined();
  });

  it.each(["+48 22 123 45 67", "22-123-45-67", "(22) 123 45 67", "+3221234567", "48.22.1234567"])(
    "przepuszcza numer w formacie %s",
    (phone) => {
      expect(validateClubApply(withField("phone", phone)).phone).toBeUndefined();
    },
  );

  it.each(["123", "abc123456", "+48 22 123 45 67 89 01 23 45", "22 123 45 67 <script>"])(
    "odrzuca numer %s",
    (phone) => {
      expect(validateClubApply(withField("phone", phone)).phone).toBeDefined();
    },
  );
});

describe("validateClubApply - LinkedIn (pole nieobowiązkowe z formatem)", () => {
  it.each([
    "https://www.linkedin.com/in/anna-kowalska/",
    "https://linkedin.com/in/anna",
    "http://pl.linkedin.com/in/anna",
    "HTTPS://WWW.LINKEDIN.COM/in/anna",
  ])("przepuszcza %s", (url) => {
    expect(validateClubApply(withField("linkedinUrl", url)).linkedinUrl).toBeUndefined();
  });

  it("pusty adres jest poprawny - pole jest nieobowiązkowe", () => {
    expect(validateClubApply(withField("linkedinUrl", "")).linkedinUrl).toBeUndefined();
  });

  it.each([
    "linkedin.com/in/anna",
    "https://www.linkedin.com",
    "https://linkedin.example.com/in/anna",
    "javascript:alert(1)",
    "https://www.linkedin.com.napastnik.example/in/anna",
  ])("odrzuca %s", (url) => {
    // Ostatni przypadek to nie kosmetyka: `linkedin.com.napastnik.example`
    // zawiera literał `linkedin.com`, więc dopasowanie przez `includes` puściłoby
    // adres prowadzący na cudzy serwer. Wzorzec jest zakotwiczony i musi taki zostać.
    expect(validateClubApply(withField("linkedinUrl", url)).linkedinUrl).toBeDefined();
  });
});

describe("validateClubApply - lata doświadczenia", () => {
  it.each(["", "0", "12", "70"])("przepuszcza %s", (value) => {
    expect(validateClubApply(withField("yearsExperience", value)).yearsExperience).toBeUndefined();
  });

  it.each(["-1", "71", "12.5", "dwanaście", "1e3", "NaN"])("odrzuca %s", (value) => {
    expect(validateClubApply(withField("yearsExperience", value)).yearsExperience).toBeDefined();
  });

  it("same białe znaki liczą się jako pole puste, nie jako liczba", () => {
    // `z.string().trim()` przycina PRZED `refine`, więc " " dochodzi jako "" -
    // a pole jest nieobowiązkowe. To zachowanie zamierzone (kandydat, który
    // trącił pole i wyszedł, nie ma dostawać błędu), ale nieoczywiste, więc
    // zapisane wprost: gdyby ktoś przeniósł `trim()` za `refine`, ten test padnie.
    expect(validateClubApply(withField("yearsExperience", "   ")).yearsExperience).toBeUndefined();
  });
});

describe("validateClubApply - górne granice długości", () => {
  // Granica jest sprawdzana OBUSTRONNIE: błąd `>` kontra `>=` przechodzi przez
  // test pisany tylko na wartość odrzuconą, a odcina kandydata przy wartości,
  // którą formularz obiecuje przyjąć.
  const LIMITS: ReadonlyArray<[ClubApplyField, number]> = [
    ["firstName", 60],
    ["lastName", 80],
    ["company", 120],
    ["jobPosition", 120],
    ["country", 80],
    ["city", 80],
    ["expertise", 500],
    ["languages", 200],
    ["clubId", 64],
    ["motivation", 2000],
    ["goals", 1000],
    ["contribution", 1000],
    ["referralSource", 120],
  ];

  it.each(LIMITS)(
    "pole %s przyjmuje dokładnie %i znaków i odrzuca o jeden więcej",
    (field, max) => {
      expect(
        validateClubApply(withField(field, "a".repeat(max)))[field],
        `@${max}`,
      ).toBeUndefined();
      expect(
        validateClubApply(withField(field, "a".repeat(max + 1)))[field],
        `@${max + 1}`,
      ).toBeDefined();
    },
  );

  it("adres LinkedIn przyjmuje dokładnie 200 znaków i odrzuca 201", () => {
    // Osobno od pętli, bo wartość musi jednocześnie spełniać wzorzec adresu -
    // 200 znaków samych "a" oblałoby na formacie, nie na długości, i test
    // mierzyłby wtedy nie to, co obiecuje w nazwie.
    const prefix = "https://www.linkedin.com/in/";
    const at = prefix + "a".repeat(200 - prefix.length);
    const over = prefix + "a".repeat(201 - prefix.length);
    expect(at).toHaveLength(200);
    expect(over).toHaveLength(201);
    expect(validateClubApply(withField("linkedinUrl", at)).linkedinUrl).toBeUndefined();
    expect(validateClubApply(withField("linkedinUrl", over)).linkedinUrl).toBeDefined();
  });
});

describe("validateClubApply - clubId jest podpowiedzią, nie uprawnieniem", () => {
  // Świadomie zapisany kontrakt, nie przeoczenie. `clubId` przychodzi z listy
  // klubów, którą kandydat WIDZI, ale walidacja UI nie ma z czym go porównać:
  // nie jest to uuid, nie jest obowiązkowy i nie jest sprawdzany wobec żadnego
  // katalogu. Zakresem decyduje `club_apply_submit` (SECURITY DEFINER), który
  // trzyma próg planu WYBRANEGO klubu i osobny kod błędu `club_tier_too_low`.
  //
  // Test istnieje po to, żeby nikt nie wziął tej walidacji za bramkę i nie
  // usunął sprawdzenia z RPC "bo klient już to robi".
  it("pusty clubId przechodzi - zgłoszenie do specjalizacji bez wyboru klubu", () => {
    expect(validateClubApply(withField("clubId", "")).clubId).toBeUndefined();
  });

  it("nieistniejący, ale krótki clubId przechodzi walidację UI", () => {
    expect(validateClubApply(withField("clubId", "nie-ma-takiego-klubu")).clubId).toBeUndefined();
  });

  it("clubId powyżej 64 znaków jest odrzucany - jedyna reguła, jaką ta warstwa zna", () => {
    expect(validateClubApply(withField("clubId", "a".repeat(65))).clubId).toBe(
      "club.spec.apply.errors.clubInvalid",
    );
  });
});

describe("validateClubApply - dolne granice pól opisowych", () => {
  it.each([
    ["expertise", 10],
    ["motivation", 20],
    ["goals", 10],
  ] as ReadonlyArray<[ClubApplyField, number]>)(
    "pole %s wymaga co najmniej %i znaków",
    (field, min) => {
      expect(validateClubApply(withField(field, "a".repeat(min)))[field]).toBeUndefined();
      expect(validateClubApply(withField(field, "a".repeat(min - 1)))[field]).toBeDefined();
    },
  );
});

describe("katalogi list rozwijanych - stałość wartości", () => {
  // Wartości trafiają do bazy i do raportów komisji, więc ich zmiana rozjeżdża
  // dane historyczne z nowymi. Ten test jest świadomą blokadą na przypadkową
  // zmianę nazwy, nie zakazem dodawania nowych pozycji na końcu listy.
  it("poziomy stanowiska są stabilne", () => {
    expect(CLUB_APPLY_SENIORITY).toEqual([
      "board",
      "c_level",
      "director",
      "head",
      "manager",
      "expert",
      "advisor",
      "academic",
      "other",
    ]);
  });

  it("branże są stabilne", () => {
    expect(CLUB_APPLY_INDUSTRY).toEqual([
      "public_administration",
      "defence",
      "energy",
      "finance",
      "transport",
      "technology",
      "legal",
      "media",
      "academia",
      "ngo",
      "consulting",
      "other",
    ]);
  });

  it("dostępności są stabilne", () => {
    expect(CLUB_APPLY_AVAILABILITY).toEqual(["monthly", "quarterly", "ad_hoc", "observer"]);
  });

  it("każda wartość katalogu przechodzi walidację swojego pola", () => {
    for (const value of CLUB_APPLY_SENIORITY) {
      expect(validateClubApply(withField("seniority", value)).seniority, value).toBeUndefined();
    }
    for (const value of CLUB_APPLY_INDUSTRY) {
      expect(validateClubApply(withField("industry", value)).industry, value).toBeUndefined();
    }
    for (const value of CLUB_APPLY_AVAILABILITY) {
      expect(
        validateClubApply(withField("availability", value)).availability,
        value,
      ).toBeUndefined();
    }
  });

  it("każda wartość katalogu ma podpis w PL i w EN", () => {
    // Prefiksy są takie, jakie składa `optionList()` w `routes/club.apply.tsx:230`
    // (`club.spec.apply.${prefix}.${key}`) - nie takie, jak nazywa się pole.
    // Rozjazd nazwy pola z nazwą gałęzi słownika to dokładnie defekt
    // `club.memberRole.*` z bramki `clubI18nKeys.gate`.
    const DICTS: ReadonlyArray<[string, readonly string[]]> = [
      ["club.spec.apply.seniorityOptions", CLUB_APPLY_SENIORITY],
      ["club.spec.apply.industryOptions", CLUB_APPLY_INDUSTRY],
      ["club.spec.apply.availabilityOptions", CLUB_APPLY_AVAILABILITY],
    ];
    const gaps: string[] = [];
    for (const [prefix, values] of DICTS) {
      for (const value of values) {
        for (const [lang, tree] of [
          ["pl", clubPl as Tree],
          ["en", clubEn as Tree],
        ] as const) {
          const text = readKey(tree, `${prefix}.${value}`);
          if (typeof text !== "string" || text.trim() === "") {
            gaps.push(`${lang}: ${prefix}.${value}`);
          }
        }
      }
    }
    expect(gaps).toEqual([]);
  });
});

describe("bramka i18n: każdy klucz błędu ma zdanie w PL i w EN", () => {
  it("skan definicji schematu znajduje klucze błędów", () => {
    // Bez tego kanarka zmiana sposobu składania kluczy (np. na stałą) zrobiłaby
    // z bramki niżej puste, zielone `expect([]).toEqual([])`.
    expect(declaredErrorKeys().length).toBeGreaterThan(25);
  });

  it("żaden klucz zwracany walidacją nie jest gołym kluczem na ekranie", () => {
    const gaps: string[] = [];
    for (const key of declaredErrorKeys()) {
      for (const [lang, tree] of [
        ["pl", clubPl as Tree],
        ["en", clubEn as Tree],
      ] as const) {
        const text = readKey(tree, key);
        if (typeof text !== "string" || text.trim() === "") gaps.push(`${lang}: ${key}`);
      }
    }
    expect(gaps).toEqual([]);
  });

  it("komunikaty PL i EN są RÓŻNE - kopia z drugiego języka to brak tłumaczenia", () => {
    // Wklejenie angielskiego zdania do gałęzi PL przechodzi parytet (klucz jest
    // po obu stronach) i przechodzi bramkę wyżej (tekst niepusty). Widać to
    // wyłącznie porównaniem treści.
    const identical: string[] = [];
    for (const key of declaredErrorKeys()) {
      const pl = readKey(clubPl as Tree, key);
      const en = readKey(clubEn as Tree, key);
      if (typeof pl === "string" && typeof en === "string" && pl === en) identical.push(key);
    }
    expect(identical).toEqual([]);
  });
});

describe("styl komunikatów - myślnik zamiast pauzy", () => {
  // Konwencja typograficzna platformy: dywiz "-", nigdy pauza "—". Komunikaty
  // walidacji są pisane ręcznie w dwóch językach, więc to najłatwiejsze miejsce
  // na przypadkowy wklej z edytora tekstu.
  it("żaden komunikat błędu zgłoszenia nie zawiera pauzy", () => {
    const offenders: string[] = [];
    for (const key of declaredErrorKeys()) {
      for (const [lang, tree] of [
        ["pl", clubPl as Tree],
        ["en", clubEn as Tree],
      ] as const) {
        const text = readKey(tree, key);
        if (typeof text === "string" && /[—–]/.test(text)) offenders.push(`${lang}: ${key}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("clubApplySchema - kontrakt kształtu", () => {
  it("odrzuca wejście o obcym kształcie zamiast rzucać wyjątkiem", () => {
    // `validateClubApply` jest wołane z tego, co trzyma formularz; `safeParse`
    // nigdy nie rzuca, więc widok nie może się wysypać na złym stanie.
    const parsed = clubApplySchema.safeParse({ firstName: 1, consent: "tak" });
    expect(parsed.success).toBe(false);
  });

  it('zgoda przyjmuje wyłącznie `true` - `"true"` nie jest zgodą', () => {
    const parsed = clubApplySchema.safeParse({ ...VALID, consent: "true" });
    expect(parsed.success).toBe(false);
  });

  // DLACZEGO `validateClubApply` FILTRUJE POLA, skoro schemat i mapa błędów
  // wyglądają na tę samą listę. Bo nie są tą samą listą: schemat zna
  // `marketingConsent`, a `CLUB_APPLY_FIELDS` (czyli zbiór kluczy mapy błędów,
  // po którym widok rysuje komunikaty przy polach) - nie. Błąd tego pola nie
  // ma gdzie się narysować, więc pętla w `validateClubApply` go POMIJA zamiast
  // wpisywać do mapy klucz, którego formularz nie umie pokazać. Warunek pilnuje
  // ROZJAZDU: dopisanie do schematu kolejnego pola spoza `CLUB_APPLY_FIELDS`
  // (albo odwrotnie - dopisanie `marketingConsent` do listy bez komunikatu
  // i18n) zapala się tutaj.
  it("`marketingConsent` jest jedynym polem schematu spoza `CLUB_APPLY_FIELDS`", () => {
    expect(CLUB_APPLY_FIELDS as readonly string[]).not.toContain("marketingConsent");

    const parsed = clubApplySchema.safeParse({ ...VALID, marketingConsent: "tak" });
    expect(parsed.success).toBe(false);
    const offending = parsed.success ? [] : parsed.error.issues.map((issue) => issue.path[0]);
    expect(offending).toEqual(["marketingConsent"]);

    // Kanarek: pole Z listy daje błąd, który do mapy WCHODZI - inaczej warunek
    // wyżej przechodziłby także dla walidacji, która nie zwraca nic.
    expect(validateClubApply({ ...VALID, motivation: "za krótko" })).toHaveProperty("motivation");
  });
});
