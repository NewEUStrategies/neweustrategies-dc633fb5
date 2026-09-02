// Trasa `/admin/link-monitor` - monitor martwych linków wychodzących.
// 0/33 linii, 0/7 funkcji.
//
// PO CO. Ten panel nie jest raportem do czytania, jest LISTĄ ROBOCZĄ: dla
// każdego martwego przypisu ma podać gotową zamianę na migawkę Internet
// Archive. Wartość panelu leży więc w czterech regułach, których złamania nie
// widać ani w typach, ani na ekranie z przykładowymi danymi:
//
//   1. „ZEPSUTE" TO FILTR, NIE NAGŁÓWEK. Zapytanie MUSI mieć `.eq("ok", false)`.
//      Bez tego ogniwa tabela pokazuje wszystkie sprawdzone linki - w większości
//      działające - a tytuł „monitor zepsutych linków" zaczyna kłamać. Pusty
//      panel przy zdrowej witrynie jest POPRAWNYM wynikiem i test musi to
//      rozróżniać od „zapytanie nie filtruje".
//   2. PRÓG ALERTU JEST WSPÓLNY Z POWIADOMIENIEM. Skaner wysyła maila/push od
//      `BROKEN_LINK_ALERT_THRESHOLD` zepsutych linków. Gdyby panel liczył swój
//      własny próg, redakcja dostawałaby powiadomienie o stanie, którego panel
//      nie potwierdza (albo odwrotnie). Dlatego asercje idą po IMPORTOWANEJ
//      stałej, nie po wpisanej w test dziesiątce - zmiana polityki ma
//      przestawić oba miejsca naraz albo oblać ten test.
//   3. ZAWSZE JEST CO PODAĆ. Sugestia zamiany ma dwa źródła: konkretną migawkę
//      znalezioną przez skaner (`archive_url`) oraz uniwersalny adres „znajdź
//      najbliższą" (`waybackSearchUrl`). Wiersz BEZ migawki nie może zostać
//      bez linku - inaczej redaktor wraca do ręcznego wklejania adresów do
//      Wayback Machine, czyli do stanu przed tym panelem.
//   4. STATUS MA TRZY ŹRÓDŁA. `status_code`, a gdy go nie ma - `error`
//      (timeout, DNS, certyfikat), a gdy i tego nie ma - kreska. Wiersz z samym
//      błędem sieciowym pokazany jako pusta komórka jest nieodróżnialny od
//      wiersza niesprawdzonego.
//
// GRANICE. Atrapowane są: powłoka panelu (`AdminShell` - własny test),
// `supabase` (atrapa łańcucha PostgREST z `@/test/supabaseChain`), serwerowa
// funkcja skanu, schowek i toasty. PRAWDZIWE biegną: `validateSearch` i sklejenie
// trasy (harness), `useQuery`/`useQueryClient`, oraz - co najważniejsze -
// `waybackSearchUrl` i `waybackTimestampToIso` z `lib/content/brokenLinkPolicy`
// wraz ze stałą progu. Atrapa w tym miejscu zamieniłaby test w sprawdzanie
// własnych napisów.
//
// CZEGO TEN TEST NIE DOWODZI I DLACZEGO NIE MOŻE. Izolacji najemcy. Zapytanie
// panelu ŚWIADOMIE nie ma `.eq("tenant_id", …)`: tabela `outbound_link_checks`
// stoi pod RLS `tenant_id = public.current_tenant_id() AND public.is_staff()`
// (migracja 20260720135000), więc filtr najemcy i warunek roli sztabowej są
// wymuszone w bazie, a nie w kliencie - i tam też są testowane
// (`check:tenant-isolation`). Powtarzanie ich w atrapie klienta dowodziłoby
// jedynie tego, co sama atrapa zwraca. Klucz cache'u `["admin","broken-links"]`
// jest z tego samego powodu bezpieczny bez identyfikatora najemcy: wylogowanie
// woła `queryClient.clear()` i twardą nawigację (`src/hooks/useAuth.tsx`), więc
// cache nie przeżywa zmiany tożsamości.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";

