// Ekrany „Recenzenci" i „Materiały prelegentów".
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW - pilnowane niżej:
// DOWODZIMY: (1) dodanie recenzenta wysyła konto z wyszukiwarki członków,
// (2) każda zmiana w wierszu wysyła KOMPLET pól recenzenta (upsert), więc
// przełączenie jednej flagi nie gubi zakresu ścieżek, (3) usunięcie recenzenta
// z ocenami mówi, że go wyłączono, (4) publikacja materiału przełącza flagę
// i otwiera adres z `noopener`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";

const h = vi.hoisted(() => ({
  rpc: null as SupabaseRpcStub | null,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  confirm: vi.fn(async () => true),
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
vi.mock("@/lib/appDialogs", () => ({ confirmDialog: h.confirm }));
vi.mock("@/lib/i18n-admin-event-cfp", () => ({ ensureAdminEventCfpI18n: () => undefined }));
vi.mock("@/lib/events/adminCfpErrors", () => ({
  adminCfpErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));
vi.mock("@/components/admin/community/MemberPicker", async () =>
  (await import("@/test/events/cfpStubs")).memberPickerStubModule(await import("react")),
);
vi.mock("@/components/ui/switch", async () =>
  (await import("@/test/reactStubs")).radixSwitchStub(await import("react")),
);

const { CfpReviewersPanel } = await import("@/components/admin/events/organisms/CfpReviewersPanel");
const { CfpMaterialsTable } = await import("@/components/admin/events/organisms/CfpMaterialsTable");

function stub(): SupabaseRpcStub {
  if (h.rpc === null) throw new Error("test");
  return h.rpc;
}

function payload(name: string): Record<string, unknown> {
  const value = stub().lastCall(name)?.arg("p_payload");
  if (typeof value !== "object" || value === null) throw new Error(`test: brak ${name}`);
  return value as Record<string, unknown>;
}

const REVIEWERS = [
  {
    id: "r1",
    user_id: "u1",
    display_name: "Anna Recenzentka",
    avatar_url: null,
    track_ids: ["t1"],
    can_see_identity: false,
    is_active: true,
    reviews_count: 4,
    created_at: "",
  },
  {
    id: "r2",
    user_id: "u2",
    display_name: "",
    avatar_url: null,
    track_ids: null,
    can_see_identity: true,
    is_active: false,
    reviews_count: 0,
    created_at: "",
  },
];

const SETTINGS = {
  options: {
    tracks: [
      { id: "t1", key: "e", name_pl: "Energia", name_en: "Energy" },
      { id: "t2", key: "c", name_pl: "Klimat", name_en: "Climate" },
    ],
  },
};

beforeEach(() => {
  h.rpc = supabaseRpcStub();
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.confirm.mockReset();
  h.confirm.mockResolvedValue(true);
});
afterEach(cleanup);

async function renderReviewers(rows: unknown = REVIEWERS, settings: unknown = SETTINGS) {
  stub().setData("admin_event_cfp_reviewers_list", rows);
  stub().setData("admin_event_cfp_settings_get", settings);
  renderWithQueryClient(<CfpReviewersPanel eventId="e1" />);
  await screen.findByText("adminEventCfp.reviewers.lead");
}

describe("CfpReviewersPanel", () => {
  it("dodaje konto wybrane w wyszukiwarce członków", async () => {
    await renderReviewers([]);
    expect(await screen.findByText("adminEventCfp.reviewers.empty")).toBeInTheDocument();
    const add = screen.getByRole("button", { name: "adminEventCfp.reviewers.add" });
    expect(add).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "adminEventCfp.reviewers.picker.placeholder" }),
    );
    stub().setData("admin_event_cfp_reviewer_set", "r9");
    fireEvent.click(add);
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminEventCfp.toasts.reviewerAdded"),
    );
    expect(payload("admin_event_cfp_reviewer_set")).toEqual({
      event_id: "e1",
      user_id: "u-picked",
      is_active: true,
    });
    await waitFor(() => expect(add).toBeDisabled());

    stub().setError("admin_event_cfp_reviewer_set", "reviewer_not_found: x");
    fireEvent.click(
      screen.getByRole("button", { name: "adminEventCfp.reviewers.picker.placeholder" }),
    );
    fireEvent.click(add);
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("odmowa:reviewer_not_found: x"));
  });

  it("zmiana w wierszu wysyła komplet pól recenzenta", async () => {
    await renderReviewers();
    const row = (await screen.findByText("Anna Recenzentka")).closest("tr");
    if (row === null) throw new Error("test");
    stub().setData("admin_event_cfp_reviewer_set", "r1");

    fireEvent.click(within(row).getByRole("checkbox", { name: "Klimat" }));
    await waitFor(() =>
      expect(payload("admin_event_cfp_reviewer_set")).toEqual({
        event_id: "e1",
        user_id: "u1",
        track_ids: ["t1", "t2"],
        can_see_identity: false,
        is_active: true,
      }),
    );
    expect(h.toastSuccess).toHaveBeenCalledWith("adminEventCfp.toasts.reviewerSaved");

    fireEvent.click(
      within(row).getByRole("switch", {
        name: "adminEventCfp.reviewers.identityLabel(name=Anna Recenzentka)",
      }),
    );
    await waitFor(() =>
      expect(payload("admin_event_cfp_reviewer_set")).toMatchObject({
        can_see_identity: true,
        track_ids: ["t1"],
      }),
    );
    fireEvent.click(
      within(row).getByRole("switch", {
        name: "adminEventCfp.reviewers.activeLabel(name=Anna Recenzentka)",
      }),
    );
    await waitFor(() =>
      expect(payload("admin_event_cfp_reviewer_set")).toMatchObject({ is_active: false }),
    );

    // Recenzent bez nazwy i bez zakresu ścieżek.
    const unnamed = screen.getByText("adminEventCfp.reviewers.unnamed").closest("tr");
    if (unnamed === null) throw new Error("test");
    expect(within(unnamed).getByText("adminEventCfp.reviewers.scopeHint")).toBeInTheDocument();
    fireEvent.click(within(unnamed).getByRole("checkbox", { name: "Energia" }));
    await waitFor(() =>
      expect(payload("admin_event_cfp_reviewer_set")).toEqual({
        event_id: "e1",
        user_id: "u2",
        track_ids: ["t1"],
        can_see_identity: true,
        is_active: false,
      }),
    );
  });

  it("wydarzenie bez ścieżek: recenzent ocenia wszystko", async () => {
    await renderReviewers(REVIEWERS, { options: { tracks: [] } });
    await screen.findByText("Anna Recenzentka");
    expect(screen.getAllByText("adminEventCfp.reviewers.allTracks")).toHaveLength(2);
  });

  it("usunięcie: potwierdzenie, usunięty albo wyłączony, odmowa", async () => {
    await renderReviewers();
    await screen.findByText("Anna Recenzentka");
    h.confirm.mockResolvedValueOnce(false);
    fireEvent.click(
      screen.getAllByRole("button", { name: "adminEventCfp.common.delete" })[0] as HTMLElement,
    );
    await waitFor(() => expect(h.confirm).toHaveBeenCalledTimes(1));
    expect(stub().callsFor("admin_event_cfp_reviewer_remove")).toHaveLength(0);

    stub().setData("admin_event_cfp_reviewer_remove", "deactivated");
    fireEvent.click(
      screen.getAllByRole("button", { name: "adminEventCfp.common.delete" })[0] as HTMLElement,
    );
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminEventCfp.toasts.reviewerDeactivated"),
    );
    stub().setData("admin_event_cfp_reviewer_remove", "deleted");
    fireEvent.click(
      screen.getAllByRole("button", { name: "adminEventCfp.common.delete" })[1] as HTMLElement,
    );
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminEventCfp.toasts.reviewerRemoved"),
    );
    expect(stub().lastCall("admin_event_cfp_reviewer_remove")?.arg("p_reviewer_id")).toBe("r2");
    stub().setError("admin_event_cfp_reviewer_remove", "forbidden: x");
    fireEvent.click(
      screen.getAllByRole("button", { name: "adminEventCfp.common.delete" })[1] as HTMLElement,
    );
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("odmowa:forbidden: x"));
  });

  it("odmowa odczytu listy", async () => {
    stub().setError("admin_event_cfp_reviewers_list", "forbidden: q");
    stub().setData("admin_event_cfp_settings_get", SETTINGS);
    renderWithQueryClient(<CfpReviewersPanel eventId="e1" />);
    expect(await screen.findByText("odmowa:forbidden: q")).toBeInTheDocument();
  });
});

