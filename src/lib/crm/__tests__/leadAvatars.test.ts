// Reguła dopasowania lead -> zdjęcie profilowe członka (lib/crm/leadAvatars.ts).
// Sieć i granica najemcy mają test w crmFunctions.test.ts (getCrmLeadAvatars).
// Dane wyłącznie syntetyczne (domena example.test).
import { describe, expect, it } from "vitest";
import {
  avatarLookupChunks,
  avatarLookupKeyCost,
  avatarLookupKeys,
  chunked,
  contactFilter,
  matchChunkAvatars,
  matchLeadAvatars,
  normalizeEmail,
  pgCaseFold,
  type LeadEmailRow,
  type ProfileAvatarRow,
} from "../leadAvatars";
import { decodeOrParam, pgLower } from "@/test/supabase/postgrestGrammar";
import { urlEncodedLength } from "@/lib/supabase/postgrestFilterValue";

const lead = (
  id: string,
  email: string,
  email_norm = email.trim().toLowerCase(),
): LeadEmailRow => ({
  id,
  email,
  email_norm,
});

const profile = (over: Partial<ProfileAvatarRow>): ProfileAvatarRow => ({
  email: null,
  contact_email: null,
  avatar_url: null,
  ...over,
});

describe("normalizeEmail", () => {
  it("tnie białe znaki i sprowadza do małych liter - jak crm_leads.email_norm", () => {
    expect(normalizeEmail("  Anna@Example.TEST ")).toBe("anna@example.test");
    expect(normalizeEmail(null)).toBe("");
    expect(normalizeEmail(undefined)).toBe("");
  });
});

