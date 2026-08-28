// Parsowanie odpowiedzi panelu uczestnika - kontrakt z RPC, bez sieci.
import { describe, expect, it, vi, beforeEach } from "vitest";

// `vi.mock` jest hoistowane ponad importy - stan mocka musi żyć w `vi.hoisted`.
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import {
  fetchMyAgenda,
  fetchMyEventProfile,
  saveMyEventProfile,
} from "@/lib/events/myEventProfileApi";

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
