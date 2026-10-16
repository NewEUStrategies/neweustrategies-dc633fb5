// TRASA DEFINICJI „CUSTOM META” (/admin/custom-meta). Do 16.10.2026 na zerze.
//
// Ekran trzyma globalne definicje pól własnych wpisu (klucz + etykiety PL/EN
// + ikona + pozycja). Każda definicja staje się polem w edytorze KAŻDEGO wpisu,
// a wartości lądują w `posts.custom_meta` pod KLUCZEM definicji. Reguły:
//
//   1. KLUCZ JEST TOŻSAMOŚCIĄ. „Dodaj” z kluczem, który już istnieje, NIE
//      MOŻE nadpisać istniejącej definicji - zmieniłby jej etykiety, ikonę
//      i pozycję (a jej wartości we wszystkich wpisach zmieniłyby znaczenie).
//      Lista na ekranie daje natychmiastową podpowiedź, ale rozstrzyga baza:
//      dodanie to INSERT (zajęty klucz = 23505 = ten sam komunikat), nie upsert
//      po (tenant_id, key) - inaczej klucz dodany w innej karcie po wczytaniu
//      listy (cache żyje 5 minut) zostałby po cichu nadpisany.
//   2. NOWY KLUCZ WALIDUJEMY PO NORMALIZACJI (trim, małe litery,
//      [^a-z0-9_] -> „_”). „ąę” albo „!!!” normalizują się do „_” - to nie
//      jest klucz. Klucz dłuższy niż 64 znaki to pole, którego wartości serwer
//      zapisu wpisu (`custom_meta: z.record(z.string().max(64), ...)`) nigdy
//      nie przyjmie. Pusty klucz to „Klucz jest wymagany”, a niepusty, ale
//      nieużywalny - osobny komunikat o formacie i limicie.
//   2a. KLUCZ ISTNIEJĄCEJ DEFINICJI JEST NIEZMIENNY. „Zapisz zmiany” go nie
//      wysyła (UPDATE po `id` zmienia tylko etykiety, ikonę i pozycję) i nie
//      waliduje formatu - starsza definicja z kluczem „_”
//      albo dłuższym niż 64 znaki musi dać się edytować (etykiety, ikona,
//      pozycja); jedynym wyjściem byłoby usunięcie, które osieroca wartości
//      we wpisach.
//   3. DOMYŚLNA POZYCJA = KONIEC LISTY (max + 10), liczony z AKTUALNEJ listy,
//      a nie zamrożony w chwili pierwszego renderu (lista jeszcze się ładuje)
//      ani z długości listy sprzed odświeżenia.
//   4. NIEUDANY ODCZYT LISTY TO NIE „Brak definicji.” - pusty stan zachęcał do
//      dodania klucza, który już istnieje; bez listy „Dodaj” jest wyłączone.
//   5. USUNIĘCIE DEFINICJI W EDYCJI ZAMYKA EDYCJĘ - także gdy „Edytuj”
//      kliknięto w trakcie usuwania. Edycja definicji usuniętej w INNEJ karcie
//      to UPDATE po `id` bez wierszy: komunikat „usunięta w międzyczasie”, a nie
//      wskrzeszenie (upsert z `id` usuniętego wiersza robił INSERT).
//   6. `head()` daje tytuł SEKCJI ze wspólnego `adminPageHead` (AGENTS.md)
//      i `noindex`.
//   7. JEDEN ZAPIS NA RAZ, A ZAPIS NIE KASUJE NOWEJ PRACY. Podwójne kliknięcie
//      dawało dwa zapisy i dwa toasty. Pola i „Edytuj” zostają czynne w trakcie
//      zapisu, więc po nim formularz wraca do „nowej definicji” tylko, jeśli
//      redaktor nie zaczął w nim czegoś innego. Wyjątek: „Edytuj” wiersza,
//      który właśnie się zapisuje, jest wyłączone - formularz z listy sprzed
//      zapisu przetrwałby go, a kolejne „Zapisz zmiany” cofało zapisaną zmianę.
//   8. LISTA IKON MA NAZWĘ z etykiety „Ikona” - bez `htmlFor` kombobox był dla
//      czytnika ekranu bezimienny.
//   9. ODMOWA RLS TO NIE „USUNIĘTA”. Autor wchodzi do panelu (`isStaff`) i czyta
//      listę publicznego tenanta, ale zapis to polityka admina/redaktora -
//      UPDATE po cichu nie zmienia wiersza. Ekran mówi o braku uprawnień
//      i zostawia formularz, zamiast meldować usunięcie i go czyścić.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { AnyRoute } from "@tanstack/react-router";
import type { CustomMetaDef } from "@/lib/customMeta";