describe("avatarLookupKeys", () => {
  it("jeden adres w wielu leadach pyta bazę raz, kluczem jest postać znormalizowana", () => {
    const keys = avatarLookupKeys([
      lead("l1", "anna@example.test"),
      lead("l2", "ANNA@example.test"),
      lead("l3", "bartek@example.test"),
    ]);
    expect(keys.map((k) => k.key)).toEqual(["anna@example.test", "bartek@example.test"]);
  });

  it("lead bez adresu nie dokłada klucza", () => {
    expect(avatarLookupKeys([lead("l1", "", "")])).toEqual([]);
  });

  it("klucz bierze z email_norm, gdy baza go podaje", () => {
    expect(
      avatarLookupKeys([lead("l1", "anna@example.test", "ANNA@example.test")]).map((k) => k.key),
    ).toEqual(["anna@example.test"]);
  });

  it("adres bez `*`: liść `ilike` z wzorcem dosłownym klucza (wielkość liter z zapisu leada niepotrzebna)", () => {
    const keys = avatarLookupKeys([lead("l1", " Jan_Kowalski@Example.test ")]);
    expect(decodeOrParam(`(${contactFilter(keys)})`)).toEqual([
      {
        column: "contact_email",
        negated: false,
        op: "ilike",
        value: "jan\\_kowalski@example.test",
      },
    ]);
  });

  it("adres z `*`: wyłącznie dokładne `in` na postaci znormalizowanej i WŁASNEJ zapisanej, bez `ilike`", () => {
    const keys = avatarLookupKeys([lead("l1", "A*b@Example.test"), lead("l2", "a*B@example.test")]);
    expect(keys.map((k) => k.ilike)).toEqual([[], []]);
    expect(decodeOrParam(`(${contactFilter(keys)})`)).toEqual([
      {
        column: "contact_email",
        negated: false,
        op: "in",
        values: ["a*b@example.test", "A*b@Example.test"],
      },
      {
        column: "contact_email",
        negated: false,
        op: "in",
        values: ["a*b@example.test", "a*B@example.test"],
      },
    ]);
  });

  it("postaci spoza ASCII: liść na klasę `pgCaseFold`, nie tylko klucz JS", () => {
    const ilikeOf = (email: string, norm?: string) =>
      avatarLookupKeys([lead("l1", email, norm)]).map((k) => k.ilike);
    // JS `toLowerCase('İ')` = i + U+0307, a `lower('İ')` bazy = `i`: dwie klasy.
    expect(ilikeOf("İzmir@example.test")).toEqual([
      ["i\u0307zmir@example.test", "İzmir@example.test"],
    ]);
    // `email_norm` z `lower(btrim())` bazy: `lower()` zrównuje `İ` z `i`, ale
    // `pgCaseFold` nie - dwa liście (ten sam wynik w bazie), bo przypisanie
    // potrzebuje obu postaci.
    expect(ilikeOf("İzmir@example.test", "izmir@example.test")).toEqual([
      ["izmir@example.test", "İzmir@example.test"],
    ]);
    // Wielka litera ASCII nie tworzy osobnej klasy obok klucza.
    expect(ilikeOf("IZMIR@example.test")).toEqual([["izmir@example.test"]]);
    // JS daje końcowe `ς`, baza `σ`: dwie klasy.
    expect(ilikeOf("ΟΔΟΣ@example.test")).toEqual([["οδος@example.test", "ΟΔΟΣ@example.test"]]);
    // ASCII i `ẞ`: wielkość liter nie tworzy osobnego liścia.
    expect(ilikeOf("Anna@Example.TEST")).toEqual([["anna@example.test"]]);
    expect(ilikeOf("STRAẞE@example.test")).toEqual([["straße@example.test"]]);
  });

  it("ten sam klucz JS, inne postaci - osobne wpisy (postać sąsiada nie przechodzi)", () => {
    const keys = avatarLookupKeys([
      lead("l1", "ΟΔΟΣ@example.test"),
      lead("l2", "οδος@example.test"),
      lead("l3", "ΟΔΟΣ@example.test"),
    ]);
    expect(keys.map((k) => [k.key, k.ilike])).toEqual([
      ["οδος@example.test", ["οδος@example.test", "ΟΔΟΣ@example.test"]],
      ["οδος@example.test", ["οδος@example.test"]],
    ]);
    // Wspólny liść klucza idzie w filtrze raz.
    expect(
      decodeOrParam(`(${contactFilter(keys)})`).map((f) => f.op === "ilike" && f.value),
    ).toEqual(["οδος@example.test", "ΟΔΟΣ@example.test"]);
  });

  it("adresy ze znakami gramatyki dają DOKŁADNIE jeden liść na klucz", () => {
    const addresses = [
      'o"neil@example.test',
      "nowak,jan@example.test",
      "biuro(pr)@example.test",
      "dzial:sprzedaz@example.test",
      "a\\b@example.test",
      "jan+crm@example.test",
      "x*y,(z)@example.test",
    ];
    const keys = avatarLookupKeys(addresses.map((email, i) => lead(`l${i}`, email)));
    const leaves = decodeOrParam(`(${contactFilter(keys)})`);
    expect(leaves).toHaveLength(addresses.length);
    expect(leaves.map((f) => (f.op === "in" ? f.values[0] : f.value))).toEqual([
      'o"neil@example.test',
      "nowak,jan@example.test",
      "biuro(pr)@example.test",
      "dzial:sprzedaz@example.test",
      "a\\\\b@example.test",
      "jan+crm@example.test",
      "x*y,(z)@example.test",
    ]);
  });
});

