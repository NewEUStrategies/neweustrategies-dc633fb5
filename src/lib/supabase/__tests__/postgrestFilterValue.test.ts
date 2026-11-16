// Wartości filtrów PostgREST budowanych ręcznie (lib/supabase/postgrestFilterValue.ts).
//
// Napis porównany z napisem niczego nie dowodzi - dlatego każdy operand
// odczytujemy WZORCOWYM portem parsera PostgREST (test/supabase/postgrestGrammar.ts)
// i dopiero wynik serwera dopasowujemy semantyką LIKE. Port sam jest
// zakotwiczony w przykładach z dokumentacji PostgREST (niżej). Dane syntetyczne.
import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  ilikeEqualityExpressible,
  ilikeEqualsOperand,
  likeLiteral,
  postgrestQuoted,
  postgrestQuotedList,
  urlEncodedLength,
} from "../postgrestFilterValue";
import {
  decodeInParam,
  decodeOrParam,
  filterMatches,
  likeMatches,
} from "@/test/supabase/postgrestGrammar";

// Adresy z każdym znakiem, który coś znaczy dla LIKE albo dla gramatyki
// PostgREST (`_ % \ " , . ( ) :`), plus `+` (kodowanie URL) i wielkie litery.
const ADDRESSES = [
  "jan_kowalski@firma.pl",
  "100%pewny@firma.pl",
  "a\\b@firma.pl",
  'o"neil@firma.pl',
  "nowak,jan@firma.pl",
  "anna.maria.kowalska@firma.pl",
  "biuro(pr)@firma.pl",
  "dzial:sprzedaz@firma.pl",
  "jan+crm@firma.pl",
  "Anna.Kowalska@Firma.PL",
  '\\_%",.():+@firma.pl',
] as const;

/** Liść `contact_email.ilike.<operand>` tak, jak odczyta go PostgREST. */
function serverSide(operand: string) {
  const leaves = decodeOrParam(`(contact_email.ilike.${operand})`);
  expect(leaves).toHaveLength(1);
  const [leaf] = leaves;
  if (leaf?.op !== "ilike") throw new Error("oczekiwano liścia ilike");
  return leaf;
}

describe("port parsera PostgREST - przykłady z dokumentacji (url_grammar.rst)", () => {
  it("cytowane wartości z przecinkiem w `in`", () => {
    expect(decodeInParam('in.("Hebdon,John","Williams,Mary")')).toEqual([
      "Hebdon,John",
      "Williams,Mary",
    ]);
  });

  it('`\\"` to cudzysłów, `\\\\` to ukośnik - wewnątrz cudzysłowu', () => {
    expect(decodeInParam('in.("Quote:\\"","Backslash:\\\\")')).toEqual(['Quote:"', "Backslash:\\"]);
  });

  it("niecytowana wartość kończy się na przecinku - to on rozcina filtr", () => {
    expect(decodeOrParam("(a.ilike.x,y.eq.z)").map((f) => f.column)).toEqual(["a", "y"]);
  });
});

describe("postgrestQuoted", () => {
  it('ujmuje w cudzysłów i poprzedza `\\` oraz `"` ukośnikiem', () => {
    expect(postgrestQuoted("plain@x.pl")).toBe('"plain@x.pl"');
    expect(postgrestQuoted('a"b')).toBe('"a\\"b"');
    expect(postgrestQuoted("a\\b")).toBe('"a\\\\b"');
  });

  it("każda wartość wraca z drzewa `in` dosłownie", () => {
    const decoded = decodeOrParam(`(contact_email.in.(${postgrestQuotedList(ADDRESSES)}))`);
    expect(decoded).toEqual([
      { column: "contact_email", negated: false, op: "in", values: [...ADDRESSES] },
    ]);
  });
});

describe("likeLiteral", () => {
  it("poprzedza `\\`, `%` i `_` ukośnikiem - ukośnik najpierw", () => {
    expect(likeLiteral("jan_kowalski@x.pl")).toBe("jan\\_kowalski@x.pl");
    expect(likeLiteral("100%@x.pl")).toBe("100\\%@x.pl");
    // `\_` w adresie: ukośnik i podkreślnik osobno, nie `\\_` (dosłowny `\`
    // + wieloznacznik `_`), jak przy escapowaniu w złej kolejności.
    expect(likeLiteral("a\\_b@x.pl")).toBe("a\\\\\\_b@x.pl");
    expect(likeLiteral("zwykly.adres@x.pl")).toBe("zwykly.adres@x.pl");
  });

  it("odrzuca `*` - PostgREST zamieniłby go na `%` bez względu na escapowanie", () => {
    expect(ilikeEqualityExpressible("a*b@x.pl")).toBe(false);
    expect(ilikeEqualityExpressible("a_b@x.pl")).toBe(true);
    expect(() => likeLiteral("a*b@x.pl")).toThrow(/`\*`/);
    expect(() => ilikeEqualsOperand("a*b@x.pl")).toThrow(/`\*`/);
  });

  it("dlaczego: `\\*` po stronie serwera to dosłowny `%`, nie gwiazdka", () => {
    // Port `T.map star` z SqlFragment.hs: zamiana po zdjęciu cytowania.
    const leaf = { column: "c", negated: false, op: "ilike", value: "a\\*b" } as const;
    expect(filterMatches(leaf, { c: "a%b" })).toBe(true);
    expect(filterMatches(leaf, { c: "a*b" })).toBe(false);
  });
});

