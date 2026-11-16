// Reguła dopasowania lead -> zdjęcie profilowe członka (lib/crm/leadAvatars.ts).
// Sieć i granica najemcy mają test w crmFunctions.test.ts (getCrmLeadAvatars).
// Dane wyłącznie syntetyczne (domena example.test).
import { describe, expect, it } from "vitest";
import {
  avatarLookupChunks,
  avatarLookupKeyCost,
  avatarLookupKeys,
  chunked,
  matchLeadAvatars,
  normalizeEmail,
  type LeadEmailRow,
  type ProfileAvatarRow,
} from "../leadAvatars";
import { decodeOrParam } from "@/test/supabase/postgrestGrammar";
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

/** Filtr `contact_email` porcji tak, jak składa go `lookupLeadAvatars`. */
const contactFilter = (keys: ReturnType<typeof avatarLookupKeys>) =>
  keys
    .map((k) =>
      k.ilike !== undefined ? `contact_email.ilike.${k.ilike}` : `contact_email.in.(${k.exact})`,
    )
    .join(",");

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

  it("adres z `*`: wyłącznie dokładne `in` na postaci znormalizowanej i zapisanej, bez `ilike`", () => {
    const keys = avatarLookupKeys([lead("l1", "A*b@Example.test"), lead("l2", "a*B@example.test")]);
    expect(keys).toHaveLength(1);
    expect(keys[0]?.ilike).toBeUndefined();
    expect(decodeOrParam(`(${contactFilter(keys)})`)).toEqual([
      {
        column: "contact_email",
        negated: false,
        op: "in",
        values: ["a*b@example.test", "A*b@Example.test", "a*B@example.test"],
      },
    ]);
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

  it("klucz droższy niż limit dostaje porcję dla siebie, nie znika", () => {
    const keys = keysFor(3);
    const parts = avatarLookupChunks(keys, { maxItems: 100, maxEncodedLength: 1 });
    expect(parts).toEqual([[keys[0]], [keys[1]], [keys[2]]]);
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

describe("chunked", () => {
  it("dzieli na porcje zadanej wielkości, ostatnia może być krótsza", () => {
    expect(chunked([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunked([], 100)).toEqual([]);
  });
});
