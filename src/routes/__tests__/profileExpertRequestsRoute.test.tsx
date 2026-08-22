// Panel zapytań do ekspertów (`/profile/expert-requests`) - trasa na zerze.
//
// CO TEN PLIK DOWODZI. Ta trasa jest CELEM GŁĘBOKIEGO LINKU Z POWIADOMIENIA:
// e-mail albo dzwonek prowadzą pod `?box=sent&r=<uuid>`, żeby otworzyć
// KONKRETNE zapytanie w KONKRETNEJ skrzynce. Wszystko, co się tu psuje, psuje
// się na tej ścieżce:
//
//   1. DRUGIE KLIKNIĘCIE W POWIADOMIENIE MUSI PRZESTAWIĆ SKRZYNKĘ. Zakładka
//      jest stanem lokalnym, a adres zmienia się bez odmontowania trasy - bez
//      efektu synchronizującego użytkownik klika „zobacz odpowiedź" w skrzynce
//      wysłanych i zostaje na odebranych, gdzie tego zapytania nie ma.
//   2. WYRÓŻNIENIE JEDZIE DO OBU SKRZYNEK, ale tylko gdy adres je niesie.
//      Przekazanie `highlightId: undefined` do listy jest różnicą widoczną
//      w propsach - lista nie ma prawa przewijać do „niczego".
//   3. PANEL PRYWATNY MA `noindex, nofollow`. Treść zapytań do ekspertów to
//      korespondencja: jeden wyciek do indeksu jest nieodwracalny.
//   4. PASEK PULI POKAZUJE SIĘ TYLKO WTEDY, GDY PULA REALNIE OGRANICZA.
//      Konto z dostępem bezpośrednim albo z pulą zerową (czyli bez limitu
//      z tego mechanizmu) dostałoby komunikat o limicie, którego nie ma -
//      i wstrzymałoby się z pytaniem, na które ma prawo.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - WALIDATORA ADRESU: `validateExpertRequestsSearch` to czysty moduł z
//   własnym testem (`src/lib/chat/__tests__/expertRequestsSearch.test.ts`).
//   Tutaj dowodzimy TYLKO tego, że trasa go PODPINA - jednym przypadkiem
//   granicznym, nie kopią jego testów.
// - LISTY ZAPYTAŃ: `ExpertRequestList` mieszka w `components/chat` i ma
//   własne testy; tu jest markerem zapisującym propsy.
// - PULI I BRAMKI WYSYŁKI: `lib/chat/useExpertRequests` ma własne testy.
//   Tu jest atrapą sterowaną ze stanu.
// - BRAMKI SESJI: mieszka w layoucie `/profile`
//   (`src/routes/__tests__/profileShellRoutes.test.tsx`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({
  /** Stan puli zapytań (`null` = odczyt jeszcze nie wrócił). */
  quota: null as { direct: boolean; quota: number; remaining: number } | null,
  /** Propsy, z jakimi trasa zawołała listę - po jednym wpisie na skrzynkę. */
  lists: [] as Record<string, unknown>[],
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-expert-request", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/chat/useExpertRequests", () => ({
  useMyExpertRequestQuota: () => ({ data: h.quota }),
}));
vi.mock("@/components/chat/ExpertRequestList", () => ({
  ExpertRequestList: (props: Record<string, unknown>) => {
    h.lists.push(props);
    return (
      <div
        data-testid={`list-${String(props.box)}`}
        data-highlight={props.highlightId === undefined ? "brak" : String(props.highlightId)}
      />
    );
  },
}));
// Radix Tabs bez pełnego pointer API nie renderuje zawartości pod happy-dom -
// atrapa oddaje WYBRANĄ zakładkę i pozwala ją przestawić, czyli dokładnie to,
// co jest tu przedmiotem dowodu.
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (next: string) => void;
    children?: ReactNode;
  }) => (
    <div data-testid="tabs" data-value={value}>
      <button type="button" data-testid="switch-sent" onClick={() => onValueChange("sent")}>
        sent
      </button>
      {children}
    </div>
  ),
  TabsList: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ value, children }: { value: string; children?: ReactNode }) => (
    <button type="button" data-tab-trigger={value}>
      {children}
    </button>
  ),
  TabsContent: ({ value, children }: { value: string; children?: ReactNode }) => (
    <div data-tab-content={value}>{children}</div>
  ),
}));

import { renderRoute, routeHead, routeSearchValidator } from "@/test/routeHarness";
import { Route as ExpertRequestsRoute } from "@/routes/profile.expert-requests";

