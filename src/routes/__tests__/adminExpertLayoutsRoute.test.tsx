// Trasa `/admin/expert-layouts` ZAMONTOWANA - globalne ustawienia strony
// eksperta (preset, widoczność i kolejność sekcji, kolory hero).
//
// PO CO TEN PLIK ISTNIEJE - I DLACZEGO WŁAŚNIE ON JEST DOWODEM TEZY AUDYTU.
//
// Ta trasa jest KONTRPRZYKŁADEM. 444 linie, ZERO `useQuery`, ZERO
// `useMutation`, ani jednego importu klienta Supabase - cała warstwa danych
// mieszka w `src/hooks/useExpertLayoutSettings.ts`, a reguły layoutu
// w `src/lib/expertLayouts.ts` (obszar `experts` stoi na 97,9%). A trasa
// mimo tego stała na ZERZE pokrycia. Wniosek, który ten plik przybija:
// EKSTRAKCJA WARSTWY DANYCH JEST WARUNKIEM KONIECZNYM, NIE WYSTARCZAJĄCYM.
// To, co zostaje w trasie po wyprowadzeniu zapytań, nie jest ozdobą - to
// STAN WERSJI ROBOCZEJ i to, CZY ZMIANY W OGÓLE DOJADĄ DO ZAPISU.
//
// PIĘĆ REGUŁ, KTÓRYCH ZŁAMANIE KOSZTUJE:
//
//   1. WERSJA ROBOCZA JEST JEDNORAZOWO ZASIEWANA Z BAZY. Efekt kopiujący
//      `data` do `local` ma warunek `!local` - odświeżenie zapytania w tle
//      (invalidacja po zapisie, okno wraca z tła) NIE MOŻE nadpisać zmian,
//      których administrator jeszcze nie zapisał.
//   2. ZAPIS IDZIE BEZ `tenant_id`. Trasa odcina to pole z ładunku, bo
//      tenanta rozstrzyga baza (`current_tenant_id()` w hooku zapisu).
//      Ładunek z `tenant_id` z klienta to zaproszenie do zapisu na cudzym
//      obszarze roboczym - a asercja na ŁADUNKU jest jedynym miejscem,
//      w którym to widać.
//   3. PODGLĄD POKAZUJE WERSJĘ ROBOCZĄ, NIE ZAPISANĄ. Podgląd karmiony
//      danymi z bazy zamiast `local` kłamałby przy każdej zmianie przed
//      zapisem - a to jest jedyne, po co ten podgląd istnieje.
//   4. BŁĄD ZAPISU NIE UDAJE SUKCESU. Panel po nieudanym zapisie pokazujący
//      „zapisano" zostawia administratora w przekonaniu, że globalne
//      ustawienia stron WSZYSTKICH ekspertów są już zmienione.
//   5. TRASA NIE MONTUJE WŁASNEJ POWŁOKI PANELU. Layout `/admin` SAM owija
//      `<Outlet/>` w `<AdminShell>`; trasa owijała się DRUGI raz
//      (`<AdminShell hideSidebar>` w stanie wczytywania i w widoku głównym),
//      co dawało drugi `<main id="main-content">` w kolumnie treści
//      (zduplikowane id celu „przejdź do treści") i pływający drugi
//      przełącznik języka `AdminLangBar`. NAPRAWIONE; atrapa `AdminShell`
//      niżej jest SONDĄ liczącą montaże.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - DOSTĘPU. Ta trasa NIE MA własnej bramki roli - i to jest poprawne:
//   ustawieniami layoutu zarządza każdy członek personelu, więc autorytetem
//   jest wspólny layout `/admin` (`isStaff` -> `/login`) plus RLS na
//   `expert_layout_settings`. Dowód tych warstw mieszka
//   w `src/routes/__tests__/adminRouteAuthority.gate.test.ts` (bramka czyta
//   pliki tras) i w pgTAP. Render-test bramki, której w tej trasie nie ma,
//   byłby dokładnie tą farmą pokrycia, o której mówi nagłówek tamtej bramki.
// - WARSTWY DANYCH: `expertLayoutSettingsQueryOptions` i
//   `useSaveExpertLayoutSettings` (odczyt pod RLS, `current_tenant_id()`,
//   `upsert` po `tenant_id`) mają własne asercje przy hooku.
// - RENDERERA PODGLĄDU: `ExpertLayoutPreview` ciągnie realnego eksperta
//   z bazy i ma testy przy `ExpertLayoutRenderer`; tutaj stoi jako
//   atrapa-sonda, która ZAPISUJE otrzymane propsy.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ExpertLayoutSettings } from "@/lib/expertLayouts";

