// Odczyt opublikowanych materiałów prelegentów (`event_speaker_materials_public`).
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW:
//   * przemianowany argument RPC (`p_event_id`) przechodzi `tsc` luźnym obiektem
//     i kończy się pustą listą - organizator publikuje, a strona nic nie pokazuje;
//   * klucz bez widza oddałby po zalogowaniu migawkę gościa (bez materiałów
//     „dla zapisanych") przez cały czas świeżości zapytania;
//   * nieznany rodzaj materiału z bazy zamieniłby etykietę w pusty napis.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";

const h = vi.hoisted(() => ({ rpc: null as SupabaseRpcStub | null }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: brak atrapy RPC");
      return h.rpc.rpc(name, args);
    },
  },
}));

const mod = await import("@/lib/events/speakerMaterialsPublic");

function stub(): SupabaseRpcStub {
  if (h.rpc === null) throw new Error("test");
  return h.rpc;
}

const ROW = {
  id: "m1",
  speaker_profile_id: "sp1",
  session_id: "ses1",
  kind: "slides",
  title_pl: "Slajdy",
  title_en: "Slides",
  url: "https://example.org/s.pdf",
  visibility: "public",
};

beforeEach(() => {
  h.rpc = supabaseRpcStub();
});

describe("materiały prelegentów na stronie wydarzenia", () => {
  it("woła RPC po identyfikatorze wydarzenia i mapuje wiersze na model ekranu", async () => {
    stub().setData("event_speaker_materials_public", [
      ROW,
      { ...ROW, id: "m2", kind: "podcast", visibility: "registered", session_id: null },
    ]);
    const rows = await mod.fetchPublicSpeakerMaterials("e1");
    expect(stub().lastCall("event_speaker_materials_public")?.arg("p_event_id")).toBe("e1");
    expect(rows).toEqual([
      {
        id: "m1",
        speakerProfileId: "sp1",
        sessionId: "ses1",
        kind: "slides",
        titlePl: "Slajdy",
        titleEn: "Slides",
        url: "https://example.org/s.pdf",
        registeredOnly: false,
      },
      expect.objectContaining({ id: "m2", kind: "link", sessionId: null, registeredOnly: true }),
    ]);
  });

  it("brak danych = pusta lista; puste tytuły nie są `null`", () => {
    expect(mod.parsePublicSpeakerMaterials(null)).toEqual([]);
    // Baza potrafi oddać NULL w kolumnie, którą generator typów opisuje jako napis.
    const withNulls: Parameters<typeof mod.parsePublicSpeakerMaterials>[0] = JSON.parse(
      JSON.stringify([{ ...ROW, title_pl: null, title_en: null }]),
    );
    const [row] = mod.parsePublicSpeakerMaterials(withNulls);
    expect(row).toMatchObject({ titlePl: "", titleEn: "" });
  });

  it("odmowa bazy wychodzi jako `Error` z treścią komunikatu", async () => {
    stub().setError("event_speaker_materials_public", "boom: nope");
    await expect(mod.fetchPublicSpeakerMaterials("e1")).rejects.toThrow("boom: nope");
  });

  it("klucz niesie widza: gość i zalogowany mają osobne wpisy, oba pod korzeniem wydarzenia", () => {
    const guest = mod.publicSpeakerMaterialsQueryOptions("e1", null);
    const member = mod.publicSpeakerMaterialsQueryOptions("e1", "u1");
    expect(guest.queryKey).toEqual(["event-speaker-materials", "e1", "anon"]);
    expect(member.queryKey).toEqual(["event-speaker-materials", "e1", "u1"]);
    expect(guest.queryKey.slice(0, 2)).toEqual([...mod.speakerMaterialsKeys.event("e1")]);
    expect(mod.speakerMaterialsKeys.all).toEqual(["event-speaker-materials"]);
    expect(guest.staleTime).toBe(60_000);
  });

  it("zapytanie z opcji woła odczyt wydarzenia", async () => {
    stub().setData("event_speaker_materials_public", [ROW]);
    const options = mod.publicSpeakerMaterialsQueryOptions("e9", null);
    const queryFn = options.queryFn as () => Promise<unknown>;
    await expect(queryFn()).resolves.toHaveLength(1);
    expect(stub().lastCall("event_speaker_materials_public")?.arg("p_event_id")).toBe("e9");
  });
});
