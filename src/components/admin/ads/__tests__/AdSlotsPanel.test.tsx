// Organizm zakładki „Sloty": CO panel wysyła do `ad_slots` i czego NIE wysyła.
//
// CO TEN PLIK DOWODZI.
//   1. UTWORZENIE SLOTU NIGDY NIE STARTUJE Z `requires_consent: false`.
//      To jest decyzja RODO, nie ustawienie: slot bez zgody ładuje skrypt strony
//      trzeciej czytelnikowi, który zgody nie wyraził. Dowód jest TRZYSTOPNIOWY -
//      świeży draft (nikt nie tknął przełącznika), draft po świadomym wyłączeniu
//      (`false` naprawdę da się wysłać, czyli `true` nie jest artefaktem atrapy)
//      i draft PO UDANYM ZAPISIE (formularz wraca do wartości domyślnej, więc
//      drugi slot też startuje ze zgodą).
//   2. INSERT NIE WYSYŁA `tenant_id` - I TAK MA BYĆ. Kolumna ma
//      `DEFAULT public.current_tenant_id()` (migracja 20260624165846), a RLS
//      `WITH CHECK` porównuje ją z tym samym wyrażeniem. Asercja negatywna
//      zamyka fałszywy alarm „panel nie ustawia najemcy" i przyszłą „poprawkę",
//      która wpisałaby tam identyfikator z przeglądarki.
//   3. PUSTA (I BIAŁOZNAKOWA) NAZWA BLOKUJE ZAPYTANIE - nie ma insertu w ogóle,
//      a nie insert odrzucony przez bazę.
//   4. NAZWA NIE JEST OBCINANA PRZED ZAPISEM. Walidacja używa `.trim()`, zapis
//      nie - więc do bazy leci `"  Baner  "`. Dwa sloty różniące się tylko
//      spacją wyglądają na liście identycznie.
//   5. EDYCJA WYSYŁA CAŁY WIERSZ, nie różnicę: `id`, `tenant_id`, `created_at`
//      i STARY `updated_at` jadą w ładunku UPDATE.
//   6. USUNIĘCIE PRZECHODZI PRZEZ `confirmDialog` Z TREŚCIĄ SKUTKU, odmowa nie
//      wysyła DELETE, a potwierdzenie odświeża listę.
//   7. BŁĄD ZAPISU POKAZUJE SUROWY KOMUNIKAT POSTGRESA, a potwierdzenie zapisu
//      to TWARDY POLSKI NAPIS („Zapisano slot") - w tym samym pliku, w którym
//      bliźniaczy panel pozycji używa `adminToast.saved()`. Dwie konwencje na
//      jednym ekranie.
//   8. AWARIA ODCZYTU LISTY JEST POWIEDZIANA (to jedyna z trzech zakładek, która
//      czyta `error` - patrz `it.fails` w testach pozycji i statystyk).
//
// ATRAPY I DLACZEGO. `@/lib/appDialogs` trzyma MODUŁOWY `pending` i drugie
// wywołanie anuluje pierwsze - dlatego dialog jest atrapą, a asercja stoi na
// jego ARGUMENCIE. `@/lib/adminToasts` czyta PRAWDZIWĄ instancję i18next
// (własny import `@/lib/i18n`), więc jest atrapą echującą klucz - inaczej
// asercja stałaby na polskim tekście z innego słownika. Radix Select/Switch
// podmienione na natywne kontrolki (happy-dom nie ma zdarzeń wskaźnika).
//
// ADRESOWANIE POZYCYJNE: `getAllByRole("switch")` -> [0] status, [1] zgoda
// marketingowa. Powód (brak `id`/`aria-label` na kontrolkach) jest opisany
// w nagłówku `AdSlotForm.test.tsx`.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Widoku formularza - `AdSlotForm.test.tsx`.
// (2) Wiersza tabeli - `adsTableRows.test.tsx`. (3) Autorytetu dostępu: zapis
// do `ad_slots` pilnuje RLS + rola redakcji, czego render NIE dowodzi i nie
// udaje, że dowodzi (pgTAP i bramka authz-snapshot).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
vi.mock("@/hooks/useInterests", () => ({
  useInterestCatalog: () => ({ data: { categories: [], tags: [] } }),
}));
vi.mock("@/components/ui/select", async () =>
  (await import("@/test/reactStubs")).radixSelectStub(await import("react")),
);
vi.mock("@/components/ui/switch", async () =>
  (await import("@/test/reactStubs")).radixSwitchStub(await import("react")),
);
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabase");
  const db = supabaseFromStub();
  h.db = db;
  return { supabase: { from: (table: string) => db.from(table) } };
});

