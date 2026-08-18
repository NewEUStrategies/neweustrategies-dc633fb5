// Podmiana pliku w edycji materiału biblioteki: nowy obiekt najpierw, jeden
// UPDATE metadanych, stary obiekt schodzi best-effort PO sukcesie; porzucenie
// dialogu sprząta osierocony upload. Testy przybijają tę choreografię, bo
// odwrócenie kolejności (usunięcie starego pliku przed zapisem) zostawiłoby
// wiersz wskazujący nieistniejący obiekt.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type React from "react";

const { rows, uploadSpy, updateSpy, removeObjSpy } = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  uploadSpy: vi.fn(async (_f: File) => ({ path: "t1/u1/999-nowy.pdf", size: 2048 })),
  updateSpy: vi.fn(async (_id: string, _patch: Record<string, unknown>) => undefined),
  removeObjSpy: vi.fn(async (_path: string) => undefined),
}));

vi.mock("@/lib/admin/library", () => ({
  fetchAdminResources: async () => rows,
  uploadResourceFile: uploadSpy,
  createResource: vi.fn(),
  updateResource: updateSpy,
  deleteResource: vi.fn(),
  removeResourceObject: removeObjSpy,
}));
vi.mock("@/lib/billing/tiers", () => ({
  useMembershipTiers: () => ({
    data: [{ id: "t0", rank: 0, active: true, name_pl: "Członek", name_en: "Member" }],
  }),
  tierName: (t: { name_pl: string }) => t.name_pl,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { Route as AdminLibraryRoute } from "@/routes/admin.library";

// Komponent trasy NIE jest eksportowany (eksport blokował route splitter i
// trzymał całą stronę w chunku wejściowym) - test sięga po niego przez
// opcje trasy, dokładnie tak jak robi to router.
const AdminLibraryPage = AdminLibraryRoute.options.component as React.ComponentType;

const OLD_PATH = "t1/u1/1-stary.pdf";

function resourceRow() {
  return {
    id: "r1",
    title_pl: "Raport Q3",
    title_en: "Raport Q3",
    description_pl: null,
    description_en: null,
    category: "report",
    file_path: OLD_PATH,
    file_name: "stary.pdf",
    file_size: 1024,
    mime_type: "application/pdf",
    min_tier_rank: 0,
    published: true,
    sort_order: 0,
    download_count: 7,
    created_at: "2026-01-01T00:00:00Z",
    created_by: "u1",
    tenant_id: "t1",
  };
}

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

async function openEditDialog(): Promise<HTMLElement> {
  await screen.findByText("Raport Q3");
  fireEvent.click(screen.getByLabelText(/Edytuj materiał|Edit resource/));
  return screen.findByLabelText(/Wybierz nowy plik|Choose a replacement file/);
}

function pickReplacement(input: HTMLElement) {
  const file = new File(["x"], "nowy.pdf", { type: "application/pdf" });
  fireEvent.change(input, { target: { files: [file] } });
}

const saveButton = () => screen.getByRole("button", { name: /Zapisz|Save/ });

beforeEach(() => {
  uploadSpy.mockClear();
  updateSpy.mockClear();
  removeObjSpy.mockClear();
  rows.length = 0;
  rows.push(resourceRow());
});

describe("AdminLibrary - podmiana pliku w edycji", () => {
  it("zapis z podmianą: jeden UPDATE z polami pliku, stary obiekt schodzi po sukcesie", async () => {
    wrap(<AdminLibraryPage />);
    const input = await openEditDialog();
    pickReplacement(input);
    await waitFor(() => expect(uploadSpy).toHaveBeenCalledTimes(1));
    // Upload nie dotyka jeszcze ani wiersza, ani starego obiektu.
    expect(updateSpy).not.toHaveBeenCalled();
    expect(removeObjSpy).not.toHaveBeenCalled();

    fireEvent.click(saveButton());
    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    expect(updateSpy).toHaveBeenCalledWith(
      "r1",
      expect.objectContaining({
        file_path: "t1/u1/999-nowy.pdf",
        file_name: "nowy.pdf",
        file_size: 2048,
        mime_type: "application/pdf",
      }),
    );
    // Stary obiekt sprzątany dopiero PO udanym zapisie metadanych.
    await waitFor(() => expect(removeObjSpy).toHaveBeenCalledWith(OLD_PATH));
  });

  it("zapis bez podmiany nie dotyka pól pliku ani storage", async () => {
    wrap(<AdminLibraryPage />);
    await openEditDialog();
    fireEvent.click(saveButton());
    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    const patch = updateSpy.mock.calls[0][1];
    expect(patch).not.toHaveProperty("file_path");
    expect(patch).not.toHaveProperty("file_name");
    expect(removeObjSpy).not.toHaveBeenCalled();
  });

  it("'Zostaw obecny plik' sprząta świeży upload i zapisuje bez pól pliku", async () => {
    wrap(<AdminLibraryPage />);
    const input = await openEditDialog();
    pickReplacement(input);
    await waitFor(() => expect(uploadSpy).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /Zostaw obecny plik|Keep current file/ }));
    await waitFor(() => expect(removeObjSpy).toHaveBeenCalledWith("t1/u1/999-nowy.pdf"));

    fireEvent.click(saveButton());
    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    const patch = updateSpy.mock.calls[0][1];
    expect(patch).not.toHaveProperty("file_path");
    // Stary obiekt nigdy nie jest ruszany w tym przepływie.
    expect(removeObjSpy).not.toHaveBeenCalledWith(OLD_PATH);
  });

  it("porzucenie dialogu po uploadzie sprząta osierocony obiekt (Anuluj)", async () => {
    wrap(<AdminLibraryPage />);
    const input = await openEditDialog();
    pickReplacement(input);
    await waitFor(() => expect(uploadSpy).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /Anuluj|Cancel/ }));
    await waitFor(() => expect(removeObjSpy).toHaveBeenCalledWith("t1/u1/999-nowy.pdf"));
    expect(updateSpy).not.toHaveBeenCalled();
    expect(removeObjSpy).not.toHaveBeenCalledWith(OLD_PATH);
  });
});