const PATH = "/profile/expert-requests";
const REQUEST_ID = "00000000-0000-4000-8000-000000000abc";

async function mount(search = "") {
  return renderRoute({
    route: ExpertRequestsRoute,
    path: PATH,
    initialEntry: `${PATH}${search}`,
  });
}

/** Treść paska puli - akapit sklejony z dwóch tłumaczeń. */
function quotaNote(): string {
  return document.body.textContent ?? "";
}

/** Wybrana zakładka odczytana z DOM - to ona decyduje, co widzi użytkownik. */
function selectedBox(): string | null {
  return screen.getByTestId("tabs").getAttribute("data-value");
}

beforeEach(() => {
  vi.clearAllMocks();
  h.quota = null;
  h.lists = [];
});

afterEach(() => cleanup());

describe("nagłówek panelu prywatnego", () => {
  it("panel korespondencji NIGDY nie trafia do wyszukiwarki", () => {
    // Zapytania do ekspertów to korespondencja. Jeden wyciek do indeksu jest
    // nieodwracalny, bo kopia zostaje w cache wyszukiwarki.
    const meta = routeHead(ExpertRequestsRoute).meta ?? [];
    const robots = meta.find((entry) => entry.name === "robots")?.content;
    expect(robots).toBe("noindex, nofollow");
  });

  it("ODNOTOWANE, NIE NAPRAWIONE: tytuł karty jest tylko po polsku", () => {
    // Stan faktyczny, nie życzenie: `head()` tej trasy wpisuje tytuł na
    // sztywno, więc anglojęzyczny użytkownik ma polską nazwę na karcie
    // przeglądarki i w historii. Trasa jest `noindex`, więc nie dotyczy to
    // wyników wyszukiwania - dotyczy człowieka, który szuka karty wśród
    // dwudziestu otwartych. Naprawa to klucz i18n w `head()`, ale to zmiana
    // zachowania produkcyjnego, a ten etap dowodzi pokrycia; test opisuje
    // więc rzeczywistość, żeby nikt nie zmienił jej przez przypadek.
    const meta = routeHead(ExpertRequestsRoute).meta ?? [];
    expect(meta.find((entry) => "title" in entry)?.title).toBe("Zapytania do ekspertów");
  });
});

describe("adres z powiadomienia", () => {
  it("trasa PODPINA walidator adresu - identyfikator spoza formatu wypada", () => {
    // Jeden przypadek graniczny na dowód SKLEJENIA. Reguły walidatora mają
    // własny plik testowy i nie kopiujemy ich tutaj.
    const validate = routeSearchValidator(ExpertRequestsRoute);
    expect(validate({ box: "sent", r: REQUEST_ID })).toMatchObject({
      box: "sent",
      r: REQUEST_ID,
    });
    expect(validate({ box: "kosmos", r: "nie-uuid" })).toEqual({});
  });

  it("BEZ PARAMETRU otwiera skrzynkę odebranych", async () => {
    await mount();
    await waitFor(() => expect(screen.getByTestId("tabs")).toBeTruthy());
    expect(selectedBox()).toBe("received");
  });

  it("`?box=sent` otwiera skrzynkę WYSŁANYCH, a nie domyślną", async () => {
    // To jest cała wartość głębokiego linku: powiadomienie o odpowiedzi
    // prowadzi do zapytania, które użytkownik WYSŁAŁ.
    await mount("?box=sent");
    await waitFor(() => expect(screen.getByTestId("tabs")).toBeTruthy());
    expect(selectedBox()).toBe("sent");
  });

  it("DRUGIE KLIKNIĘCIE W POWIADOMIENIE przestawia skrzynkę bez przeładowania", async () => {
    // Trasa się nie odmontowuje, więc stan lokalny zakładki sam z siebie nie
    // zauważyłby zmiany adresu - użytkownik zostałby na starej skrzynce,
    // w której szukanego zapytania nie ma.
    const view = await mount("?box=received");
    await waitFor(() => expect(selectedBox()).toBe("received"));
    await view.navigate(`${PATH}?box=sent`);
    await waitFor(() => expect(selectedBox()).toBe("sent"));
  });

  it("RĘCZNA zmiana zakładki nie jest cofana przez adres bez parametru", async () => {
    // Efekt synchronizujący reaguje TYLKO na obecny parametr. Gdyby reagował
    // na jego brak, każde przełączenie zakładki wracałoby na „odebrane".
    await mount();
    await waitFor(() => expect(selectedBox()).toBe("received"));
    screen.getByTestId("switch-sent").click();
    await waitFor(() => expect(selectedBox()).toBe("sent"));
  });
});

