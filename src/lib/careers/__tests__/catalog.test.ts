// Warstwa danych strony `/zatrudniamy` - 245 linii, zero testów do dziś.
//
// Moduł rekrutacji wszedł do repo z T/P 0,23 (powyżej mediany platformy), ale
// `catalog.ts` jest w nim największą nieotestowaną plamą - i to ta, która
// decyduje o TREŚCI strony publicznej w dwóch językach.
//
// GDZIE JEST BŁĄD, KTÓRY TU ŁAPIEMY. `rowToOffer` ma trzypoziomowy łańcuch
// zapasowy na KAŻDYM polu: język aktywny -> polski -> angielski. To jest
// świadome (świeża oferta bywa wpisana najpierw po polsku i strona EN nie może
// pokazać pustej karty), ale trzy poziomy w sześciu polach to osiemnaście
// gałęzi, z których żadna nie jest widoczna w interfejsie, dopóki nie trafi się
// na wiersz z brakującym tłumaczeniem. Wtedy objawem jest pusty tytuł oferty
// na stronie karier - w miejscu, które istnieje po to, żeby kogoś zatrudnić.
//
// Druga rzecz: `sectionState` decyduje o WIDOCZNOŚCI sekcji. Wiersz nieobecny
// w bazie znaczy "pokaż" (świeża instalacja nie może mieć pustej strony),
// a wiersz obecny z `is_visible: false` znaczy "ukryj". Pomylenie tych dwóch
// stanów albo ukrywa całą stronę, albo pokazuje sekcję wyłączoną przez redakcję.
import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";

import {
  CAREER_SECTION_KEYS,
  countOffersByDepartment,
  fallbackOffers,
  fallbackRoleRows,
  filterOffersByDepartment,
  findOffer,
  rowToOffer,
  sectionState,
  type CareerOffer,
  type CareerRoleRow,
  type CareerSectionRow,
} from "../catalog";
import { CAREER_DEPARTMENTS, CAREER_ROLES } from "../roles";

/**
 * Atrapa `t()` oddająca sam klucz.
 *
 * Wystarczająca i celowo taka: sprawdzamy, KTÓRY klucz moduł składa, nie jak
 * brzmi zdanie. Rzutowanie na `TFunction` jest tu nieuniknione (i18next ma
 * kilkanaście przeciążeń), ale zamknięte w jednym miejscu.
 */
const tKey = ((key: string) => key) as unknown as TFunction;
const tEn = ((key: string) => `en:${key}`) as unknown as TFunction;

function roleRow(overrides: Partial<CareerRoleRow> = {}): CareerRoleRow {
  return {
    id: "row-1",
    slug: "analityk-energia",
    department: "analysis",
    engagement: "full_time",
    seniority: "mid",
    location: "hybrid",
    sort_order: 10,
    is_published: true,
    title_pl: "Analityk rynku energii",
    title_en: "Energy market analyst",
    summary_pl: "Analiza rynku energii w regionie CEE.",
    summary_en: "Energy market analysis across CEE.",
    responsibilities_pl: ["Analiza regulacji", "Raporty kwartalne"],
    responsibilities_en: ["Regulatory analysis", "Quarterly reports"],
    requirements_pl: ["Trzy lata doświadczenia"],
    requirements_en: ["Three years of experience"],
    ...overrides,
  };
}

function offer(overrides: Partial<CareerOffer> & { id: string }): CareerOffer {
  return {
    department: "analysis",
    engagement: "full_time",
    seniority: "mid",
    location: "hybrid",
    title: `Oferta ${overrides.id}`,
    summary: "Opis",
    responsibilities: [],
    requirements: [],
    ...overrides,
  };
}