describe("ilikeEqualsOperand - równość bez wielkości liter, bez wieloznaczników", () => {
  it.each(ADDRESSES)("%s: jeden liść, wartość = wzorzec dosłowny", (address) => {
    const leaf = serverSide(ilikeEqualsOperand(address));
    expect(leaf.column).toBe("contact_email");
    expect(leaf.value).toBe(likeLiteral(address));
  });

  it.each(ADDRESSES)("%s: trafia sam adres w każdej wielkości liter", (address) => {
    const leaf = serverSide(ilikeEqualsOperand(address));
    for (const variant of [address, address.toUpperCase(), address.toLowerCase()]) {
      expect(filterMatches(leaf, { contact_email: variant })).toBe(true);
    }
  });

  it.each(ADDRESSES)("%s: inny znak na pozycji metaznaku to NIE trafienie", (address) => {
    const leaf = serverSide(ilikeEqualsOperand(address));
    for (let i = 0; i < address.length; i += 1) {
      if (!"_%\\".includes(address[i] ?? "")) continue;
      const other = `${address.slice(0, i)}X${address.slice(i + 1)}`;
      expect(filterMatches(leaf, { contact_email: other })).toBe(false);
    }
    // `%` nie może też połknąć dłuższego ciągu.
    expect(filterMatches(leaf, { contact_email: address.replace("%", "%%%") })).toBe(
      !address.includes("%"),
    );
  });

  it("adres z ukośnikiem nie trafia adresu bez niego (`\\b` nie jest dosłownym `b`)", () => {
    const leaf = serverSide(ilikeEqualsOperand("a\\b@firma.pl"));
    expect(filterMatches(leaf, { contact_email: "AB@firma.pl" })).toBe(false);
    expect(filterMatches(leaf, { contact_email: "A\\B@FIRMA.PL" })).toBe(true);
  });

  it("cudzysłów i przecinek w adresie nie dokładają liścia do drzewa", () => {
    // Bez escapowania `"` ten adres zamknąłby cytat i dołożył liść
    // `contact_email.ilike."%@firma.pl"` - wieloznacznik na całą domenę.
    const hostile = 'a",contact_email.ilike."%@firma.pl';
    const leaf = serverSide(ilikeEqualsOperand(hostile));
    expect(leaf.value).toBe(likeLiteral(hostile));
    expect(filterMatches(leaf, { contact_email: "ktokolwiek@firma.pl" })).toBe(false);
    expect(filterMatches(leaf, { contact_email: hostile.toUpperCase() })).toBe(true);
  });
});

describe("likeMatches (semantyka LIKE PostgreSQL, sprawdzona na PG16)", () => {
  it("`_`, `%` i ucieczka `\\`", () => {
    expect(likeMatches("Jan_Kowalski@x.pl", "jan\\_kowalski@x.pl", true)).toBe(true);
    expect(likeMatches("janXkowalski@x.pl", "jan\\_kowalski@x.pl", true)).toBe(false);
    expect(likeMatches("janXkowalski@x.pl", "jan_kowalski@x.pl", true)).toBe(true);
    expect(likeMatches("A%b@x.pl", "a\\%b@x.pl", true)).toBe(true);
    expect(likeMatches("aXYb@x.pl", "a\\%b@x.pl", true)).toBe(false);
    expect(likeMatches("A\\b@x.pl", "a\\\\b@x.pl", true)).toBe(true);
    expect(likeMatches("ab@x.pl", "a\\\\b@x.pl", true)).toBe(false);
    expect(likeMatches("ANNA@X.PL", "anna@x.pl", false)).toBe(false);
    // PG16: `'ab' ILIKE 'a\'` -> ERROR „LIKE pattern must not end with escape character".
    expect(() => likeMatches("ab", "a\\", true)).toThrow(/escape/);
  });
});

describe("urlEncodedLength", () => {
  it("to długość parametru w adresie, jaki składa postgrest-js", () => {
    for (const address of ADDRESSES) {
      const param = `(contact_email.ilike.${ilikeEqualsOperand(address)})`;
      const url = new URL("https://db.example.test/rest/v1/profiles");
      url.searchParams.append("or", param);
      expect(url.search.length - "?or=".length).toBe(urlEncodedLength(param));
    }
  });
});

describe("postgrest-js z node_modules - dlaczego cytujemy sami", () => {
  // Prawdziwa biblioteka, nie jej opis: adres URL, który builder wysłałby
  // do PostgREST. Klient nie łączy się z siecią przy budowie zapytania.
  const client = createClient("https://db.example.test", "test-anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const paramOf = (builder: unknown, name: string): string => {
    const value = (builder as { url: URL }).url.searchParams.get(name);
    if (value === null) throw new Error(`brak parametru ${name}`);
    return value;
  };

  it("`.or()` przekazuje napis bez żadnego escapowania", () => {
    const raw = 'contact_email.ilike."a\\_b",email.in.("x")';
    expect(paramOf(client.from("profiles").select("email").or(raw), "or")).toBe(`(${raw})`);
  });

  it('`.in()` cytuje wartość z `,()`, ale nie escapuje w niej `"` - PostgREST ucina listę', () => {
    const values = ['o"neil,(pr)@firma.test', "login@firma.test"];
    const param = paramOf(client.from("profiles").select("email").in("email", values), "email");
    // Serwer widzi listę uciętą w połowie - `login@firma.test` znika z filtra.
    expect(decodeInParam(param)).not.toContain("login@firma.test");
    // Ta sama lista zacytowana `postgrestQuotedList` wraca w całości.
    expect(decodeInParam(`in.(${postgrestQuotedList(values)})`)).toEqual(values);
  });
});