import { AdSlotsPanel, emptySlot } from "@/components/admin/ads/organisms/AdSlotsPanel";
import { fail, ok } from "@/test/supabase";
import type { AdSlot } from "@/lib/ads/types";

const SLOT_ROW: AdSlot = {
  id: "slot-1",
  tenant_id: "tenant-1",
  name: "Baner nagłówka",
  kind: "html",
  status: "active",
  html: "<b>kreacja</b>",
  script: null,
  image_url: null,
  image_link: null,
  image_alt: null,
  width: 728,
  height: 90,
  requires_consent: true,
  targeting: {},
  notes: null,
  created_at: "2026-07-01T09:00:00.000Z",
  updated_at: "2026-07-02T09:00:00.000Z",
};

/** Odczyt listy oddaje wiersze; zapisy (insert/update/delete) - sukces bez danych. */
function planSlots(rows: AdSlot[], writeResult = ok(null)) {
  h.db!.setResponse("ad_slots", (chain: RecordedChain) =>
    chain.has("insert") || chain.has("update") || chain.has("delete") ? writeResult : ok(rows),
  );
}

const writeChains = () =>
  h.db!.chainsFor("ad_slots").filter((c) => c.has("insert") || c.has("update") || c.has("delete"));

const readChains = () =>
  h.db!.chainsFor("ad_slots").filter((c) => c.has("select") && !c.has("insert"));

function payloadOf(method: "insert" | "update"): Record<string, unknown> {
  const chain = h.db!.chainsFor("ad_slots").find((c) => c.has(method));
  return (chain?.argsOf(method)?.[0] ?? {}) as Record<string, unknown>;
}

const nameField = () => screen.getByLabelText("adsAdmin.slots.fieldName");
const addButton = () => screen.getByRole("button", { name: "adsAdmin.slots.addAction" });
const switches = () => screen.getAllByRole("switch") as HTMLInputElement[];

beforeEach(() => {
  h.db?.reset();
  h.confirmCalls = [];
  h.confirmAnswer = true;
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
});

describe("zakładka slotów: zgoda marketingowa w ładunku insertu", () => {
  it("nowy slot leci do bazy z requires_consent: true, choć nikt nie tknął przełącznika", async () => {
    planSlots([]);
    render(<AdSlotsPanel />);
    await waitFor(() => expect(readChains().length).toBeGreaterThan(0));

    fireEvent.change(nameField(), { target: { value: "Baner testowy" } });
    fireEvent.click(addButton());

    await waitFor(() => expect(writeChains().length).toBe(1));
    const payload = payloadOf("insert");
    expect(payload.requires_consent).toBe(true);
    expect(payload.status).toBe("active");
    expect(payload.kind).toBe("html");
  });

  it("świadome wyłączenie zgody DA SIĘ wysłać - czyli `true` nie jest artefaktem atrapy", async () => {
    planSlots([]);
    render(<AdSlotsPanel />);
    await waitFor(() => expect(readChains().length).toBeGreaterThan(0));

    fireEvent.change(nameField(), { target: { value: "Baner bez zgody" } });
    fireEvent.click(switches()[1]);
    fireEvent.click(addButton());

    await waitFor(() => expect(writeChains().length).toBe(1));
    expect(payloadOf("insert").requires_consent).toBe(false);
  });

  it("po udanym zapisie formularz wraca do wartości domyślnej - drugi slot znowu ze zgodą", async () => {
    planSlots([]);
    render(<AdSlotsPanel />);
    await waitFor(() => expect(readChains().length).toBeGreaterThan(0));

    fireEvent.change(nameField(), { target: { value: "Pierwszy" } });
    fireEvent.click(switches()[1]);
    fireEvent.click(addButton());
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());

    expect((nameField() as HTMLInputElement).value).toBe("");
    expect(switches()[1].checked).toBe(true);
  });

  it("domyślny draft ma zgodę włączoną także jako czysta wartość (bez renderu)", () => {
    // Ta asercja stoi obok dowodu przez formularz z premedytacją: gdyby ktoś
    // zamienił `emptySlot()` na obiekt bez tego pola, kolumna i tak ma DEFAULT
    // true - i wtedy test renderu dalej byłby zielony, a decyzja panelu
    // zniknęłaby bez śladu.
    expect(emptySlot().requires_consent).toBe(true);
  });
});

