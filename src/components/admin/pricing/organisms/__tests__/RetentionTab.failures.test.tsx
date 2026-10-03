// Zakładka „Retencja odchodzących" - ŚCIEŻKI PORAŻKI i kolejność powodów.
//
// Podstawowy plik (`RetentionTab.test.tsx`) dowodzi szczęśliwych ścieżek.
// Ten przypina to, co dzieje się, gdy baza ODMÓWI albo odda nietypowy kształt:
//
//   1. ODMOWA ZAPISU NIGDY NIE WYGLĄDA JAK SUKCES. Zapis, usunięcie i zmiana
//      kolejności powodu, które baza odrzuciła (RLS, sieć), muszą dać komunikat
//      błędu z treścią odmowy - a nie zielone „zapisano". Redakcja, która
//      zobaczy „zapisano", przestaje sprawdzać, co klient widzi na ekranie
//      rezygnacji.
//   2. BRAK TENANTA = BRAK ZAPISU. Powód bez właściciela byłby wierszem
//      niewidocznym dla żadnego tenanta (albo widocznym dla złego).
//   3. AWARIA JEDNEGO ODCZYTU NIE ZABIERA RESZTY ZAKŁADKI. Trzy zapytania są
//      niezależne - padnięty przegląd odpowiedzi nie może zablokować edycji
//      katalogu powodów.
//   4. PRZESUNIĘCIE W GÓRĘ zapisuje DOKŁADNIE te wiersze, których pozycja się
//      zmieniła, i odświeża także cache ekranu klienta (`retention-reasons`).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import {
  ADMIN_NOW,
  fail,
  ok,
  radixSwitchStub,
  reactI18nextStub,
  retentionFeedback,
  supabaseFromStub,
  type RecordedChain,
  type SupabaseFromStub,
} from "@/test/admin/pricingFixtures";
import { retentionReason, retentionSettings } from "@/test/billing/fixtures";
import { freezeClock } from "@/test/time";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

// Zegar na kotwicy fixture'ów admina - patrz nagłówek `RetentionTab.test.tsx`.
freezeClock(ADMIN_NOW);

let chain: SupabaseFromStub;

vi.mock("react-i18next", () => reactI18nextStub());
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => chain.from(table) },
}));
vi.mock("@/components/ui/switch", async () => radixSwitchStub(await import("react")));

const toastSuccess = vi.fn();
const toastError = vi.fn();
const confirmStub = vi.fn(() => true);
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));

const { RetentionTab } = await import("@/components/admin/pricing/organisms/RetentionTab");

const DENIED = "permission denied for table retention_reasons";

/** Odczyt katalogu działa, a zapis wskazaną metodą zostaje odrzucony. */
function reasonsRejecting(method: "update" | "delete", rows = [retentionReason({ id: "r1" })]) {
  return (c: RecordedChain) => (c.has(method) ? fail(DENIED, "42501") : ok(rows));
}

/** Wszystkie łańcuchy zapisu (UPDATE) na katalogu powodów, w kolejności wysłania. */
function reasonUpdates(): { patch: unknown; filter: unknown }[] {
  return chain
    .chainsFor("retention_reasons")
    .filter((c) => c.has("update"))
    .map((c) => ({ patch: c.argsOf("update")?.[0], filter: c.argsOf("eq") }));
}

const rowOf = (label: string) => screen.getByDisplayValue(label).closest("div.grid") as HTMLElement;

beforeEach(() => {
  chain = supabaseFromStub();
  chain.setResponse("retention_settings", ok(retentionSettings()));
  chain.setResponse("retention_reasons", ok([]));
  chain.setResponse("retention_feedback", ok([]));
  toastSuccess.mockClear();
  toastError.mockClear();
  confirmStub.mockReturnValue(true);
  vi.stubGlobal("confirm", confirmStub);
});

