// Panel subskrybentów - lista, filtry i ręczne operacje na ZGODZIE.
//
// To jedyne miejsce, w którym człowiek zmienia cudzą zgodę marketingową
// pojedynczym kliknięciem. Testy pilnują trzech rzeczy, których operator nie
// widzi na ekranie:
//   1. wypisanie jest MIĘKKIE (status + znacznik czasu), a nie DELETE - zapis
//      zgody i jej cofnięcia musi zostać dla dowodu,
//   2. usunięcie wiersza wymaga potwierdzenia i NIE wykonuje się, gdy operator
//      je odrzuci,
//   3. kliknięcie ikony akcji NIE otwiera dialogu szczegółów (akcje żyją
//      w klikalnym wierszu, więc bez zatrzymania propagacji każde wypisanie
//      otwierałoby jeszcze okno).
//
// Reguły filtrowania i eksportu mają własny test obok - tutaj sprawdzamy, że
// panel ich UŻYWA i pokazuje ich wynik.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
  del: vi.fn(),
  confirmDialog: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && "count" in opts ? `${key}:${String(opts.count)}` : key,
    i18n: { language: "pl" },
  }),
}));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/appDialogs", () => ({ confirmDialog: h.confirmDialog }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: h.select,
      update: h.update,
      delete: h.del,
    }),
  },
}));
// Dialogi potomne mają własne testy - tu tylko sondy, żeby zobaczyć, KIEDY są
// otwierane i z jakim identyfikatorem.
vi.mock("@/components/admin/newsletter/subscribers/ImportCsvDialog", () => ({
  ImportCsvDialog: ({ open }: { open: boolean }) => (
    <div data-testid="import-dialog">{open ? "otwarty" : "zamkniety"}</div>
  ),
}));
vi.mock("@/components/admin/newsletter/subscribers/SubscriberDetailDialog", () => ({
  SubscriberDetailDialog: ({ subscriberId }: { subscriberId: string | null }) => (
    <div data-testid="detail-dialog">{subscriberId ?? "brak"}</div>
  ),
}));

import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { SubscribersPanel } from "@/components/admin/newsletter/SubscribersPanel";

interface Row {
  id: string;
  email: string;
  display_name: string | null;
  language: string;
  status: string;
  source: string | null;
  created_at: string;
  confirmed_at: string | null;
}

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: "a",
    email: "anna@example.test",
    display_name: "Anna Nowak",
    language: "pl",
    status: "subscribed",
    source: "formularz",
    created_at: "2026-08-01T10:00:00.000Z",
    confirmed_at: "2026-08-01T10:05:00.000Z",
    ...overrides,
  };
}

const ROWS: Row[] = [
  row({ id: "a", email: "anna@example.test", display_name: "Anna Nowak", status: "subscribed" }),
  row({
    id: "b",
    email: "borys@example.test",
    display_name: "Borys Kowal",
    status: "pending",
    language: "en",
  }),
  row({
    id: "c",
    email: "cezary@example.test",
    display_name: null,
    status: "unsubscribed",
    source: null,
  }),
];

/** Łańcuch odczytu listy: select().order().limit() -> wynik. */
function planSelect(rows: Row[] | null, error: { message: string } | null = null): void {
  h.select.mockReturnValue({
    order: () => ({ limit: () => Promise.resolve({ data: rows, error }) }),
  });
}

/** Łańcuch zapisu: update().eq() / delete().eq(). */
function planMutations(updateError: unknown = null, deleteError: unknown = null): void {
  h.update.mockReturnValue({ eq: () => Promise.resolve({ error: updateError }) });
  h.del.mockReturnValue({ eq: () => Promise.resolve({ error: deleteError }) });
}

function mount() {
  return renderWithQueryClient(<SubscribersPanel />);
}

/** Czeka na wiersze tabeli. */
async function mountWithRows(rows: Row[] = ROWS) {
  planSelect(rows);
  const utils = mount();
  if (rows.length) await screen.findByText(rows[0]!.email);
  return utils;
}

