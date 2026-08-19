// TRASA PRESETÓW KADRU. Do 19.08.2026 na zerze (228 instrukcji).
//
// Presety z tego ekranu wychodzą daleko poza panel: `buildTransformedImageUrl`
// buduje z nich URL-e wariantów obrazków serwowane czytelnikom. Zapisany tu
// rozmiar 0 albo proporcja 0 daje adresy, których Storage nie umie obsłużyć -
// czyli puste miniatury na produkcji. Dlatego formularz KLAMRUJE każdą liczbę,
// i to jest główna reguła tego pliku.
//
// Druga reguła to tryb formularza: ten sam zestaw pól służy do TWORZENIA i do
// EDYCJI. Zgubione `id` przy edycji tworzy duplikat zamiast poprawić preset,
// a niewyczyszczony formularz po zapisie edytuje dalej stary wiersz.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { AnyRoute } from "@tanstack/react-router";

const h = vi.hoisted(() => ({
  sizes: [] as Record<string, unknown>[],
  upserts: [] as unknown[],
  deletes: [] as string[],
  upsertError: null as Error | null,
  confirmAnswer: true,
  confirmCalls: [] as Record<string, unknown>[],
  regenResult: { media: 3, sizes: 2, ok: 6, failed: 0 } as Record<string, number>,
  regenError: null as Error | null,
  regenCalls: [] as unknown[],
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({ useRequiredTenant: () => "tenant-1" }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/appDialogs", () => ({
  confirmDialog: async (opts: Record<string, unknown>) => {
    h.confirmCalls.push(opts);
    return h.confirmAnswer;
  },
}));
vi.mock("@/lib/cropSizes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cropSizes")>()),
  listCropSizes: async () => h.sizes,
  upsertCropSize: async (tenantId: string, draft: unknown) => {
    if (h.upsertError) throw h.upsertError;
    h.upserts.push({ tenantId, draft });
  },
  deleteCropSize: async (id: string) => {
    h.deletes.push(id);
  },
}));
vi.mock("@/lib/media.functions", () => ({ regenerateThumbnails: "regen" }));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => async (payload: unknown) => {
    h.regenCalls.push(payload);
    if (h.regenError) throw h.regenError;
    return h.regenResult;
  },
}));

import { Route } from "@/routes/admin.crop-sizes";

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function preset(overrides: Record<string, unknown> = {}) {
  return {
    id: "cs-1",
    tenant_id: "tenant-1",
    name: "card-4-3",
    ratio_w: 4,
    ratio_h: 3,
    width: 800,
    height: 600,
    position: 10,
    ...overrides,
  };
}

async function setup() {
  const Component = (Route as AnyRoute).options.component as () => ReactNode;
  const view = render(<Component />, { wrapper });
  await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument());
  // Lista wjeżdża z zapytania; pusty stan renderuje własny wiersz, więc czekamy
  // na dokładną liczbę wierszy zamiast na „cokolwiek”.
  const oczekiwane = Math.max(1, h.sizes.length);
  await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(oczekiwane));
  return view;
}

/** Pole formularza po widocznej etykiecie. */
function field(label: string): HTMLInputElement {
  const wrap = screen.getByText(label).closest("div");
  const input = wrap?.querySelector("input");
  if (!input) throw new Error(`brak pola ${label}`);
  return input as HTMLInputElement;
}

const saveButton = () => screen.getByRole("button", { name: /^(Zapisz|Save)$/ });
const lastDraft = () => (h.upserts.at(-1) as { draft: Record<string, unknown> }).draft;

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  h.sizes = [];
  h.upserts.length = 0;
  h.deletes.length = 0;
  h.confirmCalls.length = 0;
  h.regenCalls.length = 0;
  h.upsertError = null;
  h.regenError = null;
  h.confirmAnswer = true;
  h.regenResult = { media: 3, sizes: 2, ok: 6, failed: 0 };
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});