describe("CfpMaterialsTable", () => {
  const MATERIALS = [
    {
      id: "m1",
      kind: "slides",
      title_pl: "Slajdy",
      title_en: "Slides",
      url: "https://example.org/s.pdf",
      visibility: "public",
      is_published: false,
      speaker_name: "Anna Nowak",
      speaker_profile_id: "sp1",
      submission_id: null,
      session_id: null,
      published_at: null,
      created_at: "",
      updated_at: "2026-09-05T10:00:00+00:00",
    },
    {
      id: "m2",
      kind: "zip",
      title_pl: "",
      title_en: "Video",
      url: "https://example.org/v",
      visibility: "nope",
      is_published: true,
      speaker_name: "Jan K",
      speaker_profile_id: "sp2",
      submission_id: null,
      session_id: null,
      published_at: null,
      created_at: "",
      updated_at: null,
    },
  ];

  it("publikuje i wycofuje materiał; adres otwiera się bezpiecznie", async () => {
    stub().setData("admin_event_cfp_materials_list", MATERIALS);
    renderWithQueryClient(<CfpMaterialsTable eventId="e1" timezone="Europe/Warsaw" />);
    const row = (await screen.findByText("Slajdy")).closest("tr");
    if (row === null) throw new Error("test");
    expect(within(row).getByText("eventCfp.materialKinds.slides")).toBeInTheDocument();
    expect(within(row).getByText("eventCfp.materialVisibility.public")).toBeInTheDocument();
    expect(within(row).getByText("adminEventCfp.materials.unpublished")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "adminEventCfp.materials.open" })).toHaveAttribute(
      "rel",
      "noopener noreferrer nofollow",
    );
    const second = screen.getByText("Video").closest("tr");
    if (second === null) throw new Error("test");
    expect(within(second).getByText("eventCfp.materialKinds.link")).toBeInTheDocument();
    expect(within(second).getByText("eventCfp.materialVisibility.organizers")).toBeInTheDocument();

    stub().setData("admin_event_cfp_material_publish", true);
    fireEvent.click(within(row).getByRole("button", { name: "adminEventCfp.materials.publish" }));
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminEventCfp.toasts.materialPublished"),
    );
    expect(payload("admin_event_cfp_material_publish")).toEqual({ id: "m1", is_published: true });
    fireEvent.click(
      within(second).getByRole("button", { name: "adminEventCfp.materials.unpublish" }),
    );
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminEventCfp.toasts.materialUnpublished"),
    );
    stub().setError("admin_event_cfp_material_publish", "not_found: x");
    fireEvent.click(
      within(second).getByRole("button", { name: "adminEventCfp.materials.unpublish" }),
    );
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("odmowa:not_found: x"));
  });

  it("odmowa odczytu materiałów", async () => {
    stub().setError("admin_event_cfp_materials_list", "forbidden: m");
    renderWithQueryClient(<CfpMaterialsTable eventId="e1" timezone="Europe/Warsaw" />);
    expect(await screen.findByText("odmowa:forbidden: m")).toBeInTheDocument();
  });
});
