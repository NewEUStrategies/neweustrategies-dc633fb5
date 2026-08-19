// TRASA GLOBALNYCH KOLORÓW. Do 19.08.2026 na zerze (131 linii).
//
// Ten ekran ma szerszy zasięg niż jakikolwiek inny w panelu wyglądu: wybrane
// sloty NADPISUJĄ semantyczne tokeny shadcn, więc jedna zmiana koloru dotyka
// całej produkcyjnej strony. Reguły, które tutaj mieszkają, są trzy:
//
//   1. Wersja robocza. Ekran nie zapisuje po każdym kliknięciu - zbiera zmiany
//      i wysyła je razem. Zapis czytający dane z serwera zamiast szkicu wysłałby
//      stan sprzed edycji.
//   2. Slot ma DWA tryby (jasny i ciemny) i zapis do niewłaściwego oznacza
//      kolor, który pojawia się dopiero po przełączeniu motywu przez czytelnika.
//   3. Wyczyszczenie OBU trybów usuwa slot z zapisu - pusty obiekt zostawiony
//      w danych nadpisywałby token pustym napisem.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { AnyRoute } from "@tanstack/react-router";

const h = vi.hoisted(() => ({
  data: {} as Record<string, { light?: string; dark?: string }> | undefined,
  isLoading: false,
  saved: [] as unknown[],
  isPending: false,
}));

vi.mock("@/hooks/useGlobalColors", () => ({
  useGlobalColors: () => ({ data: h.data, isLoading: h.isLoading }),
  useSaveGlobalColors: () => ({
    mutate: (value: unknown) => h.saved.push(value),
    isPending: h.isPending,
  }),
}));

// Kontrolka koloru to złożony picker (paleta, pipeta, historia) - tu liczy się
// wyłącznie to, KTÓRY slot i KTÓRY tryb dostaje wpisaną wartość.
vi.mock("@/components/admin/builder/ui/atoms/ColorField", () => ({
  ColorField: ({
    value,
    onChange,
    placeholder,
  }: {
    value?: string;
    onChange: (v: string | undefined) => void;
    placeholder?: string;
  }) => (
    <input
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value || undefined)}
    />
  ),
}));

import { Route } from "@/routes/admin.appearance.global-colors";
import { GLOBAL_COLOR_GROUPS } from "@/lib/builder/globalColors";

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function setup() {
  const Component = (Route as AnyRoute).options.component as () => ReactNode;
  return render(<Component />, { wrapper });
}

/** Wiersz slotu po jego widocznej etykiecie. */
function slotRow(label: string): HTMLElement {
  const el = screen.getByText(label).closest("div.grid");
  if (!el) throw new Error(`brak wiersza slotu ${label}`);
  return el as HTMLElement;
}

/**
 * Przyciski zapisu - jeden nad listą, drugi pod nią. Wzorzec obejmuje też stan
 * „Zapisywanie…”, bo etykieta zmienia się w trakcie wysyłki.
 */
const saveButtons = () => screen.getAllByRole("button", { name: /zapis|sav/i });
const lastSaved = () => h.saved.at(-1) as Record<string, { light?: string; dark?: string }>;

/** Pierwszy slot z osobnym trybem ciemnym - to on niesie regułę dwóch trybów. */
const SLOT_Z_CIEMNYM = GLOBAL_COLOR_GROUPS.flatMap((g) => g.slots).find((s) => s.hasDark)!;
/** Pierwszy slot WSPÓLNY dla obu trybów - nie może pokazywać pola ciemnego. */
const SLOT_WSPOLNY = GLOBAL_COLOR_GROUPS.flatMap((g) => g.slots).find((s) => !s.hasDark);

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  h.data = {};
  h.isLoading = false;
  h.isPending = false;
  h.saved.length = 0;
});

