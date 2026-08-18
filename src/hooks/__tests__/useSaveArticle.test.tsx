// „Zapisz na później" - decyzja, GDZIE klik trafia, i pamięć lokalna gościa
// z wygasaniem. `readLocal` i `pruneExpired` stały na zerze, a to one czytają
// dane z urządzenia użytkownika: uszkodzony JSON, wpis bez znacznika czasu i
// zablokowany magazyn to stany, które w produkcji WYSTĘPUJĄ.
//
// Cztery reguły, których złamanie widzi użytkownik:
//
//   1. USZKODZONY MAGAZYN NIE GASI PRZYCISKU. Nieparsowalny JSON, wartość
//      nie-tablicowa albo rzucający `localStorage` (tryb prywatny, wyczerpany
//      limit) muszą degradować do pustej listy, nie do wyjątku w renderze.
//   2. TTL GOŚCIA JEST EGZEKWOWANY PRZY ODCZYCIE I ZAPISYWANY DO MAGAZYNU.
//      Inaczej `/reading-list` i scalanie po zalogowaniu widziałyby inną listę
//      niż przycisk na wpisie.
//   3. WPIS BEZ `savedAt` (ręcznie edytowany / z czasów przed TTL) NIE GINIE -
//      dostaje znacznik przy najbliższym zapisie i od tego momentu się starzeje.
//   4. TRZY ŚCIEŻKI ZAPISU SĄ ROZŁĄCZNE: zalogowany + personalizacja -> baza;
//      gość z `allowGuests` -> magazyn lokalny; gość bez -> okno logowania
//      (i ANI JEDEN zapis nigdzie).
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import {
  DEFAULT_PERSONALIZED_SETTINGS,
  type PersonalizedSettings,
} from "@/hooks/usePersonalizedSettings";

const h = vi.hoisted(() => ({
  storage: undefined as Storage | undefined,
  user: null as { id: string } | null,
  settings: null as unknown,
  bookmarks: [] as { entity_type: string; entity_id: string }[],
  toggleMutate: vi.fn(),
  navigate: vi.fn(),
  openLoginPopup: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: h.toastSuccess, error: h.toastError },
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => h.navigate }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock("@/lib/loginPopupBus", () => ({
  openLoginPopup: (arg: unknown) => h.openLoginPopup(arg),
}));
vi.mock("@/hooks/usePersonalizedSettings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/usePersonalizedSettings")>()),
  usePersonalizedSettings: () => h.settings,
}));
vi.mock("@/hooks/useBookmarks", () => ({
  useBookmarks: () => ({ data: h.bookmarks }),
  useToggleBookmark: () => ({ mutate: h.toggleMutate }),
}));
// Magazyn wstrzykiwany na GRANICY MODUŁU `storageKeys` - `readStoredValue`
// i `writeStoredValue` (czyli prawdziwa logika odczytu i migracji kluczy
// legacy) zostają nietknięte. Podmiana samego `localStorage` nie działa: pod
// happy-dom jest Proxy, więc ani przypisanie `setItem` na instancji, ani
// łatanie prototypu nie dociera do wywołania z kodu produkcyjnego (zmierzone).
vi.mock("@/lib/storageKeys", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storageKeys")>();
  return {
    ...actual,
    browserStorage: (kind: "local" | "session") =>
      kind === "local" ? h.storage : actual.browserStorage(kind),
  };
});

import { useSaveArticle } from "@/hooks/useSaveArticle";
import { GUEST_SAVED_ARTICLES_KEY } from "@/lib/storageKeys";
import { POST_IDS } from "@/test/postExperience/fixtures";

const URL_A = "/post/analiza-a";
const URL_B = "/post/analiza-b";
const DAY_MS = 86_400_000;
const NOW = new Date("2026-08-18T10:00:00.000Z").getTime();

