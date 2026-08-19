// CO DOWODZI TEN PLIK: karta „Autorzy" utrzymuje JEDNĄ uporządkowaną listę,
// w której PIERWSZA pozycja jest autorem głównym wpisu (`posts.author_id`),
// a kolejne to współautorzy (`post_authors.sort_order`). Zapis idzie osobną
// funkcją serwerową, więc karta ma własny stan roboczy (draft) i własny
// przycisk zapisu - niezależny od autozapisu treści.
//
// DLACZEGO TO WAŻNE DLA UŻYTKOWNIKA:
//   * kolejność JEST znaczeniem: pierwszy autor trafia do stopki wpisu, do
//     JSON-LD i do strony autora. Przestawienie strzałkami musi zmieniać
//     autora GŁÓWNEGO, inaczej redakcja „ustawia" atrybucję, która nigdzie się
//     nie pokazuje,
//   * lista osób do wyboru musi być zawężona do TENANTA - podpowiedź osoby
//     z innej redakcji to wyciek katalogu pracowników między najemcami,
//   * lista nie może się opróżnić (wpis bez autora nie da się przypisać) ani
//     zdublować (ten sam człowiek dwa razy w stopce),
//   * błąd zapisu MUSI być pokazany i NIE MOŻE czyścić stanu roboczego -
//     inaczej redaktor traci ustawioną kolejność i myśli, że zapisał.
//
// Asercje idą po KLUCZACH i18n (stub `reactI18nextStub`), nie po copy.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { EDITOR_IDS } from "@/test/post-editor/fixtures";
import { ok, fail, type SupabaseFromStub, type SupabaseResult } from "@/test/supabaseChain";

const stubs = vi.hoisted(() => ({
  from: null as unknown,
  toast: null as unknown,
  save: null as unknown,
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  stubs.from = from;
  return {
    supabase: { from: from.from, rpc: vi.fn(async () => ({ data: null, error: null })) },
  };
});

vi.mock("react-i18next", async () =>
  (await import("@/test/post-editor/fixtures")).reactI18nextStub(),
);
vi.mock("@/lib/i18n-admin-post-panes", () => ({}));

// `useServerFn` w produkcji tylko owija funkcję serwerową - oddajemy ją wprost.
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));

vi.mock("@/lib/content.functions", async () => {
  const { vi: v } = await import("vitest");
  const save = v.fn(async () => ({ ok: true as const }));
  stubs.save = save;
  return { setPostAuthors: save };
});

vi.mock("sonner", async () => {
  const { toastStub } = await import("@/test/post-editor/fixtures");
  const toast = toastStub();
  stubs.toast = toast;
  return { toast, Toaster: () => null };
});

import { PostAuthorsCard } from "../PostAuthorsCard";

const db = stubs.from as SupabaseFromStub;
const toast = () =>
  stubs.toast as ReturnType<typeof import("@/test/post-editor/fixtures").toastStub>;
const save = () => stubs.save as ReturnType<typeof vi.fn>;

const K = {
  hint: "adminPostPanes.authors.hint",
  unknown: "adminPostPanes.authors.unknown",
  main: "adminPostPanes.authors.mainBadge",
  co: (n: number) => `adminPostPanes.authors.coBadge {"n":${n}}`,
  up: "adminPostPanes.authors.moveUp",
  down: "adminPostPanes.authors.moveDown",
  remove: "adminPostPanes.authors.remove",
  add: "adminPostPanes.authors.addPlaceholder",
  none: "adminPostPanes.authors.noneAvailable",
  save: "adminPostPanes.authors.save",
  cancel: "adminPostPanes.authors.cancel",
  saved: "adminPostPanes.authors.saved",
} as const;

/** Kształt wiersza z `profiles`, jaki czyta `useTenantAuthors`. */
interface Person {
  id: string;
  display_name: string | null;
  slug: string | null;
  avatar_url: string | null;
}

