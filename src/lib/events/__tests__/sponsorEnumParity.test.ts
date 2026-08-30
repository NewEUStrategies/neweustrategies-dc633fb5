// BRAMKA: slowniki i limity modulu SPONSORZY zgadzaja sie z ograniczeniami
// `CHECK` w migracjach.
//
// PO CO OSOBNY PLIK OBOK `dbEnumParity.test.ts`. Tamta bramka pilnuje modulow
// pakietow, identyfikatorow i odprawy; ta - sponsorow. Rozdzielenie jest
// swiadome: pliki modulu sponsorow powstaly pozniej i maja WLASNE pulapki,
// ktorych tamta bramka nie umie wyrazic. Poza czterema slownikami (`role`,
// `kind`, `logo_size`, role kontaktu) baza narzuca temu modulowi rowniez
// DLUGOSCI i ZAKRESY - a te siedza po stronie klienta w stalych
// `SPONSOR_MAX_*` oraz w regulach `validate*Draft`. Stala dlugosci, ktora
// obiecuje wiecej niz baza przyjmie, nie jest zabezpieczeniem: jest zaproszeniem
// do odmowy `23514` po dwudziestu minutach pisania opisu.
//
// TYP GENEROWANY NIE POMOZE. Kolumny sa typu `text`/`integer` z `CHECK`-iem,
// wiec kompilator widzi `string` i `number` - o rozjezdzie dowiaduje sie
// wylacznie baza, przy zapisie, u organizatora.
//
// CZEGO TU NIE MA. Konwersji szkicu (`sponsorDraft.test.ts`) i tresci odmow
// (`adminSponsorErrors.test.ts`) - tu chodzi wylacznie o to, czy klient obiecuje
// dokladnie to, co baza przyjmie.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  SPONSOR_CONTACT_ROLES,
  SPONSOR_MATERIAL_KINDS,
  SPONSOR_ROLES,
  SPONSOR_TIER_LOGO_SIZES,
} from "@/lib/events/sponsorsApi";
import {
  SPONSOR_HEX_COLOR_PATTERN,
  SPONSOR_KEY_PATTERN,
  SPONSOR_MAX_DESCRIPTION,
  SPONSOR_MAX_NAME,
  SPONSOR_MAX_NOTE,
  emptyMaterialDraft,
  emptySponsorDraft,
  emptyTierDraft,
  isSponsorUrl,
  validateMaterialDraft,
  validateSponsorDraft,
  validateTierDraft,
} from "@/lib/events/sponsorDraft";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/**
 * Tresc KAZDEGO nazwanego `CONSTRAINT ... CHECK (...)` z calego lancucha
 * migracji, po nazwie ograniczenia.
 *
 * Nawiasy liczymy recznie, bo wyrazenia sponsorow zagniezdzaja wywolania
 * (`char_length(btrim(name_pl)) BETWEEN 2 AND 80`) - regex „do pierwszego
 * nawiasu zamykajacego" uciolby je w polowie i bramka mierzylaby wlasny blad
 * parsowania zamiast bazy.
 *
 * OSTATNIA DEFINICJA WYGRYWA, dokladnie jak przy `supabase db push`: tabele
 * modulu powstaja dwa razy (plik opisowy i migracja panelu z UUID-em w nazwie).
 */
function checkBodies(): Map<string, string> {
  const out = new Map<string, string>();
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const head = /CONSTRAINT\s+([a-z0-9_]+)\s+CHECK\s*\(/gi;
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    for (const match of sql.matchAll(head)) {
      const start = match.index + match[0].length;
      let depth = 1;
      let cursor = start;
      while (cursor < sql.length && depth > 0) {
        if (sql[cursor] === "(") depth += 1;
        if (sql[cursor] === ")") depth -= 1;
        cursor += 1;
      }
      out.set(match[1], sql.slice(start, cursor - 1).trim());
    }
  }
  return out;
}

const CHECKS = checkBodies();

function body(constraint: string): string {
  const found = CHECKS.get(constraint);
  if (found === undefined) {
    throw new Error(
      `Nie znaleziono ograniczenia ${constraint} w supabase/migrations. ` +
        "Jesli zostalo przemianowane, popraw mapowanie w tej bramce.",
    );
  }
  return found;
}

/** Wartosci z `IN ('a', 'b', ...)`. */
function inValues(constraint: string): string[] {
  const match = /IN\s*\(([^)]*)\)/i.exec(body(constraint));
  if (match === null) throw new Error(`${constraint} nie jest lista wartosci`);
  return match[1]
    .split(",")
    .map((value) => value.trim().replace(/^'|'$/g, ""))
    .filter((value) => value.length > 0)
    .sort();
}

