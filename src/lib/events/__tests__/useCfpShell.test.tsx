// Nabór prelegentów w CHROME'IE strony wydarzenia: odczyt fazy dla paska
// zakładek i leniwy panel prelegenta dla zakładki „Moje".
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW - pilnowane niżej:
// (1) pozycja „Nabór prelegentów" pojawia się przy fazie innej niż `open`
//     (zaplanowany albo zamknięty nabór zaprasza do zgłoszeń);
// (2) odmowa bazy albo brak wydarzenia rysuje pozycję zamiast ją ukryć;
// (3) zapytanie o fazę startuje przed montażem albo bez sluga (SSR przestaje
//     być równy pierwszemu renderowi, a gość bez strony pyta bazę o nic);
// (4) klucz fazy wypada spod gałęzi sluga - unieważnienie strony naboru nie
//     odświeża paska;
// (5) panel prelegenta dostaje inny klucz niż strona panelu (dwa odczyty tego
//     samego) albo startuje bez sesji.
import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";
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

const pub = vi.hoisted(() => ({ fetchSpeakerPanel: vi.fn() }));
vi.mock("@/lib/events/cfpPublicApi", () => pub);

const { fetchCfpTabOpen } = await import("@/lib/events/cfpShellApi");
const shell = await import("@/lib/events/useCfpShell");
const me = await import("@/lib/events/useCfpMe");

function stub(): SupabaseRpcStub {
  if (h.rpc === null) throw new Error("test: brak atrapy RPC");
  return h.rpc;
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
  pub.fetchSpeakerPanel.mockReset();
});

describe("fetchCfpTabOpen", () => {
  it("prawda wyłącznie przy fazie `open`, slug idzie do RPC", async () => {
    stub().setData("event_cfp_public", { phase: "open", is_open: true });
    await expect(fetchCfpTabOpen("kongres")).resolves.toBe(true);
    expect(stub().lastCall("event_cfp_public")?.arg("p_slug")).toBe("kongres");
  });

  it.each([
    ["zaplanowany", { phase: "scheduled" }],
    ["zamknięty", { phase: "closed" }],
    ["nieskonfigurowany", { phase: "none", is_open: false }],
    ["brak wydarzenia", null],
    ["tablica zamiast obiektu", [{ phase: "open" }]],
    ["goły napis", "open"],
  ])("%s = brak pozycji", async (_label, data) => {
    stub().setData("event_cfp_public", data);
    await expect(fetchCfpTabOpen("kongres")).resolves.toBe(false);
  });

  it("odmowa bazy leci wyjątkiem z komunikatem bazy", async () => {
    stub().setError("event_cfp_public", "rate_limited: slow down");
    await expect(fetchCfpTabOpen("kongres")).rejects.toThrow("rate_limited: slow down");
  });
});

describe("klucze", () => {
  it("faza paska stoi pod gałęzią sluga strony naboru", () => {
    const branch = shell.cfpPublicKeys.slug("kongres");
    const tab = shell.cfpPublicKeys.tabOpen("kongres");
    expect(tab).toEqual(["event-cfp-public", "kongres", "tab-open"]);
    expect(tab.slice(0, branch.length)).toEqual(branch);
    expect(shell.cfpPublicKeys.tabOpen("inne")).not.toEqual(tab);
  });

  it("`useCfpMe` re-eksportuje TE SAME fabryki i hook panelu", () => {
    expect(me.cfpPublicKeys).toBe(shell.cfpPublicKeys);
    expect(me.cfpMeKeys).toBe(shell.cfpMeKeys);
    expect(me.useSpeakerPanel).toBe(shell.useSpeakerPanel);
  });
});

describe("useCfpTabOpen", () => {
  it("przed montażem i bez sluga nie pyta bazy", async () => {
    const off = renderHookWithQueryClient(() => shell.useCfpTabOpen("kongres", false));
    const blank = renderHookWithQueryClient(() => shell.useCfpTabOpen("", true));
    expect(off.result.current).toBe(false);
    expect(blank.result.current).toBe(false);
    expect(stub().callsFor("event_cfp_public")).toHaveLength(0);
  });

  it("otwarty nabór po montażu = prawda pod kluczem fazy", async () => {
    stub().setData("event_cfp_public", { phase: "open" });
    const { result, queryClient } = renderHookWithQueryClient(() =>
      shell.useCfpTabOpen("kongres", true),
    );
    await waitFor(() => expect(result.current).toBe(true));
    expect(queryClient.getQueryData(shell.cfpPublicKeys.tabOpen("kongres"))).toBe(true);
    expect(queryClient.getQueryData(shell.cfpPublicKeys.slug("kongres"))).toBeUndefined();
  });

  it("błąd odczytu = brak pozycji", async () => {
    stub().setError("event_cfp_public", "boom");
    const { result, queryClient } = renderHookWithQueryClient(() =>
      shell.useCfpTabOpen("kongres", true),
    );
    await waitFor(() =>
      expect(queryClient.getQueryState(shell.cfpPublicKeys.tabOpen("kongres"))?.status).toBe(
        "error",
      ),
    );
    expect(result.current).toBe(false);
  });
});

describe("useSpeakerPanel", () => {
  it("bez sesji i bez sluga nie ładuje fetchera", async () => {
    renderHookWithQueryClient(() => shell.useSpeakerPanel("kongres", false));
    renderHookWithQueryClient(() => shell.useSpeakerPanel("", true));
    await Promise.resolve();
    expect(pub.fetchSpeakerPanel).not.toHaveBeenCalled();
  });

  it("z sesją dociąga fetcher i zapisuje panel pod kluczem strony panelu", async () => {
    const panel = { eventId: "e1", isReviewer: true };
    pub.fetchSpeakerPanel.mockResolvedValue(panel);
    const { result, queryClient } = renderHookWithQueryClient(() =>
      shell.useSpeakerPanel("kongres", true),
    );
    await waitFor(() => expect(result.current.data).toEqual(panel));
    expect(pub.fetchSpeakerPanel).toHaveBeenCalledWith("kongres");
    expect(queryClient.getQueryData(shell.cfpMeKeys.panel("kongres"))).toEqual(panel);
    expect(queryClient.getQueryData(shell.cfpMeKeys.panel("inne"))).toBeUndefined();
  });
});
