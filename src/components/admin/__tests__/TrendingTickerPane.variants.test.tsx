// Panel CMS „Warte przeczytania” (`TrendingTickerPane`) - WARIANTY, HISTORIA,
// ZAPIS I MOST PODGLĄDU.
//
// CO TEN PLIK PRZYPINA I DLACZEGO. Panel jest jedynym miejscem, w którym
// redakcja układa pasek w nagłówku serwisu, a całość jego stanu jedzie do JEDNEJ
// komórki `site_settings.header.value.trending`. Trzy rzeczy są tu nieodwracalne
// i dlatego mają świadków:
//   1. ZAPIS SCALA, A NIE NADPISUJE. `value` nagłówka trzyma też inne sekcje
//      (nawigacja, logo); zapis paska, który zgubiłby obce klucze, kasuje
//      konfigurację całego nagłówka jednym kliknięciem. Dlatego asercja czyta
//      PEŁEN ładunek `upsert` razem z `onConflict: "tenant_id,key"` (bez tego
//      klucza wielodostępność wstawiałaby duplikaty wierszy zamiast aktualizacji).
//   2. HISTORIA (cofnij/ponów/anuluj + skróty Ctrl/Cmd) jest jedyną siatką
//      bezpieczeństwa redaktora - panel nie ma potwierdzeń, a „Anuluj zmiany”
//      wraca do stanu OSTATNIO ZAPISANEGO, nie do domyślnego.
//   3. MOST DRAFTU. Panel rozgłasza niezapisaną konfigurację do prawdziwego
//      nagłówka (`publishTickerDraft`), a odmontowanie MUSI ten draft skasować -
//      inaczej po wyjściu z panelu cały serwis zostaje z podglądem cudzych,
//      nigdy niezapisanych ustawień. Świadkiem jest PUBLICZNY hak
//      `useTickerDraft` (ten sam, którego używa `Header`), a nie nazwa zdarzenia.
//
// TRZY STANY BAZOWE są tu osobnymi przypadkami: pusty (brak sekcji `trending` w
// ustawieniach), z danymi (dwa nazwane warianty) i błąd (odczyt oraz zapis
// odrzucone przez bazę).
//
// GRANICA ATRAP: klient Supabase (atom `supabaseFromStub` - pełny łańcuch
// PostgREST z zapisem wywołań), toasty, `toastError`, przełącznik Radix oraz
// podgląd paska i próbnik kolorów (`src/test/ticker/tickerPaneStubs.ts`).
// Wszystko poniżej - stan panelu, normalizacja wariantów, most draftu - jest
// PRAWDZIWE. Zero sieci i zero prawdziwych danych: wpisy nazywają się
// `post-alfa`, a warianty „Redakcja” i „Weekend”.
//
// PODZIAŁ PLIKU. Formularz konfiguracji ma osobny plik
// (`TrendingTickerPane.form.test.tsx`), a wybór wpisów i kolory -
// `TrendingTickerPane.selection.test.tsx`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { fail, ok, supabaseFromStub } from "@/test/supabase";
import type { RecordedChain, SupabaseResult } from "@/test/supabase";
import type { TickerPreviewSink } from "@/test/ticker/tickerPaneStubs";
import type { TickerConfig } from "@/lib/views/headerTickerQuery";
import type { TickerSettings } from "@/lib/views/tickerVariants";

/** Wiersz, jaki panel wysyła do `site_settings` przez `upsert`. */
interface SavedRow {
  key: string;
  value: Record<string, unknown>;
}

