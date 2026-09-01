// Panel zgód RODO (`src/components/notifications/ConsentsPanel.tsx`) - jedyne
// miejsce w produkcie, w którym zalogowany użytkownik widzi i zmienia CAŁY swój
// rejestr zgód. Do tej pory 0/59 linii i 0/18 funkcji pokrycia.
//
// Przedmiotem dowodu są tu trzy rzeczy, których nie widzi żaden test warstwy
// danych: kolejność i grupowanie kategorii, ROZDZIAŁ PISARZY (cookie idzie
// ścieżką CMP, reszta przez rejestr) oraz dostępność i dwujęzyczność.
//
// I18N BEZ ATRAPY - i to jest świadome. Udokumentowany w `src/test/i18nReal.ts`
// skrót `vi.mock("react-i18next", async () => (...).reactI18nextMock(lang))`
// ZAKLESZCZA ten plik: fabryka mocka importuje `@/lib/i18n`, a ten importuje
// `react-i18next`, czyli moduł właśnie mockowany (sprawdzone - przebieg wisi
// bez jednej linii logu aż do zabicia procesu). Zamiast tego czytamy tę samą
// instancję i18next, której używa aplikacja, i przełączamy język przez
// `i18n.changeLanguage` - dokładnie tak, jak `AdminDonations.test.tsx`.
//
// Napisy pochodzą ze SŁOWNIKA (`realT`), nie z literałów w teście. Dwa powody:
// treść zgody jest oświadczeniem woli i bywa redagowana niezależnie od kodu,
// a asercja na literale mierzyłaby to, co ktoś przepisał do testu, zamiast
// tego, co zobaczy użytkownik.
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { axeViolations, summarize } from "@/test/axe";
import { supabaseFromStub } from "@/test/supabase";
import { REGISTRY_SYNC_EVENT } from "@/lib/consent/registryBridge";
import type { ConsentDefinition } from "@/lib/notifications/consentCatalog";
import type { AppLang } from "@/lib/i18n/localePath";

/** Kategorie CMP w kształcie, w jakim czyta je panel (`cmp.state.categories`). */
interface CmpCategories {
  necessary: boolean;
  functional: boolean;
  analytics: boolean;
  marketing: boolean;
}

interface CmpStateLike {
  version: number;
  ts: number;
  categories: CmpCategories;
  gpcOverrideAt?: number;
}

const h = vi.hoisted(() => ({
  user: { current: { id: "u-1" } as { id: string } | null },
  cmpState: { current: null as CmpStateLike | null },
  cmpSave: vi.fn<(cats: Partial<CmpCategories>, source?: string) => void>(),
  gpcActive: { current: false },
  gpcSource: { current: "none" as "none" | "navigator" },
  listMyConsents: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  listMyConsentEvents: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  setMyConsent: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  toastSuccess: vi.fn<(message: string) => void>(),
  toastError: vi.fn<(message: string) => void>(),
  /** Podmieniony katalog zgód - `null` znaczy „użyj prawdziwego". */
  catalog: { current: null as readonly ConsentDefinition[] | null },
}));

// Rozwinięty PRAWDZIWY moduł: `@/lib/i18n` sięga po `createIsomorphicFn`, więc
// atrapa z samym `useServerFn` wywala import całego drzewa.
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.user.current }) }));

// CMP (`@/lib/ads/consent`) jest granicą: żyje w localStorage/cookie/profilu i
// ma własne testy. Tu liczy się WYŁĄCZNIE to, czy panel przez nią pisze.
vi.mock("@/lib/ads/consent", () => ({
  useConsent: () => ({ state: h.cmpState.current, save: h.cmpSave }),
  useGpcSignal: () => ({ active: h.gpcActive.current, source: h.gpcSource.current }),
  useGpcHonored: () => h.gpcActive.current && !h.cmpState.current?.gpcOverrideAt,
}));

vi.mock("@/lib/consents.functions", () => ({
  listMyConsents: (...args: unknown[]) => h.listMyConsents(...args),
  listMyConsentEvents: (...args: unknown[]) => h.listMyConsentEvents(...args),
  setMyConsent: (...args: unknown[]) => h.setMyConsent(...args),
}));

