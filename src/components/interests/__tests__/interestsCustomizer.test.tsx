// Personalizacja zainteresowań (/profile/interests i widget „Dostosuj tematy").
//
// CO TEN PLIK DOWODZI. `InterestsCustomizer.tsx` stał na 58% linii. Jest
// ekranem, na którym użytkownik zarządza tym, co silnik rekomendacji o nim wie.
// Cztery reguły, których złamanie widzi użytkownik:
//
//   1. WYBÓR JEST LOKALNY DO KLIKNIĘCIA „ZAPISZ". Autozapis przy każdym
//      kliknięciu zamieniłby przeglądanie listy w serię zapisów do bazy.
//   2. GOŚĆ WIDZI, ŻE JEGO WYBÓR NIE JEST TRWAŁY. Bez tej informacji wybór
//      zniknie razem z magazynem przeglądarki i nikt nie wie dlaczego.
//   3. POTWIERDZENIE ZAPISU GAŚNIE, ALE BŁĄD ZOSTAJE. Znacznik „zapisano"
//      wiszący po nieudanym zapisie mówi nieprawdę o stanie konta.
//   4. KLIKNIĘCIE PO ZAPISIE KASUJE POTWIERDZENIE. Inaczej „zapisano" wisi nad
//      wyborem, który właśnie przestał być zapisany.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - WARSTWY DANYCH: różnica zapisu, magazyn gościa i unieważnienia mają tabelę
//   przypadków w `src/hooks/__tests__/useInterests.test.tsx`.
// - GRUPOWANIA KATALOGU: `topicsDroplist.test.tsx` (ten ekran pokazuje płaskie
//   sekcje „kategorie" i „tagi", bez hierarchii obszarów).
// - SCALANIA GOŚĆ → ZALOGOWANY: `lib/personalization/anonMerge.ts`, moduł 19.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { InterestItem } from "@/hooks/useInterests";

const h = vi.hoisted(() => ({
  catalog: { categories: [] as InterestItem[], tags: [] as InterestItem[] } as
    { categories: InterestItem[]; tags: InterestItem[] } | undefined,
  catalogLoading: false,
  myData: { categoryIds: [] as string[], tagIds: [] as string[] } as
    { categoryIds: string[]; tagIds: string[] } | undefined,
  myLoading: false,
  isAnonymous: false,
  saveResult: { ok: true } as { ok: boolean; error?: string },
  saveGate: null as Promise<void> | null,
  saved: [] as { categoryIds: string[]; tagIds: string[] }[],
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-interests", () => ({ ensureI18n: () => undefined }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children?: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));
// Tożsamość obiektów MUSI być stabilna: komponent ma `useEffect(..., [my.data])`,
// który wywołuje `setSelectedCats(new Set(...))`. Świeży literał na każdy render
// zapętla ten efekt i plik testowy wisi do timeoutu bez żadnego komunikatu.
vi.mock("@/hooks/useInterests", () => {
  const catalogQuery = {
    get data() {
      return h.catalog;
    },
    get isLoading() {
      return h.catalogLoading;
    },
  };
  const my = {
    get data() {
      return h.myData;
    },
    get isLoading() {
      return h.myLoading;
    },
    get isAnonymous() {
      return h.isAnonymous;
    },
    save: async (next: { categoryIds: string[]; tagIds: string[] }) => {
      h.saved.push(next);
      if (h.saveGate !== null) await h.saveGate;
      return h.saveResult;
    },
  };
  return { useInterestCatalog: () => catalogQuery, useMyInterests: () => my };
});

import { InterestsCustomizer } from "@/components/interests/InterestsCustomizer";
import { axeViolations, summarize } from "@/test/axe";

function item(id: string, type: "category" | "tag", label = id): InterestItem {
  return { id, type, label, slug: id, parentId: null, parentLabel: null, parentSlug: null };
}

const saveButton = () => screen.getByText("interests.save").closest("button")!;
const chip = (label: string) => screen.getByRole("button", { name: new RegExp(label) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  h.catalog = {
    categories: [item("c1", "category", "Afryka"), item("c2", "category", "Azja")],
    tags: [item("t1", "tag", "Handel")],
  };
  h.catalogLoading = false;
  h.myData = { categoryIds: [], tagIds: [] };
  h.myLoading = false;
  h.isAnonymous = false;
  h.saveResult = { ok: true };
  h.saveGate = null;
  h.saved = [];
});

afterEach(() => cleanup());

describe("stany wczytywania i pustki", () => {
  it("wczytywanie KATALOGU pokazuje wskaźnik zamiast pustych sekcji", () => {
    // Puste sekcje w trakcie odczytu mówią „nie ma tematów", a nie „czekaj".
    h.catalogLoading = true;
    render(<InterestsCustomizer />);
    expect(screen.getByText("interests.loading")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Afryka/ })).toBeNull();
  });

  it("wczytywanie MOICH WYBORÓW też wstrzymuje listę", () => {
    h.myLoading = true;
    render(<InterestsCustomizer />);
    expect(screen.getByText("interests.loading")).toBeTruthy();
  });

  it("PUSTY katalog pokazuje zdanie o braku w KAŻDEJ sekcji", () => {
    h.catalog = { categories: [], tags: [] };
    render(<InterestsCustomizer />);
    expect(screen.getAllByText("interests.empty")).toHaveLength(2);
  });

  it("brak danych katalogu (undefined) nie wywala renderu", () => {
    h.catalog = undefined;
    render(<InterestsCustomizer />);
    expect(screen.getAllByText("interests.empty")).toHaveLength(2);
  });

  it("obie sekcje mają nagłówki - kategorie i tagi to różne rzeczy", () => {
    render(<InterestsCustomizer />);
    expect(screen.getByText("interests.sectionCategories")).toBeTruthy();
    expect(screen.getByText("interests.sectionTags")).toBeTruthy();
  });
});

describe("gość", () => {
  it("widzi informację, że wybór nie jest trwały, i drogę do logowania", () => {
    h.isAnonymous = true;
    render(<InterestsCustomizer />);
    expect(screen.getByText("interests.loginRequired")).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("href")).toBe("/login");
  });

  it("zalogowany NIE widzi tej informacji", () => {
    h.isAnonymous = false;
    render(<InterestsCustomizer />);
    expect(screen.queryByText("interests.loginRequired")).toBeNull();
  });

  it("gość może wybierać i zapisywać - magazyn lokalny to też zapis", () => {
    h.isAnonymous = true;
    render(<InterestsCustomizer />);
    fireEvent.click(chip("Afryka"));
    fireEvent.click(saveButton());
    expect(h.saved).toEqual([{ categoryIds: ["c1"], tagIds: [] }]);
  });
});

