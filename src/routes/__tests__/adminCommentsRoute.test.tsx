// Trasa `/admin/comments` ZAMONTOWANA - kolejka moderacji komentarzy wraz ze
// ścieżką operacji NISZCZĄCYCH (zatwierdź / oznacz jako spam / usuń hurtem).
// Przed tym plikiem moduł 16 mierzony w zawężeniu do samego pliku trasy stał na
// 0%: 74,5% z audytu wydania 8 pochodziło z PRZYPADKOWEGO importu w pełnej
// suicie, nie z testu tej trasy. Import to nie dowód - wykonuje ciało modułu,
// a nie ciało komponentu, i milczy o tym, czy „Usuń zaznaczone” w ogóle pyta.
//
// CO JEST PRZEDMIOTEM DOWODU
//   1. REGUŁA ZAZNACZENIA JEST UŻYWANA, NIE TYLKO ZAIMPORTOWANA.
//      `@/lib/comments/selection` stoi na 100% jako reguła czysta, ale 100%
//      na regule nie mówi nic o tym, czy ktokolwiek jej słucha. Dlatego moduł
//      jest tu OPAKOWANY szpiegami wokół PRAWDZIWYCH implementacji: testy
//      mierzą jednocześnie zachowanie (trójstanowy checkbox, licznik) i to,
//      Z JAKIMI ARGUMENTAMI trasa woła regułę.
//   2. OPERACJA NISZCZĄCA PYTA, A ODMOWA W DIALOGU NIC NIE ROBI. Kasowanie
//      cudzych wypowiedzi hurtem musi mieć dwa kliknięcia, a to drugie musi dać
//      się cofnąć - „Anuluj” nie może wołać mutacji ani czyścić zaznaczenia.
//   3. PORAŻKA SERWERA NIE ZOSTAWIA UI W STANIE „ZROBIONE”. Zaznaczenie po
//      odmowie zostaje, klucz cache NIE jest unieważniany, jest toast błędu.
//   4. SUKCES UNIEWAŻNIA `["admin-comments"]`. Bez tego lista po zatwierdzeniu
//      hurtem pokazuje przez 15 s (`staleTime`) rekordy, których już nie ma
//      w tym filtrze, a operator klika drugi raz w te same wiersze.
//
// GDZIE NAPRAWDĘ STOI BRAMKA UPRAWNIEŃ - USTALENIE, NIE ZAŁOŻENIE.
// Prześledziłem ścieżkę od kliknięcia do wiersza w bazie, zanim napisałem
// pierwszą asercję. Wyszło tak i tylko tak:
//   * `src/routes/admin.tsx` (layout `/admin`) - JEDYNA bramka renderu dla
//     wszystkich tras panelu: `useAuth()` daje `isStaff`, efekt robi
//     `navigate({ to: "/login" })`, komponent zwraca `null`.
//   * TA trasa - zero warunku roli. Nie ma `useAuth`, nie ma `beforeLoad`,
//     nie ma `redirect`. To nie jest dziura, to podział pracy.
//   * `src/lib/comments/api.ts` - `fetchAdminComments`, `moderateComment`
//     i `bulkModerateComments` idą ZWYKŁYM klientem Supabase
//     (`supabase.from("comments")`), a nie serwerową funkcją z middleware.
//     Nie ma tam ani jednego `if`-a o roli. Autorytetem jest RLS.
// Dlatego NIE MA tu testu „użytkownik bez roli nie zmoderuje”, który udawałby
// dowód na tym poziomie - mierzyłby atrapę. Zamiast tego są asercje mierzące
// TO, CO JEST: że trasa nie bramkuje sama, że bramka renderu żyje w layoucie
// i że warstwa danych świadomie nie zna pojęcia roli.
//
// IZOLACJA NAJEMCY - GRANICA DOWODU I ZNALEZISKO.
// Zapytanie listy panelu NIE NIESIE predykatu `tenant_id`: `fetchAdminComments`
// filtruje wyłącznie po statusie i frazie. Odsianie cudzego najemcy robi więc
// w całości polityka `comments_staff_select` (`tenant_id =
// current_tenant_id() AND has_role(admin|editor)`). Test na atrapie klienta nie
// wykona SQL-a, więc mierzy DWA końce tego, co da się zmierzyć w tej warstwie:
// (a) że zapytanie faktycznie nie ma własnego predykatu najemcy i nie idzie
// przez serwerową funkcję, (b) że predykat stoi w migracji. Egzekucja polityki
// to pgTAP, nie ten plik.
// ZNALEZISKO (przypięte niżej `it.fails` z kontrolą dodatnią): polityki SELECT
// są OR-owane, a `comments_own_select` NIE MA predykatu najemcy
// (`USING (user_id = auth.uid())`). Lista panelu nie filtruje po wpisie ani po
// najemcy, więc moderator zobaczy w KOLEJCE także własne komentarze zostawione
// u INNEGO najemcy. Na publicznej liście komentarzy to niewidoczne
// (`fetchPostComments` filtruje po `post_id`, a wpisy są per najemca) - ta
// jedna powierzchnia to odsłania.
//
// CO JEST ATRAPOWANE I DLACZEGO
//   * `@/lib/comments/api` - warstwa danych. Ma własne testy
//     (`src/lib/comments/__tests__/api.test.ts`, `bulkModerate.test.ts`), więc
//     powtarzanie kształtu łańcucha PostgREST dałoby drugi zestaw asercji o tej
//     samej rzeczy. Przedmiotem dowodu jest, CO trasa robi z wynikiem i KIEDY
//     woła zapis.
//   * `sonner` - toast jest jedynym obserwowalnym skutkiem błędu.
//   * `@/lib/comments/selection` - opakowany, nie zastąpiony (patrz punkt 1).
//   * `@/components/ui/select` NIE jest atrapowany. Sprawdziłem: Radix Select
//     otwiera się pod happy-dom (`pointerDown` + `ArrowDown`) i oddaje pięć
//     `role="option"`, więc filtr statusu jest klikany naprawdę, a asercja axe
//     mierzy PRAWDZIWY znacznik trasy, nie moją namiastkę.
//   * `react-i18next` NIE jest atrapowany - napisy jadą ze słownika przez
//     `realT()`. Test dwujęzyczny przełącza globalny język, a `beforeEach`
//     przywraca „pl”.
//
// POMIAR (ten plik, zawężenie do `src/routes/admin.comments.tsx`):
// linie 55/55, funkcje 30/30, gałęzie 47/49. Dwie nieosiągalne gałęzie zostają
// świadomie i są to OBIE gałęzie obronne, nie luki w teście:
//   * `if (selected.size === 0) return` w `runBulk` - z ekranu nie do trafienia,
//     bo wszystkie trzy przyciski zbiorcze są wtedy `disabled` (dowodzi tego
//     osobny test); to druga bariera pod pierwszą, nie martwy kod,
//   * fałszywa odnoga `if (confirm)` w akcji dialogu - dialog montuje się
//     wyłącznie przy `confirm !== null`.
//
// GRANICA DOWODU. Ten plik nie dowodzi, że baza odrzuci moderatora bez roli
// (pgTAP), ani że `bulkModerateComments` składa poprawny `.in()` (to
// `bulkModerate.test.ts`). Dowodzi, że trasa nie kasuje bez pytania, nie kłamie
// licznikiem, nie udaje sukcesu po odmowie i unieważnia dokładnie ten klucz,
// od którego zależy jej własna lista.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import type { AdminCommentRow } from "@/lib/comments/api";

