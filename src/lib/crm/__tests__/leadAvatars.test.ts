// Reguła dopasowania lead -> zdjęcie profilowe członka (lib/crm/leadAvatars.ts).
// Sieć i granica najemcy mają test w crmFunctions.test.ts (getCrmLeadAvatars).
// Dane wyłącznie syntetyczne (domena example.test).
import { describe, expect, it } from "vitest";
import {
  chunked,
  emailLookupValues,
  matchLeadAvatars,
  normalizeEmail,
  type LeadEmailRow,
  type ProfileAvatarRow,
} from "../leadAvatars";

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

describe("emailLookupValues", () => {
  it("jeden adres w wielu leadach pyta bazę raz", () => {
    const values = emailLookupValues([
      lead("l1", "anna@example.test"),
      lead("l2", "anna@example.test"),
      lead("l3", "bartek@example.test"),
    ]);
    expect(values).toEqual(["anna@example.test", "bartek@example.test"]);
  });

  it("obok postaci znormalizowanej niesie adres w zapisanej postaci (dla contact_email)", () => {
    // `.in()` porównuje dokładnie; kontakt wpisany przez członka tą samą
    // wielkością liter co formularz leada też ma trafić.
    expect(emailLookupValues([lead("l1", " Anna@Example.test ")])).toEqual([
      "anna@example.test",
      "Anna@Example.test",
    ]);
  });

  it("lead bez adresu nie dokłada pustej wartości do filtra", () => {
    expect(emailLookupValues([lead("l1", "", "")])).toEqual([]);
  });

  it("klucz bierze z email_norm, gdy baza go podaje", () => {
    expect(emailLookupValues([lead("l1", "anna@example.test", "ANNA@example.test")])).toEqual([
      "anna@example.test",
    ]);
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