interface SavedItem {
  url: string;
  title: string;
  savedAt?: number;
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function settingsWith(overrides: Partial<PersonalizedSettings> = {}): PersonalizedSettings {
  return { ...DEFAULT_PERSONALIZED_SETTINGS, ...overrides };
}

function seedStorage(raw: string) {
  h.storage!.setItem(GUEST_SAVED_ARTICLES_KEY.key, raw);
}

function seedItems(items: SavedItem[]) {
  seedStorage(JSON.stringify(items));
}

/**
 * Magazyn w pamięci o kontrakcie `Storage`. Wariant `blockWrites` odgrywa tryb
 * prywatny Safari i wyczerpany limit: `setItem` RZUCA, a odczyt nadal działa -
 * dokładnie ten stan, w którym przycisk „zapisz" nie ma gdzie zapisać.
 */
function memoryStorage(options: { blockWrites?: boolean } = {}): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => {
      if (options.blockWrites) throw new DOMException("QuotaExceededError");
      map.set(key, value);
    },
  } as Storage;
}

function storedItems(): SavedItem[] {
  const raw = h.storage!.getItem(GUEST_SAVED_ARTICLES_KEY.key);
  return raw ? (JSON.parse(raw) as SavedItem[]) : [];
}

function mount(overrides: Partial<Parameters<typeof useSaveArticle>[0]> = {}) {
  return renderHook(
    () =>
      useSaveArticle({
        entityId: POST_IDS.post,
        url: URL_A,
        title: "Analiza A",
        lang: "pl",
        ...overrides,
      }),
    { wrapper },
  );
}

beforeEach(() => {
  // Zegar zamrożony przez podmianę `Date.now`, NIE przez `vi.useFakeTimers`:
  // hook czyta czas w efekcie, a `waitFor` z testing-library potrzebuje
  // prawdziwych timerów. `shouldAdvanceTime` dawał dryf kilkunastu ms i
  // asercje na dokładny znacznik czasu pękały losowo.
  vi.restoreAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  h.storage = memoryStorage();
  h.user = null;
  h.bookmarks = [];
  h.settings = settingsWith({ allowGuests: true });
  h.toggleMutate.mockReset();
  h.navigate.mockReset();
  h.openLoginPopup.mockReset();
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});

afterEach(() => {
  // OBOWIĄZKOWE: `vi.clearAllMocks()` NIE zdejmuje szpiegów założonych przez
  // `vi.spyOn`. Bez tego atrapa `localStorage.setItem` rzucająca
  // QuotaExceededError z testu zablokowanego magazynu przeciekała do
  // NASTĘPNYCH przypadków i wywracała je z zupełnie innego powodu.
  vi.restoreAllMocks();
});

describe("useSaveArticle - pamięć lokalna gościa: odczyt", () => {
  it("puste magazyn daje stan niezapisany", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.isSaved).toBe(false));
    expect(storedItems()).toEqual([]);
  });

  it("wpis dla TEGO adresu daje stan zapisany", async () => {
    seedItems([{ url: URL_A, title: "Analiza A", savedAt: NOW }]);
    const { result } = mount();
    await waitFor(() => expect(result.current.isSaved).toBe(true));
    expect(storedItems()).toHaveLength(1);
  });

  it("wpis dla INNEGO adresu nie zaznacza tego wpisu jako zapisanego", async () => {
    seedItems([{ url: URL_B, title: "Analiza B", savedAt: NOW }]);
    const { result } = mount();
    await waitFor(() => expect(result.current.isSaved).toBe(false));
    expect(storedItems()).toHaveLength(1);
  });

  it("USZKODZONY JSON degraduje do pustej listy, nie do wyjątku", async () => {
    seedStorage("{to nie jest json");
    const { result } = mount();
    await waitFor(() => expect(result.current.isSaved).toBe(false));
    expect(typeof result.current.toggle).toBe("function");
  });

  it("wartość NIE-TABLICOWA (obiekt) degraduje do pustej listy", async () => {
    seedStorage('{"url":"/post/x"}');
    const { result } = mount();
    await waitFor(() => expect(result.current.isSaved).toBe(false));
    expect(() => result.current.toggle()).not.toThrow();
  });

  it("pusty napis w magazynie degraduje do pustej listy", async () => {
    seedStorage("");
    const { result } = mount();
    await waitFor(() => expect(result.current.isSaved).toBe(false));
    expect(storedItems()).toEqual([]);
  });
});

