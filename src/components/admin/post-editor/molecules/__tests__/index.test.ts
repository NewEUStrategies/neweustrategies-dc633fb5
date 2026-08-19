// Barrel molekuł edytora wpisu (`molecules/index.ts`).
//
// CO TU DOWODZIMY: że publiczna powierzchnia katalogu jest DOKŁADNIE tą listą
// kart, których używają organizmy - ani mniej (brak eksportu psuje budowę
// edytora), ani więcej (wyciek szczegółu implementacyjnego zamienia go w API,
// którego nikt nie zamierzał utrzymywać).
//
// DLACZEGO TO WAŻNE: `OrganizationPickerDialog` jest ŚWIADOMIE trzymany poza
// barrelem - to wnętrze `PostOrganizationPicker`, a sąsiad importuje go wprost.
// Bez testu ta decyzja żyje wyłącznie w komentarzu i pierwszy „porządkujący"
// commit dopisze go do listy. Test jest też zaporą na cichy rozjazd nazw: barrel
// z literówką w nazwie eksportu kompiluje się, a pada dopiero przy renderze
// edytora.
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", async () =>
  (await import("@/test/post-editor/fixtures")).reactI18nextStub(),
);
vi.mock("@/lib/i18n-admin-post-panes", () => ({}));
vi.mock("@/lib/i18n-admin-tts", () => ({}));
vi.mock("@/lib/i18n-admin-zero-click", () => ({}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  return { supabase: { from: from.from, rpc: vi.fn(async () => ({ data: null, error: null })) } };
});

// Barrel wciąga karty, które w łańcuchu importów sięgają po funkcje serwerowe
// (`createServerFn`) i middleware autoryzacji (`createMiddleware`). Tu nic ich
// nie WOŁA - potrzebny jest wyłącznie łańcuch, który da się zbudować przy
// wczytaniu modułu.
vi.mock("@tanstack/react-start", () => {
  const chain: Record<string, unknown> = {};
  for (const link of ["server", "client", "middleware", "validator", "handler", "type"]) {
    chain[link] = () => chain;
  }
  return {
    useServerFn: (fn: unknown) => fn,
    createServerFn: () => chain,
    createMiddleware: () => chain,
  };
});

vi.mock("sonner", async () => {
  const { toastStub } = await import("@/test/post-editor/fixtures");
  return { toast: toastStub(), Toaster: () => null };
});

import * as molecules from "../index";

/** Karty, po które organizmy edytora przychodzą do tego katalogu. */
const OCZEKIWANE_EKSPORTY = [
  "BilingualPickerCard",
  "CategoriesCard",
  "ChangelogCard",
  "EditorModeToggle",
  "LayoutOverridesCard",
  "PostAuthorsCard",
  "PostOrganizationPicker",
  "PostSponsoredCard",
  "PreviewLinksCard",
  "PublishChecklistCard",
  "SeriesCard",
  "StepIndicator",
  "TagsCard",
  "TranslateCard",
  "TtsVoiceCard",
  "WorkflowStatusSection",
  "ZeroClickCheatSheet",
  "ZeroClickChecklist",
] as const;

describe("barrel molekuł edytora wpisu", () => {
  it("wystawia DOKŁADNIE zaplanowany zestaw kart", () => {
    expect(Object.keys(molecules).sort()).toEqual([...OCZEKIWANE_EKSPORTY]);
  });

  it("każdy eksport jest komponentem do wyrenderowania (funkcją), nie obiektem", () => {
    for (const name of OCZEKIWANE_EKSPORTY) {
      expect(typeof molecules[name]).toBe("function");
    }
  });

  it("dialog wyboru organizacji NIE jest częścią publicznej powierzchni katalogu", () => {
    // To szczegół implementacyjny PostOrganizationPicker - sąsiad importuje go
    // wprost, a barrel wystawia tylko to, czego używają organizmy.
    expect("OrganizationPickerDialog" in molecules).toBe(false);
  });
});