describe("wybór", () => {
  it("hydruje się z zapisanych preferencji", async () => {
    h.myData = { categoryIds: ["c1"], tagIds: ["t1"] };
    render(<InterestsCustomizer />);
    await waitFor(() => expect(chip("Afryka").getAttribute("aria-pressed")).toBe("true"));
    expect(chip("Handel").getAttribute("aria-pressed")).toBe("true");
    expect(chip("Azja").getAttribute("aria-pressed")).toBe("false");
  });

  it("kliknięcie zaznacza, drugie odznacza", () => {
    render(<InterestsCustomizer />);
    fireEvent.click(chip("Afryka"));
    expect(chip("Afryka").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(chip("Afryka"));
    expect(chip("Afryka").getAttribute("aria-pressed")).toBe("false");
  });

  it("kliknięcie NIE zapisuje - zapis idzie wyłącznie przyciskiem", () => {
    // Autozapis zamieniłby przeglądanie listy w serię zapisów do bazy.
    render(<InterestsCustomizer />);
    fireEvent.click(chip("Afryka"));
    fireEvent.click(chip("Handel"));
    expect(h.saved).toEqual([]);
  });

  it("licznik wybranych sumuje kategorie i tagi", () => {
    render(<InterestsCustomizer />);
    expect(screen.getByText("interests.selectedCount(count=0)")).toBeTruthy();
    fireEvent.click(chip("Afryka"));
    fireEvent.click(chip("Handel"));
    expect(screen.getByText("interests.selectedCount(count=2)")).toBeTruthy();
  });

  it("kategoria i tag jadą do OSOBNYCH zbiorów - `user_follows` je rozróżnia", () => {
    render(<InterestsCustomizer />);
    fireEvent.click(chip("Afryka"));
    fireEvent.click(chip("Handel"));
    fireEvent.click(saveButton());
    expect(h.saved).toEqual([{ categoryIds: ["c1"], tagIds: ["t1"] }]);
  });
});

describe("zapis", () => {
  it("udany zapis pokazuje potwierdzenie", async () => {
    render(<InterestsCustomizer />);
    fireEvent.click(chip("Afryka"));
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByText("interests.saved")).toBeTruthy());
  });

  it("potwierdzenie GAŚNIE samo po dwóch sekundach", async () => {
    // Zegar sterowany, nie `setTimeout` w teście - inaczej test byłby wolny
    // i niedeterministyczny.
    vi.useFakeTimers();
    render(<InterestsCustomizer />);
    fireEvent.click(chip("Afryka"));
    fireEvent.click(saveButton());
    await vi.waitFor(() => expect(screen.getByText("interests.saved")).toBeTruthy());
    // `act` wokół przesunięcia zegara: `setSaveState` z callbacku `setTimeout`
    // biegnie poza cyklem Reacta, więc bez tego asercja ściga się z renderem.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.queryByText("interests.saved")).toBeNull();
    vi.useRealTimers();
  });

  it("KLIKNIĘCIE PO ZAPISIE kasuje potwierdzenie", async () => {
    // Napis „zapisano" wiszący nad wyborem, który właśnie przestał być zapisany,
    // mówi nieprawdę o stanie konta.
    render(<InterestsCustomizer />);
    fireEvent.click(chip("Afryka"));
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByText("interests.saved")).toBeTruthy());
    fireEvent.click(chip("Azja"));
    expect(screen.queryByText("interests.saved")).toBeNull();
  });

  it("BŁĄD zapisu pokazuje komunikat i NIE pokazuje potwierdzenia", async () => {
    h.saveResult = { ok: false, error: "odmowa polityki" };
    render(<InterestsCustomizer />);
    fireEvent.click(chip("Afryka"));
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByText("odmowa polityki")).toBeTruthy());
    expect(screen.queryByText("interests.saved")).toBeNull();
  });

  it("błąd bez komunikatu nie renderuje pustej ramki błędu", async () => {
    h.saveResult = { ok: false };
    render(<InterestsCustomizer />);
    fireEvent.click(chip("Afryka"));
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.saved).toHaveLength(1));
    expect(screen.queryByText("interests.saved")).toBeNull();
  });

  it("BŁĄD ZOSTAJE na ekranie, w odróżnieniu od potwierdzenia", async () => {
    vi.useFakeTimers();
    h.saveResult = { ok: false, error: "odmowa" };
    render(<InterestsCustomizer />);
    fireEvent.click(chip("Afryka"));
    fireEvent.click(saveButton());
    await vi.waitFor(() => expect(screen.getByText("odmowa")).toBeTruthy());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByText("odmowa")).toBeTruthy();
    vi.useRealTimers();
  });

  it("zapis w locie blokuje przycisk", async () => {
    let release: () => void = () => undefined;
    h.saveGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    render(<InterestsCustomizer />);
    fireEvent.click(chip("Afryka"));
    fireEvent.click(saveButton());
    await waitFor(() => expect(saveButton().disabled).toBe(true));
    release();
    await waitFor(() => expect(saveButton().disabled).toBe(false));
  });

  it("przycisk jest zablokowany w trakcie wczytywania - nie ma czego zapisać", () => {
    h.catalogLoading = true;
    render(<InterestsCustomizer />);
    expect(saveButton().disabled).toBe(true);
  });
});