const h = vi.hoisted(() => ({
  /** Odpowiedź odczytu ustawień - `null` = zapytanie jeszcze wisi. */
  settings: null as ExpertLayoutSettings | null,
  /** Ładunki przekazane do mutacji zapisu - PRZEDMIOT DOWODU zamiast DOM. */
  savePayloads: [] as Partial<ExpertLayoutSettings>[],
  /** Błąd, którym mutacja ma odpowiedzieć (`null` = sukces). */
  saveError: null as unknown,
  savePending: false,
  /** Propsy, jakie dostała atrapa podglądu - kolejno, na każdy render. */
  previewProps: [] as { settings: ExpertLayoutSettings; savedAt: number }[],
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  /** Ile razy trasa zarejestrowała swój słownik (chunk trasy, nie entry). */
  ensureI18nCalls: 0,
  /** Ile razy zamontowano `AdminShell` - SONDA reguły 5. */
  shellRenders: 0,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-layouts", () => ({
  ensureI18n: () => {
    h.ensureI18nCalls += 1;
  },
}));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/adminToasts", () => ({
  adminToast: { layoutSaved: () => "adminToasts.layoutSaved" },
}));
vi.mock("@/hooks/useExpertLayoutSettings", () => ({
  useExpertLayoutSettings: () => ({ data: h.settings ?? undefined }),
  useSaveExpertLayoutSettings: () => ({
    mutateAsync: (patch: Partial<ExpertLayoutSettings>) => {
      h.savePayloads.push(patch);
      return h.saveError === null ? Promise.resolve() : Promise.reject(h.saveError);
    },
    isPending: h.savePending,
  }),
}));
// SONDA reguły 5, nie ozdoba: po naprawie trasa NIE importuje powłoki, więc
// ta atrapa nie powinna być wywołana ani razu. Powrót `<AdminShell>` do trasy
// podbija licznik i czerwieni test - bez montowania prawdziwej powłoki (ta
// ciągnie nawigację, sesję i tenanta, i ma własne testy przy `AdminShell`).
vi.mock("@/components/admin/AdminShell", () => ({
  AdminShell: ({ children }: { children?: ReactNode }) => {
    h.shellRenders += 1;
    return <div data-testid="admin-shell">{children}</div>;
  },
}));
// Sonda, nie ozdoba: podgląd renderuje REALNEGO eksperta z bazy, a dowodem
// jest tu WYŁĄCZNIE to, jakie ustawienia dostał (wersja robocza czy zapisana).
vi.mock("@/components/admin/ExpertLayoutPreview", () => ({
  ExpertLayoutPreview: (props: { settings: ExpertLayoutSettings; savedAt: number }) => {
    h.previewProps.push(props);
    return <div data-testid="preview" data-saved-at={props.savedAt} />;
  },
}));

import { renderRoute, routeMeta } from "@/test/routeHarness";
import { Route as ExpertLayoutsRoute } from "@/routes/admin.expert-layouts";
import {
  DEFAULT_EXPERT_SECTION_ORDER,
  EXPERT_LAYOUT_PRESETS,
  EXPERT_SECTIONS,
  defaultExpertLayoutSettings,
} from "@/lib/expertLayouts";

const PATH = "/admin/expert-layouts";
const TENANT = "11111111-1111-4111-8111-111111111111";

function settings(patch: Partial<ExpertLayoutSettings> = {}): ExpertLayoutSettings {
  return { ...defaultExpertLayoutSettings(TENANT), ...patch };
}

