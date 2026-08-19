// TRASA BIBLIOTEKI IKON. Do 19.08.2026 na zerze (598 instrukcji) - cała
// funkcjonalność „Ikony / marka” po stronie panelu.
//
// Ikony z tej biblioteki wychodzą na publiczną stronę przez shortcode `:nazwa:`
// i przez `DynamicIcon`. Ekran ma cztery reguły, których złamania nie widać:
//
//   1. NAZWA JEST ADRESEM. Wpisany tekst przechodzi przez `slugifyIconName` -
//      nazwa z wielkimi literami albo spacjami dałaby shortcode, którego nie da
//      się wpisać w treści.
//   2. TRZY WARIANTY jednej ikony (default / light / dark) to trzy osobne
//      adresy. Wgranie do niewłaściwego slotu daje logo znikające po zmianie
//      motywu przez czytelnika.
//   3. WYDAJNOŚĆ. Biblioteka bywa tysiącami ikon, a jedna karta to trzy obrazki.
//      Siatka renderuje paczkami po 60 - render całości to tysiące żądań w
//      jednym tiku i zawieszona zakładka.
//   4. IZOLACJA ZAKŁADEK. Trzy rodzaje (własne, flagi, brandy) mają osobne
//      listy; zapytanie bez rodzaju w kluczu pokazałoby flagi pod „własnymi”.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { AnyRoute } from "@tanstack/react-router";

const h = vi.hoisted(() => ({
  byKind: {} as Record<string, Record<string, unknown>[]>,
  listCalls: [] as string[],
  upserts: [] as unknown[],
  upsertError: null as Error | null,
  deletes: [] as string[],
  uploads: [] as unknown[],
  uploadUrl: "https://cdn.example/ikona.svg",
  uploadError: null as Error | null,
  bulkCalls: [] as unknown[],
  bulkResult: { created: 2, updated: 1, skipped: 0, errors: [] as unknown[] },
  bulkProgress: [] as Record<string, unknown>[],
  bulkError: null as Error | null,
  confirmAnswer: true,
  confirmCalls: [] as Record<string, unknown>[],
  toast: { success: vi.fn(), error: vi.fn() },
  observerCallbacks: [] as ((entries: { isIntersecting: boolean }[]) => void)[],
}));

vi.mock("@/hooks/useAuth", () => ({ useRequiredTenant: () => "tenant-1" }));
vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("@/lib/appDialogs", () => ({
  confirmDialog: async (opts: Record<string, unknown>) => {
    h.confirmCalls.push(opts);
    return h.confirmAnswer;
  },
}));
vi.mock("@/lib/iconLibrary", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/iconLibrary")>();
  return {
    ...actual,
    listIcons: async (kind: string) => {
      h.listCalls.push(kind);
      return h.byKind[kind] ?? [];
    },
    upsertIcon: async (tenantId: string, payload: unknown) => {
      if (h.upsertError) throw h.upsertError;
      h.upserts.push({ tenantId, payload });
      return { id: "new" };
    },
    deleteIcon: async (id: string) => {
      h.deletes.push(id);
    },
    uploadIconAsset: async (tenantId: string, kind: string, file: File) => {
      if (h.uploadError) throw h.uploadError;
      h.uploads.push({ tenantId, kind, name: file.name });
      return h.uploadUrl;
    },
    bulkImportIcons: async (
      tenantId: string,
      kind: string,
      files: File[],
      opts: { existingNames: Set<string>; onProgress: (p: Record<string, unknown>) => void },
    ) => {
      h.bulkCalls.push({
        tenantId,
        kind,
        files: files.map((f) => f.name),
        existing: [...opts.existingNames],
      });
      for (const p of h.bulkProgress) opts.onProgress(p);
      if (h.bulkError) throw h.bulkError;
      return h.bulkResult;
    },
  };
});

import "@/test/i18nReal";
import { Route } from "@/routes/admin.icons";

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function icon(overrides: Record<string, unknown> = {}) {
  return {
    id: "i1",
    tenant_id: "tenant-1",
    kind: "custom",
    name: "nes_logo",
    label: "Logo NES",
    url_default: "https://cdn.example/default.svg",
    url_light: "",
    url_dark: "",
    default_variant: "auto",
    position: 0,
    ...overrides,
  };
}

