// Trasa `/admin/library` ZAMONTOWANA - biblioteka materiałów członkowskich
// (pliki w prywatnym buckecie + bramka rangi warstwy).
//
// PO CO OSOBNY PLIK, GDY `src/__tests__/adminLibraryReplace.test.tsx` JUŻ JEST.
// Tamten plik dowodzi JEDNEJ rzeczy: choreografii PODMIANY pliku w oknie
// edycji (nowy obiekt, jeden UPDATE, stary obiekt best-effort po sukcesie,
// sprzątanie osieroconego uploadu). Renderuje sam komponent trasy przez
// `Route.options.component`, więc nie widzi sklejenia i nie dotyka ani listy,
// ani publikacji, ani usuwania, ani dodawania nowego materiału. Ta trasa
// stała więc na 61,2% linii i 24 z 60 funkcji.
//
// PIĘĆ REGUŁ, KTÓRYCH ZŁAMANIE KOSZTUJE:
//
//   1. AWARIA ODCZYTU NIE UDAJE PUSTEJ BIBLIOTEKI. Ten panel MA rozdzielone
//      trzy stany (`isLoading` / `isError` / puste) - i to jest wzorzec dla
//      pozostałych paneli modułu. Panel pokazujący „brak materiałów" po
//      odmowie zaprasza redakcję do wgrania pliku, który już tam jest.
//   2. PRZEŁĄCZNIK PUBLIKACJI JEST OPTYMISTYCZNY I MUSI SIĘ COFAĆ. Bez
//      wycofania po błędzie panel pokazuje materiał jako opublikowany, gdy
//      baza go odrzuciła - a materiał za bramką rangi jest zasobem płatnym.
//   3. USUNIĘCIE PYTA I NIE DA SIĘ COFNĄĆ. Kasuje wiersz metadanych i obiekt
//      w buckecie; licznik pobrań i historia idą razem z nim.
//   4. NOWY MATERIAŁ ZAPISUJE ŚCIEŻKĘ Z UPLOADU, nie nazwę z dysku. Wiersz
//      wskazujący nieistniejący obiekt to pozycja w bibliotece, której nie da
//      się pobrać - widoczna dla członków, płatna.
//   5. RANGA WARSTWY JEST LICZBĄ, nie napisem. `min_tier_rank` steruje bramką
//      pobrania; wartość z listy wyboru przechodzi przez `Number(...)`, więc
//      napis „10" zapisany wprost dałby porównanie leksykograficzne w bazie.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - PODMIANY PLIKU: cała choreografia (i porzucenie okna) ma asercje
//   w `src/__tests__/adminLibraryReplace.test.tsx`.
// - WARSTWY DANYCH: `fetchAdminResources`, `uploadResourceFile`,
//   `createResource`, `updateResource`, `deleteResource` mieszkają
//   w `src/lib/admin/library.ts` i są tu GRANICĄ (atrapy) - to jedyny sposób
//   dowiedzenia, CO panel do nich wysyła.
// - DOSTĘPU: `/admin` przepuszcza tylko `isStaff`, a prawo do
//   `member_resources` i do bucketu egzekwuje RLS + polityki Storage; warstw
//   pilnuje `src/routes/__tests__/adminRouteAuthority.gate.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { MemberResourceRow, ResourceInput } from "@/lib/admin/library";

const RESOURCE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FILE_PATH = "t1/u1/1-raport.pdf";
const UPLOADED_PATH = "t1/u1/2-nowy.pdf";