describe("rowToOffer - wybór języka", () => {
  it("oddaje polską wersję dla `pl`", () => {
    const out = rowToOffer(roleRow(), "pl");
    expect(out.title).toBe("Analityk rynku energii");
    expect(out.summary).toBe("Analiza rynku energii w regionie CEE.");
    expect(out.responsibilities).toEqual(["Analiza regulacji", "Raporty kwartalne"]);
    expect(out.requirements).toEqual(["Trzy lata doświadczenia"]);
  });

  it("oddaje angielską wersję dla `en`", () => {
    const out = rowToOffer(roleRow(), "en");
    expect(out.title).toBe("Energy market analyst");
    expect(out.summary).toBe("Energy market analysis across CEE.");
    expect(out.responsibilities).toEqual(["Regulatory analysis", "Quarterly reports"]);
    expect(out.requirements).toEqual(["Three years of experience"]);
  });

  it("identyfikatorem oferty jest SLUG, nie klucz główny wiersza", () => {
    // Adres oferty i preselekcja stanowiska w formularzu chodzą po slugu.
    // Wystawienie `row.id` zrobiłoby z uuid-a element adresu, a przy okazji
    // złamałoby każdy zapisany link po zmianie wiersza.
    expect(rowToOffer(roleRow({ id: "uuid-1", slug: "analityk" }), "pl").id).toBe("analityk");
  });

  it("przepisuje fasety bez zmian - filtry stoją na nich, nie na tekstach", () => {
    const row = roleRow({
      department: "policy",
      engagement: "contract",
      seniority: "lead",
      location: "brussels",
    });
    const out = rowToOffer(row, "en");
    expect(out.department).toBe("policy");
    expect(out.engagement).toBe("contract");
    expect(out.seniority).toBe("lead");
    expect(out.location).toBe("brussels");
  });
});

describe("rowToOffer - łańcuch zapasowy przy brakującym tłumaczeniu", () => {
  // Osiemnaście gałęzi w sześciu polach. Każda gałąź jest tu wywołana jawnie,
  // bo objawem jej awarii jest PUSTY tekst na stronie publicznej, a nie wyjątek.
  it("brak tytułu EN spada na PL, nie na pustkę", () => {
    expect(rowToOffer(roleRow({ title_en: "" }), "en").title).toBe("Analityk rynku energii");
  });

  it("brak tytułu PL spada na EN", () => {
    expect(rowToOffer(roleRow({ title_pl: "" }), "pl").title).toBe("Energy market analyst");
  });

  it("brak obu tytułów daje pusty tekst, ale nie wyjątek", () => {
    expect(rowToOffer(roleRow({ title_pl: "", title_en: "" }), "pl").title).toBe("");
  });

  it("brak opisu EN spada na PL", () => {
    expect(rowToOffer(roleRow({ summary_en: "" }), "en").summary).toBe(
      "Analiza rynku energii w regionie CEE.",
    );
  });

  it("brak opisu PL spada na EN", () => {
    expect(rowToOffer(roleRow({ summary_pl: "" }), "pl").summary).toBe(
      "Energy market analysis across CEE.",
    );
  });

  it("PUSTA lista obowiązków EN spada na PL", () => {
    // Zapas na listach patrzy na DŁUGOŚĆ, nie na `null`: kolumna jest typu
    // `text[] not null`, więc brakiem tłumaczenia jest `[]`, a nie brak wartości.
    expect(rowToOffer(roleRow({ responsibilities_en: [] }), "en").responsibilities).toEqual([
      "Analiza regulacji",
      "Raporty kwartalne",
    ]);
  });

  it("PUSTA lista obowiązków PL spada na EN", () => {
    expect(rowToOffer(roleRow({ responsibilities_pl: [] }), "pl").responsibilities).toEqual([
      "Regulatory analysis",
      "Quarterly reports",
    ]);
  });

  it("obie listy obowiązków puste dają pustą listę, nie `undefined`", () => {
    const out = rowToOffer(roleRow({ responsibilities_pl: [], responsibilities_en: [] }), "en");
    expect(out.responsibilities).toEqual([]);
  });

  it("PUSTA lista wymagań EN spada na PL", () => {
    expect(rowToOffer(roleRow({ requirements_en: [] }), "en").requirements).toEqual([
      "Trzy lata doświadczenia",
    ]);
  });

  it("PUSTA lista wymagań PL spada na EN", () => {
    expect(rowToOffer(roleRow({ requirements_pl: [] }), "pl").requirements).toEqual([
      "Three years of experience",
    ]);
  });

  it("zapas działa POLOWO - brak jednego pola nie przełącza całej oferty na drugi język", () => {
    // Najważniejsza gałąź całego łańcucha. Oferta z przetłumaczonym tytułem
    // i nieprzetłumaczonym opisem musi na stronie EN pokazać ANGIELSKI tytuł
    // i polski opis - a nie zjechać całą kartą na polski, bo jedno pole nie
    // było gotowe.
    const out = rowToOffer(roleRow({ summary_en: "" }), "en");
    expect(out.title).toBe("Energy market analyst");
    expect(out.summary).toBe("Analiza rynku energii w regionie CEE.");
  });

  it("wiersz kompletny nigdy nie sięga po zapas", () => {
    const pl = rowToOffer(roleRow(), "pl");
    const en = rowToOffer(roleRow(), "en");
    expect(pl.title).not.toBe(en.title);
    expect(pl.summary).not.toBe(en.summary);
    expect(pl.responsibilities).not.toEqual(en.responsibilities);
    expect(pl.requirements).not.toEqual(en.requirements);
  });
});