describe("RetentionTab - awaria jednego odczytu nie zabiera reszty zakładki", () => {
  it("padnięty odczyt ustawień nie blokuje katalogu powodów ani przeglądu odpowiedzi", async () => {
    chain.setResponse("retention_settings", fail("permission denied for table retention_settings"));
    chain.setResponse("retention_reasons", ok([retentionReason({ id: "r1" })]));
    chain.setResponse(
      "retention_feedback",
      ok([retentionFeedback({ comment: "Za mało analiz o Bałtyku" })]),
    );
    const { queryClient } = renderWithQueryClient(<RetentionTab />);

    await waitFor(() => expect(screen.getByDisplayValue("Za drogo")).toBeInTheDocument());
    expect(screen.getByText("Za mało analiz o Bałtyku")).toBeInTheDocument();
    // Odmowa odczytu zostaje BŁĘDEM zapytania - nie jest połykana jako „brak
    // wiersza ustawień" (to byłby `null` i stan `success`).
    await waitFor(() =>
      expect(queryClient.getQueryState(["admin", "retention-settings"])?.status).toBe("error"),
    );
    expect(queryClient.getQueryData(["admin", "retention-settings"])).toBeUndefined();
    // Zakładka nie wysyła żadnego zapisu sama z siebie po nieudanym odczycie.
    expect(chain.chainsFor("retention_settings").some((c) => c.has("upsert"))).toBe(false);
  });

  it("padnięty przegląd odpowiedzi nie blokuje wczytania ustawień kontroferty", async () => {
    chain.setResponse("retention_settings", ok(retentionSettings({ discount_pct: 25 })));
    chain.setResponse("retention_feedback", fail("statement timeout"));
    const { queryClient } = renderWithQueryClient(<RetentionTab />);

    await waitFor(() => expect(screen.getAllByRole("spinbutton")[0]).toHaveValue(25));
    expect(screen.getByRole("button", { name: /retention\.addReason/ })).toBeInTheDocument();
    // Przekroczony czas odczytu to błąd zapytania, nie „zero odpowiedzi".
    await waitFor(() =>
      expect(queryClient.getQueryState(["admin", "retention-feedback"])?.status).toBe("error"),
    );
    expect(queryClient.getQueryData(["admin", "retention-feedback"])).toBeUndefined();
  });

  it("`null` zamiast listy z PostgREST to pusty katalog i pusty przegląd, nie wywrotka", async () => {
    chain.setResponse("retention_reasons", ok(null));
    chain.setResponse("retention_feedback", ok(null));
    renderWithQueryClient(<RetentionTab />);

    await waitFor(() =>
      expect(screen.getByText("adminPricing.retention.feedbackEmpty")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: /retention\.moveUp/ })).toBeNull();
    expect(screen.getByRole("button", { name: /retention\.addReason/ })).toBeInTheDocument();
  });
});

// Ustawienia, których panel NIE ZNA, nie mogą wyglądać jak domyślne 30/3/14.
// Zapis idzie `upsert`-em po tenancie i nadpisuje CAŁY wiersz - redakcja, która
// po padniętym odczycie poprawi tylko ważność kodu, po cichu zmieniłaby też
// prawdziwy rabat (np. 15%) na domyślne 30%.
describe("RetentionTab - nieznane ustawienia nie dają się nadpisać domyślnymi", () => {
  it("padnięty odczyt ustawień: komunikat z ponowieniem zamiast pól 30/3/14", async () => {
    chain.setResponse("retention_settings", fail("permission denied for table retention_settings"));
    // Powód niesie tenanta - bez naprawy przycisk zapisu miałby komu zapisać.
    chain.setResponse("retention_reasons", ok([retentionReason({ id: "r1" })]));
    renderWithQueryClient(<RetentionTab />);

    expect(await screen.findByText("adminPricing.retention.settingsLoadError")).toBeInTheDocument();
    expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);

    // Ponowienie wczytuje PRAWDZIWY rabat - dopiero wtedy da się go edytować.
    chain.setResponse("retention_settings", ok(retentionSettings({ discount_pct: 15 })));
    fireEvent.click(screen.getByRole("button", { name: "adminPricing.retention.retryLoad" }));

    await waitFor(() => expect(screen.getAllByRole("spinbutton")[0]).toHaveValue(15));
    expect(screen.queryByText("adminPricing.retention.settingsLoadError")).toBeNull();
    expect(chain.chainsFor("retention_settings").some((c) => c.has("upsert"))).toBe(false);
  });

  it("dopóki ustawienia się wczytują, panel nie pokazuje domyślnych wartości do zapisu", async () => {
    chain.setResponse("retention_settings", ok(retentionSettings({ discount_pct: 15 })));
    renderWithQueryClient(<RetentionTab />);

    // Pierwszy render: zapytanie jeszcze w toku - żadnych pól z wartościami domyślnymi.
    expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);
    await waitFor(() => expect(screen.getAllByRole("spinbutton")[0]).toHaveValue(15));
  });

  it("padnięty przegląd odpowiedzi to komunikat błędu, nie „brak odpowiedzi” ani zera w statystykach", async () => {
    chain.setResponse("retention_feedback", fail("statement timeout"));
    renderWithQueryClient(<RetentionTab />);

    expect(await screen.findByText("adminPricing.retention.feedbackLoadError")).toBeInTheDocument();
    expect(screen.queryByText("adminPricing.retention.feedbackEmpty")).toBeNull();
    // Statystyki z nieudanego odczytu byłyby fałszywym „0 odpowiedzi”.
    expect(screen.queryByText("adminPricing.retention.stats.total")).toBeNull();

    chain.setResponse(
      "retention_feedback",
      ok([retentionFeedback({ comment: "Za mało analiz o Bałtyku" })]),
    );
    fireEvent.click(screen.getByRole("button", { name: "adminPricing.retention.retryLoad" }));

    expect(await screen.findByText("Za mało analiz o Bałtyku")).toBeInTheDocument();
    expect(screen.getByText("adminPricing.retention.stats.total")).toBeInTheDocument();
  });
});