async function setup(rows: Record<string, unknown>[] = []) {
  h.byKind.custom = rows;
  const Component = (Route as AnyRoute).options.component as () => ReactNode;
  const view = render(<Component />, { wrapper });
  await waitFor(() => expect(screen.queryByLabelText("")).not.toBeUndefined());
  await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
  return view;
}

/** Karta ikony po jej shortcode. */
const card = (name: string) =>
  screen.getByText(`:${name}:`).closest("div.rounded-lg") as HTMLElement;

const searchBox = () => screen.getByPlaceholderText(/Szukaj ikony|Search icon/i);

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  h.byKind = {};
  h.listCalls.length = 0;
  h.upserts.length = 0;
  h.deletes.length = 0;
  h.uploads.length = 0;
  h.bulkCalls.length = 0;
  h.bulkProgress = [];
  h.upsertError = null;
  h.uploadError = null;
  h.bulkError = null;
  h.confirmAnswer = true;
  h.confirmCalls.length = 0;
  h.uploadUrl = "https://cdn.example/ikona.svg";
  h.bulkResult = { created: 2, updated: 1, skipped: 0, errors: [] };
  h.toast.success.mockReset();
  h.toast.error.mockReset();
  h.observerCallbacks.length = 0;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
        h.observerCallbacks.push(cb);
      }
      observe() {}
      disconnect() {}
    },
  );
});

describe("biblioteka ikon - zakładki rodzajów", () => {
  it("startuje od ikon WŁASNYCH", async () => {
    await setup();
    expect(h.listCalls).toContain("custom");
  });

  it("zmiana zakładki odpytuje o INNY rodzaj", async () => {
    // Zapytanie bez rodzaju w kluczu pokazałoby flagi pod „własnymi”.
    h.byKind.flag = [icon({ id: "f1", kind: "flag", name: "pl" })];
    await setup([icon()]);
    fireEvent.click(screen.getByRole("button", { name: /Flagi|Flags/ }));

    await waitFor(() => expect(h.listCalls).toContain("flag"));
    await waitFor(() => expect(screen.getByText(":pl:")).toBeInTheDocument());
    expect(screen.queryByText(":nes_logo:")).toBeNull();
  });

  it("każdy rodzaj ma własną zakładkę", async () => {
    await setup();
    for (const nazwa of [/Własne ikony|Custom/, /Flagi|Flags/, /Logotypy|Brand/]) {
      expect(screen.getByRole("button", { name: nazwa })).toBeInTheDocument();
    }
  });
});

describe("biblioteka ikon - nazwa jest adresem", () => {
  const nameField = () => screen.getByPlaceholderText("np. nes_logo") as HTMLInputElement;
  const addButton = () => screen.getAllByRole("button", { name: /^(Dodaj|Add)$/ })[0];

  it("NORMALIZUJE wpisaną nazwę do shortcode'u", async () => {
    // „Moje Logo!” jako shortcode jest nie do wpisania w treści.
    await setup();
    fireEvent.change(nameField(), { target: { value: "  Moje Logo!  " } });
    fireEvent.click(addButton());

    await waitFor(() => expect(h.upserts).toHaveLength(1));
    expect((h.upserts[0] as { payload: { name: string } }).payload.name).toBe("moje-logo");
  });

  it("nazwa, z której nie zostaje nic, jest ODRZUCANA przed zapisem", async () => {
    // Same znaki interpunkcyjne dają pusty shortcode - ikonę nie do wywołania.
    await setup();
    fireEvent.change(nameField(), { target: { value: "!!!" } });
    fireEvent.click(addButton());

    await waitFor(() => expect(h.toast.error).toHaveBeenCalled());
    expect(h.upserts).toHaveLength(0);
  });

  it("nowa ikona dziedziczy rodzaj Z AKTYWNEJ zakładki", async () => {
    // Ikona utworzona z cudzym rodzajem znika z widoku zaraz po dodaniu.
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /Flagi|Flags/ }));
    await waitFor(() => expect(h.listCalls).toContain("flag"));
    fireEvent.change(nameField(), { target: { value: "pl" } });
    fireEvent.click(addButton());

    await waitFor(() => expect(h.upserts).toHaveLength(1));
    expect((h.upserts[0] as { payload: { kind: string } }).payload.kind).toBe("flag");
  });

  it("pusta etykieta zapisuje się jako PUSTKA, nie jako pusty napis", async () => {
    await setup();
    fireEvent.change(nameField(), { target: { value: "logo" } });
    fireEvent.click(addButton());

    await waitFor(() => expect(h.upserts).toHaveLength(1));
    expect((h.upserts[0] as { payload: { label: unknown } }).payload.label).toBeNull();
  });

  it("po dodaniu formularz się CZYŚCI", async () => {
    // Niewyczyszczony formularz dodaje drugi raz tę samą ikonę.
    await setup();
    fireEvent.change(nameField(), { target: { value: "logo" } });
    fireEvent.click(addButton());

    await waitFor(() => expect(nameField().value).toBe(""));
  });

  it("PORAŻKA dodania zostawia wpisaną nazwę", async () => {
    h.upsertError = new Error("nazwa zajęta");
    await setup();
    fireEvent.change(nameField(), { target: { value: "logo" } });
    fireEvent.click(addButton());

    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("nazwa zajęta"));
    expect(nameField().value).toBe("logo");
  });
});

