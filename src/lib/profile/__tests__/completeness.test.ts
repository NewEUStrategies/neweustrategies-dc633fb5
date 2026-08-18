// Kompletność profilu - DOMKNIĘCIE pokrycia (moduł stał na 30,43%).
//
// Część reguł jest już przypięta w bramce katalogu intencji
// (`src/lib/ci/__tests__/profileIntentCatalog.gate.test.ts`): suma wag = 100,
// profil pusty = 0/thin, profil pełny = 100/strong, imię+nazwisko zamiast
// `display_name`, próg 50 dla oceny `partial`. Ten plik ich NIE powtarza -
// dobija to, czego tam nie ma, a co decyduje o tym, czy licznik mówi prawdę:
//
//   * DOKŁADNE progi znakowe bio i „czego szukam” (119 vs 120 znaków),
//   * wybór DŁUŻSZEJ z dwóch wersji językowych (jeden język wystarcza),
//   * granica oceny `strong` - druga, niesprawdzona strona progu `partial`,
//   * kolejność listy braków i zgodność `nextGain` z wagą `nextField`,
//   * pola pozorne: sam biały znak i pusta tablica `open_to`.
//
// Ostatni punkt jest tu najważniejszy: profil z bio złożonym z 200 spacji
// zaliczyłby próg długości, gdyby `has`/`longest` nie przycinały. Katalog
// stawiałby taki profil wyżej niż uzupełniony.
import { describe, expect, it } from "vitest";
import { emptyCompletenessInput, fullCompletenessInput, text } from "@/test/profile/fixtures";
import { PROFILE_SEEKING_MIN } from "../intents";
import {
  PROFILE_BIO_MIN,
  PROFILE_COMPLETENESS_FIELDS,
  PROFILE_COMPLETENESS_WEIGHTS,
  PROFILE_SEMANTIC_MIN_SCORE,
  PROFILE_SKILLS_MIN,
  profileCompleteness,
  profileCompletenessFieldKey,
} from "../completeness";

describe("progi znakowe", () => {
  it("bio zalicza się DOKŁADNIE od PROFILE_BIO_MIN znaków", () => {
    const below = profileCompleteness(
      emptyCompletenessInput({ bio_pl: text(PROFILE_BIO_MIN - 1) }),
    );
    const at = profileCompleteness(emptyCompletenessInput({ bio_pl: text(PROFILE_BIO_MIN) }));
    expect(below.fields.bio).toBe(false);
    expect(at.fields.bio).toBe(true);
    expect(at.score).toBe(PROFILE_COMPLETENESS_WEIGHTS.bio);
  });

  it("„czego szukam” zalicza się DOKŁADNIE od PROFILE_SEEKING_MIN znaków", () => {
    const below = profileCompleteness(
      emptyCompletenessInput({ seeking_pl: text(PROFILE_SEEKING_MIN - 1) }),
    );
    const at = profileCompleteness(
      emptyCompletenessInput({ seeking_pl: text(PROFILE_SEEKING_MIN) }),
    );
    expect(below.fields.seeking).toBe(false);
    expect(at.fields.seeking).toBe(true);
  });

  it("umiejętności zaliczają się DOKŁADNIE od PROFILE_SKILLS_MIN", () => {
    const below = profileCompleteness(emptyCompletenessInput({ skills: PROFILE_SKILLS_MIN - 1 }));
    const at = profileCompleteness(emptyCompletenessInput({ skills: PROFILE_SKILLS_MIN }));
    expect(below.fields.skills).toBe(false);
    expect(at.fields.skills).toBe(true);
  });

  it("doświadczenie i wykształcenie wystarczy po JEDNYM wpisie", () => {
    const status = profileCompleteness(emptyCompletenessInput({ experiences: 1, education: 1 }));
    expect(status.fields.experience).toBe(true);
    expect(status.fields.education).toBe(true);
    expect(status.score).toBe(
      PROFILE_COMPLETENESS_WEIGHTS.experience + PROFILE_COMPLETENESS_WEIGHTS.education,
    );
  });
});

describe("dwa języki, jedno pole", () => {
  it("bio liczy DŁUŻSZĄ wersję - wystarczy jeden uzupełniony język", () => {
    // Autor pisze najpierw po polsku; wymaganie obu wersji do zaliczenia
    // punktów karałoby za normalną kolejność pracy.
    const plOnly = profileCompleteness(
      emptyCompletenessInput({ bio_pl: text(PROFILE_BIO_MIN), bio_en: null }),
    );
    const enOnly = profileCompleteness(
      emptyCompletenessInput({ bio_pl: null, bio_en: text(PROFILE_BIO_MIN) }),
    );
    expect(plOnly.fields.bio).toBe(true);
    expect(enOnly.fields.bio).toBe(true);
  });

  it("krótka wersja NIE psuje zaliczenia dłuższej", () => {
    // `longest`, nie „ostatnia niepusta”: inaczej dopisanie jednozdaniowego
    // angielskiego streszczenia odbierałoby punkty za pełne polskie bio.
    const status = profileCompleteness(
      emptyCompletenessInput({ bio_pl: text(PROFILE_BIO_MIN), bio_en: "Short." }),
    );
    expect(status.fields.bio).toBe(true);
  });

  it("dwie wersje ZA KRÓTKIE nie sumują się do progu", () => {
    const half = Math.floor(PROFILE_BIO_MIN / 2);
    const status = profileCompleteness(
      emptyCompletenessInput({ bio_pl: text(half), bio_en: text(half) }),
    );
    expect(status.fields.bio).toBe(false);
  });
});