interface CheckRow {
  id: string;
  url: string;
  status_code: number | null;
  error: string | null;
  checked_at: string;
  archive_url: string | null;
  archive_timestamp: string | null;
  posts: { slug: string; title_pl: string; title_en: string } | null;
}

interface ScanResult {
  postsScanned: number;
  linksChecked: number;
  broken: number;
  archived: number;
}

const h = vi.hoisted(() => ({
  rows: [] as unknown[],
  queryError: null as Error | null,
  scanResult: null as unknown,
  scanError: null as Error | null,
  scanCalls: [] as unknown[],
  /** Rozwiązanie skanu wstrzymane, dopóki test go nie zwolni. */
  scanGate: null as null | (() => void),
  clipboard: [] as string[],
  clipboardFails: false,
  toastSuccess: [] as unknown[][],
  toastError: [] as unknown[][],
  lang: "pl",
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => void h.toastSuccess.push(a),
    error: (...a: unknown[]) => void h.toastError.push(a),
  },
}));
vi.mock("@/components/admin/AdminShell", () => ({
  // Atrapa MUSI renderować dzieci: cała treść trasy siedzi w powłoce.
  AdminShell: ({ children }: { children?: ReactNode }) => (
    <div data-testid="AdminShell">{children}</div>
  ),
}));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => async (payload: unknown) => {
    h.scanCalls.push(payload);
    if (h.scanGate) await new Promise<void>((resolve) => (h.scanGate = resolve));
    if (h.scanError) throw h.scanError;
    return h.scanResult;
  },
}));

// Atrapa łańcucha PostgREST zapisuje KOLEJNOŚĆ ogniw, więc test może dowieść
// `.eq("ok", false)`, `.order(...)` i `.limit(200)`, a nie tylko danych.
const db = vi.hoisted(() => ({ stub: null as null | { from: (t: string) => unknown } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (!db.stub) throw new Error("test: atrapa bazy nieustawiona");
      return db.stub.from(table);
    },
  },
}));

import { supabaseFromStub, fail, ok, type SupabaseFromStub } from "@/test/supabaseChain";
import { renderRoute } from "@/test/routeHarness";
import {
  BROKEN_LINK_ALERT_THRESHOLD,
  waybackSearchUrl,
  waybackTimestampToIso,
} from "@/lib/content/brokenLinkPolicy";
import { Route as LinkMonitorRoute } from "@/routes/admin.link-monitor";

const PATH = "/admin/link-monitor";
const TABLE = "outbound_link_checks";
const QUERY_KEY = ["admin", "broken-links"] as const;

let chains: SupabaseFromStub;

function row(patch: Partial<CheckRow> = {}): CheckRow {
  return {
    id: "row-1",
    url: "https://ec.europa.eu/martwy-raport.pdf",
    status_code: 404,
    error: null,
    checked_at: "2026-08-30T09:15:00.000Z",
    archive_url: null,
    archive_timestamp: null,
    posts: { slug: "fundusze-2026", title_pl: "Fundusze 2026", title_en: "Funds 2026" },
    ...patch,
  };
}

/** N wierszy o odrębnych identyfikatorach - do asercji progowych. */
function rows(count: number): CheckRow[] {
  return Array.from({ length: count }, (_, i) =>
    row({ id: `row-${i}`, url: `https://example.org/${i}` }),
  );
}

const scan = (patch: Partial<ScanResult> = {}): ScanResult => ({
  postsScanned: 10,
  linksChecked: 42,
  broken: 3,
  archived: 2,
  ...patch,
});

async function mount() {
  const view = await renderRoute({
    route: LinkMonitorRoute,
    path: PATH,
    initialEntry: PATH,
  });
  // CZEKAMY NA STAN CACHE'U, NIE NA LICZBĘ MIKROTASKÓW. React Query odkłada
  // wynik przez własny `notifyManager`, więc „dwa razy `await Promise.resolve()`"
  // daje test, który mierzy PIERWSZĄ KLATKĘ - czyli pustą tabelę - i przechodzi
  // tak samo, gdy zapytanie w ogóle nie zwróciło danych.
  await waitFor(() => {
    const state = view.queryClient.getQueryState(QUERY_KEY);
    expect(state?.fetchStatus).toBe("idle");
    expect(state?.status).not.toBe("pending");
  });
  return view;
}