async function mount() {
  return renderRoute({ route: ExpertLayoutsRoute, path: PATH, initialEntry: PATH });
}

/** Ostatni ładunek zapisu - `undefined`, gdy panel nie zawołał mutacji. */
const lastPayload = () => h.savePayloads.at(-1);

/** Ostatnie propsy podglądu - z twardym błędem, gdy podglądu w ogóle nie ma. */
function lastPreview(): { settings: ExpertLayoutSettings; savedAt: number } {
  const last = h.previewProps.at(-1);
  if (!last) throw new Error("test: podgląd layoutu nie został zamontowany");
  return last;
}

/** Przycisk zapisu - etykieta jest KLUCZEM (stub i18n echuje klucz). */
const saveButton = () => screen.getByRole("button", { name: "common.save" });

/**
 * Kafel presetu po jego polskiej etykiecie (etykiety presetów są w kodzie,
 * nie w słowniku - to dane wariantu layoutu).
 *
 * Etykieta AKTYWNEGO presetu występuje na ekranie DWA razy: raz w kaflu, raz
 * w podpisie „wybrany: ...". Szukamy więc wystąpienia, które siedzi w kaflu
 * (`aria-pressed`) - wybór po pierwszym trafieniu tekstu dawałby test, który
 * przechodzi albo nie w zależności od tego, który preset jest zapisany.
 */
function presetTile(labelPl: string): HTMLElement {
  for (const node of screen.getAllByText(labelPl)) {
    const tile = node.closest("button[aria-pressed]");
    if (tile instanceof HTMLElement) return tile;
  }
  throw new Error(`test: brak kafla presetu "${labelPl}"`);
}

/** Wiersz sekcji o danym kluczu - z twardym błędem zamiast cichego `null`. */
function sectionRow(key: string): HTMLElement {
  const label = screen.getByText(`adminLayouts.expertLayouts.sections.${key}`);
  const row = label.closest("li");
  if (!(row instanceof HTMLElement)) throw new Error(`test: brak wiersza sekcji "${key}"`);
  return row;
}

/** Element wewnątrz wiersza po selektorze - twardy błąd zamiast `null`. */
function within(row: HTMLElement, selector: string): HTMLElement {
  const found = row.querySelector(selector);
  if (!(found instanceof HTMLElement)) {
    throw new Error(`test: w wierszu nie ma elementu "${selector}"`);
  }
  return found;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.settings = settings();
  h.savePayloads = [];
  h.saveError = null;
  h.savePending = false;
  h.previewProps = [];
  h.ensureI18nCalls = 0;
  h.shellRenders = 0;
});

afterEach(() => cleanup());

