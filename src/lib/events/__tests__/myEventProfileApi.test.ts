// Parsowanie odpowiedzi panelu uczestnika - kontrakt z RPC, bez sieci.
import { describe, expect, it, vi, beforeEach } from "vitest";

// `vi.mock` jest hoistowane ponad importy - stan mocka musi żyć w `vi.hoisted`.
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import {
  fetchMyAgenda,
  fetchMyEventProfile,
  linkMyEventAccount,
  myEventProfileErrorKey,
  sameEmail,
  saveMyEventProfile,
} from "@/lib/events/myEventProfileApi";
import i18n from "@/lib/i18n";
import { ensureI18n } from "@/lib/i18n-cart";

beforeEach(() => {
  rpc.mockReset();
});

describe("fetchMyEventProfile", () => {
  it("mapuje profil i stan zgłoszenia", async () => {
    rpc.mockResolvedValue({
      data: {
        profile: {
          person_id: "p1",
          first_name: "Ada",
          last_name: "",
          job_title: "Analityk",
          company_id: "c1",
          bio_pl: "Nota",
        },
        registration: { registration_id: "r1", status: "confirmed", notify_email: true },
      },
      error: null,
    });

    const state = await fetchMyEventProfile("summit");

    expect(state.profile?.personId).toBe("p1");
    expect(state.profile?.firstName).toBe("Ada");
    expect(state.profile?.companyId).toBe("c1");
    // Milczenie w bazie = kontakt prywatny.
    expect(state.profile?.emailVisible).toBe(false);
    expect(state.profile?.socialLinks).toEqual({});
    // Pusty napis z bazy to brak danych, nie wartość do wyświetlenia.
    expect(state.profile?.lastName).toBeNull();
    expect(state.registration?.status).toBe("confirmed");
    expect(state.registration?.notifySms).toBe(false);
  });

  it("oddaje puste wartości, gdy uczestnik nie ma kartoteki", async () => {
    rpc.mockResolvedValue({ data: { profile: null, registration: null }, error: null });
    await expect(fetchMyEventProfile("summit")).resolves.toEqual({
      profile: null,
      account: null,
      registration: null,
    });
  });

  it("przenosi błąd RPC do wołającego", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("auth_required") });
    await expect(fetchMyEventProfile("summit")).rejects.toThrow("auth_required");
  });
});

describe("saveMyEventProfile", () => {
  it("przenosi przełączniki widoczności i linki social bez zmiany kształtu", async () => {
    rpc.mockResolvedValue({ data: { profile: null, registration: null }, error: null });
    await saveMyEventProfile({
      slug: "summit",
      email_visible: true,
      phone_visible: false,
      social_links: { linkedin: "https://linkedin.com/in/ada" },
    });
    expect(rpc).toHaveBeenCalledWith("event_my_event_profile_set", {
      p_payload: {
        slug: "summit",
        email_visible: true,
        phone_visible: false,
        social_links: { linkedin: "https://linkedin.com/in/ada" },
      },
    });
  });

  it("wysyła płaski słownik napisów razem ze slugiem", async () => {
    rpc.mockResolvedValue({ data: { profile: null, registration: null }, error: null });
    await saveMyEventProfile({ slug: "summit", job_title: "Dyrektor", phone: "" });
    expect(rpc).toHaveBeenCalledWith("event_my_event_profile_set", {
      p_payload: { slug: "summit", job_title: "Dyrektor", phone: "" },
    });
  });

  it("przenosi identyfikator wybranej organizacji", async () => {
    rpc.mockResolvedValue({ data: { profile: null, registration: null }, error: null });
    await saveMyEventProfile({ slug: "summit", company_id: "c1", company_text: "Alfa" });
    expect(rpc).toHaveBeenCalledWith("event_my_event_profile_set", {
      p_payload: { slug: "summit", company_id: "c1", company_text: "Alfa" },
    });
  });

  it("przenosi zgodę na zapis wstecz do profilu platformy", async () => {
    rpc.mockResolvedValue({ data: { profile: null, registration: null }, error: null });
    await saveMyEventProfile({ slug: "summit", job_title: "Dyrektor", push_account: true });
    expect(rpc).toHaveBeenCalledWith("event_my_event_profile_set", {
      p_payload: { slug: "summit", job_title: "Dyrektor", push_account: true },
    });
  });
});

