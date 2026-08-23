// Organizm zakładki „Rozmieszczenie": CO panel wysyła do `ad_placements`
// i CZEGO NIE MÓWI, gdy odczyt się nie udaje.
//
// CO TEN PLIK DOWODZI.
//   1. NOWA POZYCJA STARTUJE JAKO AKTYWNA, na wpisach, nad treścią, z PUSTĄ
//      konfiguracją i `page_id: null`. Każde z tych pól decyduje, gdzie i komu
//      pokaże się reklama, a żadnego z nich nie widać w tabeli po zapisie.
//   2. BRAK WYBRANEGO SLOTU BLOKUJE ZAPYTANIE, a komunikat jest TWARDYM
//      polskim napisem („Wybierz slot") - mimo że słownik ma klucz
//      `adsAdmin.placements.selectSlot` o dokładnie tej treści. Interfejs po
//      angielsku pokazuje w tym miejscu polszczyznę.
//   3. ODCZYT LISTY IDZIE DWOMA ZAPYTANIAMI RÓWNOLEGLE (sloty po nazwie,
//      pozycje po `sort_order`) - kolejność sortowania jest kolejnością emisji.
//   4. DIALOG USUNIĘCIA POZYCJI NIE MA OPISU SKUTKU (słownik nie ma nawet
//      takiego klucza), w przeciwieństwie do bliźniaczego dialogu slotu.
//      Administrator usuwający pozycję nie dowiaduje się, co znika.
//   5. AWARIA ODCZYTU UDAJE PUSTĄ LISTĘ. `load()` nie czyta pola `error` żadnej
//      z dwóch tabel, więc odmowa RLS wygląda identycznie jak „nic tu nie ma".
//      Zgłoszone parą `it.fails` + `it` (patrz komentarz przy tej parze).
//   6. ZAPIS POTWIERDZA `adminToast.saved()` - inaczej niż w zakładce slotów,
//      która ma w tym miejscu twardy napis. Dwie konwencje na jednym ekranie.
//
// ATRAPY I DLACZEGO - jak w `AdSlotsPanel.test.tsx` (dialog i toasty admina
// mają moduły z własnym stanem i własną instancją i18next; Radix nie działa pod
// happy-dom). `DateTimePicker` echuje propsy, bo Popover się nie otwiera.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Widoku formularza - `AdPlacementForm.test.tsx`.
// (2) Pól konfiguracji - `AdPlacementConfigFields.test.tsx`. (3) Wiersza tabeli -
// `adsTableRows.test.tsx`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { RecordedChain, SupabaseFromStub } from "@/test/supabase";