describe("admin.expert-layouts - sklejenie trasy i stan pusty", () => {
  it("dopóki odczyt nie wrócił, panel pokazuje wczytywanie i NIE formularz", async () => {
    // Formularz zbudowany wokół `null` renderowałby pola z `undefined`
    // i pierwszy zapis wysłałby do bazy wiersz bez połowy kolumn - a ta
    // tabela ma JEDEN wiersz na obszar roboczy, więc byłby to zapis
    // nadpisujący ustawienia stron wszystkich ekspertów pustkami.
    h.settings = null;
    await mount();

    expect(screen.getByText("adminLayouts.expertLayouts.loading")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "common.save" })).toBeNull();
    // Stan pusty nie może „awaryjnie" pokazać podglądu bez ustawień.
    expect(h.previewProps).toEqual([]);
  });

  it("po odczycie panel pokazuje nagłówek, WSZYSTKIE presety i WSZYSTKIE sekcje", async () => {
    await mount();

    expect(screen.getByText("adminLayouts.expertLayouts.pageTitle")).toBeInTheDocument();
    // Preset niewidoczny w panelu jest presetem, którego nikt nie ustawi -
    // a mimo to zostaje w typie i w rendererze publicznym.
    for (const preset of EXPERT_LAYOUT_PRESETS) {
      expect(
        presetTile(preset.label_pl),
        `preset ${preset.id} zniknął z panelu - nie da się go już wybrać`,
      ).toBeInTheDocument();
    }
    for (const key of EXPERT_SECTIONS) {
      expect(
        screen.getByText(`adminLayouts.expertLayouts.sections.${key}`),
        `sekcja ${key} zniknęła z panelu - nie da się jej ukryć ani przestawić`,
      ).toBeInTheDocument();
    }
  });

  it("wybrany preset jest zaznaczony `aria-pressed`, a pozostałe nie", async () => {
    // Bez tego atrybutu panel nie mówi czytnikowi ekranu, który z ośmiu
    // kafli jest aktywny - a wszystkie osiem wygląda tak samo w drzewie
    // dostępności.
    h.settings = settings({ default_preset: "centered" });
    await mount();

    expect(presetTile("Wycentrowany")).toHaveAttribute("aria-pressed", "true");
    expect(presetTile("Klasyczny")).toHaveAttribute("aria-pressed", "false");
  });

  it("rejestruje własny słownik w chunku trasy, a nie w wejściowym", async () => {
    // `ensureI18n()` wołane w KOMPONENCIE (nie side-effectowym importem) jest
    // powodem, dla którego słownik layoutów nie jedzie w chunku każdej strony
    // publicznej. Zniknięcie wywołania to regresja rozmiaru wejścia, której
    // nie widać w żadnym widoku.
    await mount();

    expect(h.ensureI18nCalls).toBeGreaterThan(0);
  });

  it("NIE montuje własnej powłoki panelu - ani we wczytywaniu, ani w widoku głównym", async () => {
    // REGUŁA 5 (regresja). Przed naprawą oba stany owijały się
    // w `<AdminShell hideSidebar>` WEWNĄTRZ powłoki layoutu `/admin`.
    h.settings = null;
    const loading = await mount();
    expect(screen.getByText("adminLayouts.expertLayouts.loading")).toBeInTheDocument();
    expect(h.shellRenders).toBe(0);
    loading.unmount();

    h.settings = settings();
    await mount();
    expect(saveButton()).toBeInTheDocument();
    expect(h.shellRenders).toBe(0);
    expect(screen.queryByTestId("admin-shell")).toBeNull();
  });

  it("panel nie zostawia w nagłówku pustego tytułu", async () => {
    // Panel jest `noindex` z definicji (layout `/admin`), więc sprawdzamy
    // tylko kontrakt: albo nagłówek niesie tytuł, albo go nie ma - nigdy
    // pusty wpis udający tytuł.
    const meta = await routeMeta(ExpertLayoutsRoute);
    for (const entry of meta) {
      if ("title" in entry) expect(entry.title).not.toBe("");
    }
  });
});

describe("admin.expert-layouts - wersja robocza kontra odczyt z bazy", () => {
  it("odświeżenie odczytu NIE nadpisuje niezapisanych zmian", async () => {
    // To jest treść warunku `if (data && !local)`. Bez niego invalidacja
    // po zapisie (albo powrót okna z tła) wrzuciłaby do formularza wiersz
    // z bazy i cicho skasowała pracę administratora - w środku edycji,
    // bez żadnego komunikatu.
    await mount();
    fireEvent.click(presetTile("Wycentrowany"));
    expect(lastPreview().settings.default_preset).toBe("centered");

    // Odczyt wraca z bazy z INNĄ wartością - tak wygląda odświeżenie w tle.
    h.settings = settings({ default_preset: "magazine" });
    // Dowolna zmiana stanu przerenderowuje trasę, więc efekt zasiewu biegnie
    // ponownie z nowym `data`.
    fireEvent.click(within(sectionRow("cv"), 'button[aria-pressed="true"]'));

    await waitFor(() => expect(lastPreview().settings.show_cv).toBe(false));
    expect(lastPreview().settings.default_preset).toBe("centered");
  });

  it("podgląd dostaje WERSJĘ ROBOCZĄ, nie zapisany wiersz", async () => {
    // Podgląd karmiony danymi z bazy pokazywałby stan sprzed zmiany przy
    // każdym kliknięciu - czyli byłby podglądem czegoś innego niż to, co
    // administrator właśnie ustawia.
    await mount();
    fireEvent.change(screen.getByLabelText("adminLayouts.expertLayouts.maxWidth"), {
      target: { value: "1400" },
    });

    expect(lastPreview().settings.max_width).toBe(1400);
    expect(h.savePayloads).toEqual([]);
  });

  it("szerokość spoza zakresu jest PRZYCINANA, a nie zapisywana", async () => {
    // Kolumna szerokości jedzie prosto do `max-width` strony eksperta.
    // Wartość 40 px (albo 40 000) daje stronę nieczytelną dla wszystkich
    // ekspertów naraz, a `<input type=number>` da się ustawić na dowolną
    // liczbę (rozszerzenie przeglądarki, autofill, wklejenie).
    await mount();
    const input = screen.getByLabelText("adminLayouts.expertLayouts.maxWidth");
    fireEvent.change(input, { target: { value: "40" } });
    expect(lastPreview().settings.max_width).toBe(880);

    fireEvent.change(input, { target: { value: "40000" } });
    expect(lastPreview().settings.max_width).toBe(1600);
  });
});