describe("filterOffersByDepartment", () => {
  const OFFERS: readonly CareerOffer[] = [
    offer({ id: "a", department: "analysis" }),
    offer({ id: "b", department: "policy" }),
    offer({ id: "c", department: "analysis" }),
  ];

  it("zawęża do jednego działu", () => {
    expect(filterOffersByDepartment(OFFERS, "analysis").map((o) => o.id)).toEqual(["a", "c"]);
  });

  it.each(["all", null, undefined] as const)("wartość %s oddaje pełną listę", (department) => {
    expect(filterOffersByDepartment(OFFERS, department).map((o) => o.id)).toEqual(["a", "b", "c"]);
  });

  it("zwraca KOPIĘ, nie wejście - lista na ekranie nie może zmienić się pod filtrem", () => {
    const out = filterOffersByDepartment(OFFERS, "all");
    expect(out).not.toBe(OFFERS);
    expect(out).toEqual([...OFFERS]);
  });

  it("dział bez ofert daje pustą listę", () => {
    expect(filterOffersByDepartment(OFFERS, "operations")).toEqual([]);
  });

  it("zachowuje kolejność wejścia - kolejność to kolejność prezentacji", () => {
    const many = [
      offer({ id: "trzeci", department: "analysis" }),
      offer({ id: "pierwszy", department: "analysis" }),
      offer({ id: "drugi", department: "analysis" }),
    ];
    expect(filterOffersByDepartment(many, "analysis").map((o) => o.id)).toEqual([
      "trzeci",
      "pierwszy",
      "drugi",
    ]);
  });
});

describe("countOffersByDepartment", () => {
  it("liczy oferty w każdym dziale", () => {
    const counts = countOffersByDepartment([
      offer({ id: "a", department: "analysis" }),
      offer({ id: "b", department: "analysis" }),
      offer({ id: "c", department: "policy" }),
    ]);
    expect(counts.analysis).toBe(2);
    expect(counts.policy).toBe(1);
  });

  it("dział bez ofert ma ZERO, nie `undefined`", () => {
    // Chipy filtra renderują licznik obok nazwy działu. `undefined` wypisałoby
    // się jako puste miejsce, a nie jako "0".
    const counts = countOffersByDepartment([]);
    for (const department of CAREER_DEPARTMENTS) {
      expect(counts[department], department).toBe(0);
    }
  });

  it("klucze wyniku pokrywają DOKŁADNIE zamknięty zbiór działów", () => {
    // Dział dopisany do `CAREER_DEPARTMENTS`, a pominięty w wartości początkowej
    // licznika, dawałby `NaN` po pierwszej ofercie z tego działu (`undefined + 1`).
    expect(Object.keys(countOffersByDepartment([])).sort()).toEqual([...CAREER_DEPARTMENTS].sort());
  });

  it("suma liczników równa się liczbie ofert", () => {
    const offers = CAREER_DEPARTMENTS.map((department, index) =>
      offer({ id: `o-${index}`, department }),
    );
    const total = Object.values(countOffersByDepartment(offers)).reduce((a, b) => a + b, 0);
    expect(total).toBe(offers.length);
  });
});

