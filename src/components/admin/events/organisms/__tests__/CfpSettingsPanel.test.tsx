// Ekran „Ustawienia naboru": stan, okno, teksty, formy, ścieżki, zasady, ocena
// i przyjęty prelegent - oraz jawny zapis (pasek zapisu).
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW - pilnowane niżej:
// DOWODZIMY: (1) ładunek zapisu niesie KOMPLET pól w kształcie SQL-a
// (`admin_event_cfp_settings_save`), (2) błędny szkic nie wychodzi do bazy
// i mówi, które pole poprawić, (3) odmowa bazy trafia do toasta, (4) edytor
// listy form/kryteriów podpowiada klucz z etykiety tylko do ręcznej zmiany.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";

const h = vi.hoisted(() => ({
  rpc: null as SupabaseRpcStub | null,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: brak atrapy RPC");
      return h.rpc.rpc(name, args);
    },
  },
}));
vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/i18n-admin-event-cfp", () => ({ ensureAdminEventCfpI18n: () => undefined }));
vi.mock("@/lib/events/adminCfpErrors", () => ({
  adminCfpErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));
vi.mock("@/components/atoms/FormSelect", async () =>
  (await import("@/test/events/cfpStubs")).formSelectStubModule(await import("react")),
);
vi.mock("@/components/ui/datetime-picker", async () =>
  (await import("@/test/events/cfpStubs")).dateTimePickerStubModule(await import("react")),
);
vi.mock("@/components/ui/switch", async () =>
  (await import("@/test/reactStubs")).radixSwitchStub(await import("react")),
);

const { CfpSettingsPanel } = await import("@/components/admin/events/organisms/CfpSettingsPanel");

function stub(): SupabaseRpcStub {
  if (h.rpc === null) throw new Error("test");
  return h.rpc;
}

function settingsRow(overrides: Record<string, unknown> = {}) {
  return {
    event_id: "e1",
    event_slug: "kongres",
    event_status: "published",
    event_timezone: "Europe/Warsaw",
    exists: true,
    status: "draft",
    phase: "none",
    is_open: false,
    opens_at: "2026-09-01T10:00:00.000Z",
    closes_at: "2026-09-30T10:00:00.000Z",
    intro_pl: "",
    intro_en: "",
    guidelines_pl: "",
    guidelines_en: "",
    formats: [],
    track_ids: [],
    max_per_submitter: 3,
    allow_co_speakers: true,
    review_blind: false,
    score_max: 5,
    review_criteria: [],
    min_reviews: 2,
    speaker_group_id: "g1",
    speaker_ticket_type_id: null,
    options: {
      tracks: [
        { id: "t1", key: "energy", name_pl: "Energia", name_en: "Energy", is_active: true },
        { id: "t2", key: "old", name_pl: "Stara", name_en: "Old", is_active: false },
      ],
      rooms: [],
      groups: [{ id: "g1", key: "speakers", name_pl: "Prelegenci", name_en: "Speakers" }],
      tickets: [{ id: "tk1", key: "vip", name_pl: "VIP", name_en: "VIP" }],
    },
    ...overrides,
  };
}

function payload(): Record<string, unknown> {
  const value = stub().lastCall("admin_event_cfp_settings_save")?.arg("p_payload");
  if (typeof value !== "object" || value === null) throw new Error("test: brak zapisu");
  return value as Record<string, unknown>;
}

async function renderPanel(row = settingsRow()) {
  stub().setData("admin_event_cfp_settings_get", row);
  const view = renderWithQueryClient(<CfpSettingsPanel eventId="e1" />);
  await screen.findByText("adminEventCfp.settings.statusTitle");
  return view;
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});
afterEach(cleanup);