describe("presety kadru - klamrowanie wartości", () => {
  it("proporcja NIE schodzi poniżej jedynki", async () => {
    // Zero w proporcji daje dzielenie przez zero w budowie adresu wariantu.
    await setup();
    fireEvent.change(field("Nazwa"), { target: { value: "test" } });
    fireEvent.change(field("Ratio W"), { target: { value: "0" } });
    fireEvent.change(field("Ratio H"), { target: { value: "-5" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.upserts).toHaveLength(1));
    expect(lastDraft()).toMatchObject({ ratio_w: 1, ratio_h: 1 });
  });

  it("wymiary NIE schodzą poniżej szesnastu pikseli", async () => {
    // Miniatura mniejsza niż 16 px jest bezużyteczna, a Storage i tak odmówi.
    await setup();
    fireEvent.change(field("Nazwa"), { target: { value: "test" } });
    fireEvent.change(field("Width (px)"), { target: { value: "1" } });
    fireEvent.change(field("Height (px)"), { target: { value: "0" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.upserts).toHaveLength(1));
    expect(lastDraft()).toMatchObject({ width: 16, height: 16 });
  });

  it("tekst zamiast liczby spada na wartość minimalną, nie na NaN", async () => {
    // `Number("abc")` to NaN - bez zabezpieczenia wpadłby do bazy.
    await setup();
    fireEvent.change(field("Nazwa"), { target: { value: "test" } });
    fireEvent.change(field("Width (px)"), { target: { value: "abc" } });
    fireEvent.change(field("Ratio W"), { target: { value: "abc" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.upserts).toHaveLength(1));
    expect(lastDraft()).toMatchObject({ width: 16, ratio_w: 1 });
  });

  it("kolejność PRZYJMUJE zero - to nie jest wymiar", async () => {
    // Klamra z pozostałych pól tutaj byłaby błędem: pozycja 0 jest poprawna.
    await setup();
    fireEvent.change(field("Nazwa"), { target: { value: "test" } });
    fireEvent.change(field("Kolejność"), { target: { value: "0" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.upserts).toHaveLength(1));
    expect(lastDraft()).toMatchObject({ position: 0 });
  });

  it("poprawne wartości przechodzą bez zmian", async () => {
    await setup();
    fireEvent.change(field("Nazwa"), { target: { value: "hero" } });
    fireEvent.change(field("Ratio W"), { target: { value: "21" } });
    fireEvent.change(field("Ratio H"), { target: { value: "9" } });
    fireEvent.change(field("Width (px)"), { target: { value: "2100" } });
    fireEvent.change(field("Height (px)"), { target: { value: "900" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.upserts).toHaveLength(1));
    expect(lastDraft()).toMatchObject({
      name: "hero",
      ratio_w: 21,
      ratio_h: 9,
      width: 2100,
      height: 900,
    });
  });
});

describe("presety kadru - zapis", () => {
  it("PUSTA nazwa nie idzie do bazy", async () => {
    // Preset bez nazwy jest nie do wybrania w edytorach - byłby martwym wierszem.
    await setup();
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.upserts).toHaveLength(0);
  });

  it("nazwa z samych spacji też nie idzie do bazy", async () => {
    await setup();
    fireEvent.change(field("Nazwa"), { target: { value: "   " } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.upserts).toHaveLength(0);
  });

  it("zapis niesie identyfikator TENANTA", async () => {
    // Preset bez tenanta wyciekłby do innej redakcji.
    await setup();
    fireEvent.change(field("Nazwa"), { target: { value: "test" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.upserts).toHaveLength(1));
    expect((h.upserts[0] as { tenantId: string }).tenantId).toBe("tenant-1");
  });

  it("po zapisie formularz WRACA do stanu wyjściowego", async () => {
    // Niewyczyszczony formularz zapisuje drugi raz to samo pod tym samym `id`.
    await setup();
    fireEvent.change(field("Nazwa"), { target: { value: "test" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(field("Nazwa").value).toBe(""));
    expect(field("Ratio W").value).toBe("16");
  });

  it("PORAŻKA zapisu zostawia wpisane dane i mówi o błędzie", async () => {
    // Wyczyszczenie formularza po nieudanym zapisie kasuje pracę użytkownika.
    h.upsertError = new Error("duplikat nazwy");
    await setup();
    fireEvent.change(field("Nazwa"), { target: { value: "test" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("duplikat nazwy"));
    expect(field("Nazwa").value).toBe("test");
  });
});

describe("presety kadru - lista i tryb edycji", () => {
  it("pusta lista mówi wprost, że nie ma presetów", async () => {
    await setup();
    expect(screen.getByText(/Brak presetów|No presets/i)).toBeInTheDocument();
  });

  it("wiersz pokazuje proporcję ORAZ rozmiar w pikselach", async () => {
    // Sama nazwa nie wystarcza - dwa presety bywają nazwane podobnie.
    h.sizes = [preset()];
    await setup();
    const wiersz = screen.getByRole("listitem");

    expect(wiersz.textContent).toContain("card-4-3");
    expect(wiersz.textContent).toContain("4:3");
    expect(wiersz.textContent).toContain("800×600");
  });

  it("edycja wypełnia formularz wierszem i PRZENOSI identyfikator", async () => {
    // Zgubione `id` tworzy duplikat zamiast poprawić preset.
    h.sizes = [preset()];
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /Edytuj|Edit/ }));
    expect(field("Nazwa").value).toBe("card-4-3");

    fireEvent.click(saveButton());
    await waitFor(() => expect(h.upserts).toHaveLength(1));
    expect(lastDraft()).toMatchObject({ id: "cs-1", name: "card-4-3", width: 800 });
  });

  it("tryb edycji zmienia nagłówek sekcji i dokłada wyjście", async () => {
    // Bez wyjścia z edycji nie da się wrócić do tworzenia nowego presetu.
    h.sizes = [preset()];
    await setup();
    expect(screen.getByText(/Nowy preset|New preset/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Edytuj|Edit/ }));
    expect(screen.getByText(/^(Edycja|Edit)$/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Anuluj|Cancel/ }));
    expect(field("Nazwa").value).toBe("");
    expect(screen.getByText(/Nowy preset|New preset/)).toBeInTheDocument();
  });

  it("licznik presetów zgadza się z liczbą wierszy", async () => {
    h.sizes = [preset(), preset({ id: "cs-2", name: "wide" })];
    await setup();

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText(/Presety \(2\)|Presets \(2\)/)).toBeInTheDocument();
  });
});

describe("presety kadru - usuwanie", () => {
  it("PYTA przed usunięciem i pyta pytaniem destrukcyjnym", async () => {
    // Usunięcie presetu unieważnia wszystkie zbudowane z niego adresy.
    h.sizes = [preset()];
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /Usuń|Remove/ }));

    await waitFor(() => expect(h.confirmCalls).toHaveLength(1));
    expect(h.confirmCalls[0]).toMatchObject({ destructive: true });
  });

  it("odmowa w oknie potwierdzenia NIE usuwa", async () => {
    h.confirmAnswer = false;
    h.sizes = [preset()];
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /Usuń|Remove/ }));

    await waitFor(() => expect(h.confirmCalls).toHaveLength(1));
    expect(h.deletes).toHaveLength(0);
  });

  it("zgoda usuwa DOKŁADNIE wskazany wiersz", async () => {
    h.sizes = [preset(), preset({ id: "cs-2", name: "wide" })];
    await setup();
    const drugi = screen.getAllByRole("listitem")[1];
    fireEvent.click(within(drugi).getByRole("button", { name: /Usuń|Remove/ }));

    await waitFor(() => expect(h.deletes).toEqual(["cs-2"]));
  });
});