describe("admin.expert-layouts - zapis: ładunek, nie DOM", () => {
  it("zmiana presetu trafia do ŁADUNKU zapisu", async () => {
    await mount();
    fireEvent.click(presetTile("Wycentrowany"));
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.savePayloads).toHaveLength(1));
    expect(lastPayload()?.default_preset).toBe("centered");
  });

  it("ładunek zapisu NIE niesie `tenant_id` z klienta", async () => {
    // Tenanta rozstrzyga baza (`current_tenant_id()` w hooku zapisu).
    // `tenant_id` podany z klienta byłby polem, którym da się celować w cudzy
    // obszar roboczy - a `upsert` idzie po `onConflict: "tenant_id"`, więc
    // trafienie byłoby nadpisaniem CAŁEGO wiersza ustawień innego tenanta.
    await mount();
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.savePayloads).toHaveLength(1));
    expect(Object.keys(lastPayload() ?? {})).not.toContain("tenant_id");
  });

  it("ukrycie sekcji jedzie do ładunku jako pole `show_*` TEJ sekcji", async () => {
    // Mapa `ExpertSectionKey -> keyof ExpertLayoutSettings` jest jedynym
    // miejscem, które wiąże przełącznik w panelu z kolumną w bazie. Pomyłka
    // w niej ukrywa INNĄ sekcję niż wskazana - i to na stronach wszystkich
    // ekspertów naraz.
    await mount();
    fireEvent.click(within(sectionRow("cv"), 'button[aria-pressed="true"]'));
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.savePayloads).toHaveLength(1));
    expect(lastPayload()?.show_cv).toBe(false);
    // Sąsiednie sekcje nie mogły się przy tym przestawić.
    expect(lastPayload()?.show_materials).toBe(true);
    expect(lastPayload()?.show_programs).toBe(true);
  });

  it("przestawienie sekcji w górę zamienia DOKŁADNIE dwa miejsca kolejności", async () => {
    // Kolejność sekcji jest tablicą w jednej kolumnie jsonb. Zamiana, która
    // gubi element albo duplikuje go, daje stronę eksperta z sekcją
    // wyrenderowaną dwa razy lub bez sekcji wcale.
    await mount();
    fireEvent.click(
      within(
        sectionRow(DEFAULT_EXPERT_SECTION_ORDER[1]),
        '[aria-label="adminLayouts.expertLayouts.moveUp"]',
      ),
    );
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.savePayloads).toHaveLength(1));
    const order = lastPayload()?.section_order ?? [];
    expect(order[0]).toBe(DEFAULT_EXPERT_SECTION_ORDER[1]);
    expect(order[1]).toBe(DEFAULT_EXPERT_SECTION_ORDER[0]);
    expect(order).toHaveLength(DEFAULT_EXPERT_SECTION_ORDER.length);
    expect(new Set(order).size).toBe(DEFAULT_EXPERT_SECTION_ORDER.length);
  });

  it("pierwsza sekcja nie ma jak pojechać w górę, a ostatnia w dół", async () => {
    // Brak blokady na krańcach dałby `undefined` w tablicy kolejności -
    // czyli wiersz jsonb, którego renderer publiczny nie umie przeczytać.
    await mount();
    const lastKey = DEFAULT_EXPERT_SECTION_ORDER[DEFAULT_EXPERT_SECTION_ORDER.length - 1];

    expect(
      within(
        sectionRow(DEFAULT_EXPERT_SECTION_ORDER[0]),
        '[aria-label="adminLayouts.expertLayouts.moveUp"]',
      ),
    ).toBeDisabled();
    expect(
      within(sectionRow(lastKey), '[aria-label="adminLayouts.expertLayouts.moveDown"]'),
    ).toBeDisabled();
  });

  it("przestawienie sekcji w dół zamienia ją z NASTĘPNĄ, a nie z poprzednią", async () => {
    // Strzałka w dół z kierunkiem pomylonym na `-1` robiłaby to samo co
    // strzałka w górę - na pierwszej sekcji byłaby zablokowana, a na
    // pozostałych przesuwała sekcję w przeciwną stronę niż obiecuje ikona.
    await mount();
    fireEvent.click(
      within(
        sectionRow(DEFAULT_EXPERT_SECTION_ORDER[0]),
        '[aria-label="adminLayouts.expertLayouts.moveDown"]',
      ),
    );
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.savePayloads).toHaveLength(1));
    const order = lastPayload()?.section_order ?? [];
    expect(order.slice(0, 2)).toEqual([
      DEFAULT_EXPERT_SECTION_ORDER[1],
      DEFAULT_EXPERT_SECTION_ORDER[0],
    ]);
    expect(order.slice(2)).toEqual(DEFAULT_EXPERT_SECTION_ORDER.slice(2));
  });

  it("niepełna zapisana kolejność daje „przywróć” i przywraca PEŁNĄ kolejność domyślną", async () => {
    // Wiersz zapisany przed dodaniem nowej sekcji niesie krótszą tablicę -
    // brakujących sekcji nie ma w panelu, więc nie da się ich ani ukryć, ani
    // przestawić. Jedyną drogą powrotu jest przycisk przywrócenia.
    h.settings = settings({ section_order: DEFAULT_EXPERT_SECTION_ORDER.slice(0, 3) });
    await mount();
    expect(screen.queryByText("adminLayouts.expertLayouts.sections.cv")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "adminLayouts.expertLayouts.restoreOrder" }),
    );
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.savePayloads).toHaveLength(1));
    expect(lastPayload()?.section_order).toEqual(DEFAULT_EXPERT_SECTION_ORDER);
    expect(screen.getByText("adminLayouts.expertLayouts.sections.cv")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "adminLayouts.expertLayouts.restoreOrder" }),
    ).toBeNull();
  });

  it("pełna kolejność NIE pokazuje przycisku przywrócenia", async () => {
    // Przycisk przy pełnej kolejności kasowałby jednym kliknięciem ręczne
    // ustawienie administratora - bez żadnej korzyści.
    await mount();

    expect(
      screen.queryByRole("button", { name: "adminLayouts.expertLayouts.restoreOrder" }),
    ).toBeNull();
  });

  it("udany zapis pokazuje toast i STEMPLUJE podgląd nowym czasem", async () => {
    // `savedAt` jest sygnałem dla podglądu, że dane w bazie się zmieniły
    // (przeładowuje eksperta). Brak stempla to podgląd, który po zapisie
    // pokazuje stan sprzed zapisu.
    await mount();
    const before = lastPreview().savedAt;
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("adminToasts.layoutSaved"));
    await waitFor(() => expect(lastPreview().savedAt).toBeGreaterThan(before));
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("nieudany zapis NIE pokazuje sukcesu i nie stempluje podglądu", async () => {
    // Panel mówiący „zapisano" po odmowie RLS zostawia administratora
    // w przekonaniu, że globalne ustawienia stron ekspertów są zmienione.
    h.saveError = new Error("test: brak uprawnień do expert_layout_settings");
    await mount();
    const before = lastPreview().savedAt;
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(lastPreview().savedAt).toBe(before);
  });

  it("komunikat błędu zapisu jedzie KLUCZEM i18n, nie samym surowcem z bazy", async () => {
    // Klucz `saveErrorToast` z wstawką `{{msg}}` jest tym, co widzi
    // administrator. Utrata klucza zamieniłaby toast w goły komunikat
    // Postgresa - z nazwami tabel i polityk w środku.
    h.saveError = new Error("row-level security policy");
    await mount();
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    const shown = h.toastError.mock.calls.flat().join(" ");
    expect(shown).toContain("adminLayouts.expertLayouts.saveErrorToast");
  });

  it("błąd bez komunikatu dostaje zapasowy tekst z KLUCZA, a nie `undefined`", async () => {
    // Odrzucenie wartością spoza `Error` (np. obiekt z sieci) nie ma
    // `message` - wstawka `{{msg}}` bez zapasu dawałaby „undefined" w toaście.
    h.saveError = { code: "PGRST000" };
    await mount();
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.toastError).toHaveBeenCalledWith(
      "adminLayouts.expertLayouts.saveErrorToast(msg=adminLayouts.expertLayouts.saveFailed)",
    );
  });

  it("w trakcie zapisu przycisk jest zablokowany i mówi o zapisywaniu", async () => {
    // Drugi klik w trwający zapis to drugi `upsert` na tym samym wierszu -
    // wyścig o wiersz, który ma jedną wersję na obszar roboczy.
    h.savePending = true;
    await mount();

    expect(
      screen.getByRole("button", { name: "adminLayouts.expertLayouts.saving" }),
    ).toBeDisabled();
  });
});