const h = vi.hoisted(() => ({
  /** Stan „bazy” - lista zwracana przez `listCustomMetaDefs`. */
  defs: [] as CustomMetaDef[],
  listCalls: [] as unknown[],
  listError: null as Error | null,
  /** Gdy ustawione, odczyt listy czeka na zwolnienie bramki. */
  listGate: null as Promise<void> | null,
  inserts: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
  writeError: null as unknown,
  /** Konto bez prawa zapisu (autor): wiersze widać, ale RLS nie pozwala ich zmienić. */
  rlsReadOnly: false,
  /** Gdy ustawione, zapis (dodanie/edycja) czeka na zwolnienie bramki. */
  writeGate: null as Promise<void> | null,
  deletes: [] as string[],
  deleteError: null as unknown,
  /** Gdy ustawione, usuwanie czeka na zwolnienie bramki. */
  deleteGate: null as Promise<void> | null,
  confirmAnswer: true,
  confirmCalls: [] as Record<string, unknown>[],
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/hooks/useAuth", () => ({ useRequiredTenant: () => "tenant-1" }));
vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("@/lib/appDialogs", () => ({
  confirmDialog: async (opts: Record<string, unknown>) => {
    h.confirmCalls.push(opts);
    return h.confirmAnswer;
  },
}));
// Trasa nie dotyka klienta bazy bezpośrednio - wszystko idzie przez
// `@/lib/customMeta`. Pusty klient wywróci test, gdyby to się zmieniło.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/customMeta", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/customMeta")>()),
  listCustomMetaDefs: async (tenantId: unknown) => {
    h.listCalls.push(tenantId);
    if (h.listGate) await h.listGate;
    if (h.listError) throw h.listError;
    return h.defs.map((d) => ({ ...d }));
  },
  // Symulacja bazy - kolejny odczyt listy widzi zapis. Semantyka jak zapytania
  // warstwy danych (przypina je `customMeta.test.ts`): INSERT na
  // `UNIQUE (tenant_id, key)` odrzuca zajęty klucz, UPDATE po `id` bez wiersza
  // niczego nie wstawia, a wiersz widoczny, lecz zablokowany przez RLS, to
  // `forbidden`.
  addCustomMetaDef: async (payload: Omit<CustomMetaDef, "id">) => {
    h.inserts.push({ ...payload });
    if (h.writeGate) await h.writeGate;
    if (h.writeError) throw h.writeError;
    if (h.defs.some((d) => d.tenant_id === payload.tenant_id && d.key === payload.key)) {
      return { ok: false, reason: "key_taken" };
    }
    h.defs = [...h.defs, { ...payload, id: `new-${h.inserts.length}` }];
    return { ok: true };
  },
  updateCustomMetaDef: async (id: string, patch: Record<string, unknown>) => {
    h.updates.push({ id, ...patch });
    if (h.writeGate) await h.writeGate;
    if (h.writeError) throw h.writeError;
    if (!h.defs.some((d) => d.id === id)) return { ok: false, reason: "deleted" };
    if (h.rlsReadOnly) return { ok: false, reason: "forbidden" };
    h.defs = h.defs.map((d) => (d.id === id ? { ...d, ...patch } : d));
    return { ok: true };
  },
  deleteCustomMetaDef: async (id: string) => {
    if (h.deleteGate) await h.deleteGate;
    if (h.deleteError) throw h.deleteError;
    h.deletes.push(id);
    h.defs = h.defs.filter((d) => d.id !== id);
  },
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

import "@/test/i18nReal";
import { routeHead } from "@/test/routeHarness";
import { Route } from "@/routes/admin.custom-meta";

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function def(overrides: Partial<CustomMetaDef> = {}): CustomMetaDef {
  return {
    id: "d1",
    tenant_id: "tenant-1",
    key: "prep_time",
    label_pl: "Czas przygotowania",
    label_en: "Prep time",
    icon: "Clock",
    position: 10,
    ...overrides,
  };
}

/** Montuje trasę i czeka, aż lista definicji się rozstrzygnie. */
async function setup(defs: CustomMetaDef[] = []) {
  h.defs = defs;
  const Component = (Route as AnyRoute).options.component as () => ReactNode;
  const view = render(<Component />, { wrapper });
  if (defs.length) {
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(defs.length));
  } else {
    await screen.findByText("Brak definicji.");
  }
  return view;
}

const KEY_INVALID = "Klucz musi zawierać literę a-z lub cyfrę i mieć najwyżej 64 znaki.";
const KEY_TAKEN = "Definicja o tym kluczu już istnieje - edytuj ją na liście.";
const DELETED_MEANWHILE =
  "Ta definicja została w międzyczasie usunięta - dodaj ją ponownie, jeśli jest potrzebna.";
const NO_PERMISSION =
  "Nie masz uprawnień do zmiany tej definicji - może to zrobić administrator lub redaktor.";

const keyInput = () =>
  screen.getByLabelText("Klucz (a-z, 0-9, _) - np. prep_time") as HTMLInputElement;
const labelPl = () => screen.getByLabelText("Etykieta PL") as HTMLInputElement;
const labelEn = () => screen.getByLabelText("Etykieta EN") as HTMLInputElement;
const positionInput = () => screen.getByLabelText("Pozycja (sort)") as HTMLInputElement;
const addButton = () => screen.getByRole("button", { name: "Dodaj" });
const saveChangesButton = () => screen.getByRole("button", { name: "Zapisz zmiany" });
const rowByLabel = (label: string) => screen.getByText(label).closest("li") as HTMLElement;

function type(input: HTMLInputElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

function fillNew(key: string, pl: string, en = "") {
  type(keyInput(), key);
  type(labelPl(), pl);
  if (en) type(labelEn(), en);
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  h.defs = [];
  h.listCalls.length = 0;
  h.listError = null;
  h.listGate = null;
  h.inserts.length = 0;
  h.updates.length = 0;
  h.writeError = null;
  h.rlsReadOnly = false;
  h.writeGate = null;
  h.deletes.length = 0;
  h.deleteError = null;
  h.deleteGate = null;
  h.confirmAnswer = true;
  h.confirmCalls.length = 0;
  h.toast.success.mockReset();
  h.toast.error.mockReset();
});

describe("custom meta - nagłówek strony", () => {
  it("head() daje tytuł sekcji ze wspólnego adminPageHead i trzyma ekran poza indeksem", () => {
    // Ogólnikowe „Custom meta - Admin” nie mówiło, która to karta panelu.
    expect(routeHead(Route as AnyRoute).meta).toEqual(
      expect.arrayContaining([
        { title: "Custom meta fields | New European Strategies" },
        { name: "robots", content: "noindex, nofollow" },
      ]),
    );
  });

  it("granica błędu trasy pokazuje komunikat jako alert, a nieznany adres - 404", () => {
    // Np. brak tenanta: `useRequiredTenant()` rzuca, a ekran ma powiedzieć
    // dlaczego, zamiast zostawić pustą kartę.
    const options = (Route as AnyRoute).options;
    const ErrorView = options.errorComponent as (p: { error: Error }) => ReactNode;
    const NotFound = options.notFoundComponent as () => ReactNode;

    render(<ErrorView error={new Error("Brak kontekstu tenanta")} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Brak kontekstu tenanta");

    render(<NotFound />);
    expect(screen.getByText("404")).toBeInTheDocument();
  });
});

describe("custom meta - lista definicji", () => {
  it("czyta definicje WYŁĄCZNIE bieżącego tenanta", async () => {
    await setup();
    expect(h.listCalls).toEqual(["tenant-1"]);
  });

  it("w trakcie ładowania pokazuje wskaźnik i blokuje „Dodaj”", async () => {
    // Bez listy nie da się sprawdzić zajętości klucza ani końca listy.
    let release!: () => void;
    h.listGate = new Promise<void>((r) => (release = r));
    h.defs = [def()];
    const Component = (Route as AnyRoute).options.component as () => ReactNode;
    render(<Component />, { wrapper });

    expect(screen.getByText("...")).toBeInTheDocument();
    expect(addButton()).toBeDisabled();

    release();
    await screen.findByText("Czas przygotowania");
    expect(addButton()).toBeEnabled();
  });

  it("pusta lista mówi wprost, że definicji nie ma", async () => {
    await setup();
    expect(screen.getByText("Brak definicji.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("wiersz pokazuje pozycję, etykietę PL, klucz i ikonę", async () => {
    await setup([def()]);
    const row = rowByLabel("Czas przygotowania");

    expect(row.textContent).toContain("10");
    expect(within(row).getByText("prep_time · ikona: Clock")).toBeInTheDocument();
  });

  it("etykieta w wierszu spada PL -> EN -> klucz", async () => {
    await setup([
      def({ id: "a", key: "only_en", label_pl: "", label_en: "English only", position: 10 }),
      def({ id: "b", key: "bare_key", label_pl: "", label_en: "", position: 20 }),
    ]);

    expect(screen.getByText("English only")).toBeInTheDocument();
    expect(screen.getByText("bare_key")).toBeInTheDocument();
  });

  it("nieudany odczyt pokazuje błąd zamiast „Brak definicji.” i blokuje „Dodaj”", async () => {
    // Pusty stan przy awarii odczytu zachęcał do dodania klucza, który już
    // istnieje.
    h.listError = new Error("permission denied for table post_custom_meta_defs");
    const Component = (Route as AnyRoute).options.component as () => ReactNode;
    render(<Component />, { wrapper });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "permission denied for table post_custom_meta_defs",
    );
    expect(screen.queryByText("Brak definicji.")).toBeNull();
    expect(addButton()).toBeDisabled();
  });

  it("błąd odczytu bez treści pokazuje ogólny komunikat, a nie pusty alert", async () => {
    h.listError = new Error("");
    const Component = (Route as AnyRoute).options.component as () => ReactNode;
    render(<Component />, { wrapper });

    expect(await screen.findByRole("alert")).toHaveTextContent("Błąd");
  });
});

describe("custom meta - dodawanie definicji", () => {
  it("zapisuje znormalizowany klucz, etykiety, ikonę i pozycję dla bieżącego tenanta", async () => {
    await setup();
    fillNew("  Czas Przygotowania ", "Czas przygotowania", "Prep time");
    fireEvent.click(addButton());

    await waitFor(() => expect(h.inserts).toHaveLength(1));
    expect(h.inserts[0]).toEqual({
      key: "czas_przygotowania",
      label_pl: "Czas przygotowania",
      label_en: "Prep time",
      icon: "Clock",
      position: 10,
      tenant_id: "tenant-1",
    });
    expect(h.toast.success).toHaveBeenCalledWith("Zapisano");
  });

  it("po zapisie czyści formularz i odświeża listę", async () => {
    await setup();
    fillNew("difficulty", "Trudność");
    fireEvent.click(addButton());

    expect(await screen.findByText("Trudność")).toBeInTheDocument();
    expect(h.listCalls).toHaveLength(2);
    expect(keyInput().value).toBe("");
    expect(labelPl().value).toBe("");
    expect(screen.getByRole("combobox")).toHaveTextContent("Clock");
  });

  it("domyślna pozycja to koniec WCZYTANEJ listy, a nie 10 z pierwszego renderu", async () => {
    // Inicjalizator `useState` liczył pozycję, gdy lista jeszcze się ładowała
    // (defs = []), więc pierwsze nowe pole zawsze dostawało 10.
    await setup([
      def({ id: "a", key: "a", label_pl: "A", position: 10 }),
      def({ id: "b", key: "b", label_pl: "B", position: 20 }),
      def({ id: "c", key: "c", label_pl: "C", position: 30 }),
    ]);

    expect(positionInput().value).toBe("40");
    fillNew("d", "D");
    fireEvent.click(addButton());
    await waitFor(() => expect(h.inserts).toHaveLength(1));
    expect(h.inserts[0].position).toBe(40);
  });

  it("po zapisie kolejna domyślna pozycja nie powtarza właśnie zapisanej", async () => {
    // Reset po zapisie brał długość listy SPRZED odświeżenia: po dodaniu
    // czwartego pola (40) formularz znów proponował 40.
    await setup([
      def({ id: "a", key: "a", label_pl: "A", position: 10 }),
      def({ id: "b", key: "b", label_pl: "B", position: 20 }),
      def({ id: "c", key: "c", label_pl: "C", position: 30 }),
    ]);
    fillNew("d", "D");
    fireEvent.click(addButton());

    await screen.findByText("D");
    await waitFor(() => expect(positionInput().value).toBe("50"));
  });

  it("domyślna pozycja liczy się od największej pozycji, nie od liczby pól", async () => {
    // Po usunięciu środkowego pola (10, 30) `(length + 1) * 10` dawało 30 -
    // pozycję istniejącego pola.
    await setup([
      def({ id: "a", key: "a", label_pl: "A", position: 10 }),
      def({ id: "c", key: "c", label_pl: "C", position: 30 }),
    ]);

    expect(positionInput().value).toBe("40");
  });

  it("ręcznie wpisana pozycja wygrywa z domyślną, a wyczyszczona daje 0", async () => {
    await setup([def()]);
    fillNew("x", "X");
    type(positionInput(), "5");
    expect(positionInput().value).toBe("5");
    type(positionInput(), "");
    expect(positionInput().value).toBe("0");
    type(positionInput(), "15");
    fireEvent.click(addButton());

    await waitFor(() => expect(h.inserts).toHaveLength(1));
    expect(h.inserts[0].position).toBe(15);
  });

  it("wybrana ikona trafia do zapisu", async () => {
    await setup();
    fillNew("rating", "Ocena");
    const select = screen.getByRole("combobox");
    fireEvent.keyDown(select, { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "Star" }));
    expect(select).toHaveTextContent("Star");
    fireEvent.click(addButton());

    await waitFor(() => expect(h.inserts).toHaveLength(1));
    expect(h.inserts[0].icon).toBe("Star");
  });

  it("lista ikon ma dostępną nazwę z etykiety „Ikona”", async () => {
    // Etykieta bez `htmlFor` zostawiała kombobox bez nazwy dla czytnika ekranu.
    await setup();
    expect(screen.getByRole("combobox", { name: "Ikona" })).toHaveTextContent("Clock");
  });

  it("pusty klucz blokuje zapis z komunikatem", async () => {
    await setup();
    fillNew("   ", "Etykieta");
    fireEvent.click(addButton());

    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("Klucz jest wymagany"));
    expect(h.inserts).toHaveLength(0);
  });

  it.each([["ąę"], ["!!!"], ["___"]])(
    "klucz %j, który normalizuje się do samych podkreśleń, NIE jest kluczem",
    async (raw) => {
      // Stary warunek sprawdzał niepustość PRZED normalizacją - „ąę” dawało
      // klucz „_”, a dwa różne polskie klucze zderzały się na tym samym „_”.
      await setup();
      fillNew(raw, "Etykieta");
      fireEvent.click(addButton());

      await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith(KEY_INVALID));
      expect(h.toast.error).not.toHaveBeenCalledWith("Klucz jest wymagany");
      expect(h.inserts).toHaveLength(0);
    },
  );

  it("klucz jest ograniczony do 64 znaków, których przyjmie zapis wpisu", async () => {
    // `posts.custom_meta` przyjmuje klucze do 64 znaków. Pole z dłuższym
    // kluczem pokazywałoby się w edytorze, ale zapis wpisu z jego wartością
    // zawsze by padał.
    await setup();
    expect(keyInput()).toHaveAttribute("maxLength", "64");

    // „İ” po `toLowerCase()` to DWA znaki („i” + kropka łącząca -> „i_”), więc
    // 40 znaków w polu daje 80-znakowy klucz - limit pola tego nie łapie.
    fillNew("İ".repeat(40), "Etykieta");
    fireEvent.click(addButton());

    // Klucz WPISANO - „Klucz jest wymagany” byłoby tu nieprawdą.
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith(KEY_INVALID));
    expect(h.toast.error).not.toHaveBeenCalledWith("Klucz jest wymagany");
    expect(h.inserts).toHaveLength(0);
  });

  it("bez etykiety PL ani EN zapis jest zablokowany", async () => {
    await setup();
    fillNew("prep_time", "   ");
    fireEvent.click(addButton());

    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("Podaj etykietę PL lub EN"));
    expect(h.inserts).toHaveLength(0);
  });

  it("sama etykieta EN wystarcza", async () => {
    await setup();
    type(keyInput(), "prep_time");
    type(labelEn(), "Prep time");
    fireEvent.click(addButton());

    await waitFor(() => expect(h.inserts).toHaveLength(1));
    expect(h.inserts[0]).toMatchObject({ key: "prep_time", label_pl: "", label_en: "Prep time" });
  });

  it("„Dodaj” z kluczem, który już istnieje, NIE nadpisuje istniejącej definicji", async () => {
    // Upsert po (tenant_id, key) zamieniał etykiety, ikonę i pozycję
    // istniejącego pola, a ekran meldował „Zapisano”.
    await setup([def()]);
    fillNew("Prep Time", "Coś innego");
    fireEvent.click(addButton());

    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith(KEY_TAKEN));
    expect(h.inserts).toHaveLength(0);
    expect(h.toast.success).not.toHaveBeenCalled();
    expect(keyInput().value).toBe("Prep Time");
  });

  it("błąd zapisu pokazuje komunikat serwera i zostawia formularz", async () => {
    h.writeError = new Error("new row violates row-level security policy");
    await setup();
    fillNew("prep_time", "Czas");
    fireEvent.click(addButton());

    await waitFor(() =>
      expect(h.toast.error).toHaveBeenCalledWith("new row violates row-level security policy"),
    );
    expect(h.toast.success).not.toHaveBeenCalled();
    expect(keyInput().value).toBe("prep_time");
    expect(h.listCalls).toHaveLength(1);
    // Blokada zapisu (reguła 7) schodzi także po porażce.
    expect(addButton()).toBeEnabled();
  });

  it("błąd zapisu bez obiektu Error daje ogólny komunikat zapisu", async () => {
    h.writeError = { code: "500" };
    await setup();
    fillNew("prep_time", "Czas");
    fireEvent.click(addButton());

    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("Błąd zapisu"));
  });
});