describe("findOffer", () => {
  const OFFERS = [offer({ id: "analityk" }), offer({ id: "redaktor" })];

  it("znajduje ofertę po slugu", () => {
    expect(findOffer(OFFERS, "redaktor")?.id).toBe("redaktor");
  });

  it.each([null, undefined, ""] as const)("brak identyfikatora (%j) daje `null`", (id) => {
    expect(findOffer(OFFERS, id)).toBeNull();
  });

  it("nieznany slug daje `null`, nie pierwszą ofertę z listy", () => {
    // Zapas na `[0]` podstawiłby w formularzu inne stanowisko niż to z adresu -
    // kandydat wysyła zgłoszenie na rolę, której nie czytał.
    expect(findOffer(OFFERS, "nie-ma-takiej")).toBeNull();
  });

  it("dopasowanie jest DOKŁADNE, nie po prefiksie", () => {
    expect(findOffer(OFFERS, "analit")).toBeNull();
    expect(findOffer(OFFERS, "analityk-energia")).toBeNull();
  });
});

describe("sectionState - widoczność sekcji strony", () => {
  function sectionRow(overrides: Partial<CareerSectionRow> = {}): CareerSectionRow {
    return {
      key: "hero",
      is_visible: true,
      sort_order: 0,
      title_pl: "Pracuj z nami",
      title_en: "Work with us",
      subtitle_pl: "Zespół analityczny NES",
      subtitle_en: "The NES analytical team",
      ...overrides,
    };
  }

  it("BRAK wiersza znaczy `pokaż` - świeża instalacja nie może mieć pustej strony", () => {
    // Najważniejsza gałąź. Odwrócenie jej ukrywa CAŁĄ stronę karier na każdej
    // instalacji, w której tabela sekcji jest jeszcze pusta.
    for (const rows of [undefined, []] as const) {
      const state = sectionState(rows, "hero", "pl");
      expect(state.visible, JSON.stringify(rows)).toBe(true);
      expect(state.title).toBeNull();
      expect(state.subtitle).toBeNull();
    }
  });

  it("wiersz z `is_visible: false` znaczy `ukryj`", () => {
    expect(sectionState([sectionRow({ is_visible: false })], "hero", "pl").visible).toBe(false);
  });

  it("oddaje tekst w języku operatora", () => {
    expect(sectionState([sectionRow()], "hero", "pl").title).toBe("Pracuj z nami");
    expect(sectionState([sectionRow()], "hero", "en").title).toBe("Work with us");
    expect(sectionState([sectionRow()], "hero", "pl").subtitle).toBe("Zespół analityczny NES");
    expect(sectionState([sectionRow()], "hero", "en").subtitle).toBe("The NES analytical team");
  });

  it("pusty tekst normalizuje się do `null`, nie do pustego napisu", () => {
    // Widok rozstrzyga `title === null ? domyślny : title`. Pusty napis
    // przeszedłby przez ten warunek i wyrenderował nagłówek zerowej wysokości.
    const state = sectionState([sectionRow({ title_pl: "", subtitle_pl: "" })], "hero", "pl");
    expect(state.title).toBeNull();
    expect(state.subtitle).toBeNull();
  });

  it("brak tłumaczenia daje `null` - tu NIE ma zapasu na drugi język", () => {
    // Świadoma różnica wobec `rowToOffer`: nagłówek sekcji ma zapas w słowniku
    // i18n (widok podstawia domyślny), więc mieszanie języków byłoby gorsze niż
    // wartość domyślna. Zapisane wprost, żeby nikt nie "ujednolicił" tego
    // z łańcuchem ofert.
    expect(sectionState([sectionRow({ title_en: null })], "hero", "en").title).toBeNull();
  });

  it("wybiera wiersz po kluczu, nie po pozycji", () => {
    const rows = [
      sectionRow({ key: "hero", title_pl: "Nagłówek" }),
      sectionRow({ key: "roles", title_pl: "Oferty" }),
    ];
    expect(sectionState(rows, "roles", "pl").title).toBe("Oferty");
  });

  it("każdy klucz z zamkniętego zbioru ma rozstrzygnięcie", () => {
    for (const key of CAREER_SECTION_KEYS) {
      const state = sectionState([], key, "pl");
      expect(state.visible, key).toBe(true);
    }
  });

  it("zbiór kluczy sekcji jest stabilny", () => {
    // Kolejność jest kolejnością renderowania strony; wartości trafiają do bazy
    // jako `key`, więc zmiana nazwy rozjeżdża zapisane ustawienia redakcji.
    expect(CAREER_SECTION_KEYS).toEqual([
      "hero",
      "values",
      "benefits",
      "roles",
      "process",
      "form",
      "closing",
    ]);
  });
});