describe("RetentionTab - brak tenanta blokuje dodanie powodu", () => {
  it("pusta baza: dodanie powodu odmawia i NIE wysyła INSERT bez właściciela", async () => {
    chain.setResponse("retention_settings", ok(null));
    renderWithQueryClient(<RetentionTab />);
    await waitFor(() => expect(screen.getAllByRole("spinbutton")[0]).toHaveValue(30));

    const [pl, en] = screen.getAllByRole("textbox");
    fireEvent.change(pl, { target: { value: "Za drogo" } });
    fireEvent.change(en, { target: { value: "Too expensive" } });
    fireEvent.click(screen.getByRole("button", { name: /retention\.addReason/ }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("adminPricing.toast.noTenant"));
    expect(chain.chainsFor("retention_reasons").some((c) => c.has("insert"))).toBe(false);
    // Wpisany tekst zostaje - odmowa nie kasuje pracy redakcji.
    expect(screen.getAllByRole("textbox")[0]).toHaveValue("Za drogo");
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

describe("RetentionTab - odmowa zapisu nigdy nie wygląda jak sukces", () => {
  it("odrzucony zapis powodu: treść odmowy w komunikacie, bez „zapisano”", async () => {
    chain.setResponse("retention_reasons", reasonsRejecting("update"));
    renderWithQueryClient(<RetentionTab />);
    await waitFor(() => expect(screen.getByDisplayValue("Za drogo")).toBeInTheDocument());

    fireEvent.change(screen.getByDisplayValue("Za drogo"), { target: { value: "Cena" } });
    fireEvent.click(within(rowOf("Cena")).getByRole("button", { name: /retention\.save/ }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(DENIED));
    expect(toastSuccess).not.toHaveBeenCalledWith("adminPricing.toast.reasonSaved");
    // Szkic zostaje na ekranie - redakcja może ponowić zapis.
    expect(screen.getByDisplayValue("Cena")).toBeInTheDocument();
  });

  it("odrzucone usunięcie: komunikat błędu, powód zostaje w katalogu", async () => {
    chain.setResponse("retention_reasons", reasonsRejecting("delete"));
    renderWithQueryClient(<RetentionTab />);
    await waitFor(() => expect(screen.getByDisplayValue("Za drogo")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /retention\.reasonDelete/ }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(DENIED));
    const deleted = chain.chainsFor("retention_reasons").find((c) => c.has("delete"))!;
    expect(deleted.argsOf("eq")).toEqual(["id", "r1"]);
    expect(toastSuccess).not.toHaveBeenCalledWith("adminPricing.toast.reasonDeleted");
    expect(screen.getByDisplayValue("Za drogo")).toBeInTheDocument();
  });

  it("odrzucona zmiana kolejności: komunikat błędu, bez „zapisano kolejność”", async () => {
    chain.setResponse(
      "retention_reasons",
      reasonsRejecting("update", [
        retentionReason({ id: "r1", sort_order: 0 }),
        retentionReason({ id: "r2", sort_order: 10, label_pl: "Brak czasu" }),
      ]),
    );
    renderWithQueryClient(<RetentionTab />);
    await waitFor(() => expect(screen.getByDisplayValue("Brak czasu")).toBeInTheDocument());

    fireEvent.click(within(rowOf("Brak czasu")).getByRole("button", { name: /retention\.moveUp/ }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(DENIED));
    expect(toastSuccess).not.toHaveBeenCalledWith("adminPricing.toast.reordered");
    // Pierwszy odrzucony UPDATE przerywa renumerację - drugi wiersz nie jest już ruszany.
    expect(reasonUpdates()).toHaveLength(1);
  });
});

describe("RetentionTab - przesunięcie powodu w górę", () => {
  it("drugi powód idzie na pierwsze miejsce: dwa UPDATE-y po id, odświeżony też ekran klienta", async () => {
    chain.setResponse(
      "retention_reasons",
      ok([
        retentionReason({ id: "r1", sort_order: 0 }),
        retentionReason({ id: "r2", sort_order: 10, label_pl: "Brak czasu" }),
        retentionReason({ id: "r3", sort_order: 20, label_pl: "Inne źródło" }),
      ]),
    );
    const { queryClient } = renderWithQueryClient(<RetentionTab />);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await waitFor(() => expect(screen.getByDisplayValue("Brak czasu")).toBeInTheDocument());

    fireEvent.click(within(rowOf("Brak czasu")).getByRole("button", { name: /retention\.moveUp/ }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("adminPricing.toast.reordered"));
    // r3 zostaje na pozycji 20 - zapisujemy wyłącznie wiersze, które się ruszyły.
    expect(reasonUpdates()).toEqual([
      { patch: { sort_order: 0 }, filter: ["id", "r2"] },
      { patch: { sort_order: 10 }, filter: ["id", "r1"] },
    ]);
    const keys = invalidate.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(["admin", "retention-reasons"]));
    expect(keys).toContain(JSON.stringify(["retention-reasons"]));
  });
});