const h = vi.hoisted(() => ({
  /** Język panelu (czytany getterem, jak realna instancja i18next). */
  language: "pl",
  /** Zawartość `site_settings.header.value` w atrapie bazy. */
  headerValue: {} as Record<string, unknown>,
  /** Gdy `true`, odczyt ustawień kończy się błędem PostgREST. */
  headerReadFails: false,
  /** Gdy `true`, w `site_settings` NIE MA jeszcze wiersza `header`. */
  headerRowMissing: false,
  /** Komunikat błędu zapisu (null = zapis się udaje). */
  saveError: null as string | null,
  /** Bramka opóźniająca zapis - do obserwacji stanu „Zapisywanie…”. */
  saveGate: null as Promise<void> | null,
  /** Wszystkie wiersze wysłane przez `upsert`, w kolejności. */
  saved: [] as SavedRow[],
  toastSuccess: vi.fn<(message: string) => void>(),
  toastInfo: vi.fn<(message: string) => void>(),
  toastErrorToast: vi.fn<(message: string) => void>(),
  toastError: vi.fn<(error: unknown, kind: string) => void>(),
  preview: { renders: [], mounts: 0 } as TickerPreviewSink,
  /** Podstawiane po imporcie - patrz komentarz przy atrapie klienta. */
  from: null as ((table: string) => unknown) | null,
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.language),
);

// Atrapa klienta: `from` jest podstawiane DOPIERO po imporcie (atomu
// `supabaseFromStub` nie da się zbudować w hoistowanej fabryce), ale panel woła
// `supabase.from(...)` wyłącznie w `queryFn`/`mutationFn`, czyli już w trakcie
// renderu - wtedy wskaźnik jest gotowy. Brak podstawienia to błąd testu, a nie
// cichy `undefined.select`.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string): unknown => {
      if (!h.from) throw new Error(`test: atrapa supabase nie ma łańcucha dla "${table}"`);
      return h.from(table);
    },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: h.toastSuccess, info: h.toastInfo, error: h.toastErrorToast },
  Toaster: () => null,
}));

vi.mock("@/lib/toastError", () => ({ toastError: h.toastError }));

vi.mock("@/components/ui/switch", async () =>
  (await import("@/test/reactStubs")).radixSwitchStub(await import("react")),
);

vi.mock("@/components/header/TrendingTicker", async () =>
  (await import("@/test/ticker/tickerPaneStubs")).trendingTickerStub(
    await import("react"),
    h.preview,
  ),
);

vi.mock("@/components/admin/blocks/AdminColorPicker", async () =>
  (await import("@/test/ticker/tickerPaneStubs")).adminColorPickerStub(await import("react")),
);

import { useTickerDraft } from "@/lib/views/tickerDraftBridge";
import { TrendingTickerPane } from "@/components/admin/TrendingTickerPane";

const db = supabaseFromStub();
h.from = db.from;

const HEADER_KEY = ["site_settings", "header"];
const POSTS_KEY = ["ticker_post_options"];

/** Ustawienia z dwoma nazwanymi wariantami + OBCA sekcja nagłówka do scalenia. */
function headerWithVariants(): Record<string, unknown> {
  return {
    nav: { style: "wide" },
    trending: {
      activeVariantId: "var-redakcja",
      variants: [
        {
          id: "var-redakcja",
          name: "Redakcja",
          config: { source: "trending", limit: 5, labelPl: "Redakcja poleca" },
        },
        {
          id: "var-weekend",
          name: "Weekend",
          config: { source: "latest", limit: 3, labelPl: "Na weekend" },
        },
      ],
    },
  };
}

function headerResponder(chain: RecordedChain): SupabaseResult | Promise<SupabaseResult> {
  const upsert = chain.argsOf("upsert");
  if (upsert) {
    const row = upsert[0] as SavedRow;
    h.saved.push(row);
    const finish = (): SupabaseResult => {
      if (h.saveError) return fail(h.saveError);
      // Atrapa zachowuje się jak baza: po zapisie odczyt oddaje NOWĄ wartość,
      // więc unieważnienie cache nie cofa właśnie zapisanych zmian.
      h.headerValue = row.value;
      return ok(null);
    };
    return h.saveGate ? h.saveGate.then(finish) : finish();
  }
  if (h.headerReadFails) return fail("permission denied for table site_settings", "42501");
  if (h.headerRowMissing) return ok(null);
  return ok({ value: h.headerValue });
}

/** Kolejne stany draftu widziane przez PUBLICZNY hak mostu (tak jak `Header`). */
const drafts: (TickerConfig | null)[] = [];

function DraftProbe() {
  const draft = useTickerDraft();
  useEffect(() => {
    drafts.push(draft);
  }, [draft]);
  return <div data-testid="draft-source">{draft?.source ?? "-"}</div>;
}

async function renderPane() {
  const view = renderWithQueryClient(
    <>
      <TrendingTickerPane />
      <DraftProbe />
    </>,
  );
  await waitFor(() => {
    expect(view.queryClient.getQueryState(HEADER_KEY)?.status).not.toBe("pending");
    expect(view.queryClient.getQueryState(POSTS_KEY)?.status).not.toBe("pending");
  });
  return view;
}