describe("custom meta - edycja definicji", () => {
  it("„Edytuj” wczytuje definicję do formularza i blokuje zmianę klucza", async () => {
    await setup([def({ icon: "Star", position: 70 })]);
    fireEvent.click(
      within(rowByLabel("Czas przygotowania")).getByRole("button", { name: "Edytuj" }),
    );

    expect(screen.getByRole("heading", { name: "Edytuj definicję" })).toBeInTheDocument();
    expect(keyInput().value).toBe("prep_time");
    expect(keyInput()).toBeDisabled();
    expect(labelPl().value).toBe("Czas przygotowania");
    expect(labelEn().value).toBe("Prep time");
    expect(positionInput().value).toBe("70");
    expect(screen.getByRole("combobox")).toHaveTextContent("Star");
  });

  it("„Zapisz zmiany” aktualizuje TĘ definicję po id - własny klucz nie jest „zajęty”", async () => {
    await setup([def({ position: 70 })]);
    fireEvent.click(screen.getByRole("button", { name: "Edytuj" }));
    type(labelEn(), "Preparation");
    fireEvent.click(saveChangesButton());

    await waitFor(() => expect(h.updates).toHaveLength(1));
    expect(h.updates[0]).toEqual({
      id: "d1",
      label_pl: "Czas przygotowania",
      label_en: "Preparation",
      icon: "Clock",
      position: 70,
    });
    expect(h.inserts).toHaveLength(0);
    expect(h.toast.error).not.toHaveBeenCalled();
    expect(await screen.findByRole("heading", { name: "Dodaj definicję" })).toBeInTheDocument();
    expect(keyInput()).toBeEnabled();
  });

  it.each([
    ["„_” (zapisany przez dawną walidację przed normalizacją)", "_"],
    ["dłuższy niż 64 znaki (sprzed limitu)", "a".repeat(70)],
    ["spoza wzoru (baza nie ma CHECK na format klucza)", "Prep-Time"],
  ])("starsza definicja z kluczem %s nadal daje się edytować", async (_case, legacyKey) => {
    // Walidacja nowego klucza szła też przy „Zapisz zmiany”: przy wyłączonym,
    // wypełnionym polu klucza ekran meldował błąd klucza i nic nie zapisywał.
    // Klucz nie jedzie w UPDATE wcale, więc nie da się go też „poprawić”
    // normalizacją na tożsamość innego wiersza.
    await setup([def({ key: legacyKey, label_pl: "Stare pole", position: 30 })]);
    fireEvent.click(screen.getByRole("button", { name: "Edytuj" }));
    expect(keyInput()).toBeDisabled();
    type(labelEn(), "Old field");
    fireEvent.click(saveChangesButton());

    await waitFor(() => expect(h.updates).toHaveLength(1));
    expect(h.updates[0]).toEqual({
      id: "d1",
      label_pl: "Stare pole",
      label_en: "Old field",
      icon: "Clock",
      position: 30,
    });
    expect(h.defs).toEqual([expect.objectContaining({ id: "d1", key: legacyKey })]);
    expect(h.toast.error).not.toHaveBeenCalled();
    expect(h.toast.success).toHaveBeenCalledWith("Zapisano");
  });

  it("„Anuluj” wraca do dodawania z pustym formularzem i pozycją na końcu listy", async () => {
    await setup([def({ position: 70 })]);
    fireEvent.click(screen.getByRole("button", { name: "Edytuj" }));
    fireEvent.click(screen.getByRole("button", { name: "Anuluj" }));

    expect(screen.getByRole("heading", { name: "Dodaj definicję" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Anuluj" })).toBeNull();
    expect(keyInput().value).toBe("");
    expect(keyInput()).toBeEnabled();
    expect(positionInput().value).toBe("80");
    expect([...h.inserts, ...h.updates]).toHaveLength(0);
  });
});

describe("custom meta - usuwanie definicji", () => {
  const removeIn = (label: string) =>
    within(rowByLabel(label)).getByRole("button", { name: "Usuń" });

  it("pyta o potwierdzenie destrukcyjnym oknem i bez zgody nic nie usuwa", async () => {
    h.confirmAnswer = false;
    await setup([def()]);
    fireEvent.click(removeIn("Czas przygotowania"));

    await waitFor(() => expect(h.confirmCalls).toHaveLength(1));
    expect(h.confirmCalls[0]).toEqual({
      title: "Usunąć definicję?",
      destructive: true,
      confirmLabel: "Usuń",
    });
    expect(h.deletes).toHaveLength(0);
    expect(screen.getByText("Czas przygotowania")).toBeInTheDocument();
  });

  it("po zgodzie usuwa definicję po id, melduje i odświeża listę", async () => {
    await setup([def(), def({ id: "d2", key: "level", label_pl: "Poziom", position: 20 })]);
    fireEvent.click(removeIn("Poziom"));

    await waitFor(() => expect(h.deletes).toEqual(["d2"]));
    expect(h.toast.success).toHaveBeenCalledWith("Usunięto");
    await waitFor(() => expect(screen.queryByText("Poziom")).toBeNull());
    expect(screen.getByText("Czas przygotowania")).toBeInTheDocument();
  });

  it("usunięcie definicji otwartej w edycji zamyka edycję - „Zapisz zmiany” jej nie wskrzesza", async () => {
    // Formularz zostawał w trybie edycji z `id` usuniętego wiersza; „Zapisz
    // zmiany” robiło upsert z tym `id`, czyli INSERT - definicja wracała.
    await setup([def()]);
    fireEvent.click(screen.getByRole("button", { name: "Edytuj" }));
    fireEvent.click(removeIn("Czas przygotowania"));

    await waitFor(() => expect(h.deletes).toEqual(["d1"]));
    expect(await screen.findByRole("heading", { name: "Dodaj definicję" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Zapisz zmiany" })).toBeNull();
    expect(keyInput().value).toBe("");
    expect(keyInput()).toBeEnabled();
  });

  it("usunięcie INNEJ definicji nie przerywa trwającej edycji", async () => {
    await setup([def(), def({ id: "d2", key: "level", label_pl: "Poziom", position: 20 })]);
    fireEvent.click(within(rowByLabel("Poziom")).getByRole("button", { name: "Edytuj" }));
    fireEvent.click(removeIn("Czas przygotowania"));

    await waitFor(() => expect(h.deletes).toEqual(["d1"]));
    expect(screen.getByRole("heading", { name: "Edytuj definicję" })).toBeInTheDocument();
    expect(keyInput().value).toBe("level");
  });

  it("„Edytuj” kliknięte, gdy usuwanie tego wiersza jeszcze trwa, nie zostawia formularza przy usuniętym wierszu", async () => {
    // Warunek czytał edycję z chwili kliknięcia „Usuń” (wtedy żadnej), więc
    // formularz zostawał w edycji usuniętego wiersza - a „Zapisz zmiany”
    // wskrzeszało go upsertem.
    let release!: () => void;
    h.deleteGate = new Promise<void>((r) => (release = r));
    await setup([def()]);
    fireEvent.click(removeIn("Czas przygotowania"));
    await waitFor(() => expect(h.confirmCalls).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Edytuj" }));
    expect(screen.getByRole("heading", { name: "Edytuj definicję" })).toBeInTheDocument();

    await act(async () => release());
    await waitFor(() => expect(h.deletes).toEqual(["d1"]));
    expect(await screen.findByRole("heading", { name: "Dodaj definicję" })).toBeInTheDocument();
    expect(keyInput().value).toBe("");
  });

  it("błąd usuwania pokazuje komunikat i zostawia wiersz", async () => {
    h.deleteError = new Error("foreign key violation");
    await setup([def()]);
    fireEvent.click(removeIn("Czas przygotowania"));

    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("foreign key violation"));
    expect(h.toast.success).not.toHaveBeenCalled();
    expect(screen.getByText("Czas przygotowania")).toBeInTheDocument();
  });

  it("błąd usuwania bez obiektu Error daje ogólny komunikat", async () => {
    h.deleteError = "boom";
    await setup([def()]);
    fireEvent.click(removeIn("Czas przygotowania"));

    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("Błąd"));
  });
});

describe("custom meta - jeden zapis na raz", () => {
  it("podwójne kliknięcie „Dodaj” to JEDEN zapis i jeden komunikat", async () => {
    // Bez blokady drugie kliknięcie w trakcie zapisu wysyłało drugi zapis tego
    // samego klucza i drugi toast.
    let release!: () => void;
    h.writeGate = new Promise<void>((r) => (release = r));
    await setup();
    fillNew("servings", "Porcje");
    fireEvent.click(addButton());
    fireEvent.click(addButton());

    expect(h.inserts).toHaveLength(1);
    expect(addButton()).toBeDisabled();
    await act(async () => release());
    expect(await screen.findByText("Porcje")).toBeInTheDocument();
    expect(h.inserts).toHaveLength(1);
    expect(h.toast.success).toHaveBeenCalledTimes(1);
    expect(h.toast.error).not.toHaveBeenCalled();
    expect(addButton()).toBeEnabled();
  });

  it("„Edytuj” kliknięte w trakcie zapisu przeżywa jego zakończenie", async () => {
    // Pola i „Edytuj” przy wierszach zostają czynne w trakcie zapisu, a
    // bezwarunkowe czyszczenie po zapisie kasowało edycję, którą redaktor
    // zaczął, czekając na odpowiedź serwera.
    let release!: () => void;
    h.writeGate = new Promise<void>((r) => (release = r));
    await setup([def()]);
    fillNew("servings", "Porcje");
    fireEvent.click(addButton());
    fireEvent.click(
      within(rowByLabel("Czas przygotowania")).getByRole("button", { name: "Edytuj" }),
    );
    type(labelPl(), "Zmieniona w trakcie");

    await act(async () => release());
    expect(await screen.findByText("Porcje")).toBeInTheDocument();
    expect(h.toast.success).toHaveBeenCalledWith("Zapisano");
    expect(screen.getByRole("heading", { name: "Edytuj definicję" })).toBeInTheDocument();
    expect(keyInput().value).toBe("prep_time");
    expect(labelPl().value).toBe("Zmieniona w trakcie");
  });

  it("„Edytuj” TEGO wiersza w trakcie jego zapisu nie wczytuje wersji sprzed zapisu", async () => {
    // Lista przed odświeżeniem trzyma stare etykiety. Formularz wypełniony
    // z niej to nie wysłana migawka, więc przeżywał zakończenie zapisu,
    // a kolejne „Zapisz zmiany” po cichu cofało właśnie zapisaną zmianę.
    let release!: () => void;
    await setup([def()]);
    fireEvent.click(screen.getByRole("button", { name: "Edytuj" }));
    type(labelPl(), "Zmieniona");
    h.writeGate = new Promise<void>((r) => (release = r));
    fireEvent.click(saveChangesButton());
    fireEvent.click(screen.getByRole("button", { name: "Edytuj" }));

    await act(async () => release());
    expect(await screen.findByText("Zmieniona")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dodaj definicję" })).toBeInTheDocument();
    // Po odświeżeniu wiersz otwiera się w zapisanej wersji i nic jej nie cofa.
    h.writeGate = null;
    fireEvent.click(screen.getByRole("button", { name: "Edytuj" }));
    expect(labelPl().value).toBe("Zmieniona");
    fireEvent.click(saveChangesButton());
    await waitFor(() => expect(h.updates).toHaveLength(2));
    expect(h.defs).toEqual([def({ label_pl: "Zmieniona" })]);
  });
});

describe("custom meta - zmiany z innej karty (nieświeży cache)", () => {
  // W produkcji lista żyje w cache 5 minut i nie odświeża się przy powrocie do
  // karty (`src/router.tsx`). Zmianę „z innej karty” (albo od innego
  // redaktora) robimy wprost w `h.defs` już po wczytaniu ekranu - lista na
  // ekranie o niej nie wie.
  const otherTab = def({
    id: "other-tab",
    key: "servings",
    label_pl: "Porcje (karta B)",
    icon: "Users",
    position: 20,
  });

  it("„Dodaj” klucza, który inna karta dodała po wczytaniu listy, NIE nadpisuje jej definicji", async () => {
    // Kontrola duplikatu z listy na ekranie przepuszczała klucz, a upsert po
    // (tenant_id, key) przepisywał cudze etykiety, ikonę i pozycję z „Zapisano”.
    await setup([def()]);
    h.defs = [...h.defs, otherTab];
    fillNew("servings", "Porcje (karta A)");
    fireEvent.click(addButton());

    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith(KEY_TAKEN));
    expect(h.toast.success).not.toHaveBeenCalled();
    expect(h.defs.find((d) => d.key === "servings")).toEqual(otherTab);
    // Lista pokazuje definicję, o którą zapis się rozbił, a wpis zostaje w formularzu.
    expect(await screen.findByText("Porcje (karta B)")).toBeInTheDocument();
    expect(keyInput().value).toBe("servings");
    expect(labelPl().value).toBe("Porcje (karta A)");
  });

  it("„Zapisz zmiany” definicji usuniętej w innej karcie jej NIE wskrzesza", async () => {
    // Upsert z `id` wiersza, którego już nie ma, nie trafiał w konflikt klucza,
    // więc WSTAWIAŁ definicję z powrotem i meldował „Zapisano”.
    await setup([def(), def({ id: "d2", key: "level", label_pl: "Poziom", position: 20 })]);
    fireEvent.click(
      within(rowByLabel("Czas przygotowania")).getByRole("button", { name: "Edytuj" }),
    );
    h.defs = h.defs.filter((d) => d.id !== "d1");
    type(labelPl(), "Zmieniona");
    fireEvent.click(saveChangesButton());

    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith(DELETED_MEANWHILE));
    expect(h.toast.success).not.toHaveBeenCalled();
    expect(h.defs.map((d) => d.id)).toEqual(["d2"]);
    // Formularz nie wskazuje już nieistniejącego wiersza, a lista go nie pokazuje.
    expect(screen.getByRole("heading", { name: "Dodaj definicję" })).toBeInTheDocument();
    expect(keyInput().value).toBe("");
    await waitFor(() => expect(screen.queryByText("Czas przygotowania")).toBeNull());
  });

  it("edycja INNEJ definicji zaczęta w trakcie zapisu zostaje, gdy edytowana zniknęła", async () => {
    // Czyszczenie dotyczy formularza wskazującego usunięty wiersz - nie pracy,
    // którą redaktor zaczął przy innym wierszu, czekając na odpowiedź serwera.
    await setup([def(), def({ id: "d2", key: "level", label_pl: "Poziom", position: 20 })]);
    fireEvent.click(
      within(rowByLabel("Czas przygotowania")).getByRole("button", { name: "Edytuj" }),
    );
    h.defs = h.defs.filter((d) => d.id !== "d1");
    let release!: () => void;
    h.writeGate = new Promise<void>((r) => (release = r));
    fireEvent.click(saveChangesButton());
    fireEvent.click(within(rowByLabel("Poziom")).getByRole("button", { name: "Edytuj" }));

    await act(async () => release());
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith(DELETED_MEANWHILE));
    expect(h.defs.map((d) => d.id)).toEqual(["d2"]);
    expect(screen.getByRole("heading", { name: "Edytuj definicję" })).toBeInTheDocument();
    expect(keyInput().value).toBe("level");
  });
});

describe("custom meta - konto bez prawa zapisu (autor)", () => {
  it("„Zapisz zmiany” odrzucone przez RLS mówi o braku uprawnień i zostawia formularz", async () => {
    // Autor dostawał „usunięta w międzyczasie”, formularz się czyścił, a po
    // odświeżeniu definicja dalej stała na liście - rada „dodaj ją ponownie”
    // kończyła się już błędem RLS przy INSERT.
    h.rlsReadOnly = true;
    await setup([def()]);
    fireEvent.click(screen.getByRole("button", { name: "Edytuj" }));
    type(labelPl(), "Zmieniona");
    fireEvent.click(saveChangesButton());

    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith(NO_PERMISSION));
    expect(h.toast.error).not.toHaveBeenCalledWith(DELETED_MEANWHILE);
    expect(h.toast.success).not.toHaveBeenCalled();
    expect(h.defs).toEqual([def()]);
    expect(screen.getByRole("heading", { name: "Edytuj definicję" })).toBeInTheDocument();
    expect(labelPl().value).toBe("Zmieniona");
    expect(saveChangesButton()).toBeEnabled();
  });
});