describe("admin.expert-layouts - wycentrowanie i typografia", () => {
  /** Przełącznik z etykietą - przycisk `aria-pressed` w `<label>` z tym tekstem. */
  function labelledToggle(labelKey: string): HTMLElement {
    const label = screen.getByText(labelKey).closest("label");
    if (!(label instanceof HTMLElement)) throw new Error(`test: brak przełącznika "${labelKey}"`);
    return within(label, "button[aria-pressed]");
  }

  it("każdy przełącznik wycentrowania pisze do SWOJEJ kolumny", async () => {
    // Dwa przełączniki obok siebie z zamienionymi polami wycentrowałyby
    // szczegóły zamiast hero - na stronach wszystkich ekspertów naraz.
    await mount();
    fireEvent.click(labelledToggle("adminLayouts.expertLayouts.centerHero"));
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.savePayloads).toHaveLength(1));
    expect(lastPayload()).toMatchObject({ center_hero: true, center_details: false });

    fireEvent.click(labelledToggle("adminLayouts.expertLayouts.centerDetails"));
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.savePayloads).toHaveLength(2));
    expect(lastPayload()).toMatchObject({ center_hero: true, center_details: true });
  });

  it("wyczyszczone pole rozmiaru nazwy spada na domyślne 36/48 px, nie na 0", async () => {
    // `Number("")` to 0, a nazwa eksperta z `font-size: 0` znika z hero.
    h.settings = settings({ name_size_base: 40, name_size_lg: 56 });
    await mount();
    fireEvent.change(screen.getByLabelText("adminLayouts.expertLayouts.nameMobile"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("adminLayouts.expertLayouts.nameDesktop"), {
      target: { value: "" },
    });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.savePayloads).toHaveLength(1));
    expect(lastPayload()).toMatchObject({ name_size_base: 36, name_size_lg: 48 });
  });

  it("rozmiar nazwy wpisany przez administratora jedzie do ładunku jako liczba", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText("adminLayouts.expertLayouts.nameMobile"), {
      target: { value: "30" },
    });
    fireEvent.change(screen.getByLabelText("adminLayouts.expertLayouts.nameDesktop"), {
      target: { value: "64" },
    });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.savePayloads).toHaveLength(1));
    expect(lastPayload()).toMatchObject({ name_size_base: 30, name_size_lg: 64 });
  });
});