/** Granice z `BETWEEN x AND y`. */
function betweenRange(constraint: string): { min: number; max: number } {
  const match = /BETWEEN\s+(\d+)\s+AND\s+(\d+)/i.exec(body(constraint));
  if (match === null) throw new Error(`${constraint} nie jest zakresem BETWEEN`);
  return { min: Number(match[1]), max: Number(match[2]) };
}

/** Gorna granica z `char_length(...) <= n`. */
function upperBound(constraint: string): number {
  const match = /<=\s*(\d+)/.exec(body(constraint));
  if (match === null) throw new Error(`${constraint} nie ma gornej granicy`);
  return Number(match[1]);
}

/** Wzor z `kolumna ~ 'regex'`. */
function pattern(constraint: string): string {
  const match = /~\s*'([^']*)'/.exec(body(constraint));
  if (match === null) throw new Error(`${constraint} nie zawiera wzoru`);
  return match[1];
}

const EVENT = "11111111-1111-4111-8111-111111111111";
const SPONSOR = "22222222-2222-4222-8222-222222222222";
const COMPANY = "33333333-3333-4333-8333-333333333333";

describe("bramka nie jest prozna", () => {
  it("znajduje ograniczenia sponsorow w lancuchu migracji", () => {
    for (const constraint of [
      "event_sponsors_role_values",
      "event_sponsor_contacts_role_values",
      "event_sponsor_materials_kind_values",
      "event_sponsor_tiers_logo_size_values",
      "event_sponsor_tiers_key_format",
      "event_sponsor_tiers_name_pl_len",
      "event_sponsor_materials_title_pl_len",
      "event_sponsors_snapshot_website_shape",
    ]) {
      expect(CHECKS.has(constraint), `brak ${constraint}`).toBe(true);
    }
  });

  it("czyta CALE wyrazenie, razem z zagniezdzonymi nawiasami", () => {
    // Regex ucinajacy na pierwszym „)” zgubilby tu `AND 80` i bramka
    // porownywalaby limit z niczym.
    expect(body("event_sponsor_tiers_name_pl_len")).toContain("BETWEEN 2 AND 80");
  });
});

/* --------------------------------------------------------------- slowniki --- */

const SLOWNIKI: ReadonlyArray<readonly [string, string, readonly string[]]> = [
  ["SPONSOR_ROLES", "event_sponsors_role_values", SPONSOR_ROLES],
  ["SPONSOR_CONTACT_ROLES", "event_sponsor_contacts_role_values", SPONSOR_CONTACT_ROLES],
  ["SPONSOR_MATERIAL_KINDS", "event_sponsor_materials_kind_values", SPONSOR_MATERIAL_KINDS],
  ["SPONSOR_TIER_LOGO_SIZES", "event_sponsor_tiers_logo_size_values", SPONSOR_TIER_LOGO_SIZES],
];

describe("slowniki panelu === CHECK bazy", () => {
  it.each(SLOWNIKI)("%s === %s", (_name, constraint, values) => {
    expect([...values].sort()).toEqual(inValues(constraint));
  });

  it("rodzaj materialu decyduje o tym, co uczestnik dostanie do reki - zaden wariant nie moze byc wymyslony", () => {
    // `logo_pack` to paczka do pobrania, `link` to wyjscie na zewnatrz.
    // Wariant spoza CHECK-u konczy sie odmowa dopiero przy zapisie materialu.
    const allowed = inValues("event_sponsor_materials_kind_values");
    for (const kind of SPONSOR_MATERIAL_KINDS) expect(allowed).toContain(kind);
    expect(allowed).toHaveLength(SPONSOR_MATERIAL_KINDS.length);
  });
});

describe("wzory klienta === wzory bazy", () => {
  it("klucz poziomu ma ten sam wzor po obu stronach", () => {
    expect(SPONSOR_KEY_PATTERN.source).toBe(pattern("event_sponsor_tiers_key_format"));
  });

  it("kolor akcentu ma ten sam wzor po obu stronach", () => {
    expect(SPONSOR_HEX_COLOR_PATTERN.source).toBe(pattern("event_sponsor_tiers_accent_hex"));
  });

  it("adres logotypu: klient jest WEZSZY swiadomie - baza bierze `http://`, panel tylko `https://`", () => {
    // Zawezenie jest decyzja: logotyp po `http` na stronie po `https` znika
    // za ostrzezeniem przegladarki o tresci mieszanej.
    expect(pattern("event_sponsors_snapshot_logo_shape")).toBe("^(https?://|/)");
    expect(isSponsorUrl("https://przyklad.example.com/logo.png")).toBe(true);
    expect(isSponsorUrl("/media/logo.png")).toBe(true);
    expect(isSponsorUrl("http://przyklad.example.com/logo.png")).toBe(false);
  });
});