/** Ładunek `trending` wysłany do bazy (domyślnie z ostatniego zapisu). */
function savedSettings(index = -1): TickerSettings {
  const row = h.saved.at(index);
  if (!row) throw new Error("test: nie zapisano żadnego wiersza site_settings");
  return row.value.trending as TickerSettings;
}

/** Pigułki wariantów - jedyne przyciski panelu z `aria-pressed`. */
function chips(): HTMLElement[] {
  return [
    ...screen.queryAllByRole("button", { pressed: true }),
    ...screen.queryAllByRole("button", { pressed: false }),
  ];
}

function nameInput(): HTMLElement {
  return screen.getByLabelText("Nazwa wariantu");
}

function saveButton(): HTMLElement {
  return screen.getByRole("button", { name: /^Zapis/ });
}

beforeEach(() => {
  db.reset();
  db.setResponse("site_settings", headerResponder);
  db.setResponse("posts", () => ok([{ id: "post-alfa", title_pl: "Alfa", title_en: "Alpha" }]));
  h.language = "pl";
  h.headerValue = {};
  h.headerReadFails = false;
  h.headerRowMissing = false;
  h.saveError = null;
  h.saveGate = null;
  h.saved.length = 0;
  h.preview.renders.length = 0;
  h.preview.mounts = 0;
  drafts.length = 0;
  vi.clearAllMocks();
});

