// Zgloszenie klubu i edycja danych klubu - warstwa danych.
//
// Test pilnuje trzech rzeczy, ktore latwo cicho zepsuc: ze wolamy WLASCIWE RPC
// (a nie admin-only `admin_club_upsert`), ze limit dobowy dostaje wlasny kod
// bledu, i ze `false` z bazy nie udaje zapisu.
import { describe, expect, it, vi, beforeEach } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import { fetchMyClubProposals, proposeClub, updateClubSettings } from "@/lib/clubs/api";
import { toClubSaveError } from "@/lib/clubs/types";
import { clubKeys } from "@/lib/clubs/queryKeys";

beforeEach(() => {
  rpc.mockReset();
});

describe("proposeClub", () => {
  it("wola club_propose i zwraca szkic", async () => {
    rpc.mockResolvedValue({ data: { id: "c1", slug: "nowy-klub", status: "draft" }, error: null });
    const result = await proposeClub({ name_pl: "Nowy klub" });
    expect(rpc).toHaveBeenCalledWith("club_propose", { p: { name_pl: "Nowy klub" } });
    expect(result).toEqual({ id: "c1", slug: "nowy-klub", status: "draft" });
  });

  it("nieznany status wraca do draft, bo publikuje wylacznie administracja", async () => {
    rpc.mockResolvedValue({ data: { id: "c1", slug: "s", status: "published" }, error: null });
    await expect(proposeClub({ name_pl: "X" })).resolves.toMatchObject({ status: "draft" });
  });

  it("brak wiersza to blad, nie cichy sukces", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(proposeClub({ name_pl: "X" })).rejects.toThrow(/no row/);
  });

  it("blad RPC leci dalej", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("clubs: proposal quota exceeded") });
    await expect(proposeClub({ name_pl: "X" })).rejects.toThrow(/quota/);
  });
});

describe("fetchMyClubProposals", () => {
  it("zwraca liste, a pusta odpowiedz to pusta tablica", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(fetchMyClubProposals()).resolves.toEqual([]);
    expect(rpc).toHaveBeenCalledWith("club_my_proposals");
  });
});

describe("updateClubSettings", () => {
  it("wola club_update_settings z id klubu i lata", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await expect(updateClubSettings({ clubId: "c1", patch: { name_pl: "Nazwa" } })).resolves.toBe(
      true,
    );
    expect(rpc).toHaveBeenCalledWith("club_update_settings", {
      p_club_id: "c1",
      p: { name_pl: "Nazwa" },
    });
  });

  it("brak zmian zwraca false, a nie true", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    await expect(updateClubSettings({ clubId: "c1", patch: {} })).resolves.toBe(false);
  });
});

describe("toClubSaveError", () => {
  it("limit zgloszen ma wlasny kod", () => {
    expect(toClubSaveError(new Error("clubs: proposal quota exceeded"))).toBe("quota");
  });
});

describe("clubKeys.myProposals", () => {
  it("stoi poza galezia konkretnego klubu", () => {
    expect(clubKeys.myProposals()).toEqual(["clubs", "myProposals"]);
  });
});
