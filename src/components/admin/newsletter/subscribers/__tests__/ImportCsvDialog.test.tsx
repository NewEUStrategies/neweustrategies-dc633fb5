// Dialog importu subskrybentów z CSV - najbardziej ryzykowna operacja panelu.
//
// Jednym kliknięciem wprowadza na listę mailingową cudze DANE OSOBOWE wraz ze
// statusem zgody marketingowej. Testy pilnują tego, czego operator nie ma jak
// sprawdzić na oko:
//   * przycisk importu jest ZABLOKOWANY, dopóki nie ma zmapowanego adresu
//     i choćby jednego wiersza z poprawnym adresem,
//   * licznik nad podglądem mówi PRAWDĘ o tym, ile wierszy naprawdę wejdzie,
//   * do server fn leci dokładnie to, co widać w podglądzie,
//   * błąd importu nie znika po cichu, a dialog nie zamyka się „na sukces".
//
// Warstwa reguł (rozpoznanie nagłówka, słowniki wartości) ma własny test obok -
// tutaj sprawdzamy SKLEJENIE: plik -> mapowanie -> podgląd -> wysyłka.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  importFn: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
}));

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => h.importFn,
}));
vi.mock("@/lib/newsletter-admin.functions", () => ({ importNewsletterSubscribers: {} }));
vi.mock("sonner", () => ({
  toast: { success: h.toastSuccess, error: h.toastError, warning: h.toastWarning },
}));

import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { ImportCsvDialog } from "@/components/admin/newsletter/subscribers/ImportCsvDialog";

const CSV = [
  "email,imie,nazwisko,jezyk,status",
  "anna@example.test,Anna,Nowak,pl,subscribed",
  "borys@example.test,Borys,Kowal,en,pending",
].join("\n");

/** Podstawia plik w ukrytym `input[type=file]` dialogu. */
async function uploadCsv(text: string, name = "lista.csv"): Promise<void> {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([text], name, { type: "text/csv" });
  // happy-dom nie implementuje File.text() dla konstruowanych plików.
  Object.defineProperty(file, "text", { value: () => Promise.resolve(text) });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
  await screen.findByText(/Mapowanie kolumn/);
}

function importButton(): HTMLButtonElement {
  return screen
    .getAllByRole("button")
    .find((b) => /Importuj|Importowanie/.test(b.textContent ?? "")) as HTMLButtonElement;
}

const onOpenChange = vi.fn();

function mount(open = true) {
  return renderWithQueryClient(<ImportCsvDialog open={open} onOpenChange={onOpenChange} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.importFn.mockResolvedValue({ imported: 2, skipped: 0, errors: [] });
});

afterEach(() => {
  cleanup();
});