/** Wiersze `<tbody>` z pominięciem wiersza komunikatu pustki. */
function dataRows(): HTMLElement[] {
  return screen
    .getAllByRole("row")
    .filter((tr) => within(tr).queryAllByRole("cell").length === 5)
    .filter((tr) => within(tr).queryAllByRole("link").length > 0);
}

beforeEach(() => {
  cleanup();
  h.rows = [];
  h.queryError = null;
  h.scanResult = scan();
  h.scanError = null;
  h.scanCalls = [];
  h.scanGate = null;
  h.clipboard = [];
  h.clipboardFails = false;
  h.toastSuccess = [];
  h.toastError = [];
  h.lang = "pl";
  chains = supabaseFromStub();
  chains.setResponse(TABLE, () => (h.queryError ? fail(h.queryError.message) : ok(h.rows)));
  db.stub = chains;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (text: string) => {
        if (h.clipboardFails) throw new Error("odmowa uprawnienia do schowka");
        h.clipboard.push(text);
      },
    },
  });
});

// ---------------------------------------------------------------------------
describe("kontrakt zapytania", () => {
  it('czyta WYŁĄCZNIE zepsute linki - `.eq("ok", false)` jest filtrem, nie ozdobą', async () => {
    h.rows = [row()];
    await mount();

    const chain = chains.lastChain(TABLE);
    expect(chain).toBeDefined();
    expect(chain?.argsOf("eq")).toEqual(["ok", false]);
  });

  it("sortuje od NAJNOWSZEGO sprawdzenia i ogranicza wynik do 200 wierszy", async () => {
    h.rows = [row()];
    await mount();

    const chain = chains.lastChain(TABLE);
    expect(chain?.argsOf("order")).toEqual(["checked_at", { ascending: false }]);
    expect(chain?.argsOf("limit")).toEqual([200]);
  });

  it("pobiera kolumny migawki i DOŁĄCZA wpis - bez nich nie ma ani sugestii, ani linku do wpisu", async () => {
    h.rows = [row()];
    await mount();

    const selected = String(chains.lastChain(TABLE)?.argsOf("select")?.[0] ?? "");
    for (const column of ["archive_url", "archive_timestamp", "posts(slug, title_pl, title_en)"]) {
      expect(selected).toContain(column);
    }
  });

  it("PostgREST bez błędu, ale z `data: null` daje pustą listę, a nie wywrotkę na `.map`", async () => {
    // Realny kształt odpowiedzi, nie hipotetyczny: `select()` bez trafień
    // potrafi oddać `data: null, error: null`. Bez `?? []` render leci na
    // `null.map` i panel gaśnie zamiast pokazać „brak zepsutych linków".
    chains.setResponse(TABLE, () => ok(null));
    await mount();

    expect(screen.getByText("admin.linkMonitor.empty")).toBeTruthy();
    expect(dataRows()).toHaveLength(0);
  });

  it("błąd odczytu NIE wywraca panelu - nagłówek i przycisk skanu zostają", async () => {
    h.queryError = new Error("RLS: odmowa");
    await mount();

    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
      "admin.linkMonitor.title",
    );
    expect(screen.getByText("admin.linkMonitor.empty")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe("próg alertu jest wspólny ze skanerem", () => {
  it("JEDEN pod progiem NIE pokazuje alertu", async () => {
    h.rows = rows(BROKEN_LINK_ALERT_THRESHOLD - 1);
    await mount();

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("DOKŁADNIE na progu alert JEST - panel i powiadomienie mówią to samo", async () => {
    h.rows = rows(BROKEN_LINK_ALERT_THRESHOLD);
    await mount();

    const alert = screen.getByRole("alert");
    expect(
      within(alert).getByText(
        `admin.linkMonitor.alertTitle(count=${BROKEN_LINK_ALERT_THRESHOLD},threshold=${BROKEN_LINK_ALERT_THRESHOLD})`,
      ),
    ).toBeTruthy();
    expect(within(alert).getByText("admin.linkMonitor.alertBody")).toBeTruthy();
  });

  it("alert podaje LICZBĘ zepsutych linków, a nie sam próg", async () => {
    h.rows = rows(BROKEN_LINK_ALERT_THRESHOLD + 7);
    await mount();

    expect(
      within(screen.getByRole("alert")).getByText(
        `admin.linkMonitor.alertTitle(count=${BROKEN_LINK_ALERT_THRESHOLD + 7},threshold=${BROKEN_LINK_ALERT_THRESHOLD})`,
      ),
    ).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe("pustka jest komunikatem, nie brakiem tabeli", () => {
  it("zero zepsutych linków daje jawny komunikat rozciągnięty na wszystkie kolumny", async () => {
    await mount();

    const cell = screen.getByText("admin.linkMonitor.empty").closest("td");
    expect(cell?.getAttribute("colspan")).toBe("5");
    expect(dataRows()).toHaveLength(0);
  });

  it("nagłówki wszystkich pięciu kolumn idą ze SŁOWNIKA", async () => {
    await mount();

    for (const key of ["colUrl", "colStatus", "colSuggestion", "colPost", "colChecked"]) {
      expect(screen.getByText(`admin.linkMonitor.${key}`)).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
describe("sugestia zamiany - zawsze jest co podać", () => {
  it("KONKRETNA migawka ze znacznikiem czasu pokazuje DATĘ i linkuje w archiwum", async () => {
    h.rows = [
      row({
        archive_url: "https://web.archive.org/web/20250104120000/https://ec.europa.eu/raport.pdf",
        archive_timestamp: "20250104120000",
      }),
    ];
    await mount();

    const iso = waybackTimestampToIso("20250104120000");
    expect(iso).not.toBeNull();
    const expected = new Date(iso as string).toLocaleDateString("pl-PL");
    const link = screen.getByRole("link", { name: expected });
    expect(link.getAttribute("href")).toBe(
      "https://web.archive.org/web/20250104120000/https://ec.europa.eu/raport.pdf",
    );
  });

  it("ta sama migawka po angielsku ma datę w formacie en-GB, nie polskim", async () => {
    h.lang = "en";
    h.rows = [
      row({
        archive_url: "https://web.archive.org/web/20250104120000/https://ec.europa.eu/raport.pdf",
        archive_timestamp: "20250104120000",
      }),
    ];
    await mount();

    const iso = waybackTimestampToIso("20250104120000") as string;
    const enLabel = new Date(iso).toLocaleDateString("en-GB");
    expect(screen.getByRole("link", { name: enLabel })).toBeTruthy();
    // Formaty są RÓŻNE, więc test wykryłby zignorowanie języka.
    expect(enLabel).not.toBe(new Date(iso).toLocaleDateString("pl-PL"));
  });

  it("migawka BEZ poprawnego znacznika czasu ma podpis zastępczy, a nie „Invalid Date”", async () => {
    h.rows = [
      row({
        archive_url: "https://web.archive.org/web/2/https://x.example",
        archive_timestamp: "8",
      }),
    ];
    await mount();

    expect(screen.getByText("admin.linkMonitor.archiveSnapshot")).toBeTruthy();
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
  });

  it("BRAK migawki daje adres „znajdź najbliższą” - wiersz nigdy nie zostaje bez linku", async () => {
    const url = "https://ec.europa.eu/martwy-raport.pdf";
    h.rows = [row({ url, archive_url: null })];
    await mount();

    const link = screen.getByRole("link", { name: "admin.linkMonitor.archiveSearch" });
    expect(link.getAttribute("href")).toBe(waybackSearchUrl(url));
  });

  it("pusty napis w `archive_url` jest traktowany jak BRAK migawki, nie jak link do niczego", async () => {
    h.rows = [row({ archive_url: "", archive_timestamp: "20250104120000" })];
    await mount();

    const link = screen.getByRole("link", { name: "admin.linkMonitor.archiveSearch" });
    expect(link.getAttribute("href")).toBe(
      waybackSearchUrl("https://ec.europa.eu/martwy-raport.pdf"),
    );
  });
});

// ---------------------------------------------------------------------------
describe("kopiowanie sugestii", () => {
  it("kopiuje adres MIGAWKI, a nie martwy adres oryginalny", async () => {
    const archive = "https://web.archive.org/web/20250104120000/https://ec.europa.eu/raport.pdf";
    h.rows = [row({ archive_url: archive, archive_timestamp: "20250104120000" })];
    await mount();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "admin.linkMonitor.archiveCopy" }));
    });

    expect(h.clipboard).toEqual([archive]);
    expect(h.clipboard[0]).not.toBe("https://ec.europa.eu/martwy-raport.pdf");
    expect(h.toastSuccess).toEqual([["admin.linkMonitor.archiveCopied"]]);
  });

  it("bez migawki kopiuje adres wyszukiwania - przycisk nigdy nie kopiuje pustki", async () => {
    h.rows = [row({ archive_url: null })];
    await mount();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "admin.linkMonitor.archiveCopy" }));
    });

    expect(h.clipboard).toEqual([waybackSearchUrl("https://ec.europa.eu/martwy-raport.pdf")]);
  });

  it("ODMOWA schowka daje komunikat błędu, a nie nieobsłużony wyjątek", async () => {
    h.clipboardFails = true;
    h.rows = [row()];
    await mount();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "admin.linkMonitor.archiveCopy" }));
    });

    expect(h.toastError).toEqual([["admin.linkMonitor.archiveCopyFailed"]]);
    expect(h.toastSuccess).toEqual([]);
  });

  it("przycisk kopiowania ma DOSTĘPNĄ NAZWĘ - sama ikona nie jest nazwą", async () => {
    h.rows = [row()];
    await mount();

    const button = screen.getByRole("button", { name: "admin.linkMonitor.archiveCopy" });
    expect(button.getAttribute("aria-label")).toBe("admin.linkMonitor.archiveCopy");
    expect(button.getAttribute("type")).toBe("button");
  });
});