describe("warianty i dostępność", () => {
  it("wariant zwarty ma węższy odstęp - to samo, mniej miejsca", () => {
    const { container } = render(<InterestsCustomizer variant="compact" />);
    expect(container.querySelector("section")?.className).toContain("p-4");
  });

  it("wariant pełny jest domyślny", () => {
    const { container } = render(<InterestsCustomizer />);
    expect(container.querySelector("section")?.className).toContain("p-6");
  });

  it("nagłówek można ukryć - widget w builderze ma własny", () => {
    render(<InterestsCustomizer showHeader={false} />);
    expect(screen.queryByText("interests.title")).toBeNull();
    // Sekcja nadal ma nazwę dla czytnika (aria-labelledby zostaje).
    expect(document.querySelector("section")?.getAttribute("aria-labelledby")).toBe(
      "interests-heading",
    );
  });

  it("dodatkowa klasa z konfiguracji widgetu dociera do DOM", () => {
    const { container } = render(<InterestsCustomizer className="mt-10" />);
    expect(container.querySelector("section")?.className).toContain("mt-10");
  });

  it("nie ma naruszeń dostępności z nagłówkiem", async () => {
    h.myData = { categoryIds: ["c1"], tagIds: [] };
    const { container } = render(<InterestsCustomizer />);
    await waitFor(() => expect(chip("Afryka").getAttribute("aria-pressed")).toBe("true"));
    expect(await axeViolations(container).then(summarize)).toBe("");
  });
});