/** Zapis jednego wywołania reguły zaznaczenia: oba argumenty jako tablice id. */
interface SelectionCall {
  fn: "selectAllState" | "toggleSelectAll" | "toggleSelected" | "retainExisting";
  a: string[];
  b: string[];
}

const h = vi.hoisted(() => ({
  fetchAdmin:
    vi.fn<(filter: { status?: string; q?: string; limit?: number }) => Promise<unknown>>(),
  moderate: vi.fn<(id: string, status: string) => Promise<void>>(),
  bulk: vi.fn<(ids: readonly string[], status: string) => Promise<number>>(),
  toasts: [] as { kind: "success" | "error"; text: string }[],
  selection: [] as SelectionCall[],
}));

// Warstwa danych panelu. Patrz „CO JEST ATRAPOWANE” w nagłówku.
vi.mock("@/lib/comments/api", () => ({
  fetchAdminComments: (filter: { status?: string; q?: string; limit?: number }) =>
    h.fetchAdmin(filter),
  moderateComment: (id: string, status: string) => h.moderate(id, status),
  bulkModerateComments: (ids: readonly string[], status: string) => h.bulk(ids, status),
}));

// Reguła zaznaczenia OPAKOWANA, nie podmieniona: pod spodem biegną prawdziwe
// implementacje, a szpieg zapisuje argumenty. Dzięki temu jedna asercja mierzy
// zachowanie, a druga - że to zachowanie pochodzi Z REGUŁY, a nie z kopii
// logiki wklejonej do komponentu.
vi.mock("@/lib/comments/selection", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/comments/selection")>();
  return {
    selectAllState: (visibleIds: readonly string[], selected: ReadonlySet<string>) => {
      h.selection.push({ fn: "selectAllState", a: [...visibleIds], b: [...selected] });
      return real.selectAllState(visibleIds, selected);
    },
    toggleSelectAll: (visibleIds: readonly string[], selected: ReadonlySet<string>) => {
      h.selection.push({ fn: "toggleSelectAll", a: [...visibleIds], b: [...selected] });
      return real.toggleSelectAll(visibleIds, selected);
    },
    toggleSelected: (selected: ReadonlySet<string>, id: string) => {
      h.selection.push({ fn: "toggleSelected", a: [...selected], b: [id] });
      return real.toggleSelected(selected, id);
    },
    retainExisting: (selected: ReadonlySet<string>, existingIds: readonly string[]) => {
      h.selection.push({ fn: "retainExisting", a: [...selected], b: [...existingIds] });
      return real.retainExisting(selected, existingIds);
    },
  };
});

vi.mock("sonner", () => ({
  toast: {
    success: (text: string) => h.toasts.push({ kind: "success", text }),
    error: (text: string) => h.toasts.push({ kind: "error", text }),
  },
}));

import i18n from "@/lib/i18n";
import { realT } from "@/test/i18nReal";
import { renderRoute, routeHead } from "@/test/routeHarness";
import { axeViolations, summarize } from "@/test/axe";
import { Route as AdminCommentsRoute } from "@/routes/admin.comments";

const t = realT("pl");
const tEn = realT("en");
const PATH = "/admin/comments";

const ROUTE_SRC = readFileSync("src/routes/admin.comments.tsx", "utf8");
const SELECTION_SRC = readFileSync("src/lib/comments/selection.ts", "utf8");
const API_SRC = readFileSync("src/lib/comments/api.ts", "utf8");
const COMMENTS_SQL = readFileSync(
  "supabase/migrations/20260711081539_1b55f71d-759c-43eb-9985-f1cd2c15f790.sql",
  "utf8",
);

const TENANT = "tenant-alfa";
const BASE_ISO = "2026-08-18T10:00:00.000Z";

/**
 * Wiersz kolejki panelu. Treści i podpisy sa jawnie zmyślone, adresy wyłącznie
 * `@example.com` - to jest ekran z cudzymi wypowiedziami, więc fixtura nie ma
 * prawa nieść niczyich prawdziwych danych.
 */
function row(over: Partial<AdminCommentRow> = {}): AdminCommentRow {
  return {
    id: "c-1",
    post_id: "post-1",
    tenant_id: TENANT,
    user_id: "user-1",
    author_name: null,
    parent_id: null,
    body: "Testowa treść komentarza numer jeden.",
    status: "pending",
    created_at: BASE_ISO,
    updated_at: BASE_ISO,
    edited_at: null,
    author: {
      id: "user-1",
      display_name: "Zetka Testowa",
      avatar_url: null,
      slug: "zetka-testowa",
    },
    post: { id: "post-1", slug: "wpis-testowy", title_pl: "Wpis testowy", title_en: "Test post" },
    ...over,
  };
}

/** Trzy wiersze o różnych id - baza większości testów zaznaczenia. */
function threeRows(): AdminCommentRow[] {
  return [
    row({ id: "c-1", body: "Pierwsza zmyślona wypowiedź." }),
    row({ id: "c-2", body: "Druga zmyślona wypowiedź." }),
    row({ id: "c-3", body: "Trzecia zmyślona wypowiedź." }),
  ];
}