describe("avatarLookupChunks", () => {
  const keysFor = (count: number, local = "osoba") =>
    avatarLookupKeys(
      Array.from({ length: count }, (_, i) => lead(`l${i}`, `${local}${i}@example.test`)),
    );

  it("trzyma limit liczby kluczy w porcji i kolejność", () => {
    const keys = keysFor(5);
    const parts = avatarLookupChunks(keys, { maxItems: 2, maxEncodedLength: 1_000_000 });
    expect(parts.map((p) => p.length)).toEqual([2, 2, 1]);
    expect(parts.flat()).toEqual(keys);
  });

  it("trzyma DŁUGOŚĆ filtra kontaktowego w adresie URL, nie tylko liczbę adresów", () => {
    const keys = keysFor(120, "bardzo.dlugi_adres.kontaktowy%czlonka.");
    const budget = 6000;
    const parts = avatarLookupChunks(keys, { maxItems: 100, maxEncodedLength: budget });
    expect(parts.length).toBeGreaterThan(2);
    expect(parts.flat()).toEqual(keys);
    for (const part of parts) {
      // Dokładnie ten parametr wysyła postgrest-js: `or=(...)`.
      expect(urlEncodedLength(`(${contactFilter(part)})`)).toBeLessThanOrEqual(budget);
    }
  });

  it("koszt klucza ogranicza z góry jego liść w zakodowanym filtrze", () => {
    for (const key of avatarLookupKeys([
      lead("l1", 'a\\b_c%d"e@example.test'),
      lead("l2", "x*y,(z)@example.test"),
      lead("l3", "anna@example.test"),
    ])) {
      expect(urlEncodedLength(`${contactFilter([key])},`)).toBeLessThanOrEqual(
        avatarLookupKeyCost(key),
      );
    }
  });

  it("klucz droższy niż limit jest pomijany - reszta idzie, każda porcja w limicie", () => {
    // Adres 305 znaków (mieści się w limicie importu 320): `İ` daje dwie
    // postaci (klucz JS i zapis), `\` - 12 znaków każdy po kodowaniu.
    const oversized = `İ${"\\".repeat(299)}@x.pl`;
    const keys = avatarLookupKeys([
      lead("l1", "anna@example.test"),
      lead("l2", oversized),
      lead("l3", "bartek@example.test"),
    ]);
    const budget = 6000;
    expect(avatarLookupKeyCost(keys[1] as (typeof keys)[number])).toBeGreaterThan(budget);
    const parts = avatarLookupChunks(keys, { maxItems: 100, maxEncodedLength: budget });
    expect(parts).toEqual([[keys[0], keys[2]]]);
    // Sam za drogi klucz: żadnej porcji, czyli żadnego zapytania.
    expect(
      avatarLookupChunks([keys[1] as (typeof keys)[number]], {
        maxItems: 100,
        maxEncodedLength: budget,
      }),
    ).toEqual([]);
    // Za drogi bywa już adres w limicie RFC 5321 (254 znaki): `İ` (dwa liście)
    // i 248 `\`. Ta sama długość w jednym liściu mieści się z zapasem.
    const costOf = (email: string) =>
      avatarLookupKeyCost(avatarLookupKeys([lead("l4", email)])[0] as (typeof keys)[number]);
    const rfcMax = `İ${"\\".repeat(248)}@x.pl`;
    expect([...rfcMax]).toHaveLength(254);
    expect(costOf(rfcMax)).toBeGreaterThan(budget);
    expect(costOf(`Ł${"\\".repeat(248)}@x.pl`)).toBeLessThan(budget / 2 + 100);
    // Każdy klucz w limicie mieści się sam - nic poza za drogimi nie znika.
    const tight = avatarLookupChunks(keysFor(3), { maxItems: 100, maxEncodedLength: 60 });
    expect(tight.flat()).toEqual(keysFor(3));
  });

  it("pusta lista to brak porcji (bez pustego zapytania)", () => {
    expect(avatarLookupChunks([], { maxItems: 100, maxEncodedLength: 6000 })).toEqual([]);
  });
});