describe("fetchMyAgenda", () => {
  it("pomija wpisy bez identyfikatora sesji", async () => {
    rpc.mockResolvedValue({
      data: {
        sessions: [
          { session_id: "s1", title_pl: "Panel", starts_at: "2026-09-01T08:00:00Z" },
          { title_pl: "Bez id" },
        ],
      },
      error: null,
    });
    const rows = await fetchMyAgenda("summit");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sessionId).toBe("s1");
    expect(rows[0]?.roomNamePl).toBeNull();
  });

  it("zwraca pustą listę, gdy RPC nie ma sesji", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    await expect(fetchMyAgenda("summit")).resolves.toEqual([]);
  });
});

// ADRES KARTOTEKI = POTWIERDZONY ADRES KONTA (REG-01, 20261012132000). Baza
// odmawia zmiany adresu trzema kodami; kazdy ma trafic w zdanie formularza
// profilu w OBU jezykach, a inne odmowy zostaja przy zdaniu ogolnym.
describe("myEventProfileErrorKey", () => {
  // Zasob czytany WPROST z bundla jezyka - `i18n.exists()` ma fallback na
  // polski i odpowiedzialby „tak" za brakujace zdanie angielskie.
  function maTekst(lng: "pl" | "en", klucz: string): boolean {
    ensureI18n();
    const wartosc: unknown = i18n.getResource(lng, "translation", klucz);
    return typeof wartosc === "string" && wartosc.trim() !== "";
  }

  it.each([
    [
      "email_unverified: only the confirmed e-mail of your account can be used here",
      "eventMe.errors.emailUnverified",
    ],
    ["email_in_use: this e-mail belongs to another event profile", "eventMe.errors.emailInUse"],
    ["email_required: the event profile keeps a contact e-mail", "eventMe.errors.emailRequired"],
  ])("%s -> %s (PL i EN)", (message, key) => {
    expect(myEventProfileErrorKey(new Error(message))).toBe(key);
    expect(myEventProfileErrorKey({ message })).toBe(key);
    expect(maTekst("pl", key), `brak PL: ${key}`).toBe(true);
    expect(maTekst("en", key), `brak EN: ${key}`).toBe(true);
  });

  it("inne odmowy i treść bez kodu zostają przy zdaniu ogólnym (`null`)", () => {
    expect(
      myEventProfileErrorKey(new Error("invalid_url: photo link must start with http(s)")),
    ).toBeNull();
    expect(myEventProfileErrorKey(new Error("Failed to fetch"))).toBeNull();
    expect(myEventProfileErrorKey(null)).toBeNull();
  });
});

describe("sameEmail", () => {
  it("porównuje adresy jak `email_norm` (wielkość liter i spacje bez znaczenia)", () => {
    expect(sameEmail(" Ada@Example.COM ", "ada@example.com")).toBe(true);
    expect(sameEmail(null, "")).toBe(true);
    expect(sameEmail("ada@example.com", "ada2@example.com")).toBe(false);
  });
});

// SAMODZIELNE DOWIAZANIE (REG-01, D14): ladunek pusty - konto z sesji, najemca
// z hosta. Brak funkcji w bazie (wdrozenie „najpierw kod") to `null`.
describe("linkMyEventAccount", () => {
  it("woła `event_my_account_link` z pustym ładunkiem i czyta wynik", async () => {
    rpc.mockResolvedValue({
      data: { ok: true, linked: true, already_linked: false, person_id: "p1" },
      error: null,
    });

    await expect(linkMyEventAccount()).resolves.toEqual({
      linked: true,
      alreadyLinked: false,
      personId: "p1",
      reason: null,
    });
    expect(rpc).toHaveBeenCalledWith("event_my_account_link", { p_payload: {} });
  });

  it("brak dowiązania niesie powód; nieznany powód nie udaje znanego", async () => {
    rpc.mockResolvedValue({
      data: { ok: true, linked: false, reason: "email_unconfirmed" },
      error: null,
    });
    await expect(linkMyEventAccount()).resolves.toMatchObject({
      linked: false,
      reason: "email_unconfirmed",
    });

    rpc.mockResolvedValue({ data: { ok: true, linked: false, reason: "cos_innego" }, error: null });
    await expect(linkMyEventAccount()).resolves.toMatchObject({ linked: false, reason: null });
  });

  it.each(["PGRST202", "42883"])("brak funkcji w bazie (%s) to `null`", async (code) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: "function does not exist" } });
    await expect(linkMyEventAccount()).resolves.toBeNull();
  });

  it("inny błąd bazy leci dalej", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("auth_required: sign in") });
    await expect(linkMyEventAccount()).rejects.toThrow("auth_required");
  });
});