describe("katalog wbudowany (zapas, gdy tabela ofert jest pusta)", () => {
  it("oddaje ofertę na każdą rolę z katalogu", () => {
    const offers = fallbackOffers(tKey);
    expect(offers).toHaveLength(CAREER_ROLES.length);
    expect(offers.map((o) => o.id)).toEqual(CAREER_ROLES.map((r) => r.id));
  });

  it("składa klucze i18n, a nie zaszyte teksty", () => {
    // Atrapa `t()` oddaje sam klucz, więc widać dokładnie, po co moduł sięga.
    // Gdyby ktoś wpisał tu polskie zdanie wprost, strona EN pokazałaby polski
    // tekst - i żadna bramka parytetu tego nie zobaczy, bo klucza nie ma.
    const first = fallbackOffers(tKey)[0];
    expect(first.title).toMatch(/^careers\./);
    expect(first.summary).toMatch(/^careers\./);
    for (const bullet of first.responsibilities) expect(bullet).toMatch(/^careers\./);
    for (const requirement of first.requirements) expect(requirement).toMatch(/^careers\./);
  });

  it("liczba punktów zakresu i wymagań zgadza się z deklaracją roli", () => {
    // `bullets: 3 | 4` w katalogu ról jest UMOWĄ o liczbie kluczy w słowniku.
    // Rozjazd daje na karcie punkt renderowany jako goły klucz.
    const offers = fallbackOffers(tKey);
    for (const [index, role] of CAREER_ROLES.entries()) {
      expect(offers[index].responsibilities, role.id).toHaveLength(role.bullets);
      expect(offers[index].requirements, role.id).toHaveLength(role.requirements);
    }
  });

  it("fasety zapasu są te same, co w katalogu ról", () => {
    const offers = fallbackOffers(tKey);
    for (const [index, role] of CAREER_ROLES.entries()) {
      expect(offers[index].department, role.id).toBe(role.department);
      expect(offers[index].engagement, role.id).toBe(role.engagement);
      expect(offers[index].seniority, role.id).toBe(role.seniority);
      expect(offers[index].location, role.id).toBe(role.location);
    }
  });

  it("import do panelu wypełnia OBA języki z dwóch niezależnych słowników", () => {
    // Jednorazowy import zapasu do bazy. Podanie tej samej funkcji `t` dwa razy
    // wpisałoby polski tekst do kolumn `*_en` i nikt by tego nie zobaczył,
    // dopóki ktoś nie otworzy strony EN.
    const rows = fallbackRoleRows(tKey, tEn);
    expect(rows).toHaveLength(CAREER_ROLES.length);
    for (const row of rows) {
      expect(row.title_pl).not.toBe(row.title_en);
      expect(row.title_en.startsWith("en:"), row.slug).toBe(true);
      expect(row.summary_en.startsWith("en:"), row.slug).toBe(true);
      for (const bullet of row.responsibilities_en) expect(bullet.startsWith("en:")).toBe(true);
      for (const requirement of row.requirements_en)
        expect(requirement.startsWith("en:")).toBe(true);
    }
  });

  it("import ustawia rosnące, rozłączne `sort_order`", () => {
    // Kolejność prezentacji zapasu musi przenieść się do bazy. Wspólny
    // `sort_order` oddałby kolejność decyzji bazy, czyli losową między wdrożeniami.
    const orders = fallbackRoleRows(tKey, tEn).map((r) => r.sort_order);
    expect(new Set(orders).size).toBe(orders.length);
    expect([...orders]).toEqual([...orders].sort((a, b) => a - b));
  });

  it("import publikuje oferty - zapas ma być widoczny od razu", () => {
    for (const row of fallbackRoleRows(tKey, tEn)) {
      expect(row.is_published, row.slug).toBe(true);
    }
  });

  it("slug wiersza importu to identyfikator roli", () => {
    expect(fallbackRoleRows(tKey, tEn).map((r) => r.slug)).toEqual(CAREER_ROLES.map((r) => r.id));
  });
});