describe("krok 1: wgranie pliku", () => {
  it("zamknięty dialog nic nie renderuje", () => {
    mount(false);

    expect(screen.queryByText(/Import subskrybentow z CSV/)).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it("otwarty dialog prosi o plik i nie pokazuje jeszcze mapowania", () => {
    mount();

    expect(screen.getByText(/Kliknij aby wybrac plik/)).toBeTruthy();
    expect(screen.queryByText(/Mapowanie kolumn/)).toBeNull();
  });

  it("po wgraniu pliku pokazuje jego nazwę i liczbę wierszy", async () => {
    mount();
    await uploadCsv(CSV);

    expect(screen.getByText("lista.csv")).toBeTruthy();
    expect(screen.getByText(/2 wierszy, 2 z poprawnym e-mailem/)).toBeTruthy();
  });

  it("„Zmien plik” wraca do kroku wgrywania", async () => {
    mount();
    await uploadCsv(CSV);

    fireEvent.click(screen.getByRole("button", { name: /Zmien plik/ }));

    expect(screen.getByText(/Kliknij aby wybrac plik/)).toBeTruthy();
    expect(screen.queryByText(/Mapowanie kolumn/)).toBeNull();
  });
});

describe("krok 2: mapowanie i podgląd", () => {
  it("licznik odróżnia wiersze pliku od wierszy z poprawnym adresem", async () => {
    mount();
    await uploadCsv(
      [
        "email,imie",
        "anna@example.test,Anna",
        "to nie adres,Borys",
        "cezary@example.test,Cezary",
      ].join("\n"),
    );

    expect(screen.getByText(/3 wierszy, 2 z poprawnym e-mailem/)).toBeTruthy();
    expect(importButton().textContent).toContain("Importuj 2");
  });

  it("podgląd pokazuje adresy, które naprawdę wejdą", async () => {
    mount();
    await uploadCsv(CSV);

    expect(screen.getByText("anna@example.test")).toBeTruthy();
    expect(screen.getByText("borys@example.test")).toBeTruthy();
  });

  it("podgląd ogranicza się do pięciu pierwszych adresów", async () => {
    const rows = Array.from({ length: 8 }, (_, i) => `osoba${i}@example.test,Imie${i}`);
    mount();
    await uploadCsv(["email,imie", ...rows].join("\n"));

    expect(screen.getByText("osoba4@example.test")).toBeTruthy();
    expect(screen.queryByText("osoba5@example.test")).toBeNull();
  });

  it("kolumna bez nagłówka dostaje zastępczą etykietę", async () => {
    mount();
    await uploadCsv(["email,", "anna@example.test,x"].join("\n"));

    expect(screen.getByText("col_2")).toBeTruthy();
    expect(screen.getByText("email")).toBeTruthy();
  });

  it("lista wyboru pozwala PRZEMAPOWAĆ kolumnę, a podgląd idzie za zmianą", async () => {
    mount();
    // Nagłówek „kontakt" nie jest rozpoznawany, więc import startuje zablokowany.
    await uploadCsv(["kontakt,imie", "anna@example.test,Anna"].join("\n"));
    expect(importButton().disabled).toBe(true);

    const trigger = screen.getAllByRole("combobox")[0] as HTMLElement;
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: /E-mail \(wymagane\)/ }));

    await waitFor(() => expect(importButton().disabled).toBe(false));
    expect(screen.getByText(/1 wierszy, 1 z poprawnym e-mailem/)).toBeTruthy();
  });

  it("pozycja „pomiń” wyłącza kolumnę - i nie wywraca kontrolki", async () => {
    mount();
    await uploadCsv(CSV);
    expect(importButton().disabled).toBe(false);

    const trigger = screen.getAllByRole("combobox")[0] as HTMLElement;
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: /pomin/ }));

    // Bez zmapowanego adresu import jest zablokowany, a dialog nadal żyje.
    await waitFor(() => expect(importButton().disabled).toBe(true));
    expect(screen.getByText(/Wybierz kolumne z adresem e-mail/)).toBeTruthy();
  });

  it("plik BEZ kolumny adresu ostrzega i blokuje import", async () => {
    mount();
    await uploadCsv(["imie,nazwisko", "Anna,Nowak"].join("\n"));

    expect(screen.getByText(/Wybierz kolumne z adresem e-mail/)).toBeTruthy();
    expect(importButton().disabled).toBe(true);
  });

  it("plik z kolumną adresu, ale bez poprawnych adresów, też blokuje import", async () => {
    mount();
    await uploadCsv(["email,imie", "to nie adres,Anna"].join("\n"));

    expect(importButton().disabled).toBe(true);
    expect(screen.getByText(/1 wierszy, 0 z poprawnym e-mailem/)).toBeTruthy();
  });

  it("plik z samym nagłówkiem nie ma czego importować", async () => {
    mount();
    await uploadCsv("email,imie");

    expect(importButton().disabled).toBe(true);
    expect(screen.getByText(/0 wierszy, 0 z poprawnym e-mailem/)).toBeTruthy();
  });
});

