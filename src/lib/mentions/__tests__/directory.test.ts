// CO TEN PLIK DOWODZI: rozstrzyganie „@slug -> kto to jest" jest czyste i
// przewidywalne - osoba ma pierwszeństwo przed organizacją (tak jak w bazie),
// brak firmy nie zostawia separatora-sieroty, a nierozwiązany slug NIGDY nie
// wraca jako nick.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE: wzorca wzmianki (to `parse.test.ts`) ani
// zapytań do bazy (to `useMentionDirectory`, warstwa z I/O).
import { describe, expect, it } from "vitest";
import {
  buildDirectory,
  collectMentionSlugs,
  identityLine,
  nameInitials,
  orgFromRow,
  personFromRow,
  slugToDisplayName,
  trimText,
  withAuthorSlugs,
} from "@/lib/mentions/directory";

describe("trimText", () => {
  it("zwija białe znaki i przycina do limitu", () => {
    expect(trimText("  Anna \n\t Nowak  ", 120)).toBe("Anna Nowak");
    expect(trimText("abcdef", 3)).toBe("abc");
  });

  it("bez limitu oddaje cały tekst", () => {
    expect(trimText("x".repeat(5000))).toHaveLength(5000);
  });

  it.each([
    ["pusty napis", ""],
    ["same białe znaki", " \n "],
    ["liczba", 42],
    ["null", null],
    ["undefined", undefined],
  ])("%s to brak (`null`), a nie wartość", (_opis, value) => {
    expect(trimText(value, 10)).toBeNull();
  });
});

describe("nameInitials", () => {
  it.each([
    ["Jan Kowalski", "JK"],
    ["anna maria nowak", "AN"],
    ["Łukasz Żak", "ŁŻ"],
    ["Madonna", "M"],
    ["  dr. Jan  Kowalski-Nowak ", "DN"],
  ])("%s -> %s (pierwsze i ostatnie słowo, nie dwie pierwsze litery)", (name, expected) => {
    expect(nameInitials(name)).toBe(expected);
  });

  it("nazwa bez liter i cyfr daje znak zapytania, a nie pusty awatar", () => {
    expect(nameInitials("  ---  ")).toBe("?");
    expect(nameInitials("")).toBe("?");
  });
});

describe("slugToDisplayName", () => {
  it("odtwarza czytelną postać nazwiska ze sluga", () => {
    expect(slugToDisplayName("anna-nowak")).toBe("Anna Nowak");
  });

  it("radzi sobie z podkreśleniem i wieloczłonowym nazwiskiem", () => {
    expect(slugToDisplayName("jan_kowalski-nowak")).toBe("Jan Kowalski Nowak");
  });

  it("NIE dokleja małpy - nick nie ma prawa wrócić tylnymi drzwiami", () => {
    expect(slugToDisplayName("anna-nowak")).not.toContain("@");
  });

  it("slug jednoczłonowy zostaje jednym słowem", () => {
    expect(slugToDisplayName("nato")).toBe("Nato");
  });

  it("pusty slug oddaje sam siebie zamiast pustki", () => {
    expect(slugToDisplayName("")).toBe("");
  });
});

describe("collectMentionSlugs", () => {
  it("zbiera slugi z wielu treści, bez duplikatów, w kolejności wystąpienia", () => {
    expect(collectMentionSlugs(["@anna i @piotr", "znowu @anna"])).toEqual(["anna", "piotr"]);
  });

  it("pomija treści puste i nullowe", () => {
    expect(collectMentionSlugs([null, undefined, ""])).toEqual([]);
  });

  it("normalizuje wielkość liter - slug jest kanonicznie mały", () => {
    expect(collectMentionSlugs(["@Anna"])).toEqual(["anna"]);
  });

  it("przyjmuje WSTRZYKNIĘTY parser - warstwa ogólna nie zna parsera klubowego", () => {
    const split = () => [{ kind: "mention" as const, slug: "acme" }];
    expect(collectMentionSlugs(["cokolwiek"], split)).toEqual(["acme"]);
  });

  it("ignoruje segmenty bez sluga", () => {
    const split = () => [{ kind: "mention" as const }, { kind: "text" as const }];
    expect(collectMentionSlugs(["x"], split)).toEqual([]);
  });
});

describe("withAuthorSlugs", () => {
  it("dokłada autorów do slugów z treści, bez duplikatów", () => {
    expect(withAuthorSlugs(["anna"], ["piotr", "anna"])).toEqual(["anna", "piotr"]);
  });

  it("pomija autorów bez sluga (anonim, konto usunięte)", () => {
    expect(withAuthorSlugs([], [null, undefined, ""])).toEqual([]);
  });

  it("normalizuje wielkość liter sluga autora", () => {
    expect(withAuthorSlugs([], ["Anna"])).toEqual(["anna"]);
  });
});