// ---------------------------------------------------------------------------
describe("kolumna statusu ma trzy źródła", () => {
  it("kod HTTP wygrywa, gdy jest", async () => {
    h.rows = [row({ status_code: 410, error: "gone" })];
    await mount();

    expect(within(dataRows()[0]).getByText("410")).toBeTruthy();
  });

  it("bez kodu pokazuje BŁĄD SIECIOWY, nie pustą komórkę", async () => {
    h.rows = [row({ status_code: null, error: "ENOTFOUND" })];
    await mount();

    expect(within(dataRows()[0]).getByText("ENOTFOUND")).toBeTruthy();
  });

  it("bez kodu i bez błędu pokazuje KRESKĘ - i to dywiz, nie pauza", async () => {
    h.rows = [row({ status_code: null, error: null })];
    await mount();

    const cells = within(dataRows()[0]).getAllByRole("cell");
    expect(cells[1].textContent?.trim()).toBe("-");
    expect(cells[1].textContent).not.toContain("—");
  });
});

// ---------------------------------------------------------------------------
describe("kolumna wpisu", () => {
  it("linkuje do edycji wpisu po jego slugu", async () => {
    h.rows = [row()];
    await mount();

    const link = screen.getByRole("link", { name: "Fundusze 2026" });
    expect(link.getAttribute("href")).toBe("/admin/posts/fundusze-2026");
  });

  it("po angielsku bierze tytuł EN, a gdy go nie ma - WRACA do polskiego", async () => {
    h.lang = "en";
    h.rows = [
      row({ id: "a", posts: { slug: "a", title_pl: "Polski A", title_en: "English A" } }),
      row({ id: "b", posts: { slug: "b", title_pl: "Polski B", title_en: "" } }),
    ];
    await mount();

    expect(screen.getByRole("link", { name: "English A" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Polski B" })).toBeTruthy();
  });

  it("wpis bez żadnego tytułu jest identyfikowany SLUGIEM, a nie pustym linkiem", async () => {
    h.rows = [row({ posts: { slug: "bez-tytulu", title_pl: "", title_en: "" } })];
    await mount();

    expect(screen.getByRole("link", { name: "bez-tytulu" })).toBeTruthy();
  });

  it("osierocony wiersz (bez wpisu) pokazuje kreskę, a nie wywraca renderu", async () => {
    h.rows = [row({ posts: null })];
    await mount();

    const cells = within(dataRows()[0]).getAllByRole("cell");
    expect(cells[3].textContent?.trim()).toBe("-");
  });
});

// ---------------------------------------------------------------------------
// Link do MARTWEGO albo PRZEJĘTEGO adresu jest linkiem do zasobu, którego
// redakcja nie kontroluje - `nofollow` odcina przekazywanie autorytetu,
// `noopener`/`noreferrer` odcinają dostęp do `window.opener`.
describe("linki wychodzące są izolowane", () => {
  it("każdy link zewnętrzny ma noopener, noreferrer i nofollow", async () => {
    h.rows = [row({ archive_url: "https://web.archive.org/web/2/x", archive_timestamp: null })];
    await mount();

    const external = screen
      .getAllByRole("link")
      .filter((a) => (a.getAttribute("href") ?? "").startsWith("http"));
    expect(external.length).toBeGreaterThanOrEqual(2);
    for (const link of external) {
      const rel = link.getAttribute("rel") ?? "";
      expect(rel).toContain("noopener");
      expect(rel).toContain("noreferrer");
      expect(rel).toContain("nofollow");
      expect(link.getAttribute("target")).toBe("_blank");
    }
  });

  it("link do martwego adresu nosi go w `title` - kolumna jest ucięta wizualnie", async () => {
    const url = `https://example.org/${"a".repeat(200)}`;
    h.rows = [row({ url })];
    await mount();

    expect(screen.getByTitle(url).getAttribute("href")).toBe(url);
  });
});

// ---------------------------------------------------------------------------
describe("skan na żądanie", () => {
  it("prosi o skan DZIESIĘCIU wpisów i podaje cztery liczniki w komunikacie", async () => {
    h.scanResult = scan({ postsScanned: 10, linksChecked: 42, broken: 3, archived: 2 });
    await mount();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /admin\.linkMonitor\.scanNow/ }));
    });

    expect(h.scanCalls).toEqual([{ data: { posts: 10 } }]);
    expect(h.toastSuccess).toEqual([
      ["admin.linkMonitor.scanDone(archived=2,broken=3,links=42,posts=10)"],
    ]);
  });

  it("po skanie UNIEWAŻNIA cache, więc tabela pokazuje nowy wynik, a nie stary", async () => {
    h.rows = [];
    const view = await mount();
    const invalidate = vi.spyOn(view.queryClient, "invalidateQueries");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /admin\.linkMonitor\.scanNow/ }));
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: QUERY_KEY });
  });

  it("w trakcie skanu przycisk jest ZABLOKOWANY - drugie kliknięcie nie odpala drugiego skanu", async () => {
    // Bramka trzyma serwerową funkcję nierozwiązaną, więc test widzi stan
    // pośredni, a nie tylko wynik.
    h.scanGate = () => {};
    await mount();

    const button = screen.getByRole("button", { name: /admin\.linkMonitor\.scanNow/ });
    await act(async () => {
      fireEvent.click(button);
    });

    expect((button as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      fireEvent.click(button);
    });
    expect(h.scanCalls).toHaveLength(1);

    const release = h.scanGate as unknown as () => void;
    await act(async () => {
      release();
      await Promise.resolve();
    });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("BŁĄD skanu daje komunikat z treścią wyjątku i ODBLOKOWUJE przycisk", async () => {
    h.scanError = new Error("skaner: przekroczony limit czasu");
    await mount();

    const button = screen.getByRole("button", { name: /admin\.linkMonitor\.scanNow/ });
    await act(async () => {
      fireEvent.click(button);
    });

    expect(h.toastError).toEqual([["skaner: przekroczony limit czasu"]]);
    expect(h.toastSuccess).toEqual([]);
    // `finally` musi zdjąć blokadę, inaczej jeden błąd wyłącza panel do
    // przeładowania strony.
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("odrzucenie NIE-BŁĘDEM też daje komunikat, a nie „[object Object]”", async () => {
    h.scanError = { toString: () => "odmowa" } as unknown as Error;
    await mount();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /admin\.linkMonitor\.scanNow/ }));
    });

    expect(h.toastError).toEqual([["odmowa"]]);
  });
});