describe("useSaveArticle - TTL gościa (pruneExpired)", () => {
  it("WPIS WYGASŁY jest odsiewany I usuwany z magazynu (jedno źródło prawdy)", async () => {
    seedItems([
      { url: URL_A, title: "Stary", savedAt: NOW - 20 * DAY_MS },
      { url: URL_B, title: "Świeży", savedAt: NOW - 1 * DAY_MS },
    ]);
    h.settings = settingsWith({ allowGuests: true, guestExpirationDays: 14 });

    const { result } = mount();

    await waitFor(() => expect(result.current.isSaved).toBe(false));
    expect(storedItems().map((s) => s.url)).toEqual([URL_B]);
  });

  it("wpis DOKŁADNIE na granicy TTL zostaje (warunek jest włączny)", async () => {
    seedItems([{ url: URL_A, title: "Na granicy", savedAt: NOW - 14 * DAY_MS }]);
    h.settings = settingsWith({ allowGuests: true, guestExpirationDays: 14 });

    const { result } = mount();

    await waitFor(() => expect(result.current.isSaved).toBe(true));
    expect(storedItems()).toHaveLength(1);
  });

  it("TTL <= 0 wyłącza wygasanie - najstarszy wpis przeżywa", async () => {
    seedItems([{ url: URL_A, title: "Prehistoria", savedAt: NOW - 3650 * DAY_MS }]);
    h.settings = settingsWith({ allowGuests: true, guestExpirationDays: 0 });

    const { result } = mount();

    await waitFor(() => expect(result.current.isSaved).toBe(true));
    expect(storedItems()).toHaveLength(1);
  });

  it("TTL nieliczbowy (uszkodzone ustawienia) też wyłącza wygasanie, zamiast czyścić listę", async () => {
    seedItems([{ url: URL_A, title: "Stary", savedAt: NOW - 900 * DAY_MS }]);
    h.settings = settingsWith({
      allowGuests: true,
      guestExpirationDays: Number.NaN,
    });

    const { result } = mount();

    await waitFor(() => expect(result.current.isSaved).toBe(true));
    expect(storedItems()).toHaveLength(1);
  });

  it("WPIS BEZ `savedAt` NIE GINIE przy odsiewie (dostanie znacznik przy zapisie)", async () => {
    seedItems([
      { url: URL_A, title: "Bez znacznika" },
      { url: URL_B, title: "Wygasły", savedAt: NOW - 30 * DAY_MS },
    ]);
    h.settings = settingsWith({ allowGuests: true, guestExpirationDays: 14 });

    const { result } = mount();

    await waitFor(() => expect(result.current.isSaved).toBe(true));
    expect(storedItems().map((s) => s.url)).toEqual([URL_A]);
  });

  it("magazyn bez zmian po odsiewie NIE jest przepisywany", async () => {
    seedItems([{ url: URL_B, title: "Świeży", savedAt: NOW - DAY_MS }]);
    const writes: string[] = [];
    const base = h.storage!;
    h.storage = {
      ...base,
      getItem: (key: string) => base.getItem(key),
      setItem: (key: string, value: string) => {
        writes.push(key);
        base.setItem(key, value);
      },
    } as Storage;

    const { result } = mount();

    await waitFor(() => expect(result.current.isSaved).toBe(false));
    expect(writes).toEqual([]);
    expect(storedItems()).toHaveLength(1);
  });
});