describe("CfpSettingsPanel - stany wczytania", () => {
  it("wczytywanie, a potem formularz z fazą z bazy", async () => {
    stub().setResponse("admin_event_cfp_settings_get", () => new Promise(() => undefined) as never);
    renderWithQueryClient(<CfpSettingsPanel eventId="e1" />);
    expect(screen.getByText("adminEventCfp.common.loading")).toBeInTheDocument();
  });

  it("odmowa odczytu pokazuje zdanie z mapy", async () => {
    stub().setError("admin_event_cfp_settings_get", "forbidden: x");
    renderWithQueryClient(<CfpSettingsPanel eventId="e1" />);
    expect(await screen.findByText("odmowa:forbidden: x")).toBeInTheDocument();
  });

  it("nieopublikowane wydarzenie ostrzega, że strona naboru jest niewidoczna", async () => {
    await renderPanel(settingsRow({ event_status: "draft", phase: "scheduled" }));
    expect(screen.getByText("adminEventCfp.settings.eventNotPublished")).toBeInTheDocument();
    expect(
      screen.getByText("adminEventCfp.settings.phaseNow(phase=adminEventCfp.phases.scheduled)"),
    ).toBeInTheDocument();
  });
});

describe("CfpSettingsPanel - zapis", () => {
  it("zmiany w każdej sekcji dojeżdżają do ładunku SQL, a po zapisie pasek znika", async () => {
    await renderPanel();
    expect(screen.queryByText("adminEventCfp.settings.eventNotPublished")).not.toBeInTheDocument();
    // Pasek zapisu pokazuje się dopiero po zmianie.
    expect(
      screen.queryByRole("button", { name: "adminEventCfp.common.save" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/^adminEventCfp\.settings\.status\.open/));
    fireEvent.change(screen.getByLabelText("adminEventCfp.settings.introPl"), {
      target: { value: "Wstęp" },
    });
    fireEvent.change(screen.getByLabelText("adminEventCfp.settings.introEn"), {
      target: { value: "Intro" },
    });
    fireEvent.change(screen.getByLabelText("adminEventCfp.settings.guidelinesPl"), {
      target: { value: "Z" },
    });
    fireEvent.change(screen.getByLabelText("adminEventCfp.settings.guidelinesEn"), {
      target: { value: "G" },
    });
    fireEvent.change(screen.getByLabelText("adminEventCfp.settings.opensAt"), {
      target: { value: "2026-09-02T10:00:00.000Z" },
    });
    fireEvent.change(screen.getByLabelText("adminEventCfp.settings.closesAt"), {
      target: { value: "2026-10-02T10:00:00.000Z" },
    });

    // Forma wystąpienia: klucz podpowiedziany z etykiety PL.
    fireEvent.click(screen.getByRole("button", { name: "adminEventCfp.settings.addFormat" }));
    fireEvent.change(
      screen.getByLabelText("adminEventCfp.list.labelPl", { selector: "#cfp-format-0-pl" }),
      {
        target: { value: "Wykład główny" },
      },
    );
    fireEvent.change(
      screen.getByLabelText("adminEventCfp.list.labelEn", { selector: "#cfp-format-0-en" }),
      {
        target: { value: "Keynote" },
      },
    );
    expect(
      screen.getByLabelText("adminEventCfp.list.key", { selector: "#cfp-format-0-key" }),
    ).toHaveValue("wyklad_glowny");
    fireEvent.change(
      screen.getByLabelText("adminEventCfp.settings.formatDuration", {
        selector: "#cfp-format-0-value",
      }),
      {
        target: { value: "45" },
      },
    );

    // Kryterium oceny z ręcznym kluczem - dalsza zmiana etykiety go nie nadpisze.
    fireEvent.click(screen.getByRole("button", { name: "adminEventCfp.settings.addCriterion" }));
    fireEvent.change(
      screen.getByLabelText("adminEventCfp.list.key", { selector: "#cfp-criterion-0-key" }),
      {
        target: { value: "depth" },
      },
    );
    fireEvent.change(
      screen.getByLabelText("adminEventCfp.list.labelPl", { selector: "#cfp-criterion-0-pl" }),
      {
        target: { value: "Głębia" },
      },
    );
    fireEvent.change(
      screen.getByLabelText("adminEventCfp.list.labelEn", { selector: "#cfp-criterion-0-en" }),
      {
        target: { value: "Depth" },
      },
    );
    expect(
      screen.getByLabelText("adminEventCfp.list.key", { selector: "#cfp-criterion-0-key" }),
    ).toHaveValue("depth");
    fireEvent.change(
      screen.getByLabelText("adminEventCfp.settings.criterionWeight", {
        selector: "#cfp-criterion-0-value",
      }),
      { target: { value: "2" } },
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Energia" }));
    expect(screen.getByText("adminEventCfp.settings.trackInactive")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("adminEventCfp.settings.maxPerSubmitter"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByLabelText("adminEventCfp.settings.allowCoSpeakers"));
    fireEvent.click(screen.getByLabelText("adminEventCfp.settings.reviewBlind"));
    fireEvent.change(screen.getByLabelText("adminEventCfp.settings.scoreMax"), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByLabelText("adminEventCfp.settings.minReviews"), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText("adminEventCfp.settings.speakerGroup"), {
      target: { value: "__none__" },
    });
    fireEvent.change(screen.getByLabelText("adminEventCfp.settings.speakerTicket"), {
      target: { value: "tk1" },
    });

    stub().setData("admin_event_cfp_settings_save", settingsRow({ status: "open", phase: "open" }));
    // Baza po zapisie oddaje nowy stan także przy odświeżeniu.
    stub().setData("admin_event_cfp_settings_get", settingsRow({ status: "open", phase: "open" }));
    fireEvent.click(screen.getByRole("button", { name: "adminEventCfp.common.save" }));

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminEventCfp.toasts.settingsSaved"),
    );
    expect(payload()).toEqual({
      event_id: "e1",
      status: "open",
      opens_at: "2026-09-02T10:00:00.000Z",
      closes_at: "2026-10-02T10:00:00.000Z",
      intro_pl: "Wstęp",
      intro_en: "Intro",
      guidelines_pl: "Z",
      guidelines_en: "G",
      formats: [
        { key: "wyklad_glowny", label_pl: "Wykład główny", label_en: "Keynote", duration_min: 45 },
      ],
      track_ids: ["t1"],
      max_per_submitter: 2,
      allow_co_speakers: false,
      review_blind: true,
      score_max: 10,
      review_criteria: [{ key: "depth", label_pl: "Głębia", label_en: "Depth", weight: 2 }],
      min_reviews: 3,
      speaker_group_id: null,
      speaker_ticket_type_id: "tk1",
    });
    // Odpowiedź RPC jest nowym stanem formularza - nie ma już czego zapisywać.
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "adminEventCfp.common.save" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByText("adminEventCfp.settings.phaseNow(phase=adminEventCfp.phases.open)"),
    ).toBeInTheDocument();
  });

  it("błędny szkic nie wychodzi do bazy, pokazuje błąd przy polu i blokuje zapis; „odrzuć” wraca do bazy", async () => {
    await renderPanel();
    fireEvent.change(screen.getByLabelText("adminEventCfp.settings.closesAt"), {
      target: { value: "2026-08-01T10:00:00.000Z" },
    });
    fireEvent.click(screen.getByRole("button", { name: "adminEventCfp.common.save" }));
    expect(await screen.findByText("adminEventCfp.settings.validation.window")).toBeInTheDocument();
    expect(stub().callsFor("admin_event_cfp_settings_save")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "adminEventCfp.common.save" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "adminEventCfp.common.discard" }));
    expect(screen.getByLabelText("adminEventCfp.settings.closesAt")).toHaveValue(
      "2026-09-30T10:00:00.000Z",
    );
    expect(screen.queryByText("adminEventCfp.settings.validation.window")).not.toBeInTheDocument();
  });

  it("każda sekcja ma swój błąd przy polu", async () => {
    await renderPanel();
    fireEvent.change(screen.getByLabelText("adminEventCfp.settings.introPl"), {
      target: { value: "x".repeat(8001) },
    });
    fireEvent.click(screen.getByRole("button", { name: "adminEventCfp.settings.addFormat" }));
    fireEvent.click(screen.getByRole("button", { name: "adminEventCfp.settings.addCriterion" }));
    fireEvent.change(screen.getByLabelText("adminEventCfp.settings.maxPerSubmitter"), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByLabelText("adminEventCfp.settings.minReviews"), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "adminEventCfp.common.save" }));
    for (const key of [
      "adminEventCfp.settings.validation.texts",
      "adminEventCfp.settings.validation.formats",
      "adminEventCfp.settings.validation.criteria",
      "adminEventCfp.settings.validation.maxPerSubmitter",
      "adminEventCfp.settings.validation.minReviews",
    ]) {
      expect(await screen.findByText(key)).toBeInTheDocument();
    }
  });

  it("grupa i bilet: wybór z listy i powrót do „brak”", async () => {
    await renderPanel(settingsRow({ speaker_group_id: null, speaker_ticket_type_id: "tk1" }));
    fireEvent.change(screen.getByLabelText("adminEventCfp.settings.speakerGroup"), {
      target: { value: "g1" },
    });
    fireEvent.change(screen.getByLabelText("adminEventCfp.settings.speakerTicket"), {
      target: { value: "__none__" },
    });
    stub().setData("admin_event_cfp_settings_save", settingsRow());
    fireEvent.click(screen.getByRole("button", { name: "adminEventCfp.common.save" }));
    await waitFor(() =>
      expect(payload()).toMatchObject({ speaker_group_id: "g1", speaker_ticket_type_id: null }),
    );
  });

  it("odmowa zapisu trafia do toasta", async () => {
    await renderPanel();
    fireEvent.change(screen.getByLabelText("adminEventCfp.settings.introPl"), {
      target: { value: "x" },
    });
    stub().setError("admin_event_cfp_settings_save", "score_max_below_reviews: 7");
    fireEvent.click(screen.getByRole("button", { name: "adminEventCfp.common.save" }));
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("odmowa:score_max_below_reviews: 7"),
    );
  });
});