// ---------------------------------------------------------------------------
// Panel jest TABELĄ z akcjami - klasa widoku, w której najczęściej brakuje
// nagłówków kolumn powiązanych z komórkami i dostępnych nazw przycisków
// ikonowych. axe-core biegnie na pełnym drzewie z danymi, bo pusta tabela nie
// ma czego naruszyć.
describe("dostępność", () => {
  it("tabela z danymi nie ma naruszeń axe-core", async () => {
    h.rows = [
      row({ id: "a", archive_url: "https://web.archive.org/web/2/a", archive_timestamp: "20250104120000" }),
      row({ id: "b", status_code: null, error: "ENOTFOUND", posts: null }),
    ];
    const view = await mount();

    const { axeViolations, summarize } = await import("@/test/axe");
    const violations = await axeViolations(view.container);
    expect(summarize(violations)).toBe("");
  });

  it("panel z ALERTEM progowym też jest czysty - `role=\"alert\"` musi mieć treść", async () => {
    h.rows = rows(BROKEN_LINK_ALERT_THRESHOLD);
    const view = await mount();

    const { axeViolations, summarize } = await import("@/test/axe");
    expect(summarize(await axeViolations(view.container))).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Klucze asertowane wyżej istnieją tylko jako ECHO atrapy i18n. Ten blok
// sprawdza je w PRAWDZIWYM słowniku - w obu językach - więc usunięcie klucza
// albo dodanie go tylko po polsku oblewa test, a nie przechodzi cicho.
describe("słownik PL i EN", () => {
  const KEYS = [
    "title",
    "hint",
    "scanNow",
    "scanDone",
    "empty",
    "alertTitle",
    "alertBody",
    "archiveCopy",
    "archiveCopied",
    "archiveCopyFailed",
    "archiveSearch",
    "archiveSnapshot",
    "colUrl",
    "colStatus",
    "colSuggestion",
    "colPost",
    "colChecked",
  ] as const;

  it("każdy klucz panelu ma tłumaczenie w OBU językach i nie jest echem klucza", async () => {
    const { realT } = await import("@/test/i18nReal");
    await import("@/lib/i18n-admin-extras");

    for (const lang of ["pl", "en"] as const) {
      const t = realT(lang);
      for (const key of KEYS) {
        const full = `admin.linkMonitor.${key}`;
        const value = t(full, {
          count: 12,
          threshold: 10,
          posts: 1,
          links: 2,
          broken: 3,
          archived: 4,
        });
        expect(typeof value).toBe("string");
        expect(value).not.toBe(full);
        expect((value as string).trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("polska i angielska wersja RÓŻNIĄ się - brak tłumaczenia spada na fallback i tego nie widać", async () => {
    const { realT } = await import("@/test/i18nReal");
    await import("@/lib/i18n-admin-extras");

    expect(realT("pl")("admin.linkMonitor.title")).not.toBe(realT("en")("admin.linkMonitor.title"));
    expect(realT("pl")("admin.linkMonitor.empty")).not.toBe(realT("en")("admin.linkMonitor.empty"));
  });

  it("komunikat skanu podstawia WSZYSTKIE cztery liczniki, nie zostawia `{{...}}`", async () => {
    const { realT } = await import("@/test/i18nReal");
    await import("@/lib/i18n-admin-extras");

    for (const lang of ["pl", "en"] as const) {
      const text = realT(lang)("admin.linkMonitor.scanDone", {
        posts: 10,
        links: 42,
        broken: 3,
        archived: 2,
      });
      expect(text).not.toContain("{{");
      for (const value of ["10", "42", "3", "2"]) expect(text).toContain(value);
    }
  });
});