beforeEach(async () => {
  cleanup();
  h.fetchAdmin.mockReset();
  h.fetchAdmin.mockResolvedValue([]);
  h.moderate.mockReset();
  h.moderate.mockResolvedValue(undefined);
  h.bulk.mockReset();
  h.bulk.mockImplementation((ids) => Promise.resolve(ids.length));
  h.toasts = [];
  h.selection = [];
  // Test dwujęzyczny przełącza globalny język - przywracamy domyślny „pl”,
  // żeby kolejność plików w suicie nie decydowała o wyniku sąsiada.
  if (i18n.language !== "pl") await i18n.changeLanguage("pl");
});

afterAll(async () => {
  await i18n.changeLanguage("pl");
});

/** Klient bez ponowień - test odmowy nie ma na co czekać. */
function testClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

async function mountRoute(queryClient?: QueryClient) {
  return renderRoute({
    route: AdminCommentsRoute,
    path: PATH,
    initialEntry: PATH,
    queryClient: queryClient ?? testClient(),
  });
}

/**
 * Montuje trasę z podaną listą i czeka, aż wiersze będą na ekranie.
 *
 * Czekamy na `listitem`, a NIE na etykietę checkboxa nagłówka: ta jest
 * przetłumaczona, a jeden z testów montuje panel po angielsku - oczekiwanie na
 * polski napis rozsypywałoby się wyłącznie tam i z mylącym komunikatem.
 */
async function mountWith(rows: AdminCommentRow[], queryClient?: QueryClient) {
  h.fetchAdmin.mockResolvedValue(rows);
  const rendered = await mountRoute(queryClient);
  await screen.findAllByRole("listitem");
  return rendered;
}

const headCheckbox = () => screen.getByLabelText(t("adminComments.selection.selectAll"));
const rowCheckboxes = () => screen.getAllByLabelText(t("adminComments.selection.selectRow"));
const countLabel = (n: number) => t("adminComments.selection.count", { count: n });
const bulkButton = (key: "approve" | "spam" | "delete") =>
  screen.getByRole("button", { name: new RegExp(t(`adminComments.bulk.${key}`)) });

/** Wybór statusu w PRAWDZIWEJ dropliście Radix (patrz nagłówek pliku). */
async function pickStatus(optionLabel: string): Promise<void> {
  const combo = screen.getByRole("combobox");
  fireEvent.pointerDown(combo, { pointerId: 1, button: 0, ctrlKey: false });
  fireEvent.keyDown(combo, { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: optionLabel }));
}

const dialog = () => screen.getByRole("alertdialog");
const dialogButton = (key: "confirm" | "cancel") =>
  within(dialog()).getByRole("button", { name: t(`adminComments.bulk.${key}`) });

/**
 * Ciało JEDNEJ polityki RLS - od `CREATE POLICY` do domykającego średnika.
 *
 * Wycięcie „N znaków od nazwy” byłoby tu pułapką: polityki leżą w migracji
 * jedna pod drugą, więc okno stałej długości wciąga sąsiada i asercja
 * o predykacie najemcy przechodzi dzięki CUDZEJ polityce.
 */
function policyBody(name: string): string {
  const at = COMMENTS_SQL.indexOf(`CREATE POLICY "${name}"`);
  if (at < 0) throw new Error(`test: brak polityki ${name} w migracji komentarzy`);
  const end = COMMENTS_SQL.indexOf(";", at);
  return COMMENTS_SQL.slice(at, end < 0 ? COMMENTS_SQL.length : end);
}

/** Ostatnie wywołanie reguły o danej nazwie - albo błąd z jasnym komunikatem. */
function lastSelectionCall(fn: SelectionCall["fn"]): SelectionCall {
  const found = [...h.selection].reverse().find((c) => c.fn === fn);
  if (found === undefined) throw new Error(`test: trasa nie zawołała reguły ${fn}`);
  return found;
}

describe("/admin/comments - nagłówek i stany odczytu", () => {
  it("head() ustawia tytuł karty", async () => {
    // Dwiema drogami: wprost (kontrakt funkcji) i przez zamontowany router
    // (to, co naprawdę trafiłoby do `<HeadContent/>`).
    expect(routeHead(AdminCommentsRoute).meta).toContainEqual({ title: "Comments · Admin" });

    const { meta } = await mountRoute();
    expect(meta()).toContainEqual({ title: "Comments · Admin" });
  });

  it("w trakcie odczytu pokazuje stan ładowania, nie pustą kolejkę", async () => {
    // Rozróżnienie „jeszcze nie wiem” od „nie ma nic” jest tu treścią: pusta
    // kolejka znaczy „moderacja zrobiona” i operator na tej podstawie odchodzi
    // od ekranu.
    let resolve: (rows: AdminCommentRow[]) => void = () => {};
    h.fetchAdmin.mockReturnValue(new Promise<AdminCommentRow[]>((r) => (resolve = r)));
    await mountRoute();

    expect(screen.getByText(t("adminComments.loading"))).toBeInTheDocument();
    expect(screen.queryByText(t("adminComments.empty"))).toBeNull();

    resolve(threeRows());
    await waitFor(() => expect(screen.queryByText(t("adminComments.loading"))).toBeNull());
  });

  it("pusta kolejka mówi to wprost i nie rysuje paska operacji zbiorczych", async () => {
    // KONTROLA DODATNIA dla `it.fails` poniżej: przy PRAWDZIWIE pustej liście
    // komunikat „Brak komentarzy.” jest poprawny i ma się pojawić.
    await mountRoute();

    expect(await screen.findByText(t("adminComments.empty"))).toBeInTheDocument();
    expect(screen.queryByLabelText(t("adminComments.selection.selectAll"))).toBeNull();
    expect(screen.queryByText(countLabel(0))).toBeNull();
  });

  it.fails("odmowa odczytu NIE powinna wyglądać jak pusta kolejka", async () => {
    // DEFEKT, NIE NAPRAWA (brief pkt 6): trasa nie czyta `isError` w ogóle -
    // po odrzuceniu obietnicy `data` zostaje `undefined`, `rows` to `[]`
    // i ekran mówi „Brak komentarzy.”. Operator, któremu RLS odmówiło odczytu
    // albo któremu padła sieć, widzi dokładnie to samo, co przy zrobionej
    // moderacji, i odchodzi od kolejki pełnej zgłoszeń.
    // Wzorzec rozwiązania stoi obok: `admin.community.notifications` pokazuje
    // przy odmowie „-”, świadomie NIE „0”.
    // Ten test jest CZERWONY dzisiaj i ma zzielenieć dopiero po dołożeniu
    // gałęzi błędu; wtedy `it.fails` zacznie oblewać i trzeba go zdjąć.
    h.fetchAdmin.mockRejectedValue(new Error("odmowa RLS"));
    await mountRoute();

    await waitFor(() => expect(screen.queryByText(t("adminComments.loading"))).toBeNull());
    expect(screen.queryByText(t("adminComments.empty"))).toBeNull();
  });
});