const h = vi.hoisted(() => ({
  db: null as SupabaseFromStub | null,
  confirmCalls: [] as Record<string, unknown>[],
  confirmAnswer: true,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-ads-admin", () => ({ ensureI18n: () => undefined }));
vi.mock("sonner", () => ({
  toast: { success: h.toastSuccess, error: h.toastError },
  Toaster: () => null,
}));
vi.mock("@/lib/adminToasts", () => ({
  adminToast: {
    saved: () => "adminToasts.saved",
    deleted: () => "adminToasts.deleted",
    error: () => "adminToasts.error",
  },
}));
vi.mock("@/lib/appDialogs", () => ({
  confirmDialog: (opts: Record<string, unknown>) => {
    h.confirmCalls.push(opts);
    return Promise.resolve(h.confirmAnswer);
  },
}));
vi.mock("@/components/ui/select", async () =>
  (await import("@/test/reactStubs")).radixSelectStub(await import("react")),
);
vi.mock("@/components/ui/switch", async () =>
  (await import("@/test/reactStubs")).radixSwitchStub(await import("react")),
);
vi.mock("@/components/ui/datetime-picker", async () => {
  const react = await import("react");
  return {
    DateTimePicker: (p: { value: string | null; placeholder?: string }) =>
      react.createElement("button", { type: "button" }, p.placeholder),
  };
});
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabase");
  const db = supabaseFromStub();
  h.db = db;
  return { supabase: { from: (table: string) => db.from(table) } };
});

import {
  AdPlacementsPanel,
  emptyPlacement,
} from "@/components/admin/ads/organisms/AdPlacementsPanel";
import { fail, ok } from "@/test/supabase";
import type { AdPlacement, AdSlot } from "@/lib/ads/types";

const SLOT = { id: "slot-1", name: "Baner nagłówka" } as AdSlot;

const PLACEMENT: AdPlacement = {
  id: "pl-1",
  tenant_id: "tenant-1",
  slot_id: "slot-1",
  position: "mid_post",
  page_type: "post",
  page_id: null,
  config: { paragraph: 3 },
  sort_order: 2,
  active: true,
  starts_at: null,
  ends_at: null,
  created_at: "2026-07-01T09:00:00.000Z",
  updated_at: "2026-07-02T09:00:00.000Z",
};

function plan(slots: AdSlot[], placements: AdPlacement[]) {
  h.db!.setResponse("ad_slots", () => ok(slots));
  h.db!.setResponse("ad_placements", (chain: RecordedChain) =>
    chain.has("insert") || chain.has("update") || chain.has("delete") ? ok(null) : ok(placements),
  );
}

const writeChains = () =>
  h
    .db!.chainsFor("ad_placements")
    .filter((c) => c.has("insert") || c.has("update") || c.has("delete"));

const readChains = (table: string) =>
  h.db!.chainsFor(table).filter((c) => c.has("select") && !c.has("insert"));

function payloadOf(method: "insert" | "update"): Record<string, unknown> {
  const chain = h.db!.chainsFor("ad_placements").find((c) => c.has(method));
  return (chain?.argsOf(method)?.[0] ?? {}) as Record<string, unknown>;
}

const addButton = () => screen.getByRole("button", { name: "adsAdmin.placements.addAction" });
const slotSelect = () => screen.getAllByRole("combobox")[0] as HTMLSelectElement;
/** Nazwa slotu stoi W DWÓCH miejscach (wiersz i lista wyboru) - zawężamy do tabeli. */
const table = () => within(screen.getByRole("table"));
const trashButton = () =>
  screen.getAllByRole("button").filter((b) => (b.textContent ?? "").trim() === "")[0];

beforeEach(() => {
  h.db?.reset();
  h.confirmCalls = [];
  h.confirmAnswer = true;
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
});

describe("zakładka pozycji: ładunek nowej pozycji", () => {
  it("nowa pozycja leci AKTYWNA, na wpisach, nad treścią, z pustym config", async () => {
    plan([SLOT], []);
    render(<AdPlacementsPanel />);
    await waitFor(() => expect(readChains("ad_placements").length).toBeGreaterThan(0));

    fireEvent.change(slotSelect(), { target: { value: "slot-1" } });
    fireEvent.click(addButton());

    await waitFor(() => expect(writeChains().length).toBe(1));
    expect(payloadOf("insert")).toEqual({
      slot_id: "slot-1",
      position: "top_of_post",
      page_type: "post",
      page_id: null,
      config: {},
      sort_order: 0,
      active: true,
    });
  });

  it("świeży draft pozycji jest aktywny także jako czysta wartość (bez renderu)", () => {
    expect(emptyPlacement()).toEqual({
      slot_id: "",
      position: "top_of_post",
      page_type: "post",
      page_id: null,
      config: {},
      sort_order: 0,
      active: true,
    });
  });

  it("insert nie zawiera tenant_id - najemcę ustawia DEFAULT current_tenant_id()", async () => {
    plan([SLOT], []);
    render(<AdPlacementsPanel />);
    await waitFor(() => expect(readChains("ad_placements").length).toBeGreaterThan(0));

    fireEvent.change(slotSelect(), { target: { value: "slot-1" } });
    fireEvent.click(addButton());

    await waitFor(() => expect(writeChains().length).toBe(1));
    expect("tenant_id" in payloadOf("insert")).toBe(false);
  });

  it("zapis potwierdza adminToast.saved(), a draft wraca do pustego wyboru slotu", async () => {
    plan([SLOT], []);
    render(<AdPlacementsPanel />);
    await waitFor(() => expect(readChains("ad_placements").length).toBeGreaterThan(0));

    fireEvent.change(slotSelect(), { target: { value: "slot-1" } });
    fireEvent.click(addButton());
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("adminToasts.saved"));

    // Dowód wyzerowania draftu jest DECYZYJNY, nie wizualny: kolejny klik
    // zapisu wpada w bramkę wyboru slotu i NIE wysyła drugiego insertu.
    // (Sam `value` natywnego `<select>` nie jest tu świadkiem: atrapa Radiksa
    // nie ma opcji o wartości pustej, więc przeglądarka pokazuje pierwszą.)
    fireEvent.click(addButton());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("Wybierz slot"));
    expect(writeChains().length).toBe(1);
  });
});