const ANNA: Person = {
  id: "user-anna",
  display_name: "Anna Nowak",
  slug: "anna",
  avatar_url: null,
};
const BARTEK: Person = {
  id: "user-bartek",
  display_name: "Bartek Lis",
  slug: "bartek",
  avatar_url: "https://example.com/b.png",
};
// Celina nie ma nazwy wyświetlanej - etykieta spada na slug (`authorLabel`).
const CELINA: Person = { id: "user-celina", display_name: null, slug: "celina", avatar_url: null };

/** Etykiety, jakie karta ma pokazać dla powyższych osób. */
const NAME = { anna: "Anna Nowak", bartek: "Bartek Lis", celina: "celina" } as const;

/** Domyślny katalog osób najemcy - w kolejności, jaką zwraca zapytanie. */
const DIRECTORY: Person[] = [ANNA, BARTEK, CELINA];

function plan(options: { people?: SupabaseResult; coAuthors?: SupabaseResult }): void {
  db.setResponse("profiles", options.people ?? ok(DIRECTORY));
  db.setResponse("post_authors", options.coAuthors ?? ok([]));
}

function renderCard(options: { mainAuthorId?: string | null; tenantId?: string | null } = {}) {
  const { mainAuthorId = ANNA.id, tenantId = EDITOR_IDS.tenant } = options;
  return renderWithQueryClient(
    <PostAuthorsCard postId={EDITOR_IDS.post} tenantId={tenantId} mainAuthorId={mainAuthorId} />,
  );
}

/** Etykiety w kolejności renderu - to jest widoczny kontrakt karty. */
function names(): string[] {
  return screen.queryAllByRole("listitem").map((li) => {
    const heading = li.querySelector("p");
    return heading?.textContent ?? "";
  });
}

function rowOf(name: string): HTMLElement {
  const item = screen.getAllByRole("listitem").find((li) => li.textContent?.includes(name));
  if (!item) throw new Error(`brak wiersza autora „${name}"`);
  return item;
}

function click(name: string, label: string): void {
  fireEvent.click(within(rowOf(name)).getByRole("button", { name: label }));
}

/** Otwiera listę Radiksa klawiaturą (pointer events nie działają w happy-dom). */
function openPicker(): HTMLElement {
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
  return screen.getByRole("listbox");
}

const saveButton = () => screen.getByRole("button", { name: K.save });