describe("personFromRow", () => {
  const row = {
    slug: "anna-nowak",
    display_name: "Anna Nowak",
    avatar_url: "https://x/a.png",
    job_title: "Dyrektorka",
    current_company: "ACME",
    bio_pl: "Polski biogram",
    bio_en: "English bio",
    verified_at: "2026-01-01T00:00:00Z",
  };

  it("mapuje komplet pól karty", () => {
    expect(personFromRow(row, "pl")).toEqual({
      kind: "person",
      slug: "anna-nowak",
      name: "Anna Nowak",
      avatarUrl: "https://x/a.png",
      jobTitle: "Dyrektorka",
      company: "ACME",
      bio: "Polski biogram",
      verified: true,
    });
  });

  it("język wybiera wariant biogramu", () => {
    expect(personFromRow(row, "en")?.bio).toBe("English bio");
  });

  it("bez `display_name` skleja imię i nazwisko", () => {
    const person = personFromRow({ slug: "a-b", first_name: "Jan", last_name: "Kowalski" }, "pl");
    expect(person?.name).toBe("Jan Kowalski");
  });

  it("bez żadnej nazwy schodzi na UCZYTELNIONY slug, nie na nick", () => {
    const person = personFromRow({ slug: "jan-kowalski" }, "pl");
    expect(person?.name).toBe("Jan Kowalski");
  });

  it("`specialization` jest zapasem dla stanowiska", () => {
    const person = personFromRow({ slug: "a", specialization: "Energetyka" }, "pl");
    expect(person?.jobTitle).toBe("Energetyka");
  });

  it("brak weryfikacji to `false`, nie `undefined`", () => {
    expect(personFromRow({ slug: "a" }, "pl")?.verified).toBe(false);
  });

  it("wiersz bez sluga odpada - nie ma czym kluczować katalogu", () => {
    expect(personFromRow({ display_name: "Ktoś" }, "pl")).toBeNull();
  });

  it("puste napisy traktuje jak brak, nie jak wartość", () => {
    const person = personFromRow({ slug: "a", current_company: "   " }, "pl");
    expect(person?.company).toBeNull();
  });
});

describe("orgFromRow", () => {
  // Wiersz w kształcie, jaki oddaje publiczny RPC wzmianek: kartoteka firm nie
  // ma wariantów językowych nazwy, więc nie ma tu czego wybierać po języku.
  const row = {
    kind: "organization",
    id: "00000000-0000-4000-8000-000000000001",
    slug: "org-00000000-0000-4000-8000-000000000001",
    label: "ACME Polska",
    subtitle: "Energetyka",
    logo_url: "https://x/l.png",
    website: "https://acme.example",
  };

  it("mapuje firmę z kartoteki", () => {
    expect(orgFromRow(row)).toEqual({
      kind: "org",
      slug: "org-00000000-0000-4000-8000-000000000001",
      id: "00000000-0000-4000-8000-000000000001",
      name: "ACME Polska",
      logoUrl: "https://x/l.png",
      description: "Energetyka",
      website: "https://acme.example",
    });
  });

  it("branża jest OPCJONALNA - bez niej opis jest pusty, a nie pustym napisem", () => {
    expect(orgFromRow({ ...row, subtitle: "   " })?.description).toBeNull();
  });

  it("bez nazwy schodzi na uczytelniony slug, nigdy na surowy identyfikator", () => {
    const org = orgFromRow({ id: "abc", slug: "rada-unii" });
    expect(org?.name).toBe("Rada Unii");
  });

  it("wiersz bez id odpada - nie ma dokąd prowadzić", () => {
    expect(orgFromRow({ slug: "org-1" })).toBeNull();
  });

  it("wiersz bez sluga odpada - nie ma czym kluczować katalogu", () => {
    expect(orgFromRow({ id: "abc" })).toBeNull();
  });
});

describe("buildDirectory", () => {
  it("skleja osoby i firmy w jedną mapę po slugu", () => {
    const dir = buildDirectory(
      [{ slug: "anna-nowak", display_name: "Anna Nowak" }],
      [{ id: "abc", slug: "org-abc", label: "ACME" }],
      "pl",
    );
    expect(dir.get("anna-nowak")?.kind).toBe("person");
    expect(dir.get("org-abc")?.kind).toBe("org");
  });

  it("PREFIKS ZNOSI RYZYKO KOLIZJI - slug firmy nie zderzy się ze slugiem osoby", () => {
    const dir = buildDirectory(
      [{ slug: "acme", display_name: "Acme Człowiek" }],
      [{ id: "abc", slug: "org-abc", label: "ACME sp. z o.o." }],
      "pl",
    );
    expect(dir.get("acme")?.kind).toBe("person");
    expect(dir.get("org-abc")?.kind).toBe("org");
    expect(dir.size).toBe(2);
  });

  it("wiersze bez sluga nie trafiają do katalogu", () => {
    const dir = buildDirectory([{ display_name: "X" }], [{ id: "abc" }], "pl");
    expect(dir.size).toBe(0);
  });
});

describe("identityLine", () => {
  it("stanowisko i firma stoją obok siebie", () => {
    expect(identityLine("Dyrektorka", "ACME")).toEqual(["Dyrektorka", "ACME"]);
  });

  it("BRAK FIRMY nie zostawia pustego miejsca ani separatora-sieroty", () => {
    expect(identityLine("Dyrektorka", null)).toEqual(["Dyrektorka"]);
  });

  it("sama firma wystarczy", () => {
    expect(identityLine(null, "ACME")).toEqual(["ACME"]);
  });

  it("brak obu daje PUSTĄ tablicę - widok nie renderuje wtedy wiersza wcale", () => {
    expect(identityLine(null, null)).toEqual([]);
    expect(identityLine(undefined, undefined)).toEqual([]);
  });

  it("pusty napis to brak, nie wartość", () => {
    expect(identityLine("", "")).toEqual([]);
  });
});