describe("admin.expert-layouts - kolory hero", () => {
  /** Próbnik koloru (`type=color`) po etykiecie pola - etykieta jest KLUCZEM. */
  function colorPicker(labelKey: string): HTMLElement {
    const picker = document.querySelector(`input[type="color"][aria-label="${labelKey}"]`);
    if (!(picker instanceof HTMLElement)) throw new Error(`test: brak próbnika "${labelKey}"`);
    return picker;
  }

  // Osiem pól koloru to osiem domknięć `onChange` przepisanych ręcznie -
  // pomyłka w jednym zapisuje kolor tła w kolumnie tekstu (biały tekst na
  // białym tle) albo kolor trybu jasnego w kolumnie ciemnego.
  it.each([
    ["heroBgLight", "hero_bg_color"],
    ["heroBgDark", "hero_bg_color_dark"],
    ["heroTextLight", "hero_text_color"],
    ["heroTextDark", "hero_text_color_dark"],
    ["accentLight", "accent_color"],
    ["accentDark", "accent_color_dark"],
    ["bioBulletLight", "bio_bullet_color"],
    ["bioBulletDark", "bio_bullet_color_dark"],
  ] as const)("pole %s pisze do kolumny %s i do żadnej innej", async (labelKey, column) => {
    await mount();
    fireEvent.change(colorPicker(`adminLayouts.expertLayouts.${labelKey}`), {
      target: { value: "#abcdef" },
    });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.savePayloads).toHaveLength(1));
    const payload = lastPayload() ?? {};
    expect(payload[column]).toBe("#abcdef");
    const others = Object.entries(payload).filter(
      ([key, value]) => key !== column && value === "#abcdef",
    );
    expect(others).toEqual([]);
  });

  it("przycisk „✕” zeruje kolor do `null` (powrót do koloru z motywu)", async () => {
    h.settings = settings({ accent_color: "#123456" });
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "adminLayouts.expertLayouts.clear" }));
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.savePayloads).toHaveLength(1));
    expect(lastPayload()?.accent_color).toBeNull();
    expect(screen.queryByRole("button", { name: "adminLayouts.expertLayouts.clear" })).toBeNull();
  });

  it("wyczyszczenie pola koloru daje `null`, a nie pusty ciąg", async () => {
    // Pusty ciąg w kolumnie koloru trafia do zmiennej CSS jako `""`,
    // a przeglądarka bierze wtedy kolor odziedziczony - czyli inny niż
    // domyślny motywu. `null` znaczy „licz z motywu" i tylko to jest
    // poprawnym wyjściem po wyczyszczeniu pola.
    h.settings = settings({ hero_bg_color: "#123456" });
    await mount();

    const colorTextFields = screen
      .getAllByRole("textbox")
      .filter((el) =>
        (el.getAttribute("placeholder") ?? "").includes(
          "adminLayouts.expertLayouts.colorAutoPlaceholder",
        ),
      );
    expect(colorTextFields.length).toBe(8);
    fireEvent.change(colorTextFields[0], { target: { value: "   " } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.savePayloads).toHaveLength(1));
    expect(lastPayload()?.hero_bg_color).toBeNull();
  });

  it("kolor ustawiony wcześniej daje przycisk wyczyszczenia, a pusty - nie", async () => {
    // Przycisk „✕" jest jedyną drogą powrotu do koloru z motywu. Gdyby
    // pojawiał się też przy pustym polu, kliknięcie nic by nie robiło -
    // a to jedyna kontrolka, po której poznać, że kolor jest nadpisany.
    h.settings = settings({ hero_bg_color: "#123456", hero_bg_color_dark: null });
    await mount();

    const clearButtons = screen.getAllByRole("button", {
      name: "adminLayouts.expertLayouts.clear",
    });
    expect(clearButtons).toHaveLength(1);
  });
});