/* -------------------------------------------------- limity dlugosci i zakresy --- */

describe("limity, ktore panel obiecuje redaktorowi", () => {
  it("notatka wewnetrzna ma po obu stronach ten sam limit", () => {
    expect(SPONSOR_MAX_NOTE).toBe(upperBound("event_sponsors_internal_note_len"));
  });

  it("nazwa firmy na stronie ma po obu stronach ten sam limit", () => {
    expect(SPONSOR_MAX_NAME).toBe(betweenRange("event_sponsors_snapshot_name_len").max);
  });

  it("opis firmy ma po obu stronach ten sam limit", () => {
    expect(SPONSOR_MAX_DESCRIPTION).toBe(upperBound("event_sponsors_snapshot_desc_pl_len"));
  });

  // ---------------------------------------------------------------------------
  // DEFEKT: `SPONSOR_MAX_NAME` obsluguje CZTERY kolumny o TRZECH roznych
  // limitach - nazwe firmy (200), nazwe poziomu (80) i tytul materialu (160).
  // Formularz poziomu wpisuje ten limit do `maxLength`, wiec redaktor moze
  // wpisac 200 znakow, przejsc walidacje klienta i dostac odmowe z bazy.
  // ---------------------------------------------------------------------------
  it.fails(
    "DEFEKT: nazwa POZIOMU dostaje limit 200 znakow, a baza przyjmuje 80 - formularz obiecuje wiecej, niz baza da zapisac",
    () => {
      expect(SPONSOR_MAX_NAME).toBe(betweenRange("event_sponsor_tiers_name_pl_len").max);
    },
  );

  it.fails("DEFEKT: tytul MATERIALU dostaje limit 200 znakow, a baza przyjmuje 160", () => {
    expect(SPONSOR_MAX_NAME).toBe(betweenRange("event_sponsor_materials_title_pl_len").max);
  });

  it.fails(
    "DEFEKT: opis POZIOMU dostaje limit 2000 znakow, a baza przyjmuje 1000 - polowa opisu ginie w odmowie",
    () => {
      expect(SPONSOR_MAX_DESCRIPTION).toBe(upperBound("event_sponsor_tiers_desc_pl_len"));
    },
  );
});

/* ------------------------------------------------- reguly walidacji vs CHECK --- */