describe("matchLeadAvatars", () => {
  it("dopasowuje po adresie logowania i po adresie kontaktowym, bez wielkości liter", () => {
    const leads = [
      lead("l1", "Anna@Example.test"),
      lead("l2", "bartek@example.test"),
      lead("l3", "nikt@example.test"),
    ];
    const avatars = matchLeadAvatars(
      leads,
      [profile({ email: "anna@example.test", avatar_url: "https://cdn.test/a.png" })],
      [profile({ contact_email: "Bartek@Example.test", avatar_url: "https://cdn.test/b.png" })],
    );
    expect(avatars).toEqual([
      { lead_id: "l1", avatar_url: "https://cdn.test/a.png" },
      { lead_id: "l2", avatar_url: "https://cdn.test/b.png" },
    ]);
  });

  it("kontakt zapisany inną wielkością liter niż lead to ten sam adres", () => {
    const avatars = matchLeadAvatars(
      [lead("l1", "anna.kowalska@firma.test")],
      [],
      [
        profile({
          contact_email: "Anna.Kowalska@Firma.TEST",
          avatar_url: "https://cdn.test/k.png",
        }),
      ],
    );
    expect(avatars).toEqual([{ lead_id: "l1", avatar_url: "https://cdn.test/k.png" }]);
  });

  it("wiersz mapuje się po WŁASNYM adresie - podobny adres innego członka nie trafia", () => {
    // Gdyby filtr bazy przepuścił wieloznacznik, `janXkowalski` wróciłby
    // z zapytania o `jan_kowalski` - mapowanie i tak go nie przypisze.
    const avatars = matchLeadAvatars(
      [lead("l1", "jan_kowalski@firma.test")],
      [],
      [profile({ contact_email: "janXkowalski@firma.test", avatar_url: "https://cdn.test/x.png" })],
    );
    expect(avatars).toEqual([]);
  });

  it("adres logowania wygrywa z adresem kontaktowym innej osoby", () => {
    const avatars = matchLeadAvatars(
      [lead("l1", "anna@example.test")],
      [profile({ email: "anna@example.test", avatar_url: "https://cdn.test/konto.png" })],
      [profile({ contact_email: "anna@example.test", avatar_url: "https://cdn.test/obcy.png" })],
    );
    expect(avatars).toEqual([{ lead_id: "l1", avatar_url: "https://cdn.test/konto.png" }]);
  });

  it("w obrębie jednej klasy wygrywa pierwszy wiersz (kolejność zadaje serwer)", () => {
    const avatars = matchLeadAvatars(
      [lead("l1", "wspolny@example.test")],
      [],
      [
        profile({ contact_email: "wspolny@example.test", avatar_url: "https://cdn.test/1.png" }),
        profile({ contact_email: "wspolny@example.test", avatar_url: "https://cdn.test/2.png" }),
      ],
    );
    expect(avatars).toEqual([{ lead_id: "l1", avatar_url: "https://cdn.test/1.png" }]);
  });

  it("profil bez zdjęcia nie zasłania dopasowania z drugiej klasy", () => {
    const avatars = matchLeadAvatars(
      [lead("l1", "anna@example.test")],
      [profile({ email: "anna@example.test", avatar_url: null })],
      [profile({ contact_email: "anna@example.test", avatar_url: "https://cdn.test/k.png" })],
    );
    expect(avatars).toEqual([{ lead_id: "l1", avatar_url: "https://cdn.test/k.png" }]);
  });

  it("ten sam adres w dwóch leadach daje zdjęcie obu", () => {
    const avatars = matchLeadAvatars(
      [lead("l1", "anna@example.test"), lead("l2", "ANNA@example.test")],
      [profile({ email: "anna@example.test", avatar_url: "https://cdn.test/a.png" })],
      [],
    );
    expect(avatars.map((a) => a.lead_id)).toEqual(["l1", "l2"]);
  });

  it("wynik nie niesie adresów profilu - tylko id leada i publiczny avatar_url", () => {
    const [avatar] = matchLeadAvatars(
      [lead("l1", "anna@example.test")],
      [
        profile({
          email: "anna@example.test",
          contact_email: "prywatny@example.test",
          avatar_url: "https://cdn.test/a.png",
        }),
      ],
      [],
    );
    expect(Object.keys(avatar ?? {}).sort()).toEqual(["avatar_url", "lead_id"]);
  });
});