describe("zakładka pozycji: bramka wyboru slotu", () => {
  it("brak slotu NIE wysyła zapytania, a komunikat jest TWARDYM polskim napisem", async () => {
    plan([SLOT], []);
    render(<AdPlacementsPanel />);
    await waitFor(() => expect(readChains("ad_placements").length).toBeGreaterThan(0));

    fireEvent.click(addButton());

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("Wybierz slot"));
    expect(h.toastError).not.toHaveBeenCalledWith("adsAdmin.placements.selectSlot");
    expect(writeChains()).toEqual([]);
  });
});

describe("zakładka pozycji: odczyt listy", () => {
  it("czyta DWIE tabele: sloty po nazwie, pozycje po kolejności emisji", async () => {
    plan([SLOT], [PLACEMENT]);
    render(<AdPlacementsPanel />);
    await table().findByText("Baner nagłówka");

    expect(readChains("ad_slots")[0].argsOf("order")).toEqual(["name"]);
    expect(readChains("ad_placements")[0].argsOf("order")).toEqual(["sort_order"]);
  });

  it("nazwa slotu w wierszu pochodzi z mapy pobranej razem z pozycjami", async () => {
    plan([SLOT], [PLACEMENT]);
    render(<AdPlacementsPanel />);

    expect(await table().findByText("Baner nagłówka")).toBeTruthy();
    expect(table().getByText("adsAdmin.positions.midPost")).toBeTruthy();
  });

  it("odpowiedź bez wierszy (data: null) czyta się jak pusta lista, nie jak wyjątek", async () => {
    h.db!.setResponse("ad_slots", () => ok(null));
    h.db!.setResponse("ad_placements", () => ok(null));
    render(<AdPlacementsPanel />);

    expect(await screen.findByText("Brak pozycji.")).toBeTruthy();
    expect(slotSelect().options.length).toBe(0);
  });

  it("pusta lista pozycji mówi TWARDYM polskim napisem", async () => {
    plan([], []);
    render(<AdPlacementsPanel />);

    expect(await screen.findByText("Brak pozycji.")).toBeTruthy();
  });
});

describe("zakładka pozycji: edycja istniejącego wiersza", () => {
  it("'Edytuj' wypełnia formularz wierszem z tabeli", async () => {
    plan([SLOT], [PLACEMENT]);
    render(<AdPlacementsPanel />);
    await table().findByText("Baner nagłówka");

    fireEvent.click(screen.getByRole("button", { name: "Edytuj" }));

    expect(screen.getByText("adsAdmin.placements.editTitle")).toBeTruthy();
    expect(slotSelect().value).toBe("slot-1");
    // Pozycja `mid_post` odsłania swoje pole konfiguracji z zapisaną wartością.
    expect(
      (screen.getByLabelText("adsAdmin.placements.fieldAfterParagraph") as HTMLInputElement).value,
    ).toBe("3");
  });

  it("UPDATE wysyła CAŁY wiersz z filtrem po id, a nie różnicę pól", async () => {
    plan([SLOT], [PLACEMENT]);
    render(<AdPlacementsPanel />);
    await table().findByText("Baner nagłówka");

    fireEvent.click(screen.getByRole("button", { name: "Edytuj" }));
    fireEvent.click(screen.getByRole("button", { name: "adsAdmin.save" }));

    await waitFor(() => expect(writeChains().length).toBe(1));
    const payload = payloadOf("update");
    expect(Object.keys(payload)).toEqual(
      expect.arrayContaining(["id", "tenant_id", "created_at", "updated_at"]),
    );
    expect(payload.updated_at).toBe(PLACEMENT.updated_at);
    expect(writeChains()[0].argsOf("eq")).toEqual(["id", "pl-1"]);
  });

  it("'Anuluj' porzuca edycję i wraca do pustego draftu pozycji", async () => {
    plan([SLOT], [PLACEMENT]);
    render(<AdPlacementsPanel />);
    await table().findByText("Baner nagłówka");

    fireEvent.click(screen.getByRole("button", { name: "Edytuj" }));
    fireEvent.click(screen.getByRole("button", { name: "Anuluj" }));

    expect(screen.getByText("adsAdmin.placements.addTitle")).toBeTruthy();
    expect(screen.queryByLabelText("adsAdmin.placements.fieldAfterParagraph")).toBeNull();
    expect(writeChains()).toEqual([]);
  });
});