vi.mock("sonner", () => ({
  toast: { success: h.toastSuccess, error: h.toastError },
}));

// Katalog zgód jest podmieniany PRZEZ GETTER: domyślnie oddaje prawdziwy
// katalog (test grupowania ma mierzyć produkcyjną listę), a jeden test
// podstawia listę bez kategorii cookie, żeby dowieść filtra pustych sekcji.
vi.mock("@/lib/notifications/consentCatalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notifications/consentCatalog")>();
  return {
    ...actual,
    get CONSENT_CATALOG() {
      return h.catalog.current ?? actual.CONSENT_CATALOG;
    },
  };
});

// Atrapa klienta PostgREST jest tu strażnikiem inwariantu: panel nie ma prawa
// dotknąć ŻADNEJ tabeli bezpośrednio - ani `user_consents`, ani żadnej innej.
const stub = supabaseFromStub();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => stub.from(table) },
}));

import i18n from "@/lib/i18n";
import { realT } from "@/test/i18nReal";
import "@/lib/i18n-notifications";
import { CONSENT_CATALOG } from "@/lib/notifications/consentCatalog";
import type { ConsentEventRow, ConsentStateRow } from "@/lib/notifications/useConsents";
import { ConsentsPanel } from "../ConsentsPanel";

const CATEGORY_ORDER = ["cookies", "legal", "communications", "product", "analytics"] as const;

/** Napis ze słownika - dokładnie ten, który renderuje panel. */
function label(key: string, lang: AppLang = "pl"): string {
  return realT(lang)(key);
}

/**
 * Tytuł zgody. Panel woła `t(key, { defaultValue: definition.key })`, więc test
 * odtwarza TĘ SAMĄ ścieżkę - także dla zgody, której nakładka jeszcze nie zna.
 */
function itemTitle(key: string, lang: AppLang = "pl"): string {
  return realT(lang)(`notifications.consents.items.${key}.title`, { defaultValue: key });
}

function stateRow(over: Partial<ConsentStateRow> & { consent_key: string }): ConsentStateRow {
  return {
    given: true,
    version: "1.0",
    lang: "pl",
    gpc: false,
    given_at: "2026-08-01T10:00:00.000Z",
    withdrawn_at: null,
    updated_at: "2026-08-01T10:00:00.000Z",
    ...over,
  };
}

function eventRow(over: Partial<ConsentEventRow> & { id: string }): ConsentEventRow {
  return {
    consent_key: "marketing_email",
    given: true,
    version: "1.0",
    lang: "pl",
    source: "notifications_center",
    gpc: false,
    created_at: "2026-08-01T10:00:00.000Z",
    ...over,
  };
}