describe("pgCaseFold", () => {
  it("jak `lower()` PostgreSQL 16 (glibc), nie jak JS `toLowerCase` napisu", () => {
    expect(pgCaseFold("ΟΔΟΣ@X.gr")).toBe("οδοσ@x.gr"); // bez końcowego `ς`
    expect(pgCaseFold("STRAẞE")).toBe("straße");
    expect(pgCaseFold("ILGAZ ılgaz")).toBe("ilgaz ılgaz");
    expect(pgCaseFold("Łukasz.ŻÓŁW")).toBe("łukasz.żółw");
  });

  it("`İ` zostaje sobą - nie zrównuje się ani z `i`, ani z `I` (choć `lower()` bazy daje `i`)", () => {
    expect(pgCaseFold("İzmir@X.tr")).toBe("İzmir@x.tr");
    expect(pgCaseFold("İZMIR@x.tr")).toBe(pgCaseFold("İzmir@x.tr"));
    expect(pgCaseFold("İzmir@x.tr")).not.toBe(pgCaseFold("IZMIR@x.tr"));
    expect(pgCaseFold("İzmir@x.tr")).not.toBe(pgCaseFold("izmir@x.tr"));
    // Baza (port `pgLower`) zrównuje - liść `ILIKE` przyniesie oba wiersze.
    expect(pgLower("İzmir@x.tr")).toBe(pgLower("IZMIR@x.tr"));
    // Klasa `İ` jest jednoelementowa: żaden inny znak nie składa się do `İ`.
    for (let cp = 0; cp <= 0x10ffff; cp += 1) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const ch = String.fromCodePoint(cp);
      if ((pgCaseFold(ch) === "İ") !== (cp === 0x130)) {
        throw new Error(`U+${cp.toString(16)} -> ${pgCaseFold(ch)}`);
      }
    }
  });

  it("w zakresach zaufanych to DOKŁADNIE port `lower()` bazy, znak po znaku - poza `İ`", () => {
    // Port (test/supabase/postgrestGrammar.ts `pgLower`) porównano z PG16 na
    // wszystkich punktach kodowych; tu - że `pgCaseFold` go nie rozmija.
    // Jedyny świadomy wyjątek: `İ` (test wyżej).
    for (const [from, to] of [
      [0, 0x58f],
      [0x1e00, 0x1eff],
    ] as const) {
      for (let cp = from; cp <= to; cp += 1) {
        if (cp === 0x130) continue;
        const ch = String.fromCodePoint(cp);
        expect([cp, pgCaseFold(ch)]).toEqual([cp, pgLower(ch)]);
      }
    }
  });

  it("poza zakresami - tożsamość, nawet gdy JS zna małą literę (Unicode nowszy niż glibc bazy)", () => {
    for (const cp of [0x212a, 0x2126, 0x1c90, 0x1c89, 0xa7cb, 0x10d50, 0x13a0, 0x10400]) {
      const ch = String.fromCodePoint(cp);
      expect(ch.toLowerCase()).not.toBe(ch);
      expect(pgCaseFold(ch)).toBe(ch);
    }
  });

  it("równość `pgCaseFold` pociąga równość `lower()` bazy - dla KAŻDEGO znaku", () => {
    // `pgCaseFold` zamienia znak na JEDEN znak, a `lower()` bazy działa znak po
    // znaku - wystarczy więc `pgLower(c)` = `pgLower(pgCaseFold(c))` dla
    // każdego c: z `pgCaseFold(a)` = `pgCaseFold(b)` = f wynika
    // `pgLower(a)` = `pgLower(f)` = `pgLower(b)`. Bez tego wiersz przyniesiony
    // liściem innego leada mógłby dostać zdjęcie, którego liść samego leada
    // nie zwraca (port `pgLower` porównany z PG16 na wszystkich punktach).
    let changed = 0;
    for (let cp = 0; cp <= 0x10ffff; cp += 1) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const ch = String.fromCodePoint(cp);
      const fold = pgCaseFold(ch);
      if (fold === ch) continue;
      changed += 1;
      if ([...fold].length !== 1 || pgLower(fold) !== pgLower(ch)) {
        throw new Error(`U+${cp.toString(16)}: ${fold} / ${pgLower(ch)}`);
      }
    }
    // Wszystkie wielkie litery łaciny, greki, cyrylicy i ormiańskiego - nie zero.
    expect(changed).toBeGreaterThan(500);
  });
});