describe("krok 3: wysyłka", () => {
  it("wysyła wiersze z podglądu i oznacza źródło importu", async () => {
    mount();
    await uploadCsv(CSV);

    fireEvent.click(importButton());

    await waitFor(() => expect(h.importFn).toHaveBeenCalledTimes(1));
    const payload = h.importFn.mock.calls[0]?.[0] as {
      data: { rows: Record<string, unknown>[]; markSource: string };
    };
    expect(payload.data.markSource).toBe("csv-import");
    expect(payload.data.rows).toHaveLength(2);
  });

  it("ładunek niesie zmapowane pola, w tym język i status z pliku", async () => {
    mount();
    await uploadCsv(CSV);

    fireEvent.click(importButton());

    await waitFor(() => expect(h.importFn).toHaveBeenCalled());
    const rows = (h.importFn.mock.calls[0]?.[0] as { data: { rows: Record<string, unknown>[] } })
      .data.rows;
    expect(rows[0]).toMatchObject({
      email: "anna@example.test",
      firstName: "Anna",
      lastName: "Nowak",
      language: "pl",
      status: "subscribed",
    });
    expect(rows[1]).toMatchObject({ language: "en", status: "pending" });
  });

  it("wiersze bez poprawnego adresu NIE trafiają do wysyłki", async () => {
    mount();
    await uploadCsv(["email,imie", "anna@example.test,Anna", "to nie adres,Borys"].join("\n"));

    fireEvent.click(importButton());

    await waitFor(() => expect(h.importFn).toHaveBeenCalled());
    const rows = (h.importFn.mock.calls[0]?.[0] as { data: { rows: Record<string, unknown>[] } })
      .data.rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.email).toBe("anna@example.test");
  });

  it("w trakcie importu przycisk jest zablokowany i mówi o pracy", async () => {
    let release: (v: unknown) => void = () => {};
    h.importFn.mockReturnValue(new Promise((r) => (release = r)));
    mount();
    await uploadCsv(CSV);

    fireEvent.click(importButton());

    await waitFor(() => expect(importButton().textContent).toContain("Importowanie"));
    expect(importButton().disabled).toBe(true);
    release({ imported: 2, skipped: 0, errors: [] });
  });

  it("po sukcesie melduje wynik i ZAMYKA dialog", async () => {
    mount();
    await uploadCsv(CSV);

    fireEvent.click(importButton());

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(String(h.toastSuccess.mock.calls[0]?.[0])).toContain("Zaimportowano 2");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("liczba pominiętych jest pokazana operatorowi", async () => {
    h.importFn.mockResolvedValue({ imported: 1, skipped: 1, errors: [] });
    mount();
    await uploadCsv(CSV);

    fireEvent.click(importButton());

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(String(h.toastSuccess.mock.calls[0]?.[0])).toContain("pominieto 1");
  });

  it("błędy wierszy są zgłaszane osobnym ostrzeżeniem", async () => {
    h.importFn.mockResolvedValue({
      imported: 1,
      skipped: 0,
      errors: [{ email: "borys@example.test", reason: "invalid" }],
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mount();
    await uploadCsv(CSV);

    fireEvent.click(importButton());

    await waitFor(() => expect(h.toastWarning).toHaveBeenCalled());
    expect(String(h.toastWarning.mock.calls[0]?.[0])).toContain("Bledy: 1");
    warnSpy.mockRestore();
  });

  it("AWARIA importu pokazuje komunikat i NIE zamyka dialogu", async () => {
    h.importFn.mockRejectedValue(new Error("baza niedostępna"));
    mount();
    await uploadCsv(CSV);

    fireEvent.click(importButton());

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("baza niedostępna"));
    // Operator musi móc spróbować ponownie z tym samym plikiem.
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByText("lista.csv")).toBeTruthy();
  });

  it("odrzucenie wartością inną niż Error też daje czytelny komunikat", async () => {
    h.importFn.mockRejectedValue("padło");
    mount();
    await uploadCsv(CSV);

    fireEvent.click(importButton());

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("padło"));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("po sukcesie unieważnia listy subskrybentów i wskaźniki", async () => {
    const { queryClient } = mount();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    await uploadCsv(CSV);

    fireEvent.click(importButton());

    await waitFor(() => expect(spy).toHaveBeenCalled());
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(keys.some((k) => k.includes("newsletter-subscribers"))).toBe(true);
    expect(keys.some((k) => k.includes("newsletter-kpis"))).toBe(true);
  });
});

describe("anulowanie", () => {
  it("przycisk anulowania zamyka dialog bez wysyłki", async () => {
    mount();
    await uploadCsv(CSV);

    fireEvent.click(screen.getByRole("button", { name: /Anuluj/ }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(h.importFn).not.toHaveBeenCalled();
  });
});