describe("/admin/comments - filtry kolejki", () => {
  it("start kolejki to OCZEKUJĄCE, bo tylko one czekają na decyzję", async () => {
    await mountRoute();
    await screen.findByText(t("adminComments.empty"));

    expect(h.fetchAdmin).toHaveBeenCalledWith({ status: "pending", q: "" });
  });

  it.each([
    ["all", "adminComments.status.all"],
    ["approved", "adminComments.status.approved"],
    ["spam", "adminComments.status.spam"],
    ["deleted", "adminComments.status.deleted"],
  ] as const)("filtr %s jedzie do zapytania, nie tylko na ekran", async (status, key) => {
    await mountWith(threeRows());

    await pickStatus(t(key));

    await waitFor(() => expect(h.fetchAdmin).toHaveBeenCalledWith({ status, q: "" }));
  });

  it("fraza szukania jedzie do zapytania (a nie filtruje listy w przeglądarce)", async () => {
    // Filtrowanie po stronie klienta na 200 wierszach limitu kłamałoby: fraza
    // nieobecna w oknie wyglądałaby jak „nie ma takiego komentarza”.
    await mountWith(threeRows());

    fireEvent.change(screen.getByPlaceholderText(t("adminComments.searchPlaceholder")), {
      target: { value: "nowelizacja" },
    });

    await waitFor(() =>
      expect(h.fetchAdmin).toHaveBeenCalledWith({ status: "pending", q: "nowelizacja" }),
    );
  });
});

describe("/admin/comments - reguła zaznaczenia z @/lib/comments/selection", () => {
  it("trasa NIE ma własnej kopii logiki zaznaczenia", () => {
    // Zachowanie mierzą testy niżej; ta asercja pilnuje, że mierzą ZASADĘ,
    // a nie jej duplikat. Gdyby ktoś wkleił logikę do komponentu, testy
    // zachowania dalej by przechodziły, a reguła na 100% przestałaby cokolwiek
    // znaczyć.
    expect(ROUTE_SRC).toMatch(/from "@\/lib\/comments\/selection"/);
    for (const fn of ["retainExisting", "selectAllState", "toggleSelectAll", "toggleSelected"]) {
      expect(ROUTE_SRC).toMatch(new RegExp(`\\b${fn}\\b`));
      expect(ROUTE_SRC).not.toMatch(new RegExp(`function ${fn}\\b`));
    }
  });

  it("checkbox nagłówka jest TRÓJSTANOWY i stan bierze z selectAllState", async () => {
    await mountWith(threeRows());
    const box = headCheckbox();

    // żaden
    expect(box).toHaveAttribute("aria-checked", "false");
    expect(lastSelectionCall("selectAllState")).toMatchObject({
      a: ["c-1", "c-2", "c-3"],
      b: [],
    });

    // część - stan „mixed”, bo „zaznaczone” i „niezaznaczone” to za mało:
    // operator musi widzieć, że kliknięcie nagłówka DOZNACZY, a nie odznaczy.
    fireEvent.click(rowCheckboxes()[0]!);
    await waitFor(() => expect(headCheckbox()).toHaveAttribute("aria-checked", "mixed"));
    expect(lastSelectionCall("selectAllState")).toMatchObject({ b: ["c-1"] });

    // wszystkie
    fireEvent.click(rowCheckboxes()[1]!);
    fireEvent.click(rowCheckboxes()[2]!);
    await waitFor(() => expect(headCheckbox()).toHaveAttribute("aria-checked", "true"));
    expect(lastSelectionCall("selectAllState")).toMatchObject({ b: ["c-1", "c-2", "c-3"] });
  });

  it("„zaznacz wszystkie” bierze WIDOCZNE id, a drugie kliknięcie je zdejmuje", async () => {
    await mountWith(threeRows());

    fireEvent.click(headCheckbox());
    await screen.findByText(countLabel(3));
    expect(lastSelectionCall("toggleSelectAll")).toMatchObject({
      a: ["c-1", "c-2", "c-3"],
      b: [],
    });

    fireEvent.click(headCheckbox());
    await screen.findByText(countLabel(0));
    expect(lastSelectionCall("toggleSelectAll")).toMatchObject({
      a: ["c-1", "c-2", "c-3"],
      b: ["c-1", "c-2", "c-3"],
    });
  });

  it("„Wyczyść” zdejmuje wszystko i sam znika razem z zaznaczeniem", async () => {
    await mountWith(threeRows());
    fireEvent.click(headCheckbox());
    await screen.findByText(countLabel(3));

    fireEvent.click(screen.getByRole("button", { name: t("adminComments.selection.clear") }));

    await screen.findByText(countLabel(0));
    expect(screen.queryByRole("button", { name: t("adminComments.selection.clear") })).toBeNull();
  });

  it("pojedynczy wiersz przełącza się w obie strony przez toggleSelected", async () => {
    await mountWith(threeRows());

    fireEvent.click(rowCheckboxes()[1]!);
    await screen.findByText(countLabel(1));
    expect(lastSelectionCall("toggleSelected")).toMatchObject({ a: [], b: ["c-2"] });

    fireEvent.click(rowCheckboxes()[1]!);
    await screen.findByText(countLabel(0));
    expect(lastSelectionCall("toggleSelected")).toMatchObject({ a: ["c-2"], b: ["c-2"] });
  });

  it("ZAZNACZANIA ZAKRESU SHIFTEM NIE MA - ani w regule, ani w trasie", async () => {
    // Zlecenie kazało tego dowieść. Dowód wyszedł NEGATYWNY i tak zostaje
    // zapisany: `@/lib/comments/selection` eksportuje cztery funkcje
    // (`selectAllState`, `toggleSelected`, `toggleSelectAll`, `retainExisting`)
    // i żadna nie zna pojęcia kotwicy ani zakresu, a trasa nie czyta
    // `shiftKey` - `onCheckedChange` Radiksa nawet nie niesie zdarzenia.
    // Kontrakt brzmi więc: shift NIE ROBI NIC PONAD zwykłe kliknięcie.
    // Gdyby zakres kiedyś dołożono, ten test zapali się pierwszy.
    expect(SELECTION_SRC).not.toMatch(/shift|anchor|range|zakres/i);
    expect(ROUTE_SRC).not.toMatch(/shiftKey/);

    await mountWith(threeRows());
    fireEvent.click(rowCheckboxes()[0]!);
    await screen.findByText(countLabel(1));
    fireEvent.click(rowCheckboxes()[2]!, { shiftKey: true });

    // Gdyby shift działał, byłyby trzy. Są dwa - klikniete i tylko klikniete.
    await screen.findByText(countLabel(2));
  });

  it("ZAZNACZENIE NIE PRZEŻYWA zmiany filtra - nawet gdy te same wiersze zostają", async () => {
    // KONTRAKT USTALONY Z KODU, nie z życzenia. Zmiana statusu zmienia klucz
    // zapytania, więc `data` na moment wraca `undefined`, `rows` to `[]`,
    // a efekt woła `retainExisting(prev, [])`. To CELOWE: akcja zbiorcza
    // wykonana po zmianie filtra celowałaby w wiersze, których operator już
    // nie widzi. Test pilnuje tego przypadku granicznego, w którym nowa lista
    // zawiera DOKŁADNIE te same id - zaznaczenie i tak ma zniknąć.
    await mountWith(threeRows());
    fireEvent.click(headCheckbox());
    await screen.findByText(countLabel(3));

    await pickStatus(t("adminComments.status.approved"));

    await waitFor(() => expect(h.fetchAdmin).toHaveBeenCalledWith({ status: "approved", q: "" }));
    await screen.findByText(countLabel(0));
    expect(lastSelectionCall("retainExisting").b).toEqual(["c-1", "c-2", "c-3"]);
  });

  it("po odświeżeniu listy zaznaczenie traci ZNIKNIĘTE id, a zachowuje obecne", async () => {
    // Bez `retainExisting` licznik po moderacji pojedynczego wiersza kłamie
    // („Zaznaczono: 2”, choć jeden z nich wypadł z filtra), a akcja zbiorcza
    // wysyła id nieobecne na ekranie.
    await mountWith(threeRows());
    fireEvent.click(rowCheckboxes()[0]!);
    fireEvent.click(rowCheckboxes()[2]!);
    await screen.findByText(countLabel(2));

    // Zatwierdzenie c-1 wypycha go z filtra „oczekujące”; unieważnienie
    // z `onSuccess` wymusza odczyt, który oddaje już tylko c-2 i c-3.
    h.fetchAdmin.mockResolvedValue([threeRows()[1]!, threeRows()[2]!]);
    fireEvent.click(screen.getAllByRole("button", { name: /Zatwierdź$/ })[0]!);

    await waitFor(() => expect(h.moderate).toHaveBeenCalledWith("c-1", "approved"));
    await screen.findByText(countLabel(1));
    const call = lastSelectionCall("retainExisting");
    expect(call.b).toEqual(["c-2", "c-3"]);
    expect(call.a).toContain("c-3");
  });
});