describe("zakładka slotów: czego panel NIE wysyła", () => {
  it("insert nie zawiera tenant_id - najemcę ustawia DEFAULT current_tenant_id()", async () => {
    planSlots([]);
    render(<AdSlotsPanel />);
    await waitFor(() => expect(readChains().length).toBeGreaterThan(0));

    fireEvent.change(nameField(), { target: { value: "Baner" } });
    fireEvent.click(addButton());

    await waitFor(() => expect(writeChains().length).toBe(1));
    expect("tenant_id" in payloadOf("insert")).toBe(false);
  });

  it("insert nie zawiera id - identyfikator nadaje baza", async () => {
    planSlots([]);
    render(<AdSlotsPanel />);
    await waitFor(() => expect(readChains().length).toBeGreaterThan(0));

    fireEvent.change(nameField(), { target: { value: "Baner" } });
    fireEvent.click(addButton());

    await waitFor(() => expect(writeChains().length).toBe(1));
    expect("id" in payloadOf("insert")).toBe(false);
  });
});

describe("zakładka slotów: bramka nazwy", () => {
  it("pusta nazwa NIE wysyła zapytania - toast z klucza i zero zapisów", async () => {
    planSlots([]);
    render(<AdSlotsPanel />);
    await waitFor(() => expect(readChains().length).toBeGreaterThan(0));

    fireEvent.click(addButton());

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("adsAdmin.slots.nameRequired"));
    expect(writeChains()).toEqual([]);
  });

  it("nazwa z samych spacji też nie przechodzi (walidacja używa trim)", async () => {
    planSlots([]);
    render(<AdSlotsPanel />);
    await waitFor(() => expect(readChains().length).toBeGreaterThan(0));

    fireEvent.change(nameField(), { target: { value: "   " } });
    fireEvent.click(addButton());

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("adsAdmin.slots.nameRequired"));
    expect(writeChains()).toEqual([]);
  });

  it("nazwa NIE jest obcinana przed zapisem - do bazy leci wersja ze spacjami", async () => {
    planSlots([]);
    render(<AdSlotsPanel />);
    await waitFor(() => expect(readChains().length).toBeGreaterThan(0));

    fireEvent.change(nameField(), { target: { value: "  Baner  " } });
    fireEvent.click(addButton());

    await waitFor(() => expect(writeChains().length).toBe(1));
    expect(payloadOf("insert").name).toBe("  Baner  ");
  });
});

describe("zakładka slotów: edycja istniejącego wiersza", () => {
  it("UPDATE wysyła CAŁY wiersz - z kolumnami niemutowalnymi i starym updated_at", async () => {
    planSlots([SLOT_ROW]);
    render(<AdSlotsPanel />);
    await screen.findByText("Baner nagłówka");

    fireEvent.click(screen.getByRole("button", { name: "Edytuj" }));
    fireEvent.click(screen.getByRole("button", { name: "adsAdmin.save" }));

    await waitFor(() => expect(writeChains().length).toBe(1));
    const payload = payloadOf("update");
    expect(Object.keys(payload)).toEqual(
      expect.arrayContaining(["id", "tenant_id", "created_at", "updated_at"]),
    );
    expect(payload.updated_at).toBe(SLOT_ROW.updated_at);
    // Filtr czytamy z łańcucha UPDATE, nie z ostatniego łańcucha tabeli:
    // po udanym zapisie panel odświeża listę, więc ostatni łańcuch to SELECT.
    expect(writeChains()[0].argsOf("eq")).toEqual(["id", "slot-1"]);
  });

  it("'Anuluj' porzuca edycję i przywraca draft domyślny - ze zgodą WŁĄCZONĄ", async () => {
    planSlots([{ ...SLOT_ROW, requires_consent: false }]);
    render(<AdSlotsPanel />);
    await screen.findByText("Baner nagłówka");

    fireEvent.click(screen.getByRole("button", { name: "Edytuj" }));
    expect((nameField() as HTMLInputElement).value).toBe("Baner nagłówka");
    expect(switches()[1].checked).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Anuluj" }));

    expect((nameField() as HTMLInputElement).value).toBe("");
    expect(switches()[1].checked).toBe(true);
    expect(writeChains()).toEqual([]);
  });

  it("edycja NIE wysyła insertu - to update z filtrem po identyfikatorze", async () => {
    planSlots([SLOT_ROW]);
    render(<AdSlotsPanel />);
    await screen.findByText("Baner nagłówka");

    fireEvent.click(screen.getByRole("button", { name: "Edytuj" }));
    fireEvent.click(screen.getByRole("button", { name: "adsAdmin.save" }));

    await waitFor(() => expect(writeChains().length).toBe(1));
    expect(writeChains()[0].has("insert")).toBe(false);
    expect(writeChains()[0].has("update")).toBe(true);
  });
});