function cmpState(over: Partial<CmpStateLike> = {}): CmpStateLike {
  return {
    version: 2,
    ts: Date.parse("2026-08-01T10:00:00.000Z"),
    categories: { necessary: true, functional: true, analytics: false, marketing: false },
    ...over,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Ładunek ostatniego zapisu do rejestru (server-fn `setMyConsent`). */
function lastRegistryPayload(): Record<string, unknown> {
  const arg = h.setMyConsent.mock.calls.at(-1)?.[0];
  if (!isRecord(arg) || !isRecord(arg.data)) {
    throw new Error("test: setMyConsent nie dostał ładunku w kształcie { data: {...} }");
  }
  return arg.data;
}

/** Przełącznik zgody, adresowany napisem ze słownika. */
function consentSwitch(key: string, lang: AppLang = "pl"): HTMLElement {
  return screen.getByRole("switch", { name: itemTitle(key, lang) });
}

/** Identyfikatory wyrenderowanych sekcji kategorii, w kolejności DOM. */
function categorySectionIds(): string[] {
  return screen
    .getAllByRole("heading", { level: 3 })
    .map((el) => el.getAttribute("id"))
    .filter((id): id is string => !!id && id.startsWith("consent-cat-"));
}

async function renderPanelSettled() {
  const rendered = renderWithQueryClient(<ConsentsPanel />);
  await waitFor(() => {
    expect(h.listMyConsents).toHaveBeenCalled();
    expect(h.listMyConsentEvents).toHaveBeenCalled();
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return rendered;
}

/**
 * Wpisy HISTORII (a nie wiersze zgód) - obie listy renderują `<li>`, więc
 * `findAllByRole("listitem")` spełnia się już na samych wierszach zgód, zanim
 * zapytanie o historię zdąży się rozwiązać. Filtrowanie WYNIKU tamtej obietnicy
 * dawało więc pustą tablicę, gdy testy biegły pod obciążeniem (przypadek
 * zaobserwowany przy pełnym przebiegu katalogu, nie przy pojedynczym pliku).
 * Tu czekamy na SAME wpisy historii - rozpoznawalne po sufiksie wersji.
 */
async function historyEntries(expected: number): Promise<HTMLElement[]> {
  let found: HTMLElement[] = [];
  await waitFor(() => {
    found = screen.getAllByRole("listitem").filter((li) => li.textContent?.includes("(v1.0)"));
    expect(found).toHaveLength(expected);
  });
  return found;
}

beforeEach(async () => {
  stub.reset();
  h.user.current = { id: "u-1" };
  h.cmpState.current = cmpState();
  h.cmpSave.mockReset();
  h.gpcActive.current = false;
  h.gpcSource.current = "none";
  h.catalog.current = null;
  h.listMyConsents.mockReset();
  h.listMyConsents.mockResolvedValue([]);
  h.listMyConsentEvents.mockReset();
  h.listMyConsentEvents.mockResolvedValue([]);
  h.setMyConsent.mockReset();
  h.setMyConsent.mockResolvedValue(null);
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  await i18n.changeLanguage("pl");
});

afterEach(() => {
  cleanup();
});

describe("ConsentsPanel - grupowanie kategorii", () => {
  // Kolejność kategorii jest DECYZJĄ REDAKCYJNĄ zapisaną w CATEGORY_ORDER, nie
  // pochodną kolejności katalogu ani sortowania alfabetycznego. Cookie idą
  // pierwsze, bo to jedyna grupa spięta z banerem, który użytkownik już widział.
  it("renderuje sekcje w kolejności CATEGORY_ORDER", async () => {
    await renderPanelSettled();
    expect(categorySectionIds()).toEqual(CATEGORY_ORDER.map((c) => `consent-cat-${c}`));
  });

  it("każda pozycja katalogu dostaje własny przełącznik", async () => {
    await renderPanelSettled();
    expect(screen.getAllByRole("switch")).toHaveLength(CONSENT_CATALOG.length);
  });

  // Filtr `map.has(c)` istnieje po to, żeby usunięcie ostatniej zgody z
  // kategorii nie zostawiło nagłówka nad pustą listą. Bez podmiany katalogu nie
  // da się tego stanu wyprodukować z zewnątrz - stąd getter na module.
  it("kategoria bez ani jednej pozycji NIE renderuje sekcji", async () => {
    h.catalog.current = [
      { key: "transactional", category: "legal", version: "1.0", required: true },
      { key: "marketing_email", category: "communications", version: "1.0" },
    ];
    await renderPanelSettled();
    expect(categorySectionIds()).toEqual(["consent-cat-legal", "consent-cat-communications"]);
    expect(screen.getAllByRole("switch")).toHaveLength(2);
  });
});

describe("ConsentsPanel - zgoda wymagana", () => {
  // Zgoda `required` (wiadomości transakcyjne) jest podstawą działania serwisu.
  // Przełącznik musi być ZABLOKOWANY, a nie tylko ignorowany w handlerze -
  // klikalna kontrolka bez skutku wygląda jak awaria.
  it("ma zablokowany przełącznik i badge „wymagana”", async () => {
    await renderPanelSettled();
    expect(consentSwitch("transactional")).toBeDisabled();
    expect(screen.getByText(label("notifications.consents.requiredBadge"))).toBeInTheDocument();
  });

  it("kliknięcie zablokowanego przełącznika nie zapisuje nigdzie", async () => {
    await renderPanelSettled();
    fireEvent.click(consentSwitch("transactional"));
    expect(h.setMyConsent).not.toHaveBeenCalled();
    expect(h.cmpSave).not.toHaveBeenCalled();
  });
});

describe("ConsentsPanel - rozdział pisarzy (CMP kontra rejestr)", () => {
  // KLUCZOWA ASERCJA ARCHITEKTURY. Kategorie cookie mają JEDNEGO pisarza:
  // ścieżkę CMP. To ona aktualizuje localStorage/cookie/profil i - przez
  // registryBridge - dopisuje wpis audytowy. Zapis wprost do rejestru z tego
  // miejsca dałby audyt bez wpływu na realne bramkowanie skryptów, czyli
  // dokładnie ten rozjazd, który unifikacja zamknęła.
  it("wiersz cookie zapisuje przez CMP i NIE rusza rejestru", async () => {
    await renderPanelSettled();
    fireEvent.click(consentSwitch("cookies_analytics"));
    expect(h.cmpSave).toHaveBeenCalledTimes(1);
    expect(h.cmpSave).toHaveBeenCalledWith(
      { necessary: true, functional: true, analytics: true, marketing: false },
      "notifications_center",
    );
    expect(h.setMyConsent).not.toHaveBeenCalled();
    expect(stub.chains).toHaveLength(0);
  });

  // Odwrotnie dla zgód niecookie: te nie mają żadnego stanu runtime w CMP,
  // więc ich jedynym pisarzem jest server-fn rejestru.
  it("wiersz niecookie zapisuje przez rejestr i NIE rusza CMP", async () => {
    await renderPanelSettled();
    fireEvent.click(consentSwitch("marketing_email"));
    await waitFor(() => expect(h.setMyConsent).toHaveBeenCalledTimes(1));
    expect(h.cmpSave).not.toHaveBeenCalled();
    const payload = lastRegistryPayload();
    expect(payload.key).toBe("marketing_email");
    expect(payload.given).toBe(true);
    expect(payload.source).toBe("notifications_center");
    expect(payload.version).toBe("1.0");
    expect(stub.chains).toHaveLength(0);
  });

  it("brak stanu CMP nie blokuje zapisu cookie - wysyła bezpieczny domyślny zestaw", async () => {
    h.cmpState.current = null;
    await renderPanelSettled();
    fireEvent.click(consentSwitch("cookies_marketing"));
    expect(h.cmpSave).toHaveBeenCalledWith(
      { necessary: true, functional: false, analytics: false, marketing: true },
      "notifications_center",
    );
  });

  it("udany zapis rejestru pokazuje potwierdzenie ze słownika", async () => {
    await renderPanelSettled();
    fireEvent.click(consentSwitch("product_updates"));
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith(label("notifications.consents.saved")),
    );
  });

  // Błąd zapisu MUSI być widoczny: cicha porażka zostawia użytkownika w
  // przekonaniu, że wycofał zgodę, której serwis nadal używa.
  it("nieudany zapis rejestru pokazuje komunikat błędu", async () => {
    h.setMyConsent.mockRejectedValue(new Error("rpc down"));
    await renderPanelSettled();
    fireEvent.click(consentSwitch("product_updates"));
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(label("notifications.consents.saveError")),
    );
  });
});

describe("ConsentsPanel - stan wiersza", () => {
  // Bump wersji treści prawnej ma poprosić o ponowną decyzję. Bez tego
  // ostrzeżenia użytkownik zostaje przy zgodzie na tekst, którego nie widział.
  it("nieaktualna wersja pokazuje ostrzeżenie versionOutdated", async () => {
    h.listMyConsents.mockResolvedValue([
      stateRow({ consent_key: "marketing_email", version: "0.9" }),
    ]);
    await renderPanelSettled();
    await waitFor(() =>
      expect(screen.getByText(label("notifications.consents.versionOutdated"))).toBeInTheDocument(),
    );
  });

  // Zgody `required` nie da się „potwierdzić ponownie", więc ostrzeżenie przy
  // nich byłoby ślepym zaułkiem - i dlatego jest z nich świadomie wyłączone.
  it("zgoda required ze starą wersją NIE pokazuje ostrzeżenia", async () => {
    h.listMyConsents.mockResolvedValue([
      stateRow({ consent_key: "transactional", version: "0.9" }),
    ]);
    await renderPanelSettled();
    await waitFor(() => expect(consentSwitch("transactional")).toBeDisabled());
    expect(
      screen.queryByText(label("notifications.consents.versionOutdated")),
    ).not.toBeInTheDocument();
  });

  it("brak decyzji pokazuje „nie podjęto decyzji” zamiast zmyślonej daty", async () => {
    h.cmpState.current = null;
    await renderPanelSettled();
    expect(screen.getAllByText(label("notifications.consents.notDecided")).length).toBeGreaterThan(
      0,
    );
  });
});

describe("ConsentsPanel - historia zdarzeń", () => {
  it("pusta historia pokazuje komunikat historyEmpty", async () => {
    await renderPanelSettled();
    await waitFor(() =>
      expect(screen.getByText(label("notifications.consents.historyEmpty"))).toBeInTheDocument(),
    );
  });

  // Data, tytuł i stan - trzy informacje, bez których wpis audytowy nie
  // odpowiada na pytanie „co, kiedy i jak" zostało postanowione.
  it("wpisy pokazują sformatowaną datę, tytuł i stan", async () => {
    h.listMyConsentEvents.mockResolvedValue([
      eventRow({ id: "ev-1", consent_key: "marketing_email", given: true }),
      eventRow({ id: "ev-2", consent_key: "analytics", given: false }),
    ]);
    await renderPanelSettled();
    const history = await historyEntries(2);
    const first = history[0].textContent ?? "";
    expect(first).toContain(itemTitle("marketing_email"));
    expect(first).toContain(label("notifications.consents.stateGiven"));
    // Data MA być sformatowana lokalnie - surowe ISO w audycie jest nieczytelne.
    expect(first).not.toContain("2026-08-01T10:00:00.000Z");
    expect(first).toContain(
      new Date("2026-08-01T10:00:00.000Z").toLocaleString("pl-PL", {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    );
    expect(history[1].textContent).toContain(label("notifications.consents.stateWithdrawn"));
  });

  // Nota o kolumnie GPC to wykład o skrócie: pokazana bez ani jednego wpisu ze
  // znacznikiem tłumaczyłaby coś, czego użytkownik nigdzie nie widzi.
  it("nota o kolumnie GPC NIE pojawia się, gdy żaden wpis nie ma gpc", async () => {
    h.listMyConsentEvents.mockResolvedValue([eventRow({ id: "ev-1", gpc: false })]);
    await renderPanelSettled();
    await historyEntries(1);
    expect(screen.queryByTestId("gpc-registry-note")).not.toBeInTheDocument();
  });

  it("nota o kolumnie GPC pojawia się, gdy choć jeden wpis ma gpc === true", async () => {
    h.listMyConsentEvents.mockResolvedValue([
      eventRow({ id: "ev-1", gpc: false }),
      eventRow({ id: "ev-2", gpc: true }),
    ]);
    await renderPanelSettled();
    expect(await screen.findByTestId("gpc-registry-note")).toBeInTheDocument();
  });
});

describe("ConsentsPanel - sygnał GPC na wierszach cookie", () => {
  // Wartość wiersza cookie pochodzi z CMP (surowy stan), więc bez osobnej
  // klamry przełącznik pokazywałby „tak" dla kategorii, którą sygnał realnie
  // wyłączył - UI kłamałby o tym, co obowiązuje.
  it("honorowany sygnał odznacza przełącznik i dokłada badge GPC do wiersza", async () => {
    h.gpcActive.current = true;
    h.gpcSource.current = "navigator";
    h.cmpState.current = cmpState({
      categories: { necessary: true, functional: true, analytics: true, marketing: true },
    });
    await renderPanelSettled();
    expect(consentSwitch("cookies_analytics")).not.toBeChecked();
    // `functional` NIE podlega klamrze - preferencje UI nie opuszczają przeglądarki.
    expect(consentSwitch("cookies_functional")).toBeChecked();
    const rowEl = consentSwitch("cookies_analytics").closest("li");
    expect(rowEl).not.toBeNull();
    if (!rowEl) return;
    await waitFor(() => expect(within(rowEl).getByTestId("gpc-badge")).toBeInTheDocument());
  });

  // Świadomy override (znacznik `gpcOverrideAt`) zdejmuje klamrę - spec GPC nie
  // odbiera użytkownikowi prawa do zgody udzielonej PO wysłaniu sygnału.
  it("świadomy override zdejmuje klamrę z wiersza cookie", async () => {
    h.gpcActive.current = true;
    h.gpcSource.current = "navigator";
    h.cmpState.current = cmpState({
      categories: { necessary: true, functional: true, analytics: true, marketing: true },
      gpcOverrideAt: Date.parse("2026-08-02T10:00:00.000Z"),
    });
    await renderPanelSettled();
    expect(consentSwitch("cookies_analytics")).toBeChecked();
  });

  // Wycofanie zgody musi być tak łatwe jak jej udzielenie (art. 7 ust. 3 RODO),
  // więc nota w stanie „nadpisany" daje jednoklikowy powrót. Powrót idzie tą
  // samą ścieżką CMP co reszta decyzji cookie i zeruje OBIE klamrowane
  // kategorie naraz, zostawiając funkcjonalne bez zmian.
  it("przycisk przywrócenia sygnału zeruje kategorie klamrowane przez CMP", async () => {
    h.gpcActive.current = true;
    h.gpcSource.current = "navigator";
    h.cmpState.current = cmpState({
      categories: { necessary: true, functional: true, analytics: true, marketing: true },
      gpcOverrideAt: Date.parse("2026-08-02T10:00:00.000Z"),
    });
    await renderPanelSettled();
    const notice = await screen.findByTestId("gpc-notice");
    expect(notice).toHaveAttribute("data-gpc-state", "overridden");
    fireEvent.click(within(notice).getByRole("button"));
    expect(h.cmpSave).toHaveBeenCalledWith(
      { functional: true, analytics: false, marketing: false },
      "notifications_center",
    );
  });

  // Nota o sygnale jest obowiązkiem przejrzystości (art. 12-13 RODO): bez niej
  // użytkownik widzi wyłączone przełączniki i nie wie, dlaczego.
  it("nota o sygnale pojawia się dopiero przy aktywnym sygnale", async () => {
    await renderPanelSettled();
    expect(screen.queryByTestId("gpc-notice")).not.toBeInTheDocument();
    cleanup();
    h.gpcActive.current = true;
    h.gpcSource.current = "navigator";
    await renderPanelSettled();
    expect(await screen.findByTestId("gpc-notice")).toBeInTheDocument();
  });
});

describe("ConsentsPanel - most CMP -> rejestr", () => {
  // registryBridge pisze POZA React Query (fire-and-forget), więc bez tego
  // nasłuchu wiersze cookie pokazywałyby daty sprzed decyzji podjętej w banerze.
  it("REGISTRY_SYNC_EVENT unieważnia oba klucze cache", async () => {
    const { queryClient } = await renderPanelSettled();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => {
      window.dispatchEvent(new Event(REGISTRY_SYNC_EVENT));
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["user-consents", "u-1"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["user-consent-events", "u-1"] });
  });

  // Panel bywa zamontowany, zanim sesja się rozstrzygnie. Klucz „anon" musi być
  // wtedy jawny - `undefined` w kluczu unieważniłby przypadkowy zakres cache'u.
  it("bez sesji most unieważnia kubełek „anon”", async () => {
    h.user.current = null;
    const { queryClient } = renderWithQueryClient(<ConsentsPanel />);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => {
      window.dispatchEvent(new Event(REGISTRY_SYNC_EVENT));
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["user-consents", "anon"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["user-consent-events", "anon"] });
  });

  // Nasłuch na `window` przeżywa odmontowanie, jeśli sprzątanie jest zepsute -
  // a wtedy każdy kolejny panel dokłada kolejny listener na tym samym oknie.
  it("odmontowanie odpina nasłuch", async () => {
    const { queryClient, unmount } = await renderPanelSettled();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    unmount();
    await act(async () => {
      window.dispatchEvent(new Event(REGISTRY_SYNC_EVENT));
    });
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe("ConsentsPanel - dwujęzyczność", () => {
  // Dowód, że EN nie jest kopią PL: te same klucze, DWA różne napisy w
  // słowniku, i każdy z nich realnie wyrenderowany przy swoim języku.
  const BILINGUAL_KEYS = [
    "notifications.consents.title",
    "notifications.consents.requiredBadge",
    "notifications.consents.history",
    "notifications.consents.historyEmpty",
  ] as const;

  it("słownik ma RÓŻNE napisy PL i EN dla tych samych kluczy", () => {
    for (const key of BILINGUAL_KEYS) {
      expect(label(key, "pl")).not.toBe(label(key, "en"));
    }
    expect(itemTitle("marketing_email", "pl")).not.toBe(itemTitle("marketing_email", "en"));
  });

  it("przy języku pl renderuje polskie napisy i ŻADNEGO angielskiego", async () => {
    await renderPanelSettled();
    for (const key of BILINGUAL_KEYS) {
      await waitFor(() => expect(screen.getByText(label(key, "pl"))).toBeInTheDocument());
      expect(screen.queryByText(label(key, "en"))).not.toBeInTheDocument();
    }
  });

  it("przy języku en renderuje angielskie napisy i ŻADNEGO polskiego", async () => {
    await i18n.changeLanguage("en");
    await renderPanelSettled();
    for (const key of BILINGUAL_KEYS) {
      await waitFor(() => expect(screen.getByText(label(key, "en"))).toBeInTheDocument());
      expect(screen.queryByText(label(key, "pl"))).not.toBeInTheDocument();
    }
    expect(consentSwitch("marketing_email", "en")).toBeInTheDocument();
  });

  // Język steruje też formatem daty - `en-GB` zamiast `pl-PL`. Data w audycie
  // czytana w obcym formacie to ryzyko pomylenia dnia z miesiącem.
  it("język steruje formatem daty w historii", async () => {
    await i18n.changeLanguage("en");
    h.listMyConsentEvents.mockResolvedValue([eventRow({ id: "ev-1" })]);
    await renderPanelSettled();
    const history = await historyEntries(1);
    expect(history[0].textContent).toContain(
      new Date("2026-08-01T10:00:00.000Z").toLocaleString("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    );
    expect(history[0].textContent).toContain(label("notifications.consents.stateGiven", "en"));
  });
});

describe("ConsentsPanel - dostępność", () => {
  // Panel zgód jest powierzchnią prawną: użytkownik korzystający z czytnika
  // ekranu musi móc odczytać i zmienić KAŻDĄ zgodę. Naruszenie a11y jest tu
  // barierą w wykonaniu prawa z art. 7 ust. 3 RODO, nie kosmetyką.
  it("nie ma naruszeń axe w stanie domyślnym", async () => {
    const { container } = await renderPanelSettled();
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("nie ma naruszeń axe przy aktywnym sygnale GPC i historii ze znacznikami", async () => {
    h.gpcActive.current = true;
    h.gpcSource.current = "navigator";
    h.listMyConsents.mockResolvedValue([
      stateRow({ consent_key: "marketing_email", version: "0.9" }),
    ]);
    h.listMyConsentEvents.mockResolvedValue([eventRow({ id: "ev-1", gpc: true })]);
    const { container } = await renderPanelSettled();
    await screen.findByTestId("gpc-registry-note");
    await screen.findByTestId("gpc-notice");
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