describe("/admin/comments - operacja HURTOWA: potwierdzenie przed zniszczeniem", () => {
  it("zatwierdzenie hurtem NIE pyta - to jedyna akcja odwracalna jednym kliknięciem", async () => {
    // Świadoma asymetria, nie przeoczenie: „zatwierdź” da się cofnąć
    // filtrem + „Oznacz jako spam”, a „usuń” trzeba by odkopywać z bazy.
    await mountWith(threeRows());
    fireEvent.click(headCheckbox());
    await screen.findByText(countLabel(3));

    fireEvent.click(bulkButton("approve"));

    await waitFor(() => expect(h.bulk).toHaveBeenCalledWith(["c-1", "c-2", "c-3"], "approved"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it.each([
    ["spam", "spam", "confirmSpamBody"],
    ["delete", "deleted", "confirmDeleteBody"],
  ] as const)(
    "akcja %s PYTA i nazywa liczbę objętych wierszy, zanim cokolwiek zrobi",
    async (button, _newStatus, bodyKey) => {
      await mountWith(threeRows());
      fireEvent.click(rowCheckboxes()[0]!);
      fireEvent.click(rowCheckboxes()[1]!);
      await screen.findByText(countLabel(2));

      fireEvent.click(bulkButton(button));

      const box = dialog();
      expect(within(box).getByText(t("adminComments.bulk.confirmTitle"))).toBeInTheDocument();
      // Liczba w treści pytania jest warunkiem sensu: „usunąć zaznaczone?”
      // bez liczby nie pozwala złapać pomyłki „zaznaczyłem wszystkie 200”.
      expect(
        within(box).getByText(t(`adminComments.bulk.${bodyKey}`, { count: 2 })),
      ).toBeInTheDocument();
      expect(h.bulk).not.toHaveBeenCalled();
    },
  );

  it.each(["spam", "delete"] as const)(
    "ODMOWA w dialogu (%s) nie woła mutacji i nie rusza zaznaczenia",
    async (button) => {
      await mountWith(threeRows());
      fireEvent.click(rowCheckboxes()[0]!);
      fireEvent.click(rowCheckboxes()[1]!);
      await screen.findByText(countLabel(2));

      fireEvent.click(bulkButton(button));
      fireEvent.click(dialogButton("cancel"));

      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
      expect(h.bulk).not.toHaveBeenCalled();
      // Zaznaczenie ma przetrwać anulowanie - inaczej „Anuluj” karze operatora
      // za ostrożność i każe zaznaczać dwieście wierszy od nowa.
      expect(screen.getByText(countLabel(2))).toBeInTheDocument();
    },
  );

  it.each([
    ["spam", "spam"],
    ["delete", "deleted"],
  ] as const)(
    "POTWIERDZENIE (%s) wysyła DOKŁADNIE zaznaczone id i ten status",
    async (button, newStatus) => {
      await mountWith(threeRows());
      fireEvent.click(rowCheckboxes()[0]!);
      fireEvent.click(rowCheckboxes()[2]!);
      await screen.findByText(countLabel(2));

      fireEvent.click(bulkButton(button));
      fireEvent.click(dialogButton("confirm"));

      // Nie „dwa id”, tylko TE dwa: pomyłka o jeden wiersz w kasowaniu jest
      // nieodwracalna, więc asercja jest na równość, nie na długość.
      await waitFor(() => expect(h.bulk).toHaveBeenCalledWith(["c-1", "c-3"], newStatus));
      expect(h.bulk).toHaveBeenCalledTimes(1);
    },
  );
});

describe("/admin/comments - operacja HURTOWA: skutki", () => {
  it("sukces unieważnia klucz listy, czyści zaznaczenie i podaje LICZBĘ", async () => {
    const queryClient = testClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await mountWith(threeRows(), queryClient);
    fireEvent.click(headCheckbox());
    await screen.findByText(countLabel(3));

    fireEvent.click(bulkButton("approve"));

    await waitFor(() => expect(h.bulk).toHaveBeenCalledTimes(1));
    // Bez unieważnienia lista przez `staleTime: 15_000` pokazuje wiersze, które
    // właśnie wypadły z filtra - operator klika w nie po raz drugi.
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin-comments"] }));
    await screen.findByText(countLabel(0));
    expect(h.toasts).toContainEqual({
      kind: "success",
      text: t("adminComments.bulk.done", { count: 3 }),
    });
  });

  it("PORAŻKA serwera nie zostawia UI w stanie „zrobione”", async () => {
    // Trzy rzeczy naraz, bo każda osobno dałaby fałszywe poczucie
    // bezpieczeństwa: jest toast błędu, zaznaczenie ZOSTAJE (operator może
    // ponowić bez zaznaczania od nowa) i klucz NIE jest unieważniany (lista
    // nie udaje, że coś się zmieniło).
    const queryClient = testClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await mountWith(threeRows(), queryClient);
    fireEvent.click(rowCheckboxes()[0]!);
    fireEvent.click(rowCheckboxes()[1]!);
    await screen.findByText(countLabel(2));
    h.bulk.mockRejectedValue(new Error("odmowa bazy"));

    fireEvent.click(bulkButton("delete"));
    fireEvent.click(dialogButton("confirm"));

    await waitFor(() =>
      expect(h.toasts).toContainEqual({ kind: "error", text: t("adminComments.error") }),
    );
    expect(screen.getByText(countLabel(2))).toBeInTheDocument();
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ["admin-comments"] });
  });

  it("w trakcie operacji zbiorczej wszystkie trzy przyciski są zablokowane", async () => {
    // Dwuklik na „Usuń zaznaczone” nie może wysłać dwóch operacji, a przejście
    // z „usuń” na „spam” w locie zostawiłoby wiersze w losowym stanie.
    h.bulk.mockReturnValue(new Promise<number>(() => {}));
    await mountWith(threeRows());
    fireEvent.click(headCheckbox());
    await screen.findByText(countLabel(3));

    fireEvent.click(bulkButton("approve"));

    await waitFor(() => expect(bulkButton("approve")).toBeDisabled());
    expect(bulkButton("spam")).toBeDisabled();
    expect(bulkButton("delete")).toBeDisabled();
  });

  it("bez zaznaczenia wszystkie trzy przyciski zbiorcze są zablokowane", async () => {
    // Pierwsza bariera przed operacją niszczącą na pustym zbiorze - druga
    // (`if (selected.size === 0) return`) siedzi w `runBulk`.
    await mountWith(threeRows());

    expect(screen.getByText(countLabel(0))).toBeInTheDocument();
    expect(bulkButton("approve")).toBeDisabled();
    expect(bulkButton("spam")).toBeDisabled();
    expect(bulkButton("delete")).toBeDisabled();
    expect(h.bulk).not.toHaveBeenCalled();
  });
});

describe("/admin/comments - moderacja pojedynczego wiersza", () => {
  it.each([
    ["approve", "approved"],
    ["spam", "spam"],
    ["delete", "deleted"],
  ] as const)("akcja %s w wierszu woła moderateComment z id TEGO wiersza", async (key, status) => {
    await mountWith([row({ id: "c-7", body: "Wypowiedź do rozstrzygnięcia." })]);

    const item = screen.getByRole("listitem");
    fireEvent.click(
      within(item).getByRole("button", {
        name: new RegExp(`^${t(`adminComments.actions.${key}`)}$`),
      }),
    );

    await waitFor(() => expect(h.moderate).toHaveBeenCalledWith("c-7", status));
  });

  it("wiersz nie proponuje statusu, który już ma", async () => {
    // Przycisk „Zatwierdź” na zatwierdzonym komentarzu to zapis bez zmiany:
    // unieważnia listę, pokazuje „Zapisano” i uczy operatora, że klikanie nic
    // nie znaczy.
    await mountWith([
      row({ id: "c-p", status: "pending" }),
      row({ id: "c-a", status: "approved" }),
      row({ id: "c-s", status: "spam" }),
      row({ id: "c-d", status: "deleted" }),
    ]);
    const items = screen.getAllByRole("listitem");
    const names = (el: HTMLElement) =>
      within(el)
        .getAllByRole("button")
        .map((b) => (b.textContent ?? "").trim());

    expect(names(items[0]!)).toEqual(["Zatwierdź", "Spam", "Usuń"]);
    expect(names(items[1]!)).toEqual(["Spam", "Usuń"]);
    expect(names(items[2]!)).toEqual(["Zatwierdź", "Usuń"]);
    expect(names(items[3]!)).toEqual(["Zatwierdź", "Spam"]);
  });

  it("sukces unieważnia listę i potwierdza zapis", async () => {
    const queryClient = testClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await mountWith([row({ id: "c-9" })], queryClient);

    fireEvent.click(screen.getByRole("button", { name: /^Zatwierdź$/ }));

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin-comments"] }));
    expect(h.toasts).toContainEqual({ kind: "success", text: t("adminComments.saved") });
  });

  it("odmowa zapisu kończy się toastem błędu, nie ciszą", async () => {
    h.moderate.mockRejectedValue(new Error("odmowa bazy"));
    await mountWith([row({ id: "c-9" })]);

    fireEvent.click(screen.getByRole("button", { name: /^Usuń$/ }));

    await waitFor(() =>
      expect(h.toasts).toContainEqual({ kind: "error", text: t("adminComments.error") }),
    );
  });

  it("w trakcie zapisu akcje wiersza są zablokowane", async () => {
    h.moderate.mockReturnValue(new Promise<void>(() => {}));
    await mountWith([row({ id: "c-9" })]);

    fireEvent.click(screen.getByRole("button", { name: /^Spam$/ }));

    await waitFor(() => expect(screen.getByRole("button", { name: /^Spam$/ })).toBeDisabled());
    expect(screen.getByRole("button", { name: /^Zatwierdź$/ })).toBeDisabled();
  });
});

describe("/admin/comments - wiersz: kto, kiedy, pod czym", () => {
  it("podpisany profil wygrywa z podpisem gościa, a status niesie odznaka", async () => {
    await mountWith([
      row({
        id: "c-1",
        status: "spam",
        author: { id: "user-1", display_name: "Zetka Testowa", avatar_url: null, slug: "zt" },
        author_name: "podpis-do-zignorowania",
      }),
    ]);

    const item = screen.getByRole("listitem");
    expect(within(item).getByText("Zetka Testowa")).toBeInTheDocument();
    expect(within(item).queryByText("podpis-do-zignorowania")).toBeNull();
    expect(within(item).getByText(t("adminComments.status.spam"))).toBeInTheDocument();
    expect(within(item).queryByText(`(${t("adminComments.guest")})`)).toBeNull();
  });

  it("wpis GOŚCIA jest oznaczony jako gość - to zmienia wagę decyzji", async () => {
    // Komentarz bez konta nie ma historii ani reputacji; moderator musi
    // widzieć, że ocenia anonim, zanim kliknie „Zatwierdź”.
    await mountWith([
      row({
        id: "c-2",
        user_id: null,
        author: null,
        author_name: "Gość Testowy",
        body: "Zmyślony wpis gościa, kontakt: gosc@example.com",
      }),
    ]);

    const item = screen.getByRole("listitem");
    expect(within(item).getByText(/Gość Testowy/)).toBeInTheDocument();
    expect(within(item).getByText(`(${t("adminComments.guest")})`)).toBeInTheDocument();
  });

  it("brak jakiegokolwiek podpisu i brak wpisu dają „-”, nie puste miejsce", async () => {
    await mountWith([
      row({ id: "c-3", user_id: null, author: null, author_name: null, post: null }),
    ]);

    const item = screen.getByRole("listitem");
    // Dwa myślniki: podpis autora i tytuł wpisu. Puste miejsce wyglądałoby jak
    // błąd renderu, „-” mówi „nie wiemy”.
    expect(within(item).getAllByText("-")).toHaveLength(2);
  });

  it("kontekst wiersza to tytuł wpisu, a bez tytułu - slug", async () => {
    await mountWith([
      row({
        id: "c-4",
        post: { id: "p", slug: "wpis-bez-tytulu", title_pl: null, title_en: null },
      }),
    ]);

    expect(screen.getByTitle("wpis-bez-tytulu")).toBeInTheDocument();
  });

  it("czas komentarza jest maszynowo czytelny w `dateTime`", async () => {
    // Sformatowany napis zależy od locale maszyny; `dateTime` to kontrakt
    // stabilny i to on niesie znaczenie dla czytnika ekranu.
    await mountWith([row({ id: "c-5", created_at: BASE_ISO })]);

    const time = screen.getByRole("listitem").querySelector("time");
    if (time === null) throw new Error("test: wiersz kolejki bez znacznika <time>");
    expect(time).toHaveAttribute("dateTime", BASE_ISO);
  });

  it("po angielsku wiersz bierze angielski tytuł wpisu", async () => {
    // Jedyna gałąź językowa komponentu: `lang` steruje wyborem `title_pl` vs
    // `title_en` ORAZ locale daty. Bez tego testu połowa tej gałęzi nigdy nie
    // biegnie, a panel dwujęzyczny jest w tym repo wymaganiem, nie ozdobą.
    await i18n.changeLanguage("en");
    await mountWith([
      row({
        id: "c-6",
        post: { id: "p", slug: "s", title_pl: "Tytuł polski", title_en: "English title" },
      }),
    ]);

    expect(screen.getByTitle("English title")).toBeInTheDocument();
    expect(screen.queryByTitle("Tytuł polski")).toBeNull();
    // Napisy też jadą z angielskiego słownika - dowód, że to ten sam przełącznik.
    expect(screen.getByRole("heading", { name: tEn("adminComments.title") })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// UPRAWNIENIA I NAJEMCA. Patrz USTALENIE w nagłówku pliku. Poniżej mierzymy
// dokładnie to, co jest - żaden z tych testów nie udaje, że ta trasa albo ta
// warstwa danych kogokolwiek odsiewa.
// ---------------------------------------------------------------------------

describe("/admin/comments - gdzie stoi bramka uprawnień", () => {
  it("ta trasa NIE bramkuje dostępu sama - renderuje się bez pytania o rolę", async () => {
    // Dowód pozytywny: harness nie ma żadnej sesji, a panel się rysuje. To nie
    // dziura, tylko podział pracy - jedna bramka w layoucie zamiast kopii
    // w każdej trasie. Gdyby ktoś dołożył warunek roli TUTAJ, ten test zapali
    // się pierwszy i wymusi aktualizację opisu.
    await mountWith(threeRows());

    expect(screen.getByRole("heading", { name: t("adminComments.title") })).toBeInTheDocument();
    expect(ROUTE_SRC).not.toMatch(/isStaff|isAdmin|isSuperAdmin|useAuth/);
    expect(ROUTE_SRC).not.toMatch(/beforeLoad|redirect\(|<Navigate/);
  });

  it("bramka renderu żyje w layoucie `/admin` i prowadzi na /login", () => {
    // Odczyt pliku, nie render: layout jest RODZICEM tej trasy, a harness
    // montuje pojedynczą trasę pod zastępczym korzeniem, więc renderem nie da
    // się go tu dosięgnąć.
    const layout = readFileSync("src/routes/admin.tsx", "utf8");
    expect(layout).toMatch(/isStaff/);
    expect(layout).toMatch(/navigate\(\{\s*to:\s*"\/login"\s*\}\)/);
  });
});

describe("/admin/comments - izolacja najemcy", () => {
  it("odczyt kolejki idzie ZWYKŁYM klientem, nie serwerową funkcją", () => {
    // Ustalenie rozstrzyga, czym w ogóle można dowodzić uprawnień: gdyby to
    // była `createServerFn`, dowodem byłaby lista middleware ze
    // `@/test/serverFnHarness`. Nie jest - więc dowód siedzi w migracji.
    expect(API_SRC).not.toMatch(/createServerFn/);
    expect(API_SRC).toMatch(/export async function fetchAdminComments/);
    expect(API_SRC).toMatch(/export async function bulkModerateComments/);
    expect(API_SRC).toMatch(/supabase\s*\n?\s*\.from\("comments"\)/);
  });

  it("zapytanie kolejki NIE ma własnego predykatu najemcy - to świadome oddanie pola RLS", () => {
    // Filtry to wyłącznie status i fraza. Dopisanie tu `.eq("tenant_id", ...)`
    // z wartości czytanej w przeglądarce byłoby pozorem bezpieczeństwa
    // (klient może podać dowolną), więc jedynym autorytetem jest polityka.
    const fn = API_SRC.slice(API_SRC.indexOf("export async function fetchAdminComments"));
    expect(fn).toMatch(/query\.eq\("status", filter\.status\)/);
    expect(fn).not.toMatch(/tenant_id/);
  });

  it("predykat najemcy dla personelu stoi w politykach SELECT i UPDATE", () => {
    // Oba kierunki mają znaczenie: SELECT decyduje, CZYJE komentarze widać
    // w kolejce, UPDATE - czyje wolno zmasakrować akcją zbiorczą.
    for (const policy of ["comments_staff_select", "comments_staff_update"]) {
      const body = policyBody(policy);
      expect(body).toMatch(/tenant_id = \(SELECT public\.current_tenant_id\(\)\)/);
      expect(body).toMatch(/has_role\(\(SELECT auth\.uid\(\)\), 'admin'::app_role\)/);
    }
  });

  it.fails("polityka `comments_own_select` powinna też być zawężona do najemcy", () => {
    // ZNALEZISKO, NIE NAPRAWA (brief pkt 6). Polityki SELECT są OR-owane,
    // a `comments_own_select` brzmi `USING (user_id = auth.uid())` - bez
    // najemcy. Lista panelu nie filtruje ani po wpisie, ani po najemcy, więc
    // moderator zobaczy w SWOJEJ kolejce także własne komentarze zostawione
    // u INNEGO najemcy, a `comments_own_update` pozwoli mu je stamtąd ruszyć.
    // Na publicznej liście to niewidoczne (`fetchPostComments` filtruje po
    // `post_id`), więc ta kolejka jest jedyną powierzchnią, która to odsłania.
    // Naprawa jest po stronie migracji + pgTAP, nie tej trasy.
    // Kontrola dodatnia stoi w teście wyżej: `comments_staff_select` predykat
    // najemcy MA, więc ta asercja nie pada z powodu złego wzorca.
    expect(policyBody("comments_own_select")).toMatch(/tenant_id/);
  });
});

describe("/admin/comments - dostępność", () => {
  it("cała powierzchnia decyzyjna ma DOKŁADNIE jedno znane naruszenie axe", async () => {
    // Widok mierzony w stanie „coś jest zaznaczone”: wtedy na ekranie są
    // JEDNOCZEŚNIE trójstanowy checkbox nagłówka, checkboxy wierszy, cztery
    // przyciski zbiorcze, akcje wierszy i droplista filtra - czyli cała
    // powierzchnia, na której operator podejmuje decyzje niszczące.
    //
    // ZNALEZISKO: jedynym naruszeniem jest BEZIMIENNA droplista filtra.
    // `SelectTrigger` Radiksa ma `role="combobox"`, a dla tej roli nazwa NIE
    // pochodzi z zawartości - „Oczekujące” w środku nie jest nazwą, tylko
    // wartością. Bez `aria-label` czytnik ekranu ogłasza „przycisk” i nic
    // więcej. To wzorzec repo, nie wpadka tej trasy: z ponad czterystu użyć
    // `<SelectTrigger>` w `src/` `aria-label` niesie ledwie kilkadziesiąt -
    // dlatego naprawa nie mieści się w tym pakiecie i jest przypięta niżej
    // jako `it.fails`.
    //
    // Ta asercja jest CELOWO na równość, nie na „przynajmniej tyle”: gdyby
    // doszło JAKIEKOLWIEK inne naruszenie (przycisk bez nazwy w pasku
    // zbiorczym, checkbox bez etykiety), lista przestanie się zgadzać i test
    // zapali się natychmiast, zamiast schować nowy błąd za starym.
    const { container } = await mountWith(threeRows());
    fireEvent.click(rowCheckboxes()[0]!);
    await screen.findByText(countLabel(1));

    const violations = await axeViolations(container);
    expect(
      violations.map((v) => v.id),
      summarize(violations),
    ).toEqual(["button-name"]);
    const nodes = violations[0]?.nodes ?? [];
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.html).toContain('role="combobox"');
  });

  it.fails("droplista filtra POWINNA mieć nazwę dostępną", async () => {
    // DEFEKT, NIE NAPRAWA (brief pkt 6). Zlecenie nie mówi „napraw”, a poprawka
    // (`<SelectTrigger aria-label={t("adminComments.status.all")}>` albo nowy
    // klucz etykiety) dotknęłaby wzorca powielonego w całym repo.
    // KONTROLA DODATNIA: test wyżej dowodzi, że reszta widoku - w tym wszystkie
    // przyciski operacji niszczących - przechodzi axe czysto, więc ta asercja
    // nie pada z powodu źle użytego narzędzia.
    const { container } = await mountWith(threeRows());

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("dialog potwierdzenia operacji niszczącej nie ma naruszeń axe", async () => {
    // Osobno, bo to JEDYNY moment, w którym da się jeszcze zawrócić: dialog bez
    // poprawnej nazwy i opisu jest dla czytnika ekranu pustym pytaniem.
    await mountWith(threeRows());
    fireEvent.click(headCheckbox());
    await screen.findByText(countLabel(3));
    fireEvent.click(bulkButton("delete"));

    const violations = await axeViolations(dialog());
    expect(violations, summarize(violations)).toEqual([]);
  });
});