describe("wyróżnienie konkretnego zapytania", () => {
  it("identyfikator z adresu jedzie do OBU skrzynek", async () => {
    // Zapytanie może być wyróżnione w każdej z nich - lista sama decyduje,
    // czy je u siebie ma.
    await mount(`?box=sent&r=${REQUEST_ID}`);
    await waitFor(() => expect(screen.getByTestId("list-sent")).toBeTruthy());
    expect(screen.getByTestId("list-sent").getAttribute("data-highlight")).toBe(REQUEST_ID);
    expect(screen.getByTestId("list-received").getAttribute("data-highlight")).toBe(REQUEST_ID);
  });

  it("BEZ identyfikatora lista nie dostaje go w propsach wcale", async () => {
    // `highlightId: undefined` i brak klucza to dla listy dwie różne rzeczy -
    // nie ma prawa przewijać do „niczego".
    await mount();
    await waitFor(() => expect(screen.getByTestId("list-received")).toBeTruthy());
    expect(screen.getByTestId("list-received").getAttribute("data-highlight")).toBe("brak");
    for (const props of h.lists) expect("highlightId" in props).toBe(false);
  });

  it("każda skrzynka dostaje SWÓJ rodzaj, nie ten sam dwa razy", async () => {
    // Dwie listy tego samego rodzaju pokazałyby te same zapytania w obu
    // zakładkach - i użytkownik nie odróżniłby, co wysłał, a co dostał.
    await mount();
    await waitFor(() => expect(screen.getByTestId("list-received")).toBeTruthy());
    expect(h.lists.map((props) => props.box)).toEqual(["received", "sent"]);
  });
});

describe("pasek stanu puli zapytań", () => {
  it("POKAZUJE SIĘ, gdy pula realnie ogranicza - z liczbami", async () => {
    // To ta sama liczba, którą egzekwuje bramka wysyłki. Rozjazd znaczyłby,
    // że użytkownik pisze zapytanie, które zostanie odrzucone.
    h.quota = { direct: false, quota: 5, remaining: 2 };
    await mount();
    // Akapit składa się z DWÓCH tłumaczeń rozdzielonych spacją, więc asercja
    // idzie na jego treści, a nie na jednym węźle tekstowym.
    await waitFor(() => expect(quotaNote()).toContain("expertRequest.quota.remaining"));
    expect(quotaNote()).toContain("expertRequest.quota.remaining(quota=5,remaining=2)");
    expect(quotaNote()).toContain("expertRequest.quota.cancelledCounts");
  });

  it("ODCZYT PULI JESZCZE NIE WRÓCIŁ: paska nie ma, panel działa", async () => {
    // Migający komunikat o limicie przy każdym wejściu byłby gorszy od jego
    // braku.
    h.quota = null;
    await mount();
    await waitFor(() => expect(screen.getByTestId("tabs")).toBeTruthy());
    expect(screen.queryByText(/expertRequest.quota.remaining/)).toBeNull();
  });

  it("DOSTĘP BEZPOŚREDNI nie dostaje komunikatu o limicie, którego nie ma", async () => {
    // Konto z dostępem bezpośrednim wstrzymałoby się z pytaniem, na które ma
    // prawo.
    h.quota = { direct: true, quota: 5, remaining: 0 };
    await mount();
    await waitFor(() => expect(screen.getByTestId("tabs")).toBeTruthy());
    expect(screen.queryByText(/expertRequest.quota.remaining/)).toBeNull();
  });

  it("PULA ZEROWA (mechanizm nieaktywny) też nie pokazuje paska", async () => {
    // „0 z 0" czytałoby się jak wyczerpany limit, a to znaczy „ten mechanizm
    // nie dotyczy tego konta".
    h.quota = { direct: false, quota: 0, remaining: 0 };
    await mount();
    await waitFor(() => expect(screen.getByTestId("tabs")).toBeTruthy());
    expect(screen.queryByText(/expertRequest.quota.remaining/)).toBeNull();
  });

  it("WYCZERPANA pula nadal pokazuje pasek - zero to informacja, nie pustka", async () => {
    h.quota = { direct: false, quota: 5, remaining: 0 };
    await mount();
    await waitFor(() => expect(quotaNote()).toContain("expertRequest.quota.remaining"));
    expect(quotaNote()).toContain("expertRequest.quota.remaining(quota=5,remaining=0)");
  });
});
