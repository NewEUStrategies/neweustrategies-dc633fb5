// Ekran „Formularz zgłoszenia" (własne pytania naboru) i okno pytania.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW - pilnowane niżej:
// DOWODZIMY: (1) kolejność strzałkami zapisuje PEŁNĄ listę identyfikatorów,
// (2) usunięcie pytania z odpowiedziami mówi, ile zgłoszeń odpowiedziało,
// i wymaga potwierdzenia, (3) okno nowego pytania podpowiada klucz, a okno
// edycji go nie pokazuje (`key_immutable`), (4) opcje są tylko przy wyborze.
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
  adminCfpErrorMessage: (error: unknown) => `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));
vi.mock("@/components/atoms/FormSelect", async () =>
  (await import("@/test/events/cfpStubs")).formSelectStubModule(await import("react")),
);
vi.mock("@/components/ui/switch", async () => (await import("@/test/reactStubs")).radixSwitchStub(await import("react")));

const { CfpFormPanel } = await import("@/components/admin/events/organisms/CfpFormPanel");

function stub(): SupabaseRpcStub {
  if (h.rpc === null) throw new Error("test");
  return h.rpc;
}

const ROWS = [
  {
    id: "f1",
    key: "exp",
    field_type: "select",
    label_pl: "Doświadczenie",
    label_en: "Experience",
    help_pl: "",
    help_en: "",
    is_required: true,
    is_active: true,
    options: [{ value: "a", label_pl: "A", label_en: "A" }],
    sort_order: 10,
    answers_count: 3,
  },
  {
    id: "f2",
    key: "video",
    field_type: "weird",
    label_pl: "Nagranie",
    label_en: "",
    help_pl: "",
    help_en: "",
    is_required: false,
    is_active: false,
    options: [],
    sort_order: 20,
    answers_count: 0,
  },
];

function payload(name: string): Record<string, unknown> {
  const value = stub().lastCall(name)?.arg("p_payload");
  if (typeof value !== "object" || value === null) throw new Error(`test: brak ${name}`);
  return value as Record<string, unknown>;
}

async function renderPanel(rows: unknown = ROWS) {
  stub().setData("admin_event_cfp_fields_list", rows);
  renderWithQueryClient(<CfpFormPanel eventId="e1" />);
  if (Array.isArray(rows) && rows.length > 0) await screen.findByText("Doświadczenie");
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.confirm.mockReset();
  h.confirm.mockResolvedValue(true);
});
afterEach(cleanup);

describe("CfpFormPanel - lista pytań", () => {
  it("pusta lista i odmowa odczytu mają własne zdania", async () => {
    await renderPanel([]);
    expect(await screen.findByText("adminEventCfp.form.empty")).toBeInTheDocument();
    cleanup();
    stub().setError("admin_event_cfp_fields_list", "forbidden: x");
    renderWithQueryClient(<CfpFormPanel eventId="e1" />);
    expect(await screen.findByText("odmowa:forbidden: x")).toBeInTheDocument();
  });

  it("wiersz pokazuje etykietę, klucz, rodzaj, znaczniki i liczbę odpowiedzi", async () => {
    await renderPanel();
    const rows = screen.getAllByRole("row");
    const first = rows[1];
    const second = rows[2];
    if (first === undefined || second === undefined) throw new Error("test");
    expect(within(first).getByText("exp")).toBeInTheDocument();
    expect(within(first).getByText("adminEventCfp.form.required")).toBeInTheDocument();
    expect(within(first).getByText("adminEventCfp.fieldTypes.select")).toBeInTheDocument();
    expect(within(first).getByText("3")).toBeInTheDocument();
    expect(within(second).getByText("adminEventCfp.form.inactive")).toBeInTheDocument();
    expect(within(second).getByText("adminEventCfp.fieldTypes.text")).toBeInTheDocument();
  });

  it("strzałki zapisują pełną kolejność; skrajne są wyłączone", async () => {
    await renderPanel();
    const up = screen.getAllByRole("button", { name: "adminEventCfp.form.moveUp" });
    const down = screen.getAllByRole("button", { name: "adminEventCfp.form.moveDown" });
    expect(up[0]).toBeDisabled();
    expect(down[1]).toBeDisabled();
    stub().setData("admin_event_cfp_fields_reorder", 2);
    fireEvent.click(down[0] as HTMLElement);
    await waitFor(() => expect(payload("admin_event_cfp_fields_reorder")).toEqual({ event_id: "e1", ids: ["f2", "f1"] }));
    stub().setError("admin_event_cfp_fields_reorder", "invalid_order: x");
    fireEvent.click(up[1] as HTMLElement);
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("odmowa:invalid_order: x"));
  });

  it("usunięcie pytania z odpowiedziami mówi ile i wymaga potwierdzenia", async () => {
    await renderPanel();
    stub().setData("admin_event_cfp_field_delete", true);
    h.confirm.mockResolvedValueOnce(false);
    fireEvent.click(screen.getAllByRole("button", { name: "adminEventCfp.common.delete" })[0] as HTMLElement);
    await waitFor(() => expect(h.confirm).toHaveBeenCalledTimes(1));
    expect(h.confirm.mock.calls[0]?.[0 as number]).toMatchObject({
      description: "adminEventCfp.form.deleteWithAnswers(count=3)",
      destructive: true,
    });
    expect(stub().callsFor("admin_event_cfp_field_delete")).toHaveLength(0);

    fireEvent.click(screen.getAllByRole("button", { name: "adminEventCfp.common.delete" })[1] as HTMLElement);
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("adminEventCfp.toasts.fieldDeleted"));
    expect(h.confirm.mock.calls[1]?.[0 as number]).toMatchObject({ description: "adminEventCfp.form.deleteDescription" });
    expect(stub().lastCall("admin_event_cfp_field_delete")?.arg("p_field_id")).toBe("f2");

    stub().setError("admin_event_cfp_field_delete", "not_found: x");
    fireEvent.click(screen.getAllByRole("button", { name: "adminEventCfp.common.delete" })[1] as HTMLElement);
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("odmowa:not_found: x"));
  });
});

describe("CfpFieldDialog - nowe pytanie", () => {
  it("podpowiada klucz, pokazuje opcje przy wyborze i zapisuje komplet pól", async () => {
    await renderPanel([]);
    fireEvent.click(screen.getByRole("button", { name: "adminEventCfp.form.add" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("adminEventCfp.form.dialog.createTitle")).toBeInTheDocument();

    // Pusty zapis: błędy przy polach, zero wywołań.
    fireEvent.click(within(dialog).getByRole("button", { name: "adminEventCfp.common.save" }));
    expect(within(dialog).getByText("adminEventCfp.form.validation.key")).toBeInTheDocument();
    expect(within(dialog).getByText("adminEventCfp.form.validation.labels")).toBeInTheDocument();
    expect(stub().callsFor("admin_event_cfp_field_upsert")).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText("adminEventCfp.form.dialog.labelPl"), {
      target: { value: "Poziom zaawansowania" },
    });
    expect(within(dialog).getByLabelText("adminEventCfp.form.dialog.key")).toHaveValue("poziom_zaawansowania");
    fireEvent.change(within(dialog).getByLabelText("adminEventCfp.form.dialog.key"), { target: { value: "level" } });
    fireEvent.change(within(dialog).getByLabelText("adminEventCfp.form.dialog.labelPl"), { target: { value: "Poziom" } });
    expect(within(dialog).getByLabelText("adminEventCfp.form.dialog.key")).toHaveValue("level");
    fireEvent.change(within(dialog).getByLabelText("adminEventCfp.form.dialog.labelEn"), { target: { value: "Level" } });
    fireEvent.change(within(dialog).getByLabelText("adminEventCfp.form.dialog.helpPl"), { target: { value: "h" } });
    fireEvent.change(within(dialog).getByLabelText("adminEventCfp.form.dialog.helpEn"), { target: { value: "x".repeat(501) } });
    expect(within(dialog).queryByText("adminEventCfp.form.dialog.options")).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("adminEventCfp.form.dialog.type"), { target: { value: "select" } });
    expect(within(dialog).getByText("adminEventCfp.form.dialog.options")).toBeInTheDocument();
    expect(within(dialog).getByText("adminEventCfp.form.validation.help")).toBeInTheDocument();
    expect(within(dialog).getByText("adminEventCfp.form.validation.options")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("adminEventCfp.form.dialog.helpEn"), { target: { value: "" } });

    fireEvent.click(within(dialog).getByRole("button", { name: "adminEventCfp.form.dialog.addOption" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "adminEventCfp.form.dialog.addOption" }));
    fireEvent.change(within(dialog).getByLabelText("adminEventCfp.form.dialog.optionPl", { selector: "#cfp-option-0-pl" }), {
      target: { value: "Początkujący" },
    });
    fireEvent.change(within(dialog).getByLabelText("adminEventCfp.form.dialog.optionEn", { selector: "#cfp-option-0-en" }), {
      target: { value: "Beginner" },
    });
    fireEvent.change(
      within(dialog).getByLabelText("adminEventCfp.form.dialog.optionValue", { selector: "#cfp-option-0-value" }),
      { target: { value: "beginner" } },
    );
    fireEvent.click(within(dialog).getAllByRole("button", { name: "adminEventCfp.list.remove" })[1] as HTMLElement);
    fireEvent.click(within(dialog).getByLabelText("adminEventCfp.form.dialog.required"));
    fireEvent.click(within(dialog).getByLabelText("adminEventCfp.form.dialog.active"));

    stub().setData("admin_event_cfp_field_upsert", "f9");
    fireEvent.click(within(dialog).getByRole("button", { name: "adminEventCfp.common.save" }));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("adminEventCfp.toasts.fieldSaved"));
    expect(payload("admin_event_cfp_field_upsert")).toEqual({
      event_id: "e1",
      key: "level",
      field_type: "select",
      label_pl: "Poziom",
      label_en: "Level",
      help_pl: "h",
      help_en: "",
      is_required: true,
      is_active: false,
      options: [{ value: "beginner", label_pl: "Początkujący", label_en: "Beginner" }],
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("limit opcji wyłącza dodawanie; anulowanie zamyka okno; odmowa bazy idzie do toasta", async () => {
    await renderPanel([]);
    fireEvent.click(screen.getByRole("button", { name: "adminEventCfp.form.add" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("adminEventCfp.form.dialog.type"), { target: { value: "multiselect" } });
    const add = within(dialog).getByRole("button", { name: "adminEventCfp.form.dialog.addOption" });
    for (let i = 0; i < 50; i += 1) fireEvent.click(add);
    expect(add).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("adminEventCfp.form.dialog.type"), { target: { value: "text" } });
    fireEvent.change(within(dialog).getByLabelText("adminEventCfp.form.dialog.labelPl"), { target: { value: "Pytanie" } });
    fireEvent.change(within(dialog).getByLabelText("adminEventCfp.form.dialog.labelEn"), { target: { value: "Question" } });
    stub().setError("admin_event_cfp_field_upsert", "key_taken: x");
    fireEvent.click(within(dialog).getByRole("button", { name: "adminEventCfp.common.save" }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("odmowa:key_taken: x"));
    expect(payload("admin_event_cfp_field_upsert")).toMatchObject({ key: "pytanie", options: [] });
    fireEvent.click(within(dialog).getByRole("button", { name: "adminEventCfp.common.cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("zapis w toku blokuje przycisk", async () => {
    await renderPanel([]);
    fireEvent.click(screen.getByRole("button", { name: "adminEventCfp.form.add" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("adminEventCfp.form.dialog.labelPl"), { target: { value: "Pytanie" } });
    fireEvent.change(within(dialog).getByLabelText("adminEventCfp.form.dialog.labelEn"), { target: { value: "Question" } });
    stub().setResponse("admin_event_cfp_field_upsert", () => new Promise(() => undefined) as never);
    fireEvent.click(within(dialog).getByRole("button", { name: "adminEventCfp.common.save" }));
    expect(await within(dialog).findByRole("button", { name: "adminEventCfp.common.saving" })).toBeDisabled();
  });
});

describe("CfpFieldDialog - edycja", () => {
  it("okno edycji zaczyna od wiersza i nie pokazuje klucza", async () => {
    await renderPanel();
    fireEvent.click(screen.getAllByRole("button", { name: "adminEventCfp.common.edit" })[0] as HTMLElement);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("adminEventCfp.form.dialog.editTitle")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("adminEventCfp.form.dialog.key")).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("adminEventCfp.form.dialog.labelPl")).toHaveValue("Doświadczenie");
    stub().setData("admin_event_cfp_field_upsert", "f1");
    fireEvent.click(within(dialog).getByRole("button", { name: "adminEventCfp.common.save" }));
    await waitFor(() => expect(payload("admin_event_cfp_field_upsert")).toMatchObject({ id: "f1", field_type: "select" }));
    expect(payload("admin_event_cfp_field_upsert")).not.toHaveProperty("key");
    expect(payload("admin_event_cfp_field_upsert")).not.toHaveProperty("event_id");
  });
});