beforeEach(() => {
  vi.clearAllMocks();
  planSelect(ROWS);
  planMutations();
  h.confirmDialog.mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
});

describe("stany listy", () => {
  it("na starcie pokazuje stan ładowania", () => {
    h.select.mockReturnValue({ order: () => ({ limit: () => new Promise(() => {}) }) });
    mount();

    expect(screen.getByText("adminNewsletter.subscribers.loading")).toBeTruthy();
    expect(screen.queryByText("anna@example.test")).toBeNull();
  });

  it("pusta lista pokazuje stan pusty, nie zero wierszy bez komunikatu", async () => {
    planSelect([]);
    mount();

    expect(await screen.findByText("adminNewsletter.subscribers.emptyFiltered")).toBeTruthy();
    expect(screen.queryAllByRole("row").length).toBeLessThan(3);
  });

  it("odpowiedź `null` traktuje jak pustą listę", async () => {
    planSelect(null);
    mount();

    // `null` z PostgREST nie może wywrócić `.map()` w tabeli.
    expect(await screen.findByText("adminNewsletter.subscribers.emptyFiltered")).toBeTruthy();
    expect(screen.queryByText(/capWarning/)).toBeNull();
  });

  it("wiersze pokazują adres, nazwę, język, status i źródło", async () => {
    await mountWithRows();

    expect(screen.getByText("anna@example.test")).toBeTruthy();
    expect(screen.getByText("Anna Nowak")).toBeTruthy();
    expect(screen.getAllByText("subscribed").length).toBeGreaterThanOrEqual(1);
    // Trzeci wiersz ma źródło `null`, więc pokazuje kreskę.
    expect(screen.getAllByText("formularz").length).toBe(2);
  });

  it("brakująca nazwa i źródło pokazują kreskę, nie pustkę", async () => {
    await mountWithRows([row({ id: "c", display_name: null, source: null })]);

    expect(screen.getAllByText("-").length).toBeGreaterThanOrEqual(2);
    // Kreska, nie słowo „null" w tabeli.
    expect(screen.queryByText("null")).toBeNull();
  });

  it("nagłówek liczy WIDOCZNE wiersze", async () => {
    await mountWithRows();

    expect(screen.getByText("adminNewsletter.subscribers.heading:3")).toBeTruthy();
    // Liczba idzie z danych, nie ze stałej - zero byłoby innym podpisem.
    expect(screen.queryByText("adminNewsletter.subscribers.heading:0")).toBeNull();
  });
});

describe("ostrzeżenie o limicie odczytu", () => {
  it("poniżej limitu nie ostrzega", async () => {
    await mountWithRows();

    expect(screen.queryByText(/capWarning/)).toBeNull();
    // Tabela jednak się wyrenderowała - brak ostrzeżenia to nie brak danych.
    expect(screen.getByText("adminNewsletter.subscribers.heading:3")).toBeTruthy();
  });

  // Ścieżka Z ostrzeżeniem nie jest tu renderowana świadomie: warunek to
  // czysta reguła `isFetchCapped`, przybita na granicach w subscriberRules,
  // a wyrenderowanie 5000 wierszy tabeli kosztowało w pomiarze ponad minutę
  // CI za jedną asercję.
});