describe("useSaveArticle - przełączanie w magazynie lokalnym", () => {
  it("dodaje wpis ze znacznikiem czasu i na POCZĄTKU listy", async () => {
    seedItems([{ url: URL_B, title: "Analiza B", savedAt: NOW - DAY_MS }]);
    const { result } = mount();
    await waitFor(() => expect(result.current.isSaved).toBe(false));

    act(() => result.current.toggle());

    expect(storedItems().map((s) => s.url)).toEqual([URL_A, URL_B]);
    expect(storedItems()[0].savedAt).toBe(NOW);
  });

  it("usuwa wpis przy drugim kliknięciu i potwierdza to użytkownikowi", async () => {
    seedItems([{ url: URL_A, title: "Analiza A", savedAt: NOW }]);
    const { result } = mount();
    await waitFor(() => expect(result.current.isSaved).toBe(true));

    act(() => result.current.toggle());

    expect(storedItems()).toEqual([]);
    expect(h.toastSuccess).toHaveBeenCalledTimes(1);
  });

  it("PRZESTEMPLOWUJE wpisy bez znacznika przy zapisie (od teraz się starzeją)", async () => {
    seedItems([{ url: URL_B, title: "Legacy bez znacznika" }]);
    const { result } = mount();
    await waitFor(() => expect(result.current.isSaved).toBe(false));

    act(() => result.current.toggle());

    const legacy = storedItems().find((s) => s.url === URL_B);
    expect(legacy?.savedAt).toBe(NOW);
    expect(storedItems()).toHaveLength(2);
  });

  it("LIMIT 200 wpisów: najstarsze wypadają, nowy jest pierwszy", async () => {
    seedItems(
      Array.from({ length: 200 }, (_, i) => ({
        url: `/post/stary-${i}`,
        title: `Stary ${i}`,
        savedAt: NOW - DAY_MS,
      })),
    );
    const { result } = mount();
    await waitFor(() => expect(result.current.isSaved).toBe(false));

    act(() => result.current.toggle());

    expect(storedItems()).toHaveLength(200);
    expect(storedItems()[0].url).toBe(URL_A);
  });

  it("ZABLOKOWANY MAGAZYN (tryb prywatny / wyczerpany limit) nie wywala przycisku", async () => {
    h.storage = memoryStorage({ blockWrites: true });
    const { result } = mount();
    await waitFor(() => expect(result.current.isSaved).toBe(false));

    expect(() => act(() => result.current.toggle())).not.toThrow();
    expect(storedItems()).toEqual([]);
  });

  it("DEFEKT (przypięty): przy zablokowanym magazynie przycisk OGŁASZA zapis, którego nie ma", async () => {
    // Znalezione TYM testem. `toggleLocal` owija zapis we własne `try/catch`,
    // ale `writeStoredValue` (lib/storageKeys) POCHŁANIA wyjątek sam - więc
    // `catch` w hooku jest martwy, a wykonanie leci dalej do
    // `setLocalSaved(true)` i `savedToast()`. Użytkownik w trybie prywatnym
    // widzi „Dodano do zapisanych", a po odświeżeniu strony artykułu nie ma.
    // Test przypina stan FAKTYCZNY; naprawa idzie osobnym commitem, zgodnie
    // z zasadą „nie zmieniaj zachowania przy ekstrakcji".
    h.storage = memoryStorage({ blockWrites: true });
    const { result } = mount();
    await waitFor(() => expect(result.current.isSaved).toBe(false));

    act(() => result.current.toggle());

    expect(result.current.isSaved).toBe(true);
    expect(storedItems()).toEqual([]);
  });

  it("BRAK adresu wpisu: przełącznik nic nie robi (nie zapisuje pustego wiersza)", async () => {
    const { result } = mount({ url: "" });
    await waitFor(() => expect(result.current.isSaved).toBe(false));

    act(() => result.current.toggle());

    expect(storedItems()).toEqual([]);
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("potwierdzenie zapisu ma akcję prowadzącą do listy czytelniczej", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.isSaved).toBe(false));

    act(() => result.current.toggle());

    const options = h.toastSuccess.mock.calls[0][1] as { action: { onClick: () => void } };
    act(() => options.action.onClick());
    expect(h.navigate).toHaveBeenCalledWith({ to: "/reading-list" });
  });
});