describe("zakładka pozycji: usuwanie", () => {
  it("odmowa w dialogu NIE wysyła DELETE", async () => {
    h.confirmAnswer = false;
    plan([SLOT], [PLACEMENT]);
    render(<AdPlacementsPanel />);
    await table().findByText("Baner nagłówka");

    fireEvent.click(trashButton());

    await waitFor(() => expect(h.confirmCalls.length).toBe(1));
    expect(writeChains()).toEqual([]);
  });

  it("potwierdzenie wysyła DELETE z filtrem po id POZYCJI i odświeża listę", async () => {
    plan([SLOT], [PLACEMENT]);
    render(<AdPlacementsPanel />);
    await table().findByText("Baner nagłówka");
    const before = readChains("ad_placements").length;

    fireEvent.click(trashButton());

    await waitFor(() => expect(writeChains().length).toBe(1));
    expect(writeChains()[0].argsOf("eq")).toEqual(["id", "pl-1"]);
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("adminToasts.deleted"));
    await waitFor(() => expect(readChains("ad_placements").length).toBe(before + 1));
  });

  it("dialog pozycji pyta BEZ opisu skutku - inaczej niż dialog slotu", async () => {
    plan([SLOT], [PLACEMENT]);
    render(<AdPlacementsPanel />);
    await table().findByText("Baner nagłówka");

    fireEvent.click(trashButton());

    await waitFor(() => expect(h.confirmCalls.length).toBe(1));
    expect(Object.keys(h.confirmCalls[0]).sort()).toEqual(["confirmLabel", "destructive", "title"]);
    expect("description" in h.confirmCalls[0]).toBe(false);
  });
});

// DEFEKT: awaria odczytu pozycji udaje pustą listę.
//
// Poniższa PARA testów opisuje jedną rzecz z dwóch stron: `it.fails` mówi, jak
// panel POWINIEN się zachować, a sąsiedni `it` - jak zachowuje się DZIŚ.
// Po naprawie (`load()` czyta `error` obu zapytań, jak robi to zakładka slotów)
// USUWA SIĘ OBA RAZEM: pierwszy zacznie przechodzić, drugi zacznie padać.
describe("zakładka pozycji: awaria odczytu (defekt)", () => {
  it.fails("awaria odczytu pozycji POWINNA być powiedziana, a nie udawać pustki", async () => {
    h.db!.setResponse("ad_slots", () => ok([]));
    h.db!.setResponse("ad_placements", () => fail("permission denied for table ad_placements"));
    render(<AdPlacementsPanel />);

    await waitFor(
      () => expect(h.toastError).toHaveBeenCalledWith("permission denied for table ad_placements"),
      { timeout: 300, interval: 20 },
    );
  });

  it("STAN FAKTYCZNY: odmowa RLS pokazuje 'Brak pozycji.' i ANI JEDNEGO sygnału błędu", async () => {
    h.db!.setResponse("ad_slots", () => ok([]));
    h.db!.setResponse("ad_placements", () => fail("permission denied for table ad_placements"));
    render(<AdPlacementsPanel />);

    expect(await screen.findByText("Brak pozycji.")).toBeTruthy();
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it.fails(
    "awaria odczytu SLOTÓW też POWINNA być powiedziana - lista wyboru jest wtedy pusta",
    async () => {
      h.db!.setResponse("ad_slots", () => fail("permission denied for table ad_slots"));
      h.db!.setResponse("ad_placements", () => ok([]));
      render(<AdPlacementsPanel />);

      await waitFor(() => expect(h.toastError).toHaveBeenCalled(), { timeout: 300, interval: 20 });
    },
  );

  it("STAN FAKTYCZNY: odmowa odczytu slotów daje PUSTĄ listę wyboru bez ostrzeżenia", async () => {
    h.db!.setResponse("ad_slots", () => fail("permission denied for table ad_slots"));
    h.db!.setResponse("ad_placements", () => ok([]));
    render(<AdPlacementsPanel />);

    await screen.findByText("Brak pozycji.");
    expect((slotSelect() as HTMLSelectElement).options.length).toBe(0);
    expect(h.toastError).not.toHaveBeenCalled();
  });
});