describe("zakładka slotów: usuwanie", () => {
  it("odmowa w dialogu NIE wysyła DELETE", async () => {
    h.confirmAnswer = false;
    planSlots([SLOT_ROW]);
    render(<AdSlotsPanel />);
    await screen.findByText("Baner nagłówka");

    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[1]);

    await waitFor(() => expect(h.confirmCalls.length).toBe(1));
    expect(writeChains()).toEqual([]);
  });

  it("potwierdzenie wysyła DELETE z filtrem po id, potwierdza toastem i ODŚWIEŻA listę", async () => {
    planSlots([SLOT_ROW]);
    render(<AdSlotsPanel />);
    await screen.findByText("Baner nagłówka");
    const readsBefore = readChains().length;

    fireEvent.click(screen.getAllByRole("button")[1]);

    await waitFor(() => expect(writeChains().length).toBe(1));
    const del = writeChains()[0];
    expect(del.has("delete")).toBe(true);
    expect(del.argsOf("eq")).toEqual(["id", "slot-1"]);
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("adminToasts.deleted"));
    await waitFor(() => expect(readChains().length).toBe(readsBefore + 1));
  });

  it("dialog slotu MÓWI, CO ZNIKNIE - tytuł, opis skutku, styl destrukcyjny", async () => {
    planSlots([SLOT_ROW]);
    render(<AdSlotsPanel />);
    await screen.findByText("Baner nagłówka");

    fireEvent.click(screen.getAllByRole("button")[1]);

    await waitFor(() => expect(h.confirmCalls.length).toBe(1));
    expect(h.confirmCalls[0]).toEqual({
      title: "adsAdmin.slots.deleteTitle",
      description: "adsAdmin.slots.deleteBody",
      destructive: true,
      confirmLabel: "adsAdmin.deleteConfirm",
    });
  });
});

describe("zakładka slotów: awarie i potwierdzenia", () => {
  it("błąd zapisu pokazuje SUROWY komunikat Postgresa, nie klucz i18n", async () => {
    planSlots([], fail("duplicate key value violates unique constraint", "23505"));
    render(<AdSlotsPanel />);
    await waitFor(() => expect(readChains().length).toBeGreaterThan(0));

    fireEvent.change(nameField(), { target: { value: "Baner" } });
    fireEvent.click(addButton());

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("duplicate key value violates unique constraint"),
    );
    expect(h.toastError).not.toHaveBeenCalledWith("adminToasts.error");
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("potwierdzenie zapisu slotu to TWARDY polski napis, a nie adminToast.saved()", async () => {
    planSlots([]);
    render(<AdSlotsPanel />);
    await waitFor(() => expect(readChains().length).toBeGreaterThan(0));

    fireEvent.change(nameField(), { target: { value: "Baner" } });
    fireEvent.click(addButton());

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("Zapisano slot"));
    expect(h.toastSuccess).not.toHaveBeenCalledWith("adminToasts.saved");
  });

  it("AWARIA ODCZYTU LISTY jest powiedziana - ta zakładka czyta pole error", async () => {
    h.db!.setResponse("ad_slots", () => fail("permission denied for table ad_slots", "42501"));
    render(<AdSlotsPanel />);

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("permission denied for table ad_slots"),
    );
  });

  it("pusta lista mówi TWARDYM polskim napisem, a nagłówki kolumn jadą z kluczy", async () => {
    planSlots([]);
    render(<AdSlotsPanel />);

    expect(await screen.findByText("Brak slotów. Dodaj pierwszy poniżej.")).toBeTruthy();
    expect(screen.getByText("adsAdmin.slots.columnName")).toBeTruthy();
    expect(screen.getByText("adsAdmin.slots.columnKind")).toBeTruthy();
    expect(screen.getByText("adsAdmin.slots.columnStatus")).toBeTruthy();
    expect(screen.getByText("adsAdmin.slots.columnConsent")).toBeTruthy();
    expect(screen.getByText("adsAdmin.columnTargeting")).toBeTruthy();
  });

  it("odpowiedź bez wierszy (data: null, brak błędu) czyta się jak pusta lista", async () => {
    // PostgREST potrafi oddać `data: null` bez błędu; bez `?? []` panel
    // wywróciłby się na `slots.map` zamiast pokazać stan pusty.
    h.db!.setResponse("ad_slots", () => ok(null));
    render(<AdSlotsPanel />);

    expect(await screen.findByText("Brak slotów. Dodaj pierwszy poniżej.")).toBeTruthy();
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("lista jest czytana najnowszymi od góry - kolejność decyduje, co admin widzi pierwsze", async () => {
    planSlots([]);
    render(<AdSlotsPanel />);
    await waitFor(() => expect(readChains().length).toBeGreaterThan(0));
    expect(readChains()[0].argsOf("order")).toEqual(["created_at", { ascending: false }]);
  });
});