describe("matchChunkAvatars", () => {
  const avatarFor = (email: string, rows: ProfileAvatarRow[], norm?: string) => {
    const keys = avatarLookupKeys([lead("l1", email, norm)]);
    return matchChunkAvatars(keys, [], rows).get(keys[0]?.id ?? "") ?? null;
  };

  it("identyczny adres spoza ASCII trafia - także z kluczem JS `i̇zmir@`", () => {
    const rows = [
      profile({ contact_email: "İzmir@example.test", avatar_url: "https://cdn.test/i.png" }),
    ];
    expect(avatarFor("İzmir@example.test", rows)).toBe("https://cdn.test/i.png");
    expect(avatarFor("İzmir@example.test", rows, "izmir@example.test")).toBe(
      "https://cdn.test/i.png",
    );
    expect(avatarFor("İZMIR@example.test", rows)).toBe("https://cdn.test/i.png");
    // Lead z ASCII: baza przynosi `İzmir@` (`lower('İ')` = `i`), ale `İ` to
    // nie `i` ani `I` - wiersz bez przypisania.
    expect(avatarFor("izmir@example.test", rows)).toBeNull();
    expect(avatarFor("IZMIR@example.test", rows)).toBeNull();
    // `ı` (bez kropki) to inna litera także dla bazy.
    expect(avatarFor("ızmir@example.test", rows)).toBeNull();
  });

  it("lead z ASCII dostaje członka z IDENTYCZNYM adresem, nie `İ` z mniejszym id", () => {
    // Liść `ilike` leada `IZMIR@` zwraca na PG16 oba wiersze, `İzmir@` pierwszy.
    const rows = [
      profile({ contact_email: "İzmir@firma.test", avatar_url: "https://cdn.test/23.png" }),
      profile({ contact_email: "IZMIR@firma.test", avatar_url: "https://cdn.test/30.png" }),
    ];
    expect(avatarFor("IZMIR@firma.test", rows)).toBe("https://cdn.test/30.png");
    expect(avatarFor("izmir@firma.test", rows)).toBe("https://cdn.test/30.png");
    // Lead `İzmir@` - nadal członek z `İzmir@`, w obu postaciach klucza.
    expect(avatarFor("İzmir@firma.test", rows)).toBe("https://cdn.test/23.png");
    expect(avatarFor("İzmir@firma.test", rows, "izmir@firma.test")).toBe("https://cdn.test/23.png");
  });

  it("wiersz przypisuje się wyłącznie przez `lower()` bazy, nie przez JS `toLowerCase`", () => {
    // JS: `toLowerCase('ΟΔΟΣ@')` = `οδος@` - ten sam napis co lead z `ς`.
    // Baza: `lower('ΟΔΟΣ@')` = `οδοσ@` - liść leada `οδος@` go NIE zwraca,
    // więc wiersz przyniesiony liściem innego leada nie może dać zdjęcia.
    const rows = [
      profile({ contact_email: "ΟΔΟΣ@example.test", avatar_url: "https://cdn.test/g.png" }),
    ];
    expect(avatarFor("οδος@example.test", rows)).toBeNull();
    expect(avatarFor("οδοσ@example.test", rows)).toBe("https://cdn.test/g.png");
    expect(avatarFor("ΟΔΟΣ@example.test", rows)).toBe("https://cdn.test/g.png");
  });

  it("z kilku pasujących wierszy porcji wygrywa pierwszy (najmniejsze id), z dowolnej postaci", () => {
    const keys = avatarLookupKeys([lead("l1", "İzmir@example.test")]);
    const rows = [
      // Pasuje do klucza `i̇zmir@` (I + U+0307 -> i + U+0307).
      profile({ contact_email: "I\u0307zmir@example.test", avatar_url: "https://cdn.test/1.png" }),
      // Pasuje do postaci zapisanej.
      profile({ contact_email: "İZMIR@example.test", avatar_url: "https://cdn.test/2.png" }),
    ];
    expect(matchChunkAvatars(keys, [], rows).get(keys[0]?.id ?? "")).toBe("https://cdn.test/1.png");
    expect(matchChunkAvatars(keys, [], [...rows].reverse()).get(keys[0]?.id ?? "")).toBe(
      "https://cdn.test/2.png",
    );
  });
});

describe("chunked", () => {
  it("dzieli na porcje zadanej wielkości, ostatnia może być krótsza", () => {
    expect(chunked([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunked([], 100)).toEqual([]);
  });
});