describe("presety kadru - regeneracja miniatur", () => {
  it("raportuje liczby z odpowiedzi serwera, nie własne", async () => {
    // To jedyny ślad, ile plików faktycznie przeliczono.
    h.regenResult = { media: 12, sizes: 4, ok: 40, failed: 8 };
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /Regeneruj|Regenerate/ }));

    await waitFor(() => expect(screen.getByText(/12/)).toBeInTheDocument());
    const status = screen.getByText(/12/).textContent ?? "";
    expect(status).toContain("4");
    expect(status).toContain("40");
    expect(status).toContain("8");
  });

  it("ogranicza pojedynczy przebieg, zamiast brać całą bibliotekę", async () => {
    // Bez limitu jedno kliknięcie przelicza całą bibliotekę mediów.
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /Regeneruj|Regenerate/ }));

    await waitFor(() => expect(h.regenCalls).toHaveLength(1));
    expect(h.regenCalls[0]).toMatchObject({ data: { limit: 100 } });
  });

  it("PORAŻKA czyści status zamiast zostawiać wielokropek", async () => {
    // Zawieszone „...” wygląda jak trwająca praca, która nigdy się nie kończy.
    h.regenError = new Error("timeout");
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /Regeneruj|Regenerate/ }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("timeout"));
    expect(screen.queryByText("...")).toBeNull();
  });
});

describe("presety kadru - sklejenie trasy", () => {
  it("ma tytuł karty", async () => {
    const head = (Route as AnyRoute).options.head as () => { meta: Record<string, unknown>[] };
    expect(head().meta).toContainEqual({ title: "Crop sizes - Admin" });
  });

  it("ekran błędu pokazuje POWÓD, a nie ogólnik", () => {
    const ErrorComponent = (Route as AnyRoute).options.errorComponent as (p: {
      error: Error;
    }) => ReactNode;
    render(<>{ErrorComponent({ error: new Error("brak uprawnień") })}</>);

    expect(screen.getByRole("alert")).toHaveTextContent("brak uprawnień");
  });

  it("brak dopasowania ma własny ekran", () => {
    const NotFound = (Route as AnyRoute).options.notFoundComponent as () => ReactNode;
    render(<>{NotFound()}</>);

    expect(screen.getByText("404")).toBeInTheDocument();
  });
});
