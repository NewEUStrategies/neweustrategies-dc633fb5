// Podsumowanie /admin/newsletter/overview - wskaźniki, TRYB i ustawienia logiki.
//
// PO CO. Ten panel decyduje, czy formularz zapisu w ogóle pojawia się na stronie
// (`mode`) i czy zapis wymaga potwierdzenia adresu (`double_opt_in`). Pomyłka
// jest cicha w obie strony: tryb „wyłączony" znaczy brak zapisów, o którym nikt
// nie dowie się z panelu, a wyłączony double opt-in znaczy zbieranie adresów
// bez potwierdzonej zgody.
//
// UWAGA: ten panel ma teksty WPISANE NA SZTYWNO PO POLSKU (w odróżnieniu od
// pozostałych paneli modułu, które chodzą przez słownik). Testy opisują stan
// obecny; przejście na i18n to osobna zmiana - wymaga kilkudziesięciu nowych
// kluczy w PL i EN.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { supabaseFromStub, ok, type RecordedChain } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({ from: (_t: string): unknown => ({}) }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => h.from(table) },
}));
// Blokada wyjścia z niezapisanymi zmianami wymaga routera i ma własne testy.
vi.mock("@/hooks/useUnsavedChangesGuard", () => ({ useUnsavedChangesGuard: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// Formularz zapisu, podgląd popupu i raport zdarzeń mają WŁASNE testy - tutaj
// liczy się tylko to, czy panel je pokazuje i z jakim językiem.
vi.mock("@/components/NewsletterForm", () => ({
  NewsletterForm: ({ lang }: { lang: string }) => <div data-testid="formularz-inline">{lang}</div>,
}));
vi.mock("@/components/admin/newsletter/PopupPreview", () => ({
  PopupPreview: ({ lang }: { lang: string }) => <div data-testid="podglad-popupu">{lang}</div>,
}));
vi.mock("@/components/admin/newsletter/PopupEventsPanel", () => ({
  PopupEventsPanel: () => <div data-testid="zdarzenia-popupu" />,
}));

import { toast } from "sonner";
import { clearEdgeTtlCache } from "@/lib/ssrCache";
import { OverviewPanel } from "@/components/admin/newsletter/OverviewPanel";
import { defaultNewsletterSettings, type NewsletterSettings } from "@/hooks/useNewsletterSettings";

let stub: ReturnType<typeof supabaseFromStub>;
let saveResult: (chain: RecordedChain) => ReturnType<typeof ok>;

/** Wiersz subskrybenta - adresy nie są tu potrzebne, liczą się statusy i daty. */
function subscriber(status: string, createdDaysAgo: number, unsubDaysAgo: number | null = null) {
  const iso = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
  return {
    status,
    created_at: iso(createdDaysAgo),
    confirmed_at: status === "subscribed" ? iso(createdDaysAgo) : null,
    unsubscribed_at: unsubDaysAgo === null ? null : iso(unsubDaysAgo),
  };
}

function mount(args: { settings?: Partial<NewsletterSettings>; subscribers?: unknown[] } = {}) {
  const row = { ...defaultNewsletterSettings(), tenant_id: "tenant-1", ...args.settings };
  stub.setResponse("newsletter_settings", (chain) => {
    if (chain.has("update") || chain.has("insert")) return saveResult(chain);
    if ((chain.argsOf("select")?.[0] as string) === "tenant_id")
      return ok({ tenant_id: "tenant-1" });
    return ok(row);
  });
  stub.setResponse("newsletter_subscribers", () => ok(args.subscribers ?? []));
  return renderWithQueryClient(<OverviewPanel />);
}

async function mounted(args: Parameters<typeof mount>[0] = {}) {
  const utils = mount(args);
  // Panel renderuje się z DOMYŚLNYMI ustawieniami, dopóki nie przyjdą prawdziwe,
  // więc czekamy na oba zapytania i na efekt, który przepisuje je do szkicu -
  // inaczej asercje czytałyby render sprzed danych.
  await waitFor(() => {
    expect(utils.queryClient.getQueryData(["newsletter-settings"])).toBeTruthy();
    expect(utils.queryClient.getQueryData(["newsletter-kpis"])).toBeTruthy();
  });
  await act(async () => {});
  return utils;
}

function saveButton(): HTMLButtonElement {
  return screen.getByText("Zapisz ustawienia").closest("button")!;
}

/** Karta wskaźnika o danej etykiecie -> jego wartość. */
function kpi(label: string): string {
  const card = screen.getByText(label).closest("div.space-y-2");
  expect(card, `brak karty wskaźnika „${label}”`).toBeTruthy();
  return card!.querySelector("div.font-display")?.textContent?.trim() ?? "";
}

beforeEach(() => {
  stub = supabaseFromStub();
  h.from = stub.from;
  saveResult = () => ok(null);
  clearEdgeTtlCache();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
describe("wskaźniki listy", () => {
  it("liczy TYLKO potwierdzonych jako subskrybentów", async () => {
    await mounted({
      subscribers: [
        subscriber("subscribed", 5),
        subscriber("subscribed", 10),
        subscriber("pending", 3),
      ],
    });

    await waitFor(() => expect(kpi("Subskrybenci")).toBe("2"));
    expect(kpi("Opt-in rate")).toBe("67%");
  });

  it("PUSTA lista pokazuje 100% potwierdzeń, nie 0% ani NaN", async () => {
    // „0%" sugerowałoby, że NIKT nie potwierdza adresu.
    await mounted({ subscribers: [] });

    await waitFor(() => expect(kpi("Opt-in rate")).toBe("100%"));
    expect(kpi("Subskrybenci")).toBe("0");
  });

  it("wzrost porównuje ostatnie 30 dni z poprzednimi", async () => {
    await mounted({
      subscribers: [
        subscriber("subscribed", 5),
        subscriber("subscribed", 10),
        subscriber("subscribed", 45),
      ],
    });

    await waitFor(() => expect(kpi("Wzrost 30d")).toBe("100%"));
    // Licznik to ostatnie 30 dni (dwa zapisy), mianownik poprzednie (jeden) -
    // podpowiedź kafla subskrybentów mówi to wprost.
    expect(screen.getByText("+2 w 30 dni")).toBeTruthy();
  });

  it("wypisania liczą się po DACIE wypisania", async () => {
    await mounted({
      subscribers: [subscriber("unsubscribed", 60, 3), subscriber("unsubscribed", 90, 45)],
    });

    await waitFor(() => expect(kpi("Wypisania 30d")).toBe("1"));
    // Data ZAPISU obu wierszy jest starsza niż 30 dni, więc nowych nie ma.
    expect(screen.getByText("+0 w 30 dni")).toBeTruthy();
  });

  it("podpowiedź opt-in mówi, czy double opt-in jest aktywny", async () => {
    await mounted({ settings: { double_opt_in: true } });

    expect(screen.getByText("Double opt-in aktywny")).toBeTruthy();
    expect(screen.queryByText("Bez double opt-in")).toBeNull();
  });

  it("wyłączony double opt-in jest podpisany wprost", async () => {
    // Bez potwierdzenia adresu zbieramy zgody, których nikt nie potwierdził.
    await mounted({ settings: { double_opt_in: false } });

    expect(screen.getByText("Bez double opt-in")).toBeTruthy();
    expect(screen.queryByText("Double opt-in aktywny")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("tryb newslettera", () => {
  it("oferuje CZTERY tryby z opisem, co robią", async () => {
    await mounted();

    expect(screen.getByText("Wylaczony")).toBeTruthy();
    expect(screen.getByText("Tylko inline")).toBeTruthy();
    expect(screen.getByText("Tylko popup")).toBeTruthy();
    expect(screen.getByText("Inline + popup")).toBeTruthy();
  });

  it("aktywny tryb jest WYRÓŻNIONY - operator widzi, co jest ustawione", async () => {
    await mounted({ settings: { mode: "popup" } });

    // Wyróżnienie to pierścień - klasa `hover:border-primary/40` jest na KAŻDYM
    // przycisku, więc sam „border-primary" nie rozstrzyga.
    expect(screen.getByText("Tylko popup").closest("button")!.className).toContain("ring-2");
    expect(screen.getByText("Tylko inline").closest("button")!.className).not.toContain("ring-2");
  });

  it("zmiana trybu ODBLOKOWUJE zapis i przestawia wyróżnienie", async () => {
    await mounted({ settings: { mode: "inline" } });
    expect(saveButton()).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByText("Inline + popup"));

    expect(saveButton()).toHaveProperty("disabled", false);
    expect(screen.getByText("Inline + popup").closest("button")!.className).toContain("ring-2");
  });

  it("tryb decyduje, KTÓRY podgląd jest oznaczony jako aktywny", async () => {
    // To jedyne miejsce, w którym widać, że formularz nie pokazuje się na stronie.
    await mounted({ settings: { mode: "inline" } });

    const badges = screen.getAllByText(/^(aktywny|wyłączony)$/);
    expect(badges[0]?.textContent).toBe("aktywny");
    expect(badges[1]?.textContent).toBe("wyłączony");
  });

  it("tryb „oba” oznacza jako aktywne OBA podglądy", async () => {
    await mounted({ settings: { mode: "both" } });

    const badges = screen.getAllByText(/^(aktywny|wyłączony)$/);
    expect(badges.map((b) => b.textContent)).toEqual(["aktywny", "aktywny"]);
  });

  it("tryb „wyłączony” gasi OBA podglądy", async () => {
    await mounted({ settings: { mode: "off" } });

    const badges = screen.getAllByText(/^(aktywny|wyłączony)$/);
    expect(badges.map((b) => b.textContent)).toEqual(["wyłączony", "wyłączony"]);
  });
});

// ---------------------------------------------------------------------------
describe("ustawienia logiki", () => {
  it("przełączniki pokazują stan Z BAZY", async () => {
    await mounted({ settings: { enabled: true, double_opt_in: false } });

    const boxes = screen.getAllByRole("checkbox");
    expect(boxes[0]?.getAttribute("aria-checked")).toBe("true");
    expect(boxes[1]?.getAttribute("aria-checked")).toBe("false");
  });

  it("wyłączenie formularza odblokowuje zapis", async () => {
    await mounted({ settings: { enabled: true } });

    fireEvent.click(screen.getAllByRole("checkbox")[0]!);

    expect(saveButton()).toHaveProperty("disabled", false);
    // Przełącznik naprawdę zmienił stan - odblokowanie bez zmiany byłoby fałszywe.
    expect(screen.getAllByRole("checkbox")[0]!.getAttribute("aria-checked")).toBe("false");
  });

  it("double opt-in daje się ZDJĄĆ i wraca w zapisie jako false", async () => {
    // Zdjęcie potwierdzenia adresu znaczy zbieranie zgód, których nikt nie
    // potwierdził - to musi zapisać się jawnie, a nie zniknąć z patcha.
    await mounted({ settings: { double_opt_in: true } });

    fireEvent.click(screen.getAllByRole("checkbox")[1]!);
    fireEvent.click(saveButton());

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const update = stub.chainsFor("newsletter_settings").find((c) => c.has("update"))!;
    expect((update.argsOf("update")![0] as { double_opt_in: boolean }).double_opt_in).toBe(false);
  });

  it("włączenie popupu jest osobnym przełącznikiem od trybu", async () => {
    // Popup może być włączony, a tryb i tak go nie pokaże - i odwrotnie.
    await mounted({ settings: { popup_enabled: false } });

    fireEvent.click(screen.getByText("Wlacz popup"));
    fireEvent.click(saveButton());

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const update = stub.chainsFor("newsletter_settings").find((c) => c.has("update"))!;
    expect((update.argsOf("update")![0] as { popup_enabled: boolean }).popup_enabled).toBe(true);
  });

  it("adres nadawcy wyczyszczony do pusta zapisuje NULL, nie pusty napis", async () => {
    // Pusty napis przeszedłby walidację kolumny i wysyłka poszłaby „od nikogo".
    await mounted({ settings: { sender_email: "newsletter@example.test" } });

    fireEvent.change(screen.getByDisplayValue("newsletter@example.test"), {
      target: { value: "" },
    });
    fireEvent.click(saveButton());

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const update = stub.chainsFor("newsletter_settings").find((c) => c.has("update"))!;
    expect((update.argsOf("update")![0] as { sender_email: unknown }).sender_email).toBeNull();
  });

  it("nazwa nadawcy trafia do zapisu", async () => {
    await mounted();

    fireEvent.change(screen.getByPlaceholderText("New European Strategies"), {
      target: { value: "Redakcja NES" },
    });
    fireEvent.click(saveButton());

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const update = stub.chainsFor("newsletter_settings").find((c) => c.has("update"))!;
    expect((update.argsOf("update")![0] as { sender_name: string }).sender_name).toBe(
      "Redakcja NES",
    );
  });
});

// ---------------------------------------------------------------------------
describe("reguły wyświetlania popupu", () => {
  it("opóźnienie jest edytowalne TYLKO przy triggerze czasowym", async () => {
    // Aktywne pole przy innym triggerze uczy operatora ustawiać coś bez skutku.
    const { container } = await mounted({ settings: { popup_trigger: "delay" } });
    const numbers = () =>
      Array.from(container.querySelectorAll<HTMLInputElement>('input[type="number"]'));

    expect(numbers()[1]?.disabled).toBe(false);
    expect(numbers()[2]?.disabled).toBe(true);
  });

  it("próg przewinięcia jest edytowalny tylko przy triggerze scroll", async () => {
    const { container } = await mounted({ settings: { popup_trigger: "scroll" } });
    const numbers = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="number"]'),
    );

    expect(numbers[2]?.disabled).toBe(false);
    expect(numbers[1]?.disabled).toBe(true);
  });

  it("exit-intent blokuje OBA pola liczbowe triggera", async () => {
    const { container } = await mounted({ settings: { popup_trigger: "exit-intent" } });
    const numbers = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="number"]'),
    );

    expect(numbers[1]?.disabled).toBe(true);
    expect(numbers[2]?.disabled).toBe(true);
  });

  it("zmiana triggera patchuje ustawienia", async () => {
    await mounted({ settings: { popup_trigger: "delay" } });

    fireEvent.keyDown(screen.getByText("Po opoznieniu").closest("button")!, { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: "Exit-intent" }));

    expect(saveButton()).toHaveProperty("disabled", false);
    expect(screen.getByText("Exit-intent")).toBeTruthy();
  });

  it("częstotliwość ze śmieci schodzi na zero, a nie na NaN", async () => {
    // NaN w kolumnie liczbowej zablokowałby zapis całych ustawień.
    const { container } = await mounted();

    const freq = container.querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(freq, { target: { value: "abc" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const update = stub.chainsFor("newsletter_settings").find((c) => c.has("update"))!;
    expect(
      (update.argsOf("update")![0] as { popup_frequency_days: number }).popup_frequency_days,
    ).toBe(0);
  });

  it("próg przewinięcia wyczyszczony schodzi na 1%, nie na zero", async () => {
    // Zero znaczyłoby „popup od razu na górze strony".
    const { container } = await mounted({ settings: { popup_trigger: "scroll" } });

    const scroll = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="number"]'),
    )[2]!;
    fireEvent.change(scroll, { target: { value: "" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const update = stub.chainsFor("newsletter_settings").find((c) => c.has("update"))!;
    expect(
      (update.argsOf("update")![0] as { popup_scroll_percent: number }).popup_scroll_percent,
    ).toBe(1);
  });

  it("opóźnienie wyczyszczone schodzi na 1 sekundę, nie na zero", async () => {
    // Zero znaczyłoby „natychmiast" - popup wyskakiwałby przed wczytaniem strony.
    const { container } = await mounted({ settings: { popup_trigger: "delay" } });

    const delay = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="number"]'),
    )[1]!;
    fireEvent.change(delay, { target: { value: "" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const update = stub.chainsFor("newsletter_settings").find((c) => c.has("update"))!;
    expect(
      (update.argsOf("update")![0] as { popup_delay_seconds: number }).popup_delay_seconds,
    ).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("zapis", () => {
  it("bez zmian zapis jest ZABLOKOWANY", async () => {
    await mounted();

    expect(saveButton()).toHaveProperty("disabled", true);
    expect(stub.chainsFor("newsletter_settings").some((c) => c.has("update"))).toBe(false);
  });

  it("dokumenty builderów NIE jadą w zapisie ustawień logiki", async () => {
    // Overview edytuje tylko warstwę logiki; wysłanie dokumentów nadpisałoby
    // pracę wykonaną w builderach inline i popupu.
    await mounted();
    fireEvent.click(screen.getByText("Tylko popup"));

    fireEvent.click(saveButton());

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const update = stub.chainsFor("newsletter_settings").find((c) => c.has("update"))!;
    const body = update.argsOf("update")![0] as Record<string, unknown>;
    expect(Object.keys(body)).not.toContain("inline_doc");
    expect(Object.keys(body)).not.toContain("popup_doc");
  });

  it("identyfikator tenanta też nie jedzie w treści zapisu", async () => {
    await mounted();
    fireEvent.click(screen.getByText("Tylko popup"));

    fireEvent.click(saveButton());

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const update = stub.chainsFor("newsletter_settings").find((c) => c.has("update"))!;
    expect(Object.keys(update.argsOf("update")![0] as object)).not.toContain("tenant_id");
  });

  it("zapisany tryb to ten, który operator wybrał", async () => {
    await mounted({ settings: { mode: "off" } });
    fireEvent.click(screen.getByText("Inline + popup"));

    fireEvent.click(saveButton());

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const update = stub.chainsFor("newsletter_settings").find((c) => c.has("update"))!;
    expect((update.argsOf("update")![0] as { mode: string }).mode).toBe("both");
  });
});

// ---------------------------------------------------------------------------
describe("podgląd i raport zdarzeń", () => {
  it("pokazuje raport zdarzeń popupu", async () => {
    await mounted();

    expect(screen.getByTestId("zdarzenia-popupu")).toBeTruthy();
    // Kafel jest w podsumowaniu, nie zamiast niego - wskaźniki nadal są.
    expect(screen.getByText("Subskrybenci")).toBeTruthy();
  });

  it("pokazuje OBA podglądy obok siebie", async () => {
    await mounted();

    expect(screen.getByTestId("formularz-inline")).toBeTruthy();
    expect(screen.getByTestId("podglad-popupu")).toBeTruthy();
  });

  it("przełącznik języka przestawia OBA podglądy naraz", async () => {
    await mounted();
    expect(screen.getByTestId("formularz-inline").textContent).toBe("pl");

    fireEvent.click(screen.getByText("EN"));

    expect(screen.getByTestId("formularz-inline").textContent).toBe("en");
    expect(screen.getByTestId("podglad-popupu").textContent).toBe("en");
  });

  it("powrót na polski też przestawia oba", async () => {
    await mounted();
    fireEvent.click(screen.getByText("EN"));

    fireEvent.click(screen.getByText("PL"));

    expect(screen.getByTestId("formularz-inline").textContent).toBe("pl");
    expect(screen.getByTestId("podglad-popupu").textContent).toBe("pl");
  });

  it("WYŁĄCZONY formularz nie renderuje pola zapisu w podglądzie", async () => {
    // Podgląd nie może sugerować, że zapis działa, gdy globalny wyłącznik jest
    // zdjęty.
    await mounted({ settings: { enabled: false } });

    expect(screen.queryByTestId("formularz-inline")).toBeNull();
    expect(screen.getByText("Formularz jest wyłączony.")).toBeTruthy();
  });
});