describe("walidacja szkicu vs to, co baza naprawde przyjmie", () => {
  it("poprawny poziom przechodzi walidacje - test ponizej mierzy DZIURE, a nie ogolna odmowe", () => {
    const draft = { ...emptyTierDraft(10, 1), key: "gold", namePl: "Zloty", nameEn: "Gold" };
    expect(validateTierDraft(draft)).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // DEFEKT: komentarz w `sponsorDraft.ts` obiecuje wprost, ze „poziom z limitem
  // `0` nie przyjmie zadnej [firmy]". Baza tego zdania nie zna:
  // `event_sponsor_tiers_max_companies_positive` wymaga `max_companies > 0`,
  // wiec zero nie jest „poziomem zamknietym”, tylko odmowa przy zapisie.
  // Poziom zamyka sie przelacznikiem `is_active`, nie zerem w limicie.
  // ---------------------------------------------------------------------------
  it.fails(
    "DEFEKT: limit firm rowny ZERO przechodzi walidacje formularza, a baza wymaga liczby wiekszej od zera",
    () => {
      const draft = {
        ...emptyTierDraft(10, 1),
        key: "gold",
        namePl: "Zloty",
        nameEn: "Gold",
        maxCompanies: "0",
      };
      expect(body("event_sponsor_tiers_max_companies_positive")).toContain("> 0");
      expect(validateTierDraft(draft).map((error) => error.field)).toContain("maxCompanies");
    },
  );

  it.fails(
    "DEFEKT: ranga poziomu ponad 1000 przechodzi walidacje, a baza dopuszcza wylacznie 0-1000",
    () => {
      const draft = {
        ...emptyTierDraft(10, 1),
        key: "gold",
        namePl: "Zloty",
        nameEn: "Gold",
        rank: String(betweenRange("event_sponsor_tiers_rank_range").max + 1),
      };
      expect(validateTierDraft(draft).map((error) => error.field)).toContain("rank");
    },
  );

  it.fails(
    "DEFEKT: jednoznakowa nazwa poziomu przechodzi walidacje, a baza wymaga co najmniej dwoch znakow",
    () => {
      const draft = { ...emptyTierDraft(10, 1), key: "gold", namePl: "Z", nameEn: "G" };
      expect(betweenRange("event_sponsor_tiers_name_pl_len").min).toBe(2);
      expect(validateTierDraft(draft)).not.toEqual([]);
    },
  );

  it.fails(
    "DEFEKT: jednoznakowy tytul materialu przechodzi walidacje, a baza wymaga co najmniej dwoch znakow",
    () => {
      const draft = {
        ...emptyMaterialDraft(10),
        titlePl: "A",
        titleEn: "A",
        url: "https://przyklad.example.com/a.pdf",
      };
      expect(betweenRange("event_sponsor_materials_title_pl_len").min).toBe(2);
      expect(validateMaterialDraft(draft)).not.toEqual([]);
    },
  );

  // ---------------------------------------------------------------------------
  // DEFEKT: adres materialu i adres STRONY FIRMY to dwa rozne ograniczenia.
  // Material wolno wskazac sciezka wewnetrzna (`^(https?://|/)`), bo paczki
  // logotypow leza w naszym magazynie - ale `snapshot_website` musi byc pelnym
  // adresem (`^https?://`). Formularz uzywa do obu tej samej funkcji, wiec
  // „/o-nas” wpisane w pole strony firmy przechodzi i wraca odmowa z bazy.
  // ---------------------------------------------------------------------------
  it.fails(
    "DEFEKT: sciezka wewnetrzna w polu STRONA FIRMY przechodzi walidacje, a baza wymaga pelnego adresu",
    () => {
      const draft = {
        ...emptySponsorDraft(10),
        companyId: COMPANY,
        snapshotName: "Firma Alfa",
        snapshotWebsite: "/o-nas",
      };
      expect(pattern("event_sponsors_snapshot_website_shape")).toBe("^https?://");
      expect(validateSponsorDraft(draft).map((error) => error.field)).toContain("snapshotWebsite");
    },
  );

  it.fails(
    "DEFEKT: jednoznakowy kraj migawki przechodzi walidacje, a baza wymaga 2-120 znakow",
    () => {
      const draft = {
        ...emptySponsorDraft(10),
        companyId: COMPANY,
        snapshotName: "Firma Alfa",
        snapshotCountry: "P",
      };
      expect(betweenRange("event_sponsors_snapshot_country_len").min).toBe(2);
      expect(validateSponsorDraft(draft)).not.toEqual([]);
    },
  );

  // ---------------------------------------------------------------------------
  // DEFEKT ODWROTNY: tu formularz jest OSTRZEJSZY od bazy i zabiera organizatorowi
  // operacje, ktora baza dopuszcza. `event_sponsors_published_sponsor_needs_tier`
  // wymaga poziomu WYLACZNIE dla roli `sponsor` - patron medialny i wystawca
  // moga byc opublikowani bez poziomu (i tak sie ich publikuje: „Patroni medialni”
  // to sekcja bez podzialu na poziomy). Formularz blokuje kazda role.
  // ---------------------------------------------------------------------------
  it.fails(
    "DEFEKT: opublikowany PATRON MEDIALNY bez poziomu jest dozwolony przez baze, a formularz go blokuje",
    () => {
      const draft = {
        ...emptySponsorDraft(10),
        companyId: COMPANY,
        snapshotName: "Redakcja Przyklad",
        role: "media_partner" as const,
        isPublished: true,
        tierId: "",
      };
      expect(body("event_sponsors_published_sponsor_needs_tier")).toContain("role <> 'sponsor'");
      expect(validateSponsorDraft(draft)).toEqual([]);
    },
  );

  it("opublikowany SPONSOR bez poziomu jest blokowany po obu stronach - to zachowanie zostaje", () => {
    const draft = {
      ...emptySponsorDraft(10),
      companyId: COMPANY,
      snapshotName: "Firma Alfa",
      isPublished: true,
    };
    expect(validateSponsorDraft(draft).map((error) => error.field)).toContain("tierId");
  });

  it("identyfikatory uzyte w tej bramce nie sa danymi osobowymi", () => {
    // RODO: same UUID-y i nazwy firm, zadnych ludzi.
    expect([EVENT, SPONSOR, COMPANY].every((id) => /^[0-9a-f-]{36}$/.test(id))).toBe(true);
  });
});