beforeEach(() => {
  db.reset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PostAuthorsCard - skąd bierze się lista i czyja jest", () => {
  it("współautorów czyta dla TEGO wpisu i w rosnącej kolejności", async () => {
    plan({ coAuthors: ok([{ user_id: BARTEK.id, sort_order: 0 }]) });
    renderCard();
    await screen.findByText(NAME.bartek);

    const chain = db.lastChain("post_authors");
    expect(chain?.argsOf("eq")).toEqual(["post_id", EDITOR_IDS.post]);
    // Rosnąco, bo `sort_order` odwzorowuje kolejność w stopce wpisu.
    expect(chain?.argsOf("order")).toEqual(["sort_order", { ascending: true }]);
  });

  it("katalog osób jest zawężony do tenanta (izolacja najemców)", async () => {
    plan({});
    renderCard();
    await waitFor(() => expect(db.lastChain("profiles")).toBeDefined());
    expect(db.lastChain("profiles")?.argsOf("eq")).toEqual(["tenant_id", EDITOR_IDS.tenant]);
  });

  it("autor główny stoi PIERWSZY z odznaką autora głównego, współautorzy numerowani", async () => {
    plan({
      coAuthors: ok([
        { user_id: BARTEK.id, sort_order: 0 },
        { user_id: CELINA.id, sort_order: 1 },
      ]),
    });
    renderCard();
    await screen.findByText(NAME.bartek);

    expect(names()).toEqual([NAME.anna, NAME.bartek, NAME.celina]);
    expect(within(rowOf(NAME.anna)).getByText(K.main)).toBeInTheDocument();
    expect(within(rowOf(NAME.bartek)).getByText(K.co(1))).toBeInTheDocument();
    expect(within(rowOf(NAME.celina)).getByText(K.co(2))).toBeInTheDocument();
  });

  it("autor główny obecny też w post_authors pokazuje się RAZ", async () => {
    // Duplikat w stopce wygląda jak błąd redakcji, a nie jak stan bazy.
    plan({
      coAuthors: ok([
        { user_id: ANNA.id, sort_order: 0 },
        { user_id: BARTEK.id, sort_order: 1 },
      ]),
    });
    renderCard();
    await screen.findByText(NAME.bartek);
    expect(names()).toEqual([NAME.anna, NAME.bartek]);
  });

  it("wpis bez autora głównego pokazuje samych współautorów", async () => {
    plan({ coAuthors: ok([{ user_id: BARTEK.id, sort_order: 0 }]) });
    renderCard({ mainAuthorId: null });
    await screen.findByText(NAME.bartek);
    expect(names()).toEqual([NAME.bartek]);
  });

  it("osoba spoza katalogu tenanta dostaje etykietę „nieznany”, a nie pusty wiersz", async () => {
    // Wiersz bez etykiety byłby nieusuwalny „duch" - redaktor nie wie, kogo
    // usuwa, a atrybucja wpisu jest wtedy nie do naprawienia z panelu.
    plan({ coAuthors: ok([{ user_id: "user-obcy", sort_order: 0 }]) });
    renderCard({ mainAuthorId: null });
    await screen.findByText(K.unknown);
    expect(names()).toEqual([K.unknown]);
  });

  it("brak tenanta = brak katalogu: etykiety nieznane i nie ma kogo dodać", async () => {
    // Karta bywa montowana, zanim `tenantId` dojedzie z sesji - nie może wtedy
    // ani wybuchnąć, ani pokazać cudzych osób.
    plan({ coAuthors: ok([{ user_id: BARTEK.id, sort_order: 0 }]) });
    renderCard({ tenantId: null, mainAuthorId: null });
    await screen.findByText(K.unknown);
    expect(db.chainsFor("profiles")).toHaveLength(0);
    expect(within(openPicker()).getByRole("option")).toHaveTextContent(K.none);
  });

  it("błąd odczytu współautorów zostawia widocznego autora głównego", async () => {
    plan({ coAuthors: fail("permission denied for table post_authors") });
    renderCard();
    await screen.findByText(NAME.anna);
    expect(names()).toEqual([NAME.anna]);
  });

  it("odpowiedź bez wierszy (data = null) nie wywraca karty", async () => {
    plan({ coAuthors: ok(null) });
    renderCard();
    await screen.findByText(NAME.anna);
    expect(names()).toEqual([NAME.anna]);
  });

  it("każdy wiersz ma identyfikator wizualny: inicjały z etykiety, także ze zdjęciem", async () => {
    // Awatar Radiksa pokazuje zdjęcie dopiero PO jego wczytaniu, więc inicjały
    // są tym, co redaktor widzi w pierwszej chwili (i na stałe, gdy zdjęcie nie
    // dojdzie). Puste kwadraty w liście autorów uniemożliwiłyby rozpoznanie,
    // kogo się przesuwa - inicjały muszą być zawsze.
    plan({
      coAuthors: ok([
        { user_id: BARTEK.id, sort_order: 0 },
        { user_id: CELINA.id, sort_order: 1 },
      ]),
    });
    renderCard();
    await screen.findByText(NAME.bartek);
    // Dwa członY etykiety -> dwie litery.
    expect(within(rowOf(NAME.anna)).getByText("AN")).toBeInTheDocument();
    // Osoba ze zdjęciem dostaje ten sam identyfikator zastępczy.
    expect(within(rowOf(NAME.bartek)).getByText("BL")).toBeInTheDocument();
    // Etykieta jednoczłonowa (fallback na slug) -> jedna litera.
    expect(within(rowOf(NAME.celina)).getByText("C")).toBeInTheDocument();
  });
});