describe("filtry", () => {
  it("szukanie zawęża listę i przelicza nagłówek", async () => {
    await mountWithRows();

    fireEvent.change(screen.getByPlaceholderText("adminNewsletter.subscribers.searchPlaceholder"), {
      target: { value: "borys" },
    });

    await waitFor(() => expect(screen.queryByText("anna@example.test")).toBeNull());
    expect(screen.getByText("adminNewsletter.subscribers.heading:1")).toBeTruthy();
  });

  it("szukanie po nazwie działa tak samo jak po adresie", async () => {
    await mountWithRows();

    fireEvent.change(screen.getByPlaceholderText("adminNewsletter.subscribers.searchPlaceholder"), {
      target: { value: "Kowal" },
    });

    await waitFor(() => expect(screen.getByText("borys@example.test")).toBeTruthy());
    expect(screen.queryByText("anna@example.test")).toBeNull();
  });

  it("filtr statusu zostawia tylko pasujące wiersze", async () => {
    await mountWithRows();

    const trigger = screen.getAllByRole("combobox")[0] as HTMLElement;
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(
      await screen.findByRole("option", { name: "adminNewsletter.subscribers.statusPending" }),
    );

    await waitFor(() => expect(screen.queryByText("anna@example.test")).toBeNull());
    expect(screen.getByText("borys@example.test")).toBeTruthy();
  });

  it("filtr języka zostawia tylko pasujące wiersze", async () => {
    await mountWithRows();

    const trigger = screen.getAllByRole("combobox")[1] as HTMLElement;
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: "EN" }));

    await waitFor(() => expect(screen.getByText("borys@example.test")).toBeTruthy());
    expect(screen.queryByText("anna@example.test")).toBeNull();
  });

  it("fraza bez trafień pokazuje stan pusty", async () => {
    await mountWithRows();

    fireEvent.change(screen.getByPlaceholderText("adminNewsletter.subscribers.searchPlaceholder"), {
      target: { value: "nie-ma-takiego" },
    });

    expect(await screen.findByText("adminNewsletter.subscribers.emptyFiltered")).toBeTruthy();
    expect(screen.getByText("adminNewsletter.subscribers.heading:0")).toBeTruthy();
  });
});