describe("useSaveArticle - wybór ścieżki zapisu", () => {
  it("ZALOGOWANY + personalizacja -> BAZA, magazyn lokalny nietknięty", async () => {
    h.user = { id: POST_IDS.user };
    const { result } = mount();

    act(() => result.current.toggle());

    expect(h.toggleMutate).toHaveBeenCalledTimes(1);
    expect(storedItems()).toEqual([]);
  });

  it("stan zapisany zalogowanego pochodzi z zakładek w bazie, nie z magazynu", async () => {
    h.user = { id: POST_IDS.user };
    h.bookmarks = [{ entity_type: "post", entity_id: POST_IDS.post }];
    seedItems([]);

    const { result } = mount();

    expect(result.current.isSaved).toBe(true);
    expect(storedItems()).toEqual([]);
  });

  it("zakładka na INNY byt nie zaznacza tego wpisu", async () => {
    h.user = { id: POST_IDS.user };
    h.bookmarks = [{ entity_type: "post", entity_id: POST_IDS.otherPost }];

    const { result } = mount();

    expect(result.current.isSaved).toBe(false);
    expect(h.toggleMutate).not.toHaveBeenCalled();
  });

  it("GOŚĆ BEZ `allowGuests` dostaje okno logowania i NIE zapisuje nigdzie", async () => {
    h.settings = settingsWith({ allowGuests: false });
    const { result } = mount();

    act(() => result.current.toggle());

    expect(h.openLoginPopup).toHaveBeenCalledTimes(1);
    expect(storedItems()).toEqual([]);
  });

  it("okno logowania niesie treść z ustawień panelu, nie tekst z komponentu", async () => {
    h.settings = settingsWith({
      allowGuests: false,
      restrictedTitle: "Tytuł z panelu",
      restrictedDescription: "Opis z panelu",
    });
    const { result } = mount();

    act(() => result.current.toggle());

    expect(h.openLoginPopup).toHaveBeenCalledWith({
      title: "Tytuł z panelu",
      description: "Opis z panelu",
    });
    expect(h.toggleMutate).not.toHaveBeenCalled();
  });

  it("PERSONALIZACJA WYŁĄCZONA: nawet zalogowany ląduje w magazynie lokalnym", async () => {
    h.user = { id: POST_IDS.user };
    h.settings = settingsWith({ enabled: false });
    const { result } = mount();
    await waitFor(() => expect(result.current.isSaved).toBe(false));

    act(() => result.current.toggle());

    expect(h.toggleMutate).not.toHaveBeenCalled();
    expect(storedItems().map((s) => s.url)).toEqual([URL_A]);
  });

  it("BRAK identyfikatora bytu: zalogowany też ląduje w magazynie lokalnym", async () => {
    h.user = { id: POST_IDS.user };
    const { result } = mount({ entityId: undefined });
    await waitFor(() => expect(result.current.isSaved).toBe(false));

    act(() => result.current.toggle());

    expect(h.toggleMutate).not.toHaveBeenCalled();
    expect(storedItems().map((s) => s.url)).toEqual([URL_A]);
  });
});

describe("useSaveArticle - komunikaty po zapisie w bazie", () => {
  it("sukces dodania pokazuje potwierdzenie z akcją do listy", async () => {
    h.user = { id: POST_IDS.user };
    const { result } = mount();

    act(() => result.current.toggle());
    const opts = h.toggleMutate.mock.calls[0][1] as { onSuccess: () => void };
    act(() => opts.onSuccess());

    expect(h.toastSuccess).toHaveBeenCalledTimes(1);
    expect(h.toggleMutate.mock.calls[0][0]).toMatchObject({ on: true, entityType: "post" });
  });

  it("sukces usunięcia pokazuje komunikat o usunięciu", async () => {
    h.user = { id: POST_IDS.user };
    h.bookmarks = [{ entity_type: "post", entity_id: POST_IDS.post }];
    const { result } = mount();

    act(() => result.current.toggle());
    const opts = h.toggleMutate.mock.calls[0][1] as { onSuccess: () => void };
    act(() => opts.onSuccess());

    expect(h.toggleMutate.mock.calls[0][0]).toMatchObject({ on: false });
    expect(h.toastSuccess).toHaveBeenCalledTimes(1);
  });

  it("WYŁĄCZONE powiadomienie w panelu WYCISZA potwierdzenie, ale zapis idzie", async () => {
    h.user = { id: POST_IDS.user };
    h.settings = settingsWith({ popupNotification: false });
    const { result } = mount();

    act(() => result.current.toggle());
    const opts = h.toggleMutate.mock.calls[0][1] as { onSuccess: () => void };
    act(() => opts.onSuccess());

    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(h.toggleMutate).toHaveBeenCalledTimes(1);
  });

  it("BŁĄD ZAPISU W BAZIE pokazuje komunikat błędu, nie sukces", async () => {
    h.user = { id: POST_IDS.user };
    const { result } = mount();

    act(() => result.current.toggle());
    const opts = h.toggleMutate.mock.calls[0][1] as { onError: () => void };
    act(() => opts.onError());

    expect(h.toastError).toHaveBeenCalledTimes(1);
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("wariant angielski używa angielskich komunikatów", async () => {
    h.user = { id: POST_IDS.user };
    const { result } = mount({ lang: "en" });

    act(() => result.current.toggle());
    const opts = h.toggleMutate.mock.calls[0][1] as { onError: () => void };
    act(() => opts.onError());

    expect(h.toastError).toHaveBeenCalledWith("Could not save");
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });
});
