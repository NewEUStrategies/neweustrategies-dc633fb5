// Molekuła „eksport planu sali" - lista przy drzwiach, wszystkie miejsca,
// goście jednej firmy (CRM).
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW - każdy punkt to gwarancja, która znika.
//   1. Dane idą Z BAZY w chwili kliknięcia (`fetchSeatingExport`), a nie
//      z cache ekranu; lista firmy pyta z identyfikatorem firmy.
//   2. Plik ma nazwę z planem i trybem, treść CSV z napisem miejsca
//      podanym przez organizm (pobranie to wspólny `downloadTextFile`
//      z `lib/billing/exportHistory` - ma własne testy).
//   3. Bez wybranej firmy przycisk „pobierz” jest zgaszony; plan bez firm
//      mówi to zdaniem (bez etykiety wskazującej w próżnię).
//   4. Awaria mówi to wprost; w trakcie pobierania przyciski są zgaszone.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SeatExportRow } from "@/lib/events/seatingApi";

const h = vi.hoisted(() => ({
  calls: [] as { mapId: string; companyId: string | null }[],
  rows: [] as SeatExportRow[],
  error: null as Error | null,
  hang: false,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  files: [] as { name: string; content: string }[],
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-event-seating", () => ({ ensureSeatingI18n: () => undefined }));
vi.mock("@/components/atoms/FormSelect", async () =>
  (await import("@/test/events/seatingUiMocks")).formSelectModule(),
);
vi.mock("@/components/ui/popover", async () =>
  (await import("@/test/events/seatingUiMocks")).popoverModule(),
);
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/events/adminSeatingErrors", () => ({
  adminSeatingErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));
vi.mock("@/lib/events/seatingApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/seatingApi")>()),
  fetchSeatingExport: (mapId: string, companyId: string | null) => {
    h.calls.push({ mapId, companyId });
    if (h.hang) return new Promise<never>(() => undefined);
    return h.error === null ? Promise.resolve(h.rows) : Promise.reject(h.error);
  },
}));

import {
  SeatExportMenu,
  type SeatExportMenuProps,
} from "@/components/admin/events/molecules/SeatExportMenu";
import { SEAT_MAP_ID, seatExportRow } from "@/test/events/seatingFixtures";

const E = "adminEventSeating.export";

beforeEach(() => {
  h.calls = [];
  h.rows = [seatExportRow()];
  h.error = null;
  h.hang = false;
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
  h.files = [];
  vi.stubGlobal(
    "Blob",
    class {
      readonly parts: string;
      constructor(parts: readonly unknown[]) {
        this.parts = parts.map(String).join("");
      }
    },
  );
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: (blob: { parts: string }) => {
      h.files.push({ name: "", content: blob.parts });
      return "blob:plik";
    },
    revokeObjectURL: vi.fn(),
  });
  const realne = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    const el = realne(tag);
    if (tag === "a") {
      (el as HTMLAnchorElement).click = () => {
        const last = h.files.at(-1);
        if (last !== undefined) last.name = (el as HTMLAnchorElement).download;
      };
    }
    return el;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function menu(over: Partial<SeatExportMenuProps> = {}) {
  const props: SeatExportMenuProps = {
    eventSlug: "kongres",
    mapId: SEAT_MAP_ID,
    mapName: "Gala Łódź",
    companies: [{ id: "co-1", name: "Firma Jeden" }],
    seatText: (row) => `miejsce ${row.seat_number}`,
    ...over,
  };
  return render(<SeatExportMenu {...props} />);
}

const guzik = (klucz: string) => screen.getByRole("button", { name: `${E}.${klucz}` });

describe("SeatExportMenu", () => {
  it("lista przy drzwiach: dane z bazy w chwili kliknięcia, plik z planem i trybem", async () => {
    menu();
    fireEvent.click(guzik("door"));

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminEventSeating.toasts.exported"),
    );
    expect(h.calls).toEqual([{ mapId: SEAT_MAP_ID, companyId: null }]);
    expect(h.files[0]?.name).toMatch(/^plan-sali-kongres-gala-lodz-door-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(h.files[0]?.content).toContain("miejsce 2");
  });

  it("wszystkie miejsca mają własny tryb w nazwie pliku", async () => {
    menu();
    fireEvent.click(guzik("seats"));
    await waitFor(() => expect(h.files).toHaveLength(1));
    expect(h.files[0]?.name).toContain("-seats-");
  });

  it("lista firmy pyta z identyfikatorem firmy i dopiero po jej wyborze", async () => {
    menu();
    expect(guzik("companyDownload")).toBeDisabled();

    fireEvent.change(screen.getByLabelText(`${E}.company`), { target: { value: "co-1" } });
    fireEvent.click(guzik("companyDownload"));
    await waitFor(() => expect(h.files).toHaveLength(1));
    expect(h.calls).toEqual([{ mapId: SEAT_MAP_ID, companyId: "co-1" }]);
    expect(h.files[0]?.name).toContain("-company-");
  });

  it("plan bez firm mówi to zdaniem i nie ma etykiety bez pola", () => {
    menu({ companies: [] });
    expect(screen.getByText(`${E}.noCompanies`)).toBeTruthy();
    expect(screen.queryByLabelText(`${E}.company`)).toBeNull();
    expect(document.querySelector('label[for="seat-export-company"]')).toBeNull();
  });

  it("awaria mówi to wprost i zwalnia przyciski", async () => {
    h.error = new Error("forbidden: x");
    menu();
    fireEvent.click(guzik("door"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("odmowa:forbidden: x"));
    expect(guzik("door")).not.toBeDisabled();
    expect(h.files).toEqual([]);
  });

  it("w trakcie pobierania przyciski są zgaszone", async () => {
    h.hang = true;
    menu();
    fireEvent.click(guzik("door"));
    await waitFor(() => expect(guzik("seats")).toBeDisabled());
    expect(guzik("door")).toBeDisabled();
  });
});