describe("biblioteka ikon - trzy warianty jednej ikony", () => {
  /**
   * Kafel wariantu w karcie ikony. Etykieta sama jest `div`-em, więc `closest`
   * zwróciłby ją samą - kafel to jej RODZIC.
   */
  function slot(name: string, label: RegExp): HTMLElement {
    const labelEl = within(card(name)).getByText(label);
    return labelEl.parentElement as HTMLElement;
  }

  /** Ukryte pole wyboru pliku w kaflu wariantu. */
  const slotFileInput = (name: string, label: RegExp) =>
    slot(name, label).querySelector('input[type="file"]') as HTMLInputElement;

  it.each([
    [/^Default$/, "url_default"],
    [/^Light$/, "url_light"],
    [/^Dark$/, "url_dark"],
  ])("wgranie do slotu %s pisze do %s", async (etykieta, klucz) => {
    // Wgranie do niewłaściwego slotu daje logo znikające po zmianie motywu.
    await setup([icon()]);
    fireEvent.change(slotFileInput("nes_logo", etykieta as RegExp), {
      target: { files: [new File(["x"], "logo.svg", { type: "image/svg+xml" })] },
    });

    await waitFor(() => expect(h.upserts).toHaveLength(1));
    expect((h.upserts[0] as { payload: Record<string, unknown> }).payload[klucz as string]).toBe(
      h.uploadUrl,
    );
  });

  it("wgranie zachowuje POZOSTAŁE warianty", async () => {
    // Zapis wysyła cały wiersz; pominięcie sąsiednich pól skasowałoby je.
    await setup([icon({ url_light: "https://cdn.example/light.svg" })]);
    fireEvent.change(slotFileInput("nes_logo", /^Dark$/), {
      target: { files: [new File(["x"], "d.svg", { type: "image/svg+xml" })] },
    });

    await waitFor(() => expect(h.upserts).toHaveLength(1));
    const payload = (h.upserts[0] as { payload: Record<string, unknown> }).payload;
    expect(payload.url_light).toBe("https://cdn.example/light.svg");
    expect(payload.url_default).toBe("https://cdn.example/default.svg");
  });

  it("brak wybranego pliku niczego nie wgrywa", async () => {
    // Anulowanie okna systemowego zgłasza zdarzenie z pustą listą.
    await setup([icon()]);
    fireEvent.change(slotFileInput("nes_logo", /^Dark$/), { target: { files: [] } });

    expect(h.uploads).toHaveLength(0);
  });

  it("PORAŻKA wgrania nie zapisuje wiersza", async () => {
    h.uploadError = new Error("plik za duży");
    await setup([icon()]);
    fireEvent.change(slotFileInput("nes_logo", /^Dark$/), {
      target: { files: [new File(["x"], "d.svg", { type: "image/svg+xml" })] },
    });

    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("plik za duży"));
    expect(h.upserts).toHaveLength(0);
  });

  it("czyszczenie slotu zapisuje PUSTY adres, nie usuwa ikony", async () => {
    await setup([icon()]);
    fireEvent.click(within(slot("nes_logo", /^Default$/)).getAllByRole("button")[1]);

    await waitFor(() => expect(h.upserts).toHaveLength(1));
    expect((h.upserts[0] as { payload: { url_default: string } }).payload.url_default).toBe("");
    expect(h.deletes).toHaveLength(0);
  });

  it("slot BEZ adresu nie ma przycisku czyszczenia", async () => {
    // Przycisk, który nic nie robi, myli redaktora.
    await setup([icon({ url_dark: "" })]);

    expect(within(slot("nes_logo", /^Dark$/)).getAllByRole("button")).toHaveLength(1);
  });

  it("domyślny wariant zapisuje się natychmiast po wyborze", async () => {
    // Bez zapisu wybór ginie przy odświeżeniu i logo wraca do trybu auto.
    await setup([icon()]);
    fireEvent.keyDown(within(card("nes_logo")).getByRole("combobox"), { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: /^Dark$/ }));

    await waitFor(() => expect(h.upserts).toHaveLength(1));
    expect((h.upserts[0] as { payload: { default_variant: string } }).payload.default_variant).toBe(
      "dark",
    );
  });

  it("etykieta zapisuje się po opuszczeniu pola, ale TYLKO gdy się zmieniła", async () => {
    // Zapis przy każdym opuszczeniu pola to zapytanie na każde kliknięcie obok.
    await setup([icon()]);
    const input = within(card("nes_logo")).getByRole("textbox");
    fireEvent.blur(input);
    expect(h.upserts).toHaveLength(0);

    fireEvent.change(input, { target: { value: "Nowa etykieta" } });
    fireEvent.blur(input);
    await waitFor(() => expect(h.upserts).toHaveLength(1));
    expect((h.upserts[0] as { payload: { label: string } }).payload.label).toBe("Nowa etykieta");
  });
});

