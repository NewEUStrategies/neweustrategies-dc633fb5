// Wybór poprzedniej edycji na stronie tworzenia wydarzenia.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. WYSZUKIWARKA OTWARTA NA STAŁE. Kto tworzy od zera, ma widzieć jeden
//      przycisk, a nie pole wyszukiwania nad kreatorem.
//   2. ZAPYTANIE NA KAŻDY ZNAK / OD JEDNEGO ZNAKU. Fraza krótsza niż dwa znaki
//      dopasowuje pół listy - baza ma dostać pytanie dopiero od dwóch znaków.
//   3. WYBÓR NIE TEGO WYDARZENIA. Kliknięcie wiersza ma oddać identyfikator
//      TEGO wiersza (rodzic nawiguje pod `?from=`).
//   4. PUSTKA I BŁĄD POMYLONE. „Nic nie pasuje" po nieudanym zapytaniu to
//      nieprawda o liście wydarzeń.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import { axeViolations, summarize } from "@/test/axe";
import { freezeClock } from "@/test/time";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase";
import { CLONE_SOURCE_ID } from "@/test/events/eventCloneFixtures";

const h = vi.hoisted(() => ({ rpc: null as SupabaseRpcStub | null }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (name: string, args?: Record<string, unknown>) => h.rpc!.rpc(name, args) },
}));
vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-event-clone", () => ({ ensureCloneI18n: () => undefined }));

const { EventCloneSourcePicker } = await import("@/components/admin/events/molecules/EventCloneSourcePicker");

freezeClock();

beforeEach(() => {
  h.rpc = supabaseRpcStub();
});
afterEach(() => cleanup());

function listRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CLONE_SOURCE_ID,
    title_pl: "Kongres 2026",
    title_en: "Congress 2026",
    starts_at: "2099-03-20T08:00:00.000Z",
    timezone: "Europe/Warsaw",
    status: "published",
    ...overrides,
  };
}

function open() {
  fireEvent.click(screen.getByRole("button", { name: /adminEventClone.entry.createFromPrevious/ }));
  return screen.getByLabelText("adminEventClone.entry.pickerSearch");
}

describe("EventCloneSourcePicker", () => {
  it("zwinięty: jeden przycisk, zero zapytań", () => {
    renderWithQueryClient(<EventCloneSourcePicker onPick={vi.fn()} />);
    expect(screen.queryByLabelText("adminEventClone.entry.pickerSearch")).toBeNull();
    expect(h.rpc!.calls).toEqual([]);
  });

  it("pyta od dwóch znaków i oddaje identyfikator klikniętego wiersza", async () => {
    h.rpc!.setData("admin_events_list", [listRow(), listRow({ id: "x-2", title_pl: "Forum", status: "draft" })]);
    const onPick = vi.fn();
    const { container } = renderWithQueryClient(<EventCloneSourcePicker onPick={onPick} />);
    const search = open();
    fireEvent.change(search, { target: { value: "k" } });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(h.rpc!.calls).toEqual([]);

    fireEvent.change(search, { target: { value: "kongres" } });
    const choice = await screen.findByRole("button", {
      name: "adminEventClone.entry.pickerChoose(title=Kongres 2026)",
    });
    expect(h.rpc!.lastCall("admin_events_list")?.arg("p_q")).toBe("kongres");
    expect(screen.getByText("adminEventClone.status.draft")).toBeInTheDocument();
    expect(summarize(await axeViolations(container))).toBe("");
    fireEvent.click(choice);
    expect(onPick).toHaveBeenCalledWith(CLONE_SOURCE_ID);
  });

  it("brak wyników mówi „nic nie pasuje”; błąd jest alertem, nie pustką", async () => {
    h.rpc!.setData("admin_events_list", []);
    renderWithQueryClient(<EventCloneSourcePicker onPick={vi.fn()} />);
    const search = open();
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(await screen.findByText("adminEventClone.entry.pickerEmpty")).toBeInTheDocument();

    h.rpc!.setError("admin_events_list", "forbidden: admin role required");
    fireEvent.change(search, { target: { value: "yyy" } });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("forbidden: admin role required"));
    expect(screen.queryByText("adminEventClone.entry.pickerEmpty")).toBeNull();
  });

  it("zamknięcie zwija wybór i czyści frazę", async () => {
    h.rpc!.setData("admin_events_list", [listRow()]);
    renderWithQueryClient(<EventCloneSourcePicker onPick={vi.fn()} />);
    const search = open();
    fireEvent.change(search, { target: { value: "kongres" } });
    await screen.findByRole("button", { name: /pickerChoose/ });
    fireEvent.click(screen.getByRole("button", { name: "adminEventClone.entry.pickerClose" }));
    expect(screen.queryByLabelText("adminEventClone.entry.pickerSearch")).toBeNull();
    expect((open() as HTMLInputElement).value).toBe("");
  });
});