describe("globalne kolory - wczytywanie", () => {
  it("do czasu wczytania nie pokazuje pól", () => {
    // Formularz na pustych danych zapisałby puste kolory po pierwszym kliknięciu.
    h.isLoading = true;
    h.data = undefined;
    setup();

    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("brak danych mimo zakończonego ładowania też wstrzymuje formularz", () => {
    h.isLoading = false;
    h.data = undefined;
    setup();

    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("po wczytaniu pokazuje sekcję dla KAŻDEJ grupy z katalogu", () => {
    setup();
    for (const group of GLOBAL_COLOR_GROUPS) {
      expect(screen.getByText(group.label)).toBeInTheDocument();
    }
  });

  it("pokazuje zapisane wartości, nie puste pola", () => {
    h.data = { [SLOT_Z_CIEMNYM.key]: { light: "#123456", dark: "#654321" } };
    setup();
    const wiersz = slotRow(SLOT_Z_CIEMNYM.label);
    const pola = within(wiersz).getAllByRole("textbox") as HTMLInputElement[];

    expect(pola.map((p) => p.value)).toEqual(["#123456", "#654321"]);
  });

  it("puste pole podpowiada wartość domyślną slotu", () => {
    // Bez podpowiedzi redaktor nie wie, jaki kolor obowiązuje, gdy nic nie ustawi.
    setup();
    const wiersz = slotRow(SLOT_Z_CIEMNYM.label);
    const pola = within(wiersz).getAllByRole("textbox") as HTMLInputElement[];

    expect(pola[0].placeholder).toBe(SLOT_Z_CIEMNYM.defaultLight ?? "#000000");
  });
});

describe("globalne kolory - dwa tryby jednego slotu", () => {
  it("wpis w polu JASNYM nie dotyka trybu ciemnego", () => {
    // Zapis do niewłaściwego trybu daje kolor, który pojawia się dopiero po
    // przełączeniu motywu przez czytelnika - u redaktora wygląda jak brak efektu.
    setup();
    const wiersz = slotRow(SLOT_Z_CIEMNYM.label);
    fireEvent.change(within(wiersz).getAllByRole("textbox")[0], { target: { value: "#aabbcc" } });
    fireEvent.click(saveButtons()[0]);

    expect(lastSaved()[SLOT_Z_CIEMNYM.key]).toEqual({ light: "#aabbcc", dark: undefined });
  });

  it("wpis w polu CIEMNYM nie dotyka trybu jasnego", () => {
    h.data = { [SLOT_Z_CIEMNYM.key]: { light: "#111111" } };
    setup();
    const wiersz = slotRow(SLOT_Z_CIEMNYM.label);
    fireEvent.change(within(wiersz).getAllByRole("textbox")[1], { target: { value: "#eeeeee" } });
    fireEvent.click(saveButtons()[0]);

    expect(lastSaved()[SLOT_Z_CIEMNYM.key]).toEqual({ light: "#111111", dark: "#eeeeee" });
  });

  it("slot WSPÓLNY dla obu trybów nie pokazuje drugiego pola", () => {
    if (!SLOT_WSPOLNY) return;
    setup();
    const wiersz = slotRow(SLOT_WSPOLNY.label);

    expect(within(wiersz).getAllByRole("textbox")).toHaveLength(1);
  });

  it("wyczyszczenie OBU trybów usuwa slot z zapisu", () => {
    // Pusty obiekt zostawiony w danych nadpisywałby token pustym napisem.
    h.data = { [SLOT_Z_CIEMNYM.key]: { light: "#111111", dark: "#eeeeee" } };
    setup();
    const wiersz = slotRow(SLOT_Z_CIEMNYM.label);
    const pola = within(wiersz).getAllByRole("textbox");
    fireEvent.change(pola[0], { target: { value: "" } });
    fireEvent.change(pola[1], { target: { value: "" } });
    fireEvent.click(saveButtons()[0]);

    expect(Object.keys(lastSaved())).not.toContain(SLOT_Z_CIEMNYM.key);
  });

  it("wyczyszczenie JEDNEGO trybu zostawia slot z drugim", () => {
    h.data = { [SLOT_Z_CIEMNYM.key]: { light: "#111111", dark: "#eeeeee" } };
    setup();
    const wiersz = slotRow(SLOT_Z_CIEMNYM.label);
    fireEvent.change(within(wiersz).getAllByRole("textbox")[0], { target: { value: "" } });
    fireEvent.click(saveButtons()[0]);

    expect(lastSaved()[SLOT_Z_CIEMNYM.key]).toEqual({ light: undefined, dark: "#eeeeee" });
  });
});

describe("globalne kolory - zapis", () => {
  it("zmiana NIE leci do bazy przed kliknięciem zapisu", () => {
    // Ten ekran dotyka całej produkcyjnej strony - zapis po każdym znaku
    // publikowałby kolory w trakcie ich wpisywania.
    setup();
    const wiersz = slotRow(SLOT_Z_CIEMNYM.label);
    fireEvent.change(within(wiersz).getAllByRole("textbox")[0], { target: { value: "#aabbcc" } });

    expect(h.saved).toHaveLength(0);
  });

  it("zapis niesie CAŁĄ wersję roboczą, nie samą zmianę", () => {
    // Wysłanie samego fragmentu skasowałoby pozostałe sloty w bazie.
    h.data = { "inny-slot": { light: "#010101" } };
    setup();
    const wiersz = slotRow(SLOT_Z_CIEMNYM.label);
    fireEvent.change(within(wiersz).getAllByRole("textbox")[0], { target: { value: "#aabbcc" } });
    fireEvent.click(saveButtons()[0]);

    expect(lastSaved()["inny-slot"]).toEqual({ light: "#010101" });
  });

  it("przyciski zapisu na górze i na dole robią TO SAMO", () => {
    // Długa lista slotów - drugi przycisk istnieje po to, żeby nie przewijać
    // z powrotem. Gdyby robił co innego, byłby pułapką.
    setup();
    const przyciski = saveButtons();
    expect(przyciski.length).toBeGreaterThan(1);

    fireEvent.click(przyciski[0]);
    fireEvent.click(przyciski[przyciski.length - 1]);

    expect(h.saved).toHaveLength(2);
    expect(h.saved[0]).toEqual(h.saved[1]);
  });

  it("w trakcie zapisu OBA przyciski są zablokowane", async () => {
    h.isPending = true;
    setup();

    await waitFor(() => {
      for (const btn of saveButtons()) expect(btn).toBeDisabled();
    });
  });
});