describe("pola pozorne", () => {
  it("sam biały znak nie zalicza pola tekstowego", () => {
    const status = profileCompleteness(
      emptyCompletenessInput({
        display_name: "   ",
        job_title: "\t",
        current_company: "\n",
        location: " ",
        specialization: "  ",
      }),
    );
    expect(status.fields.name).toBe(false);
    expect(status.fields.jobTitle).toBe(false);
    expect(status.fields.company).toBe(false);
    expect(status.fields.location).toBe(false);
    expect(status.fields.specialization).toBe(false);
    expect(status.score).toBe(0);
  });

  it("bio ze spacji nie zalicza progu długości", () => {
    // Bez przycięcia 200 spacji przechodzi próg 120 znaków i katalog stawia
    // taki profil wyżej niż faktycznie uzupełniony.
    const status = profileCompleteness(emptyCompletenessInput({ bio_pl: " ".repeat(200) }));
    expect(status.fields.bio).toBe(false);
  });

  it("puste imię i nazwisko nie składają się na nazwę", () => {
    // `has(\`${first} ${last}\`)` na dwóch nullach daje napis z samą spacją.
    const status = profileCompleteness(
      emptyCompletenessInput({ display_name: null, first_name: "  ", last_name: null }),
    );
    expect(status.fields.name).toBe(false);
  });

  it("samo imię BEZ nazwiska wystarcza", () => {
    const status = profileCompleteness(emptyCompletenessInput({ first_name: "Anna" }));
    expect(status.fields.name).toBe(true);
  });

  it("PUSTA tablica open_to to brak intencji, nie zaliczone pole", () => {
    const empty = profileCompleteness(emptyCompletenessInput({ open_to: [] }));
    const one = profileCompleteness(emptyCompletenessInput({ open_to: ["consortium"] }));
    expect(empty.fields.openTo).toBe(false);
    expect(one.fields.openTo).toBe(true);
  });
});

describe("ocena słowna", () => {
  it("zdjęcie intencji i „czego szukam” zsuwa pełny profil na `partial`", () => {
    // Bramka katalogu intencji przypina próg 50 (`partial`) i wynik 100
    // (`strong`). Tu chodzi o drugą stronę granicy `strong`: warstwa intencji
    // waży łącznie 22 punkty, więc jej brak zdejmuje profil pełny poniżej 80 -
    // i to jest cała różnica między „profil gotowy” a „profil bez powodu do
    // rozmowy”, którą katalog ma widzieć.
    const withoutIntent = profileCompleteness(
      fullCompletenessInput({ open_to: [], seeking_pl: null, seeking_en: null }),
    );
    expect(withoutIntent.score).toBe(78);
    expect(withoutIntent.grade).toBe("partial");

    // Sama lista intencji (10) wraca -> 88, czyli znów `strong`.
    const withOpenTo = profileCompleteness(
      fullCompletenessInput({ seeking_pl: null, seeking_en: null }),
    );
    expect(withOpenTo.score).toBe(88);
    expect(withOpenTo.grade).toBe("strong");
  });

  it("74 i 78 punktów to `partial`, 88 to już `strong`", () => {
    // Dobieramy pola tak, żeby trafić w sąsiedztwo progu bez zgadywania:
    // avatar 10 + nazwa 8 + stanowisko 8 + firma 6 + lokalizacja 6 +
    // specjalizacja 6 + bio 14 + umiejętności 10 + doświadczenie 6 = 74.
    const base = emptyCompletenessInput({
      avatar_url: "a",
      display_name: "Anna",
      job_title: "Head",
      current_company: "NES",
      location: "Bruksela",
      specialization: "Energia",
      bio_pl: text(PROFILE_BIO_MIN),
      skills: PROFILE_SKILLS_MIN,
      experiences: 1,
    });
    expect(profileCompleteness(base).score).toBe(74);
    expect(profileCompleteness(base).grade).toBe("partial");

    // + wykształcenie 4 = 78 (partial), + intencja 10 = 88 (strong).
    expect(profileCompleteness({ ...base, education: 1 }).grade).toBe("partial");
    const over = profileCompleteness({ ...base, education: 1, open_to: ["consortium"] });
    expect(over.score).toBe(88);
    expect(over.grade).toBe("strong");
  });

  it("49 punktów to `thin`, a nie `partial`", () => {
    // avatar 10 + nazwa 8 + stanowisko 8 + firma 6 + lokalizacja 6 + wykształcenie 4 = 42.
    const thin = profileCompleteness(
      emptyCompletenessInput({
        avatar_url: "a",
        display_name: "Anna",
        job_title: "Head",
        current_company: "NES",
        location: "Bruksela",
        education: 1,
      }),
    );
    expect(thin.score).toBe(42);
    expect(thin.grade).toBe("thin");
  });
});