describe("TrendingTickerPane - stany bazowe i język panelu", () => {
  it("stan PUSTY daje jeden wariant domyślny, włączony pasek i brak czego usuwać", async () => {
    await renderPane();

    expect(
      screen.getByRole("heading", { name: "Widget „Warte przeczytania”" }),
    ).toBeInTheDocument();
    expect(nameInput()).toHaveValue("Domyślny");
    expect(screen.getByRole("button", { name: /Domyślny/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("Włącz pasek")).toBeChecked();
    expect(screen.getByRole("button", { name: "Usuń wariant" })).toBeDisabled();
  });

  it("stan Z DANYMI wczytuje warianty z ustawień i aktywuje zapisany", async () => {
    h.headerValue = headerWithVariants();
    await renderPane();

    await waitFor(() => expect(nameInput()).toHaveValue("Redakcja"));
    expect(screen.getByRole("button", { name: /Redakcja/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /Weekend/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByLabelText("Liczba wpisów")).toHaveValue(5);
  });

  it("PIERWSZE URUCHOMIENIE (brak wiersza w site_settings) też daje wariant domyślny", async () => {
    h.headerRowMissing = true;
    const view = await renderPane();

    expect(view.queryClient.getQueryState(HEADER_KEY)?.status).toBe("success");
    expect(nameInput()).toHaveValue("Domyślny");
    expect(chips()).toHaveLength(1);
  });

  it("stan BŁĘDU odczytu nie wywraca panelu - formularz stoi na wartościach domyślnych", async () => {
    h.headerReadFails = true;
    const view = await renderPane();

    expect(view.queryClient.getQueryState(HEADER_KEY)?.status).toBe("error");
    expect(nameInput()).toHaveValue("Domyślny");
    expect(screen.getByLabelText("Liczba wpisów")).toHaveValue(8);
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("wariant EN podmienia CAŁY słownik panelu, nie tylko tytuł", async () => {
    h.language = "en-GB";
    await renderPane();

    expect(screen.getByRole("heading", { name: "Worth reading widget" })).toBeInTheDocument();
    expect(screen.getByLabelText("Enable bar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add variant" })).toBeInTheDocument();
    expect(
      screen.getByText("You can create up to 5 variants - one is active."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Warianty")).not.toBeInTheDocument();
  });
});

describe("TrendingTickerPane - warianty", () => {
  it("dodaje wariant, nazywa go po języku panelu i od razu aktywuje", async () => {
    await renderPane();

    fireEvent.click(screen.getByRole("button", { name: "Dodaj wariant" }));

    expect(nameInput()).toHaveValue("Wariant 2");
    expect(screen.getByRole("button", { name: /Wariant 2/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /Domyślny/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("po angielsku nowy wariant dostaje angielską nazwę", async () => {
    h.language = "en";
    await renderPane();

    fireEvent.click(screen.getByRole("button", { name: "Add variant" }));

    expect(screen.getByLabelText("Variant name")).toHaveValue("Variant 2");
  });

  it("limit pięciu wariantów blokuje OBA przyciski dokładające warianty", async () => {
    await renderPane();

    for (let i = 0; i < 4; i += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Dodaj wariant" }));
    }

    expect(chips()).toHaveLength(5);
    expect(screen.getByRole("button", { name: "Dodaj wariant" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Duplikuj" })).toBeDisabled();
  });

  it("duplikuje AKTYWNY wariant razem z konfiguracją, a kolory kopiuje głęboko", async () => {
    h.headerValue = headerWithVariants();
    await renderPane();
    await waitFor(() => expect(nameInput()).toHaveValue("Redakcja"));

    fireEvent.click(screen.getByRole("button", { name: "Duplikuj" }));

    expect(nameInput()).toHaveValue("Redakcja (kopia)");
    expect(screen.getByLabelText("Liczba wpisów")).toHaveValue(5);

    fireEvent.click(saveButton());
    await waitFor(() => expect(h.saved).toHaveLength(1));
    const [redakcja, weekend, kopia] = savedSettings().variants;
    expect([redakcja.name, weekend.name, kopia.name]).toEqual([
      "Redakcja",
      "Weekend",
      "Redakcja (kopia)",
    ]);
    expect(kopia.id).not.toBe(redakcja.id);
    expect(kopia.config.labelPl).toBe("Redakcja poleca");
    expect(kopia.config.colors).toEqual(redakcja.config.colors);
    expect(kopia.config.colors).not.toBe(redakcja.config.colors);
    expect(kopia.config.colors?.light).not.toBe(redakcja.config.colors?.light);
  });

  it("przełącza aktywny wariant pigułką - formularz pokazuje JEGO ustawienia", async () => {
    h.headerValue = headerWithVariants();
    await renderPane();
    await waitFor(() => expect(nameInput()).toHaveValue("Redakcja"));

    fireEvent.click(screen.getByRole("button", { name: /Weekend/ }));

    expect(nameInput()).toHaveValue("Weekend");
    expect(screen.getByLabelText("Liczba wpisów")).toHaveValue(3);
    expect(screen.getByRole("button", { name: /Weekend/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("edycja pola konfiguracji dotyka WYŁĄCZNIE wariantu aktywnego", async () => {
    h.headerValue = headerWithVariants();
    await renderPane();
    await waitFor(() => expect(nameInput()).toHaveValue("Redakcja"));

    fireEvent.change(screen.getByLabelText("Liczba wpisów"), { target: { value: "9" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.saved).toHaveLength(1));
    const [redakcja, weekend] = savedSettings().variants;
    expect(redakcja.config.limit).toBe(9);
    expect(weekend.config.limit).toBe(3);
  });

  it("zmiana nazwy jedzie do pigułki i do zapisu", async () => {
    h.headerValue = headerWithVariants();
    await renderPane();
    await waitFor(() => expect(nameInput()).toHaveValue("Redakcja"));

    fireEvent.change(nameInput(), { target: { value: "Poranek" } });

    expect(screen.getByRole("button", { name: /Poranek/ })).toBeInTheDocument();
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.saved).toHaveLength(1));
    expect(savedSettings().variants[0].name).toBe("Poranek");
  });

  it("usuwa aktywny wariant i przenosi aktywność na pierwszy z pozostałych", async () => {
    h.headerValue = headerWithVariants();
    await renderPane();
    await waitFor(() => expect(nameInput()).toHaveValue("Redakcja"));

    fireEvent.click(screen.getByRole("button", { name: "Usuń wariant" }));

    expect(screen.queryByRole("button", { name: /Redakcja/ })).not.toBeInTheDocument();
    expect(nameInput()).toHaveValue("Weekend");
    expect(screen.getByRole("button", { name: "Usuń wariant" })).toBeDisabled();
  });
});

describe("TrendingTickerPane - historia zmian", () => {
  it("cofa i ponawia pojedynczą zmianę, a przyciski pilnują końców stosu", async () => {
    h.headerValue = headerWithVariants();
    await renderPane();
    await waitFor(() => expect(nameInput()).toHaveValue("Redakcja"));

    const undo = screen.getByRole("button", { name: "Cofnij" });
    const redo = screen.getByRole("button", { name: "Ponów" });
    expect(undo).toBeDisabled();
    expect(redo).toBeDisabled();

    fireEvent.change(nameInput(), { target: { value: "Poranek" } });
    expect(undo).toBeEnabled();

    fireEvent.click(undo);
    expect(nameInput()).toHaveValue("Redakcja");
    expect(undo).toBeDisabled();
    expect(redo).toBeEnabled();

    fireEvent.click(redo);
    expect(nameInput()).toHaveValue("Poranek");
    expect(redo).toBeDisabled();
  });

  it("skróty Ctrl+Z, Cmd+Z, Ctrl+Shift+Z i Ctrl+Y robią to samo, co przyciski", async () => {
    await renderPane();

    fireEvent.change(nameInput(), { target: { value: "Alfa" } });
    fireEvent.change(nameInput(), { target: { value: "Beta" } });

    fireEvent.keyDown(window, { key: "Z", ctrlKey: true });
    expect(nameInput()).toHaveValue("Alfa");

    fireEvent.keyDown(window, { key: "z", metaKey: true });
    expect(nameInput()).toHaveValue("Domyślny");

    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect(nameInput()).toHaveValue("Alfa");

    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    expect(nameInput()).toHaveValue("Beta");
  });

  it("klawisz bez modyfikatora nie rusza historii", async () => {
    await renderPane();

    fireEvent.change(nameInput(), { target: { value: "Alfa" } });
    fireEvent.keyDown(window, { key: "z" });

    expect(nameInput()).toHaveValue("Alfa");
    expect(h.toastInfo).not.toHaveBeenCalled();
  });

  it("Ctrl+Z na pustej historii mówi o tym redakcji, a Ctrl+Y nic nie psuje", async () => {
    await renderPane();

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(h.toastInfo).toHaveBeenCalledWith("Brak zmian do cofnięcia.");

    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    expect(nameInput()).toHaveValue("Domyślny");
  });

  it("po odmontowaniu panelu skrót nie ma już nasłuchu", async () => {
    const view = await renderPane();
    view.unmount();

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });

    expect(h.toastInfo).not.toHaveBeenCalled();
  });

  it("„Anuluj zmiany” wraca do stanu OSTATNIO ZAPISANEGO i czyści oba stosy", async () => {
    h.headerValue = headerWithVariants();
    await renderPane();
    await waitFor(() => expect(nameInput()).toHaveValue("Redakcja"));

    const cancel = screen.getByRole("button", { name: "Anuluj zmiany" });
    expect(cancel).toBeDisabled();

    fireEvent.change(nameInput(), { target: { value: "Poranek" } });
    fireEvent.click(screen.getByRole("button", { name: "Dodaj wariant" }));
    expect(cancel).toBeEnabled();

    fireEvent.click(cancel);

    expect(nameInput()).toHaveValue("Redakcja");
    expect(chips()).toHaveLength(2);
    expect(h.toastSuccess).toHaveBeenCalledWith("Przywrócono ostatnio zapisany stan.");
    expect(screen.getByRole("button", { name: "Cofnij" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Ponów" })).toBeDisabled();
    expect(cancel).toBeDisabled();
  });
});

describe("TrendingTickerPane - zapis", () => {
  it("scala ładunek z obcymi sekcjami nagłówka i używa klucza konfliktu tenanta", async () => {
    h.headerValue = headerWithVariants();
    const view = await renderPane();
    await waitFor(() => expect(nameInput()).toHaveValue("Redakcja"));
    const invalidate = vi.spyOn(view.queryClient, "invalidateQueries");

    fireEvent.change(nameInput(), { target: { value: "Poranek" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("Zapisano"));
    const row = h.saved[0];
    expect(row.key).toBe("header");
    expect(row.value.nav).toEqual({ style: "wide" });
    expect(savedSettings().variants[0].name).toBe("Poranek");
    // Ostatni łańcuch to już ODCZYT po unieważnieniu cache - klucza konfliktu
    // szukamy w tym łańcuchu, który naprawdę zapisywał.
    const upsertChain = db.chainsFor("site_settings").find((c) => c.has("upsert"));
    expect(upsertChain?.argsOf("upsert")?.[1]).toEqual({ onConflict: "tenant_id,key" });
    expect(invalidate.mock.calls.map(([arg]) => arg)).toEqual([
      { queryKey: ["site_settings", "header"] },
      { queryKey: ["site_settings_public", "all"] },
      { queryKey: ["site_settings_public", "header"] },
    ]);
  });

  it("udany zapis czyści historię i ustawia nową bazę dla anulowania", async () => {
    await renderPane();

    fireEvent.change(nameInput(), { target: { value: "Poranek" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("Zapisano"));
    expect(screen.getByRole("button", { name: "Cofnij" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Anuluj zmiany" })).toBeDisabled();
    expect(nameInput()).toHaveValue("Poranek");
  });

  it("zapis po nieudanym odczycie wysyła sam pasek, bez zmyślonej reszty nagłówka", async () => {
    h.headerReadFails = true;
    await renderPane();

    fireEvent.change(nameInput(), { target: { value: "Poranek" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.saved).toHaveLength(1));
    expect(Object.keys(h.saved[0].value)).toEqual(["trending"]);
    expect(savedSettings().variants[0].name).toBe("Poranek");
  });

  it("w trakcie zapisu przycisk zmienia napis i jest zablokowany", async () => {
    let release = (): void => {};
    h.saveGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await renderPane();

    fireEvent.click(saveButton());

    await waitFor(() => expect(saveButton()).toHaveTextContent("Zapisywanie…"));
    expect(saveButton()).toBeDisabled();

    release();
    await waitFor(() => expect(saveButton()).toHaveTextContent("Zapisz"));
    expect(saveButton()).toBeEnabled();
  });

  it("odrzucony zapis idzie do toastError z kategorią zapisu, bez toastu sukcesu", async () => {
    h.saveError = "new row violates row-level security policy";
    await renderPane();

    fireEvent.change(nameInput(), { target: { value: "Poranek" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    const [error, kind] = h.toastError.mock.calls[0];
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("row-level security");
    expect(kind).toBe("save");
    expect(h.toastSuccess).not.toHaveBeenCalled();
    // Historia zostaje - redaktor ma co ponowić po nieudanym zapisie.
    expect(screen.getByRole("button", { name: "Cofnij" })).toBeEnabled();
  });
});

describe("TrendingTickerPane - most podglądu (draft do nagłówka)", () => {
  it("rozgłasza bieżącą, NIEZAPISANĄ konfigurację i kasuje ją przy odmontowaniu", async () => {
    h.headerValue = headerWithVariants();
    const view = await renderPane();
    await waitFor(() => expect(nameInput()).toHaveValue("Redakcja"));

    await waitFor(() => expect(screen.getByTestId("draft-source")).toHaveTextContent("trending"));

    fireEvent.click(screen.getByRole("button", { name: /Weekend/ }));
    await waitFor(() => expect(screen.getByTestId("draft-source")).toHaveTextContent("latest"));
    expect(drafts.at(-1)?.labelPl).toBe("Na weekend");

    view.unmount();

    // Świeży odbiorca (jak `Header` wchodzący na stronę po wyjściu z panelu)
    // musi zobaczyć PUSTY draft - `useTickerDraft` czyta go na starcie.
    const after = render(<DraftProbe />);
    expect(after.getByTestId("draft-source")).toHaveTextContent("-");
  });

  it("podgląd dostaje konfigurację aktywnego wariantu i przemontowuje się po zmianie", async () => {
    h.headerValue = headerWithVariants();
    await renderPane();
    await waitFor(() => expect(nameInput()).toHaveValue("Redakcja"));

    const mountsBefore = h.preview.mounts;
    expect(h.preview.renders.at(-1)?.variantId).toBe("var-redakcja");
    expect(h.preview.renders.at(-1)?.limit).toBe(5);

    fireEvent.click(screen.getByRole("button", { name: /Weekend/ }));

    expect(h.preview.mounts).toBeGreaterThan(mountsBefore);
    expect(h.preview.renders.at(-1)?.variantId).toBe("var-weekend");
    expect(h.preview.renders.at(-1)?.limit).toBe(3);
  });

  it("wyłączenie paska chowa podgląd, ale draft nadal opisuje stan panelu", async () => {
    await renderPane();
    expect(screen.getByTestId("ticker-preview")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Włącz pasek"));

    expect(screen.queryByTestId("ticker-preview")).not.toBeInTheDocument();
    await waitFor(() => expect(drafts.at(-1)?.enabled).toBe(false));
  });
});