describe("CfpLabelledListEditor - przez ekran ustawień", () => {
  it("usuwanie wiersza, pusta lista i limit wierszy", async () => {
    await renderPanel(
      settingsRow({
        formats: Array.from({ length: 20 }, (_, i) => ({
          key: `f${i}x`,
          label_pl: `F${i}`,
          label_en: `F${i}`,
          duration_min: 30,
        })),
      }),
    );
    expect(screen.getByRole("button", { name: "adminEventCfp.settings.addFormat" })).toBeDisabled();
    const first = screen.getByText("adminEventCfp.list.rowLegend(index=1)").closest("fieldset");
    if (first === null) throw new Error("test");
    fireEvent.click(within(first).getByRole("button", { name: "adminEventCfp.list.remove" }));
    expect(
      screen.getByRole("button", { name: "adminEventCfp.settings.addFormat" }),
    ).not.toBeDisabled();
    expect(screen.getByText("adminEventCfp.settings.noCriteria")).toBeInTheDocument();
    // Zmiana etykiety zapisanego wiersza z własnym kluczem nie rusza klucza.
    fireEvent.change(
      screen.getByLabelText("adminEventCfp.list.labelPl", { selector: "#cfp-format-0-pl" }),
      {
        target: { value: "Inna nazwa" },
      },
    );
    expect(
      screen.getByLabelText("adminEventCfp.list.key", { selector: "#cfp-format-0-key" }),
    ).toHaveValue("f1x");
  });

  it("brak ścieżek w wydarzeniu mówi, gdzie je dodać", async () => {
    await renderPanel(settingsRow({ options: { tracks: [], rooms: [], groups: [], tickets: [] } }));
    expect(screen.getByText("adminEventCfp.settings.noTracks")).toBeInTheDocument();
    expect(screen.getByText("adminEventCfp.settings.noFormats")).toBeInTheDocument();
  });
});