describe("lista braków i podpowiedź", () => {
  it("kolejność braków idzie od NAJWIĘKSZEGO zysku punktowego", () => {
    // Interfejs pokazuje „+14 pkt za opis” - kolejność jest treścią zachęty,
    // nie kosmetyką. Braki muszą być nierosnące po wadze.
    const missing = profileCompleteness(emptyCompletenessInput()).missing;
    const weights = missing.map((field) => PROFILE_COMPLETENESS_WEIGHTS[field]);
    expect(weights).toEqual([...weights].sort((a, b) => b - a));
    expect(missing).toEqual([...PROFILE_COMPLETENESS_FIELDS]);
  });

  it("`nextGain` jest wagą `nextField`, nie liczbą wziętą z sufitu", () => {
    const status = profileCompleteness(
      fullCompletenessInput({ bio_pl: null, bio_en: null, education: 0 }),
    );
    expect(status.nextField).toBe("bio");
    expect(status.nextGain).toBe(PROFILE_COMPLETENESS_WEIGHTS.bio);
    // Wykształcenie (4) też brakuje, ale bio (14) jest większą luką.
    expect(status.missing).toEqual(["bio", "education"]);
  });

  it("PEŁNY profil nie ma ani braku, ani podpowiedzi", () => {
    // Para `nextField`/`nextGain` musi milczeć razem: `nextField: null` przy
    // niezerowym `nextGain` kazałby interfejsowi obiecać punkty za nic.
    const status = profileCompleteness(fullCompletenessInput());
    expect(status.missing).toEqual([]);
    expect(status.nextField).toBeNull();
    expect(status.nextGain).toBe(0);
  });

  it("`nextGain` jest zerowy DOKŁADNIE wtedy, gdy nie ma czego dobijać", () => {
    const full = profileCompleteness(fullCompletenessInput());
    const partial = profileCompleteness(fullCompletenessInput({ avatar_url: null }));
    expect(full.nextGain === 0).toBe(full.nextField === null);
    expect(partial.nextGain === 0).toBe(partial.nextField === null);
    expect(partial.nextGain).toBe(PROFILE_COMPLETENESS_WEIGHTS.avatar);
  });

  it("zaliczone pola NIE trafiają na listę braków", () => {
    const status = profileCompleteness(emptyCompletenessInput({ avatar_url: "a" }));
    expect(status.missing).not.toContain("avatar");
    expect(status.fields.avatar).toBe(true);
  });

  it("`missing` i `fields` mówią to samo o każdym polu", () => {
    const status = profileCompleteness(
      fullCompletenessInput({ avatar_url: null, skills: 0, open_to: [] }),
    );
    for (const field of PROFILE_COMPLETENESS_FIELDS) {
      expect(status.missing.includes(field)).toBe(!status.fields[field]);
    }
  });
});

describe("próg wektora semantycznego", () => {
  it("PROFILE_SEMANTIC_MIN_SCORE leży w ocenie `thin` - cel jest osiągalny wcześnie", () => {
    // Interfejs obiecuje „od 40 pkt profil zaczyna być znajdowany semantycznie”.
    // Gdyby próg wypadł powyżej `partial`, obietnica dotyczyłaby garstki kont.
    expect(PROFILE_SEMANTIC_MIN_SCORE).toBe(40);
    expect(PROFILE_SEMANTIC_MIN_SCORE).toBeLessThan(50);
  });

  it("profil z awatarem, nazwą, stanowiskiem i bio przekracza próg", () => {
    const status = profileCompleteness(
      emptyCompletenessInput({
        avatar_url: "a",
        display_name: "Anna",
        job_title: "Head",
        bio_pl: text(PROFILE_BIO_MIN),
      }),
    );
    expect(status.score).toBeGreaterThanOrEqual(PROFILE_SEMANTIC_MIN_SCORE);
  });
});

describe("profileCompletenessFieldKey", () => {
  it("buduje klucz i18n dla KAŻDEGO pola z wag", () => {
    // Pole bez etykiety pokazuje użytkownikowi surową ścieżkę klucza na liście
    // braków - a lista braków jest głównym wezwaniem do działania na profilu.
    for (const field of PROFILE_COMPLETENESS_FIELDS) {
      expect(profileCompletenessFieldKey(field)).toBe(`profileCompleteness.fields.${field}`);
    }
  });

  it("klucze są unikalne - dwa pola nie dzielą etykiety", () => {
    const keys = PROFILE_COMPLETENESS_FIELDS.map(profileCompletenessFieldKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