describe("biblioteka ikon - usuwanie", () => {
  it("PYTA, nazywając ikonę po imieniu", async () => {
    // Ikona usuwana bez nazwy w pytaniu to zgadywanka przy kilkuset kartach.
    await setup([icon()]);
    fireEvent.click(within(card("nes_logo")).getByTitle(/Usuń|Delete/));

    await waitFor(() => expect(h.confirmCalls).toHaveLength(1));
    expect(String(h.confirmCalls[0].title)).toContain("nes_logo");
    expect(h.confirmCalls[0]).toMatchObject({ destructive: true });
  });

  it("odmowa NIE usuwa", async () => {
    h.confirmAnswer = false;
    await setup([icon()]);
    fireEvent.click(within(card("nes_logo")).getByTitle(/Usuń|Delete/));

    await waitFor(() => expect(h.confirmCalls).toHaveLength(1));
    expect(h.deletes).toHaveLength(0);
  });

  it("zgoda usuwa wskazany wiersz", async () => {
    await setup([icon(), icon({ id: "i2", name: "druga" })]);
    fireEvent.click(within(card("druga")).getByTitle(/Usuń|Delete/));

    await waitFor(() => expect(h.deletes).toEqual(["i2"]));
  });
});

describe("biblioteka ikon - wyszukiwanie i wydajność siatki", () => {
  it("wyszukiwarka obejmuje nazwę I etykietę", async () => {
    // Redaktor pamięta zwykle jedno albo drugie, nie oba.
    await setup([icon(), icon({ id: "i2", name: "flaga_pl", label: "Polska" })]);

    fireEvent.change(searchBox(), { target: { value: "Polska" } });
    await waitFor(() => expect(screen.queryByText(":nes_logo:")).toBeNull());
    expect(screen.getByText(":flaga_pl:")).toBeInTheDocument();

    fireEvent.change(searchBox(), { target: { value: "nes_" } });
    await waitFor(() => expect(screen.getByText(":nes_logo:")).toBeInTheDocument());
  });

  it("licznik pokazuje ODFILTROWANE ze WSZYSTKICH", async () => {
    await setup([icon(), icon({ id: "i2", name: "druga" })]);
    fireEvent.change(searchBox(), { target: { value: "druga" } });

    await waitFor(() => expect(screen.getByText("1 / 2")).toBeInTheDocument());
  });

  it("brak trafień mówi wprost, że kategoria jest pusta", async () => {
    await setup([icon()]);
    fireEvent.change(searchBox(), { target: { value: "nie-ma-takiej" } });

    await waitFor(() => expect(screen.getByText(/Brak ikon|No icons/)).toBeInTheDocument());
  });

  it("siatka renderuje PACZKAMI, nie całą biblioteką naraz", async () => {
    // Jedna karta to trzy obrazki - render tysiąca kart to tysiące żądań.
    const many = Array.from({ length: 75 }, (_, i) => icon({ id: `i${i}`, name: `ikona_${i}` }));
    await setup(many);

    expect(screen.getAllByRole("combobox")).toHaveLength(60);
  });

  it("dociągnięcie kolejnej paczki pokazuje resztę", async () => {
    const many = Array.from({ length: 75 }, (_, i) => icon({ id: `i${i}`, name: `ikona_${i}` }));
    await setup(many);
    fireEvent.click(screen.getByRole("button", { name: /Wczytaj więcej|Load more/ }));

    await waitFor(() => expect(screen.getAllByRole("combobox")).toHaveLength(75));
  });

  it("przycisk dociągania podaje, ILE zostało", async () => {
    const many = Array.from({ length: 75 }, (_, i) => icon({ id: `i${i}`, name: `ikona_${i}` }));
    await setup(many);

    expect(screen.getByRole("button", { name: /Wczytaj więcej|Load more/ }).textContent).toContain(
      "15",
    );
  });
});