describe("eksport CSV", () => {
  it("jest ZABLOKOWANY, gdy nie ma czego wyeksportować", async () => {
    planSelect([]);
    mount();
    await screen.findByText("adminNewsletter.subscribers.emptyFiltered");

    const button = screen.getByRole("button", { name: /exportCsv/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    // Przycisk jednak JEST widoczny - operator wie, że eksport istnieje.
    expect(button.textContent).toBeTruthy();
  });

  it("eksportuje WIDOCZNE wiersze i nazywa plik datą", async () => {
    const createUrl = vi.fn().mockReturnValue("blob:csv");
    const revokeUrl = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL: createUrl, revokeObjectURL: revokeUrl });
    const clicks: HTMLAnchorElement[] = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreate(tag);
      if (tag === "a") {
        clicks.push(el as HTMLAnchorElement);
        (el as HTMLAnchorElement).click = vi.fn();
      }
      return el;
    });

    await mountWithRows();
    fireEvent.click(screen.getByRole("button", { name: /exportCsv/ }));

    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(clicks[0]?.download).toMatch(/^newsletter-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(revokeUrl).toHaveBeenCalledWith("blob:csv");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
});

describe("otwieranie okien", () => {
  it("przycisk importu otwiera dialog CSV", async () => {
    await mountWithRows();

    expect(screen.getByTestId("import-dialog").textContent).toBe("zamkniety");
    fireEvent.click(screen.getByRole("button", { name: /Import CSV/ }));

    expect(screen.getByTestId("import-dialog").textContent).toBe("otwarty");
  });

  it("klik w WIERSZ otwiera szczegóły tego subskrybenta", async () => {
    await mountWithRows();

    expect(screen.getByTestId("detail-dialog").textContent).toBe("brak");
    fireEvent.click(screen.getByText("borys@example.test"));

    expect(screen.getByTestId("detail-dialog").textContent).toBe("b");
  });
});

describe("ręczna zmiana zgody", () => {
  it("wypisanie jest MIĘKKIE - status plus znacznik czasu, nigdy DELETE", async () => {
    await mountWithRows();

    fireEvent.click(screen.getAllByLabelText("adminNewsletter.subscribers.unsubscribeAction")[0]!);

    await waitFor(() => expect(h.update).toHaveBeenCalled());
    const payload = h.update.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.status).toBe("unsubscribed");
    expect(payload.unsubscribed_at).toEqual(expect.any(String));
    expect(h.del).not.toHaveBeenCalled();
  });

  it("przywrócenie czyści znacznik wypisania", async () => {
    await mountWithRows();

    fireEvent.click(screen.getByLabelText("adminNewsletter.subscribers.resubscribeAction"));

    await waitFor(() => expect(h.update).toHaveBeenCalled());
    expect(h.update.mock.calls[0]?.[0]).toEqual({ status: "subscribed", unsubscribed_at: null });
  });

  it("wiersz WYPISANY ma przycisk przywrócenia, a nie wypisania", async () => {
    await mountWithRows([row({ id: "c", status: "unsubscribed" })]);

    expect(screen.getByLabelText("adminNewsletter.subscribers.resubscribeAction")).toBeTruthy();
    expect(screen.queryByLabelText("adminNewsletter.subscribers.unsubscribeAction")).toBeNull();
  });

  it("wiersz OCZEKUJĄCY ma przycisk wypisania", async () => {
    await mountWithRows([row({ id: "b", status: "pending" })]);

    expect(screen.getByLabelText("adminNewsletter.subscribers.unsubscribeAction")).toBeTruthy();
    expect(screen.queryByLabelText("adminNewsletter.subscribers.resubscribeAction")).toBeNull();
  });

  it("klik w ikonę akcji NIE otwiera szczegółów", async () => {
    await mountWithRows();

    fireEvent.click(screen.getAllByLabelText("adminNewsletter.subscribers.unsubscribeAction")[0]!);

    await waitFor(() => expect(h.update).toHaveBeenCalled());
    // Bez zatrzymania propagacji każde wypisanie otwierałoby jeszcze okno.
    expect(screen.getByTestId("detail-dialog").textContent).toBe("brak");
  });

  it("po zmianie melduje sukces i odświeża listę oraz wskaźniki", async () => {
    const { queryClient } = await mountWithRows();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    fireEvent.click(screen.getAllByLabelText("adminNewsletter.subscribers.unsubscribeAction")[0]!);

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(keys.some((k) => k.includes("newsletter-subscribers"))).toBe(true);
    expect(keys.some((k) => k.includes("newsletter-kpis"))).toBe(true);
  });

  it("BŁĄD zmiany nie udaje sukcesu", async () => {
    planMutations({ message: "brak uprawnień" });
    await mountWithRows();

    fireEvent.click(screen.getAllByLabelText("adminNewsletter.subscribers.unsubscribeAction")[0]!);

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("adminNewsletter.subscribers.actionError"),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("usuwanie subskrybenta", () => {
  it("wymaga POTWIERDZENIA i dopiero wtedy usuwa", async () => {
    await mountWithRows();

    fireEvent.click(screen.getAllByLabelText("adminNewsletter.subscribers.deleteAria")[0]!);

    await waitFor(() => expect(h.del).toHaveBeenCalled());
    expect(h.confirmDialog).toHaveBeenCalledTimes(1);
    expect(h.confirmDialog.mock.calls[0]?.[0]).toMatchObject({ destructive: true });
  });

  it("ODRZUCONE potwierdzenie NIE usuwa niczego", async () => {
    h.confirmDialog.mockResolvedValue(false);
    await mountWithRows();

    fireEvent.click(screen.getAllByLabelText("adminNewsletter.subscribers.deleteAria")[0]!);

    await waitFor(() => expect(h.confirmDialog).toHaveBeenCalled());
    expect(h.del).not.toHaveBeenCalled();
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("błąd usunięcia pokazuje powód z bazy", async () => {
    planMutations(null, { message: "wiersz powiązany" });
    await mountWithRows();

    fireEvent.click(screen.getAllByLabelText("adminNewsletter.subscribers.deleteAria")[0]!);

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("wiersz powiązany"));
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("po usunięciu odświeża listę i wskaźniki", async () => {
    const { queryClient } = await mountWithRows();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    fireEvent.click(screen.getAllByLabelText("adminNewsletter.subscribers.deleteAria")[0]!);

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