describe("PostAuthorsCard - porządkowanie listy", () => {
  async function renderTrio() {
    plan({
      coAuthors: ok([
        { user_id: BARTEK.id, sort_order: 0 },
        { user_id: CELINA.id, sort_order: 1 },
      ]),
    });
    const rendered = renderCard();
    await screen.findByText(NAME.bartek);
    return rendered;
  }

  it("strzałka w górę zmienia AUTORA GŁÓWNEGO, nie tylko kolejność wizualną", async () => {
    await renderTrio();
    click(NAME.bartek, K.up);
    expect(names()).toEqual([NAME.bartek, NAME.anna, NAME.celina]);
    // Odznaka „główny" jedzie razem z pozycją - to ona mówi redaktorowi,
    // czyje nazwisko pojawi się w stopce wpisu.
    expect(within(rowOf(NAME.bartek)).getByText(K.main)).toBeInTheDocument();
  });

  it("strzałka w dół przesuwa autora o jedną pozycję", async () => {
    await renderTrio();
    click(NAME.anna, K.down);
    expect(names()).toEqual([NAME.bartek, NAME.anna, NAME.celina]);
  });

  it("na krawędziach listy strzałki są zablokowane", async () => {
    await renderTrio();
    expect(within(rowOf(NAME.anna)).getByRole("button", { name: K.up })).toBeDisabled();
    expect(within(rowOf(NAME.celina)).getByRole("button", { name: K.down })).toBeDisabled();
  });

  it("usunięcie zdejmuje wskazaną osobę, zostawiając pozostałe w kolejności", async () => {
    await renderTrio();
    click(NAME.bartek, K.remove);
    expect(names()).toEqual([NAME.anna, NAME.celina]);
  });

  it("ostatniego autora nie da się usunąć (wpis musi mieć autora)", async () => {
    plan({ coAuthors: ok([]) });
    renderCard();
    await screen.findByText(NAME.anna);
    expect(within(rowOf(NAME.anna)).getByRole("button", { name: K.remove })).toBeDisabled();
  });

  it("dodanie z listy dokłada osobę na KONIEC jako współautora", async () => {
    plan({ coAuthors: ok([]) });
    renderCard();
    await screen.findByText(NAME.anna);
    fireEvent.click(within(openPicker()).getByRole("option", { name: NAME.bartek }));
    expect(names()).toEqual([NAME.anna, NAME.bartek]);
    expect(within(rowOf(NAME.bartek)).getByText(K.co(1))).toBeInTheDocument();
  });

  it("lista do wyboru pomija osoby już przypisane", async () => {
    plan({ coAuthors: ok([{ user_id: BARTEK.id, sort_order: 0 }]) });
    renderCard();
    await screen.findByText(NAME.bartek);
    const options = within(openPicker())
      .getAllByRole("option")
      .map((o) => o.textContent);
    // Anna i Bartek są już na liście; zostaje Celina (etykieta ze sluga).
    expect(options).toEqual([NAME.celina]);
  });

  it("gdy wszyscy są już przypisani, wybór mówi „brak dostępnych”", async () => {
    plan({
      coAuthors: ok([
        { user_id: BARTEK.id, sort_order: 0 },
        { user_id: CELINA.id, sort_order: 1 },
      ]),
    });
    renderCard();
    await screen.findByText(NAME.bartek);
    const option = within(openPicker()).getByRole("option");
    expect(option).toHaveTextContent(K.none);
    // Pozycja jest zablokowana - to komunikat, nie wybór.
    expect(option).toHaveAttribute("aria-disabled", "true");
  });

  it("przy limicie autorów pole dodawania znika", async () => {
    // MAX_POST_AUTHORS = 10; główny + 9 współautorów wypełnia limit.
    const many = Array.from({ length: 9 }, (_, i) => ({ user_id: `co-${i}`, sort_order: i }));
    plan({ coAuthors: ok(many) });
    renderCard();
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(10));
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});

describe("PostAuthorsCard - zapis stanu roboczego", () => {
  async function renderPair() {
    plan({ coAuthors: ok([{ user_id: BARTEK.id, sort_order: 0 }]) });
    const rendered = renderCard();
    await screen.findByText(NAME.bartek);
    return rendered;
  }

  it("dopóki nic nie zmieniono, zapis jest zablokowany i nie ma czego anulować", async () => {
    await renderPair();
    expect(saveButton()).toBeDisabled();
    expect(screen.queryByRole("button", { name: K.cancel })).toBeNull();
  });

  it("zapis wysyła CAŁĄ uporządkowaną listę razem z autorem głównym", async () => {
    await renderPair();
    click(NAME.bartek, K.up);
    fireEvent.click(saveButton());

    await waitFor(() => expect(save()).toHaveBeenCalledTimes(1));
    // Kontrakt funkcji serwerowej: pierwszy identyfikator to autor główny.
    expect(save()).toHaveBeenCalledWith({
      data: { id: EDITOR_IDS.post, authorIds: [BARTEK.id, ANNA.id] },
    });
  });

  it("powrót do stanu zapisanego przestaje być zmianą (brak pustego zapisu)", async () => {
    await renderPair();
    click(NAME.bartek, K.up);
    expect(saveButton()).not.toBeDisabled();
    click(NAME.anna, K.up);
    // Ta sama kolejność co w bazie - autozapis nie ma czego wysyłać.
    expect(names()).toEqual([NAME.anna, NAME.bartek]);
    expect(saveButton()).toBeDisabled();
  });

  it("anulowanie przywraca kolejność zapisaną w bazie", async () => {
    await renderPair();
    click(NAME.bartek, K.up);
    fireEvent.click(screen.getByRole("button", { name: K.cancel }));
    expect(names()).toEqual([NAME.anna, NAME.bartek]);
    expect(screen.queryByRole("button", { name: K.cancel })).toBeNull();
  });

  it("po udanym zapisie melduje sukces i odświeża panel ORAZ widok publiczny", async () => {
    plan({ coAuthors: ok([{ user_id: BARTEK.id, sort_order: 0 }]) });
    const { queryClient } = renderCard();
    await screen.findByText(NAME.bartek);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    click(NAME.bartek, K.up);
    fireEvent.click(saveButton());

    await waitFor(() => expect(toast().success).toHaveBeenCalledWith(K.saved));
    const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
    // Bez klucza publicznego czytelnik widziałby starą stopkę autorów.
    expect(keys).toEqual([["admin", "post-authors", EDITOR_IDS.post], ["post-by-slug"]]);
  });

  it("po udanym zapisie stan roboczy jest zamykany (nie ma co anulować)", async () => {
    await renderPair();
    click(NAME.bartek, K.up);
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.queryByRole("button", { name: K.cancel })).toBeNull());
    expect(saveButton()).toBeDisabled();
  });

  it("błąd zapisu jest POKAZANY, a ustawiona kolejność NIE ginie", async () => {
    await renderPair();
    save().mockRejectedValueOnce(new Error("optimistic lock: wiersz zmieniony"));
    click(NAME.bartek, K.up);
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(toast().error).toHaveBeenCalledWith("optimistic lock: wiersz zmieniony"),
    );
    // Draft zostaje - redaktor może spróbować ponownie bez przestawiania od nowa.
    expect(names()).toEqual([NAME.bartek, NAME.anna]);
    expect(screen.getByRole("button", { name: K.cancel })).toBeInTheDocument();
  });

  it("odrzucenie bez klasy Error też daje czytelny komunikat", async () => {
    await renderPair();
    save().mockRejectedValueOnce("server fn unreachable");
    click(NAME.bartek, K.up);
    fireEvent.click(saveButton());
    await waitFor(() => expect(toast().error).toHaveBeenCalledWith("server fn unreachable"));
  });
});