describe("biblioteka ikon - import hurtem", () => {
  const bulkInput = () =>
    document.querySelectorAll<HTMLInputElement>('input[type="file"][multiple]')[0];

  it("pomija ikony, które JUŻ SĄ w bibliotece", async () => {
    // Bez tej listy import nadpisuje ręcznie poprawione etykiety.
    await setup([icon()]);
    fireEvent.change(bulkInput(), {
      target: { files: [new File(["x"], "a.svg", { type: "image/svg+xml" })] },
    });

    await waitFor(() => expect(h.bulkCalls).toHaveLength(1));
    expect((h.bulkCalls[0] as { existing: string[] }).existing).toEqual(["nes_logo"]);
  });

  it("import trafia do rodzaju z AKTYWNEJ zakładki", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /Flagi|Flags/ }));
    await waitFor(() => expect(h.listCalls).toContain("flag"));
    fireEvent.change(bulkInput(), {
      target: { files: [new File(["x"], "pl.svg", { type: "image/svg+xml" })] },
    });

    await waitFor(() => expect(h.bulkCalls).toHaveLength(1));
    expect((h.bulkCalls[0] as { kind: string }).kind).toBe("flag");
  });

  it("pusty wybór plików nie startuje importu", async () => {
    await setup();
    fireEvent.change(bulkInput(), { target: { files: [] } });

    expect(h.bulkCalls).toHaveLength(0);
  });

  it("dziennik rozróżnia sukces, pominięcie i błąd", async () => {
    // Sam licznik na końcu nie mówi, KTÓRY plik się nie udał.
    h.bulkProgress = [
      { index: 1, total: 3, base: "alfa", status: "done" },
      { index: 2, total: 3, base: "beta", status: "skipped" },
      { index: 3, total: 3, base: "gamma", status: "error", message: "zły format" },
    ];
    await setup();
    fireEvent.change(bulkInput(), {
      target: { files: [new File(["x"], "a.svg", { type: "image/svg+xml" })] },
    });

    await waitFor(() => expect(screen.getByText(/alfa/)).toBeInTheDocument());
    expect(screen.getByText(/beta/).textContent).toContain("↷");
    expect(screen.getByText(/gamma/).textContent).toContain("zły format");
  });

  it("podsumowanie podaje liczby utworzonych i zaktualizowanych", async () => {
    h.bulkResult = { created: 5, updated: 2, skipped: 0, errors: [] };
    await setup();
    fireEvent.change(bulkInput(), {
      target: { files: [new File(["x"], "a.svg", { type: "image/svg+xml" })] },
    });

    await waitFor(() => expect(h.toast.success).toHaveBeenCalled());
    const message = String(h.toast.success.mock.calls.at(-1)?.[0]);
    expect(message).toContain("5");
    expect(message).toContain("2");
  });

  it("błędy w paczce są zgłaszane OSOBNO od podsumowania", async () => {
    // Zielony komunikat o sukcesie przy dziesięciu błędach to fałszywy sygnał.
    h.bulkResult = { created: 1, updated: 0, skipped: 0, errors: [{ base: "x" }] };
    await setup();
    fireEvent.change(bulkInput(), {
      target: { files: [new File(["x"], "a.svg", { type: "image/svg+xml" })] },
    });

    await waitFor(() => expect(h.toast.error).toHaveBeenCalled());
  });

  it("PORAŻKA całego importu chowa pasek postępu", async () => {
    // Zawieszony pasek wygląda jak trwająca praca, która nigdy się nie kończy.
    h.bulkError = new Error("brak połączenia");
    await setup();
    fireEvent.change(bulkInput(), {
      target: { files: [new File(["x"], "a.svg", { type: "image/svg+xml" })] },
    });

    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("brak połączenia"));
    expect(document.querySelector(".bg-brand")).toBeNull();
  });
});