const h = vi.hoisted(() => ({
  /** Wiersze oddawane przez warstwę danych; `null` = odczyt ma się wysypać. */
  rows: [] as MemberResourceRow[] | null,
  /** Czy odczyt ma wisieć (dowód stanu wczytywania). */
  hangRead: false,
  /** Ładunki i błędy poszczególnych operacji warstwy danych. */
  updates: [] as { id: string; patch: Record<string, unknown> }[],
  updateError: null as unknown,
  /** Czy zapis publikacji ma WISIEĆ - jedyny sposób obserwacji stanu
   *  optymistycznego (atrapa odpowiadająca natychmiast unieważnia cache
   *  w `onSettled`, więc widok wraca do wiersza z bazy w tym samym tiku). */
  hangUpdate: false,
  creates: [] as ResourceInput[],
  createError: null as unknown,
  deletes: [] as { id: string; filePath: string | null }[],
  deleteError: null as unknown,
  uploads: [] as string[],
  uploadError: null as unknown,
  removedObjects: [] as string[],
  /** Odpowiedź natywnego `confirm` - panel woła je przed usunięciem. */
  confirmAnswer: true,
  confirmMessages: [] as string[],
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-library", () => ({ ensureI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/admin/library", () => ({
  RESOURCE_BUCKET: "member-resources",
  fetchAdminResources: async () => {
    if (h.hangRead) return new Promise(() => {});
    if (h.rows === null) throw new Error("test: odmowa odczytu member_resources");
    return h.rows;
  },
  uploadResourceFile: async (file: File) => {
    h.uploads.push(file.name);
    if (h.uploadError !== null) throw h.uploadError;
    return { path: UPLOADED_PATH, size: 2048 };
  },
  createResource: async (input: ResourceInput) => {
    h.creates.push(input);
    if (h.createError !== null) throw h.createError;
    return { id: "new" } as MemberResourceRow;
  },
  updateResource: async (id: string, patch: Record<string, unknown>) => {
    h.updates.push({ id, patch });
    if (h.hangUpdate) return new Promise(() => {});
    if (h.updateError !== null) throw h.updateError;
  },
  deleteResource: async (id: string, filePath: string | null) => {
    h.deletes.push({ id, filePath });
    if (h.deleteError !== null) throw h.deleteError;
  },
  removeResourceObject: async (path: string) => {
    h.removedObjects.push(path);
  },
}));
vi.mock("@/lib/billing/tiers", () => ({
  useMembershipTiers: () => ({
    data: [
      { id: "t0", rank: 0, active: true, name_pl: "Czytelnik", name_en: "Reader" },
      { id: "t10", rank: 10, active: true, name_pl: "Członek", name_en: "Member" },
      { id: "t20", rank: 20, active: false, name_pl: "Wycofana", name_en: "Retired" },
    ],
  }),
  tierName: (tier: { name_pl: string; name_en: string }, lang: string) =>
    lang === "en" ? tier.name_en : tier.name_pl,
}));
vi.mock("@/components/ui/select", async () => {
  const react = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(react);
});
vi.mock("@/components/ui/switch", async () => {
  const react = await import("react");
  const { radixSwitchStub } = await import("@/test/reactStubs");
  return radixSwitchStub(react);
});

import { renderRoute, routeMeta } from "@/test/routeHarness";
import { Route as LibraryRoute } from "@/routes/admin.library";

const PATH = "/admin/library";

/** Wiersz materiału. Tytuły WYMYŚLONE (RODO w fixtures). */
function resource(patch: Partial<MemberResourceRow> = {}): MemberResourceRow {
  return {
    id: RESOURCE_ID,
    title_pl: "Raport kwartalny",
    title_en: "Quarterly report",
    description_pl: null,
    description_en: null,
    category: "report",
    file_path: FILE_PATH,
    file_name: "raport.pdf",
    file_size: 1536,
    mime_type: "application/pdf",
    min_tier_rank: 10,
    published: true,
    sort_order: 0,
    download_count: 7,
    created_at: "2026-01-01T00:00:00Z",
    created_by: "u1",
    tenant_id: "t1",
    ...patch,
  } as MemberResourceRow;
}

async function mount() {
  return renderRoute({ route: LibraryRoute, path: PATH, initialEntry: PATH });
}

const button = (name: string | RegExp) => screen.getByRole("button", { name });

beforeEach(() => {
  vi.clearAllMocks();
  h.rows = [resource()];
  h.hangRead = false;
  h.updates = [];
  h.updateError = null;
  h.hangUpdate = false;
  h.creates = [];
  h.createError = null;
  h.deletes = [];
  h.deleteError = null;
  h.uploads = [];
  h.uploadError = null;
  h.removedObjects = [];
  h.confirmAnswer = true;
  h.confirmMessages = [];
  // Natywny `confirm` nie istnieje w happy-dom w formie, na której da się
  // oprzeć dowód - podstawiamy własny i ZAPISUJEMY treść pytania, bo to ona
  // mówi redakcji, KTÓRY plik zniknie.
  vi.stubGlobal("confirm", (message?: string) => {
    h.confirmMessages.push(String(message));
    return h.confirmAnswer;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("admin.library - trzy stany odczytu", () => {
  it("w trakcie odczytu pokazuje wczytywanie, a nie stan pusty", async () => {
    // Stan pusty pokazany w trakcie odczytu miga redakcji komunikatem
    // „brak materiałów" na każdym wejściu do panelu.
    h.hangRead = true;
    await mount();

    expect(screen.getByText("adminLibrary.loading")).toBeInTheDocument();
    expect(screen.queryByText("adminLibrary.noResourcesYet")).toBeNull();
  });

  it("AWARIA odczytu pokazuje błąd i NIE udaje pustej biblioteki", async () => {
    // REGUŁA 1 i wzorzec dla całego modułu: `isError` ma własny komunikat.
    // Bez tego rozdzielenia redakcja wgrywa duplikat pliku, który już jest
    // w buckecie - i płaci za niego drugi raz miejscem.
    h.rows = null;
    await mount();

    expect(await screen.findByText("adminLibrary.couldLoadResources")).toBeInTheDocument();
    expect(screen.queryByText("adminLibrary.noResourcesYet")).toBeNull();
  });

  it("pusta biblioteka mówi o pustce i zostawia drogę dodania materiału", async () => {
    h.rows = [];
    await mount();

    expect(await screen.findByText("adminLibrary.noResourcesYet")).toBeInTheDocument();
    expect(button("adminLibrary.newResource")).toBeInTheDocument();
  });

  it("panel nie zostawia w nagłówku pustego tytułu", async () => {
    const meta = await routeMeta(LibraryRoute);
    for (const entry of meta) {
      if ("title" in entry) expect(entry.title).not.toBe("");
    }
  });
});

describe("admin.library - wiersz materiału", () => {
  it("pokazuje rangę warstwy NAZWĄ warstwy, nie samą liczbą", async () => {
    // Ranga to liczba w bazie, ale redakcja podejmuje decyzję o dostępie
    // po nazwie planu. „ranga 10" nie mówi, czy plik jest dla członków.
    await mount();
    await screen.findByText("Raport kwartalny");

    expect(screen.getByText("Członek")).toBeInTheDocument();
  });

  it("ranga bez odpowiadającej warstwy spada na zapasową etykietę z liczbą", async () => {
    // Warstwa wycofana z cennika nie znika z istniejących materiałów.
    // Bez zapasowej etykiety wiersz pokazywałby pustkę w miejscu bramki
    // dostępu - czyli plik bez widocznego progu.
    h.rows = [resource({ min_tier_rank: 99 })];
    await mount();
    await screen.findByText("Raport kwartalny");

    expect(screen.getByText("adminLibrary.rank(rank=99)")).toBeInTheDocument();
  });

  it("rozmiar pliku jest w jednostkach binarnych, a brak rozmiaru daje dywiz", async () => {
    // Rozmiar jest jedyną informacją o koszcie pobrania dla członka na
    // łączu komórkowym; `null` w kolumnie nie może wyjść jako „NaN B".
    h.rows = [resource(), resource({ id: "b", file_size: null, title_pl: "Bez rozmiaru" })];
    await mount();
    await screen.findByText("Raport kwartalny");

    expect(screen.getByText("1.5 KB")).toBeInTheDocument();
    expect(screen.getByText("-")).toBeInTheDocument();
  });

  it("licznik pobrań jest widoczny - to jedyny sygnał, czy materiał żyje", async () => {
    await mount();
    await screen.findByText("Raport kwartalny");

    expect(screen.getByText(/adminLibrary\.downloads: 7/)).toBeInTheDocument();
  });
});

describe("admin.library - publikacja inline", () => {
  it("przełącznik wysyła DOKŁADNIE `{ published }`, a nie cały wiersz", async () => {
    // Ładunek z całym wierszem nadpisałby licznik pobrań i ścieżkę pliku
    // wartościami z widoku - a widok nie jest źródłem prawdy o tych polach.
    await mount();
    await screen.findByText("Raport kwartalny");
    fireEvent.click(screen.getAllByRole("switch")[0]);

    await waitFor(() => expect(h.updates).toHaveLength(1));
    expect(h.updates[0]).toEqual({ id: RESOURCE_ID, patch: { published: false } });
  });

  it("zmiana jest widoczna NATYCHMIAST, przed odpowiedzią bazy", async () => {
    // O to jest cały `onMutate`: przełącznik, który czeka na rundę do bazy,
    // wygląda jak zepsuty i redakcja klika go drugi raz.
    h.hangUpdate = true;
    await mount();
    await screen.findByText("Raport kwartalny");
    expect(screen.getByText("adminLibrary.published")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("switch")[0]);

    await waitFor(() => expect(screen.getByText("adminLibrary.hidden")).toBeInTheDocument());
  });

  it("błąd zapisu WYCOFUJE optymistyczną zmianę i pokazuje komunikat", async () => {
    // REGUŁA 2. Bez wycofania panel twierdzi, że materiał jest ukryty,
    // podczas gdy baza dalej wystawia go członkom - albo odwrotnie.
    h.updateError = new Error("test: odmowa polityki member_resources");
    await mount();
    await screen.findByText("Raport kwartalny");
    fireEvent.click(screen.getAllByRole("switch")[0]);

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText("adminLibrary.published")).toBeInTheDocument());
    expect(screen.queryByText("adminLibrary.hidden")).toBeNull();
  });
});

describe("admin.library - usunięcie materiału", () => {
  it("pyta o potwierdzenie i mówi w nim, KTÓRY materiał zniknie", async () => {
    // REGUŁA 3. Usunięcie kasuje wiersz i obiekt w buckecie razem z licznikiem
    // pobrań - potwierdzenie bez tytułu nie daje się sprawdzić przed klikiem.
    await mount();
    await screen.findByText("Raport kwartalny");
    fireEvent.click(button("adminLibrary.deleteResource"));

    expect(h.confirmMessages).toHaveLength(1);
    expect(h.confirmMessages[0]).toContain("Raport kwartalny");
  });

  it("ODMOWA w potwierdzeniu nie usuwa niczego", async () => {
    h.confirmAnswer = false;
    await mount();
    await screen.findByText("Raport kwartalny");
    fireEvent.click(button("adminLibrary.deleteResource"));

    expect(h.deletes).toEqual([]);
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("ZGODA usuwa wiersz RAZEM ze ścieżką obiektu w buckecie", async () => {
    // `deleteResource(id, filePath)`: bez ścieżki obiekt zostaje w prywatnym
    // buckecie na zawsze - płatne miejsce bez wiersza, który by je opisywał.
    await mount();
    await screen.findByText("Raport kwartalny");
    fireEvent.click(button("adminLibrary.deleteResource"));

    await waitFor(() => expect(h.deletes).toHaveLength(1));
    expect(h.deletes[0]).toEqual({ id: RESOURCE_ID, filePath: FILE_PATH });
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminLibrary.resourceDeleted"),
    );
  });

  it("błąd usunięcia pokazuje komunikat i NIE chwali", async () => {
    h.deleteError = new Error("test: odmowa usunięcia");
    await mount();
    await screen.findByText("Raport kwartalny");
    fireEvent.click(button("adminLibrary.deleteResource"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("admin.library - nowy materiał", () => {
  async function openNew() {
    const view = await mount();
    await screen.findByText("Raport kwartalny");
    fireEvent.click(button("adminLibrary.newResource"));
    await screen.findByLabelText("adminLibrary.chooseFileUpload");
    return view;
  }

  function pickFile(name = "nowy.pdf") {
    const input = screen.getByLabelText("adminLibrary.chooseFileUpload");
    fireEvent.change(input, {
      target: { files: [new File(["x"], name, { type: "application/pdf" })] },
    });
  }

  it("zapis jest zablokowany, dopóki nie ma pliku I obu tytułów", async () => {
    // Materiał bez tytułu angielskiego wychodzi na angielskiej wersji
    // biblioteki jako pusty wiersz z przyciskiem pobrania.
    await openNew();
    expect(button("adminLibrary.save")).toBeDisabled();

    pickFile();
    await waitFor(() => expect(h.uploads).toEqual(["nowy.pdf"]));
    expect(button("adminLibrary.save")).toBeDisabled();

    const titles = screen.getAllByRole("textbox");
    fireEvent.change(titles[0], { target: { value: "Nowy raport" } });
    expect(button("adminLibrary.save")).toBeDisabled();
    fireEvent.change(titles[1], { target: { value: "New report" } });
    await waitFor(() => expect(button("adminLibrary.save")).not.toBeDisabled());
  });

  it("wybór pliku od razu wysyła go do bucketu - metadane dopisujemy potem", async () => {
    // Kolejność jest częścią kontraktu: gdyby upload czekał na „zapisz",
    // błąd uploadu wywracałby zapis metadanych już po jego rozpoczęciu.
    await openNew();
    pickFile();

    await waitFor(() => expect(h.uploads).toEqual(["nowy.pdf"]));
    expect(h.creates).toEqual([]);
  });

  it("błąd uploadu odrzuca WYBÓR pliku, żeby nie dało się zapisać wiersza bez obiektu", async () => {
    // Wiersz metadanych wskazujący obiekt, którego nie ma w buckecie, jest
    // pozycją w bibliotece, której członek nie pobierze - a widzi ją i płaci.
    h.uploadError = new Error("test: bucket odrzucił plik");
    await openNew();
    pickFile();

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(button("adminLibrary.save")).toBeDisabled();
    expect(h.creates).toEqual([]);
  });

  it("zapis niesie ŚCIEŻKĘ Z UPLOADU i rangę jako LICZBĘ", async () => {
    // REGUŁY 4 i 5 w jednym ładunku: ścieżka pochodzi z odpowiedzi bucketu
    // (nie z nazwy pliku na dysku), a `min_tier_rank` musi być liczbą, bo
    // bramka pobrania porównuje ją relacyjnie.
    await openNew();
    pickFile();
    await waitFor(() => expect(h.uploads).toHaveLength(1));
    const titles = screen.getAllByRole("textbox");
    fireEvent.change(titles[0], { target: { value: "Nowy raport" } });
    fireEvent.change(titles[1], { target: { value: "New report" } });
    const tierSelect = screen
      .getAllByRole("combobox")
      .find((el) => el.querySelector('option[value="0"]'));
    if (!tierSelect) throw new Error("test: brak listy wyboru warstwy");
    fireEvent.change(tierSelect, { target: { value: "0" } });
    fireEvent.click(button("adminLibrary.save"));

    await waitFor(() => expect(h.creates).toHaveLength(1));
    expect(h.creates[0]).toMatchObject({
      title_pl: "Nowy raport",
      title_en: "New report",
      file_path: UPLOADED_PATH,
      file_name: "nowy.pdf",
      file_size: 2048,
      mime_type: "application/pdf",
      min_tier_rank: 0,
    });
    expect(typeof h.creates[0].min_tier_rank).toBe("number");
  });

  it("lista warstw pomija warstwy WYCOFANE z cennika", async () => {
    // Przypisanie materiału do nieaktywnej warstwy daje plik, którego nikt
    // nie może kupić - czyli plik niedostępny dla wszystkich.
    await openNew();
    const tierSelect = screen
      .getAllByRole("combobox")
      .find((el) => el.querySelector('option[value="0"]'));
    if (!tierSelect) throw new Error("test: brak listy wyboru warstwy");

    expect(tierSelect.querySelector('option[value="20"]')).toBeNull();
    expect(tierSelect.querySelector('option[value="10"]')).not.toBeNull();
  });

  it("udany zapis chwali, unieważnia klucz listy i zamyka okno", async () => {
    const view = await openNew();
    const spy = vi.spyOn(view.queryClient, "invalidateQueries");
    pickFile();
    await waitFor(() => expect(h.uploads).toHaveLength(1));
    const titles = screen.getAllByRole("textbox");
    fireEvent.change(titles[0], { target: { value: "Nowy raport" } });
    fireEvent.change(titles[1], { target: { value: "New report" } });
    fireEvent.click(button("adminLibrary.save"));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("adminLibrary.resourceAdded"));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["admin", "member-resources"] });
    await waitFor(() =>
      expect(screen.queryByLabelText("adminLibrary.chooseFileUpload")).toBeNull(),
    );
  });

  it("porzucenie okna po uploadzie SPRZĄTA osierocony obiekt", async () => {
    // Zamknięcie bez zapisu zostawia w prywatnym buckecie plik, do którego
    // nie prowadzi żaden wiersz - i którego nikt już nigdy nie znajdzie.
    await openNew();
    pickFile();
    await waitFor(() => expect(h.uploads).toHaveLength(1));
    fireEvent.click(button("adminLibrary.cancel"));

    await waitFor(() => expect(h.removedObjects).toEqual([UPLOADED_PATH]));
    expect(h.creates).toEqual([]);
  });

  it("błąd zapisu metadanych NIE zamyka okna i NIE kasuje wgranego pliku", async () => {
    // Wersja robocza i wgrany obiekt muszą przeżyć odmowę bazy - inaczej
    // redakcja wgrywa plik po raz drugi i wpisuje metadane od zera.
    h.createError = new Error("test: odmowa zapisu metadanych");
    await openNew();
    pickFile();
    await waitFor(() => expect(h.uploads).toHaveLength(1));
    const titles = screen.getAllByRole("textbox");
    fireEvent.change(titles[0], { target: { value: "Nowy raport" } });
    fireEvent.change(titles[1], { target: { value: "New report" } });
    fireEvent.click(button("adminLibrary.save"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(screen.getByLabelText("adminLibrary.chooseFileUpload")).toBeInTheDocument();
    expect(h.removedObjects).toEqual([]);
  });
});