describe("biblioteka ikon - dociąganie przy przewinięciu", () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => icon({ id: `i${i}`, name: `ikona_${i}` }));

  it("dojechanie do końca siatki dokłada kolejną paczkę SAMO", async () => {
    // Bez obserwatora redaktor musi klikać „wczytaj więcej” przy każdej paczce.
    await setup(many(75));
    expect(screen.getAllByRole("combobox")).toHaveLength(60);

    h.observerCallbacks.at(-1)?.([{ isIntersecting: true }]);
    await waitFor(() => expect(screen.getAllByRole("combobox")).toHaveLength(75));
  });

  it("obserwator NIE dokłada niczego, dopóki koniec nie jest widoczny", async () => {
    await setup(many(75));
    h.observerCallbacks.at(-1)?.([{ isIntersecting: false }]);

    expect(screen.getAllByRole("combobox")).toHaveLength(60);
  });

  it("krótka lista w ogóle nie zakłada obserwatora", async () => {
    // Obserwator bez czego obserwować to wyciek nasłuchu na każdej zakładce.
    await setup(many(3));
    expect(h.observerCallbacks).toHaveLength(0);
  });
});

describe("biblioteka ikon - przyciski sięgające po ukryte pola", () => {
  it("przycisk importu hurtem otwiera wybór plików", async () => {
    await setup();
    const input = document.querySelector<HTMLInputElement>('input[type="file"][multiple]')!;
    const click = vi.fn();
    input.click = click;
    fireEvent.click(screen.getByRole("button", { name: /Wybierz pliki|Choose files/ }));

    expect(click).toHaveBeenCalled();
  });

  it("kafel wariantu otwiera wybór pliku po kliknięciu w podgląd", async () => {
    // Kafel jest jedynym celem kliknięcia - ukryte pole nie ma własnego.
    await setup([icon()]);
    const kafel = within(card("nes_logo")).getByText(/^Dark$/).parentElement as HTMLElement;
    const input = kafel.querySelector<HTMLInputElement>('input[type="file"]')!;
    const click = vi.fn();
    input.click = click;
    fireEvent.click(within(kafel).getAllByRole("button")[0]);

    expect(click).toHaveBeenCalled();
  });
});

describe("biblioteka ikon - etykieta w formularzu i błędy karty", () => {
  it("etykieta z formularza trafia do zapisu", async () => {
    // Etykieta jest jedynym opisem ikony widocznym w wyszukiwarce panelu.
    await setup();
    fireEvent.change(screen.getByPlaceholderText("np. nes_logo"), { target: { value: "logo" } });
    fireEvent.change(screen.getByPlaceholderText(/np\. Logo|e\.g\./), {
      target: { value: "Logo firmowe" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: /^(Dodaj|Add)$/ })[0]);

    await waitFor(() => expect(h.upserts).toHaveLength(1));
    expect((h.upserts[0] as { payload: { label: string } }).payload.label).toBe("Logo firmowe");
  });

  it("PORAŻKA zapisu z karty mówi o powodzie", async () => {
    h.upsertError = new Error("konflikt wersji");
    await setup([icon()]);
    fireEvent.click(within(slotOf("nes_logo", /^Default$/)).getAllByRole("button")[1]);

    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("konflikt wersji"));
  });

  it.each([
    [/^Light$/, "url_light"],
    [/^Dark$/, "url_dark"],
  ])("czyszczenie slotu %s zeruje WŁASNY adres", async (etykieta, klucz) => {
    await setup([
      icon({ url_light: "https://cdn.example/l.svg", url_dark: "https://cdn.example/d.svg" }),
    ]);
    fireEvent.click(within(slotOf("nes_logo", etykieta as RegExp)).getAllByRole("button")[1]);

    await waitFor(() => expect(h.upserts).toHaveLength(1));
    expect((h.upserts[0] as { payload: Record<string, unknown> }).payload[klucz as string]).toBe(
      "",
    );
  });
});

/** Kafel wariantu - etykieta jest divem, więc kafel to jej rodzic. */
function slotOf(name: string, label: RegExp): HTMLElement {
  return within(card(name)).getByText(label).parentElement as HTMLElement;
}
