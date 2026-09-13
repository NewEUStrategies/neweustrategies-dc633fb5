// PANEL ZADAŃ DOKU - do tego przebiegu plik nie miał ANI JEDNEGO testu, choć
// jego własny nagłówek deklaruje umowy, których nie pilnuje nic innego
// w repozytorium:
//
//   1. KOLEJNOŚĆ GAŁĘZI: błąd -> oczekiwanie -> puste -> lista. Panel
//      pokazywał „Brak zadań. Dodaj pierwsze powyżej", gdy zapytanie było
//      jeszcze w drodze - czyli zapraszał do dopisania zadania, które już
//      istnieje i za sekundę samo się pojawi. Dowodzimy każdej z czterech
//      gałęzi OSOBNO i tego, że wcześniejsza wygrywa z późniejszą (błąd
//      zasłania nawet dane trzymane w pamięci).
//   2. WIERSZ OCZEKIWANIA MA GEOMETRIĘ WIERSZA REALNEGO - podmiana szkieletu
//      na dane nie może przestawić układu pod kursorem. happy-dom nie liczy
//      układu, więc wysokości zmierzyć się nie da; porównujemy klasy tego
//      samego `li` przed wczytaniem i po nim, bo to one niosą całą geometrię.
//   3. ODHACZENIE WYSYŁA WARTOŚĆ ODWRÓCONĄ (`done: !todo.done`) - pomyłka
//      w tym jednym znaku daje kliknięcie, które nic nie zmienia.
//   4. WIERSZ ZROBIONY NIE MA LISTY PRIORYTETU (zostaje sam chip), a licznik
//      w pasku zakładek liczy WYŁĄCZNIE niezrobione.
//
// Warstwa danych (`@/lib/dock/useTodos`) jest tu atrapą modułu: jej zapytania
// i mutacje mają komplet własnych dowodów w `src/lib/dock/__tests__/dockData.test.tsx`,
// a w tym pliku liczy się wyłącznie to, co panel z nich robi i co widzi
// użytkownik. Dzięki atrapie stan oczekiwania i stan błędu są trzymane tak
// długo, jak trzeba, zamiast przemykać jedną klatką.
//
// Napisy czytamy ze słownika (`dockPl`), nigdy z literału - inaczej asercja
// mierzy to, co ktoś wpisał w komponencie, a nie to, co jest w tłumaczeniach.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/test/i18nReal";
import { dockPl } from "@/lib/i18n-dock";
import { FIXED_NOW_ISO, freezeClock } from "@/test/time";
import { axeViolations, summarize } from "@/test/axe";
import type { TodoDraft } from "@/lib/dock/useTodos";
import type { TodoPriority, UserTodo } from "@/lib/dock/types";

// Panel sam zegara nie czyta, ale fixture zadania niesie datę utworzenia -
// zamrożenie trzyma ją w tym samym punkcie co reszta suity.
freezeClock();

interface TogglePayload {
  id: string;
  done: boolean;
}
interface PriorityPayload {
  id: string;
  priority: TodoPriority;
}

// Stan atrapy: osobne pola na trzy gałęzie zapytania i cztery dzienniki
// wywołań mutacji. Dziennik zamiast `vi.fn()`, bo asercje dotyczą ŁADUNKU
// (co panel wysłał), a nie samego faktu wywołania.
const h = vi.hoisted(() => ({
  todos: undefined as UserTodo[] | undefined,
  isPending: true,
  isError: false,
  createPending: false,
  created: [] as TodoDraft[],
  toggled: [] as TogglePayload[],
  prioritised: [] as PriorityPayload[],
  removed: [] as string[],
}));

vi.mock("@/lib/dock/useTodos", () => ({
  useTodos: () => ({ data: h.todos, isPending: h.isPending, isError: h.isError }),
  useCreateTodo: () => ({
    isPending: h.createPending,
    mutate: (draft: TodoDraft) => void h.created.push(draft),
  }),
  useToggleTodo: () => ({
    mutate: (vars: TogglePayload) => void h.toggled.push(vars),
  }),
  useUpdateTodoPriority: () => ({
    mutate: (vars: PriorityPayload) => void h.prioritised.push(vars),
  }),
  useDeleteTodo: () => ({ mutate: (id: string) => void h.removed.push(id) }),
}));

// Radix `Select` otwiera listę dopiero po pomiarach układu i przechwyceniu
// wskaźnika, których happy-dom nie ma - opcje nigdy nie trafiłyby do drzewa.
// Wspólna atrapa sprowadza prymityw do natywnego `<select>` i ZACHOWUJE
// `aria-label` wyzwalacza, co jest tu krytyczne: obie listy priorytetu
// (formularza i wiersza) noszą ten sam napis ze słownika.
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { selectPrimitiveStub } = await import("@/test/postExperience/fixtures");
  return selectPrimitiveStub(React);
});

import { TodoPanel } from "../TodoPanel";

const NOTATKA = "Przygotować notatkę na wtorek";
const ZAPROSZENIA = "Odesłać zaproszenia";
const RAPORT = "Domknąć raport kwartalny";

const todo = (id: string, patch: Partial<UserTodo> = {}): UserTodo => ({
  id,
  title: id,
  priority: "medium",
  due_at: null,
  done: false,
  done_at: null,
  source_task_id: null,
  created_at: FIXED_NOW_ISO,
  ...patch,
});

/** Zapytanie rozwiązane - lista (być może pusta) i koniec oczekiwania. */
function loaded(...items: UserTodo[]): void {
  h.todos = items;
  h.isPending = false;
  h.isError = false;
}

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onClose = vi.fn();
  // Nowy element przy każdym renderze: ten sam obiekt elementu React
  // rozpoznaje jako pracę już wykonaną i pomija poddrzewo, więc `refresh()`
  // z jedną instancją nie pokazałby nowego stanu atrapy.
  const tree = () => (
    <QueryClientProvider client={client}>
      <TodoPanel onClose={onClose} />
    </QueryClientProvider>
  );
  const view = render(tree());
  return { ...view, onClose, refresh: () => view.rerender(tree()) };
}

function addButton(): HTMLElement {
  return screen.getByRole("button", { name: dockPl.dock.todos.add });
}

function titleField(): HTMLElement {
  return screen.getByLabelText(dockPl.dock.todos.placeholder);
}

function formOf(node: HTMLElement): HTMLFormElement {
  const form = node.closest("form");
  if (!form) throw new Error("panel bez formularza dodawania");
  return form;
}

/** Wiersz listy po widocznym tytule - obie listy priorytetu mają tę samą nazwę. */
function row(title: string): HTMLElement {
  const node = screen.getByText(title).closest("li");
  if (!node) throw new Error(`brak wiersza zadania: ${title}`);
  return node;
}

function tabButton(label: string): HTMLElement {
  return screen.getByRole("button", { name: label });
}

/** Chip priorytetu w wierszu - `<span>`, w odróżnieniu od `<option>` listy. */
function chipIn(wiersz: HTMLElement, label: string): HTMLElement {
  return within(wiersz).getByText(label, { selector: "span" });
}

beforeEach(() => {
  h.todos = undefined;
  h.isPending = true;
  h.isError = false;
  h.createPending = false;
  h.created.length = 0;
  h.toggled.length = 0;
  h.prioritised.length = 0;
  h.removed.length = 0;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("KOLEJNOŚĆ GAŁĘZI: błąd -> oczekiwanie -> puste -> lista", () => {
  it("błąd zasłania i oczekiwanie, i dane trzymane w pamięci", () => {
    h.isError = true;
    h.isPending = true;
    h.todos = [todo("t1", { title: NOTATKA })];
    const { container } = renderPanel();

    expect(screen.getByText(dockPl.dock.error)).toBeTruthy();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.queryByText(dockPl.dock.todos.empty)).toBeNull();
    expect(screen.queryByText(NOTATKA)).toBeNull();
  });

  it("oczekiwanie NIE zaprasza do dopisania zadania, które już leci", () => {
    // To jest dokładna regresja z nagłówka panelu: pusty stan pokazywał się,
    // zanim odpowiedź w ogóle dojechała.
    const { container } = renderPanel();

    const busy = container.querySelector('ul[aria-busy="true"]');
    expect(busy).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(screen.queryByText(dockPl.dock.todos.empty)).toBeNull();
    expect(screen.queryByText(dockPl.dock.error)).toBeNull();
  });

  it("wiersz oczekiwania ma geometrię wiersza realnego - podmiana nie rusza układu", () => {
    const { refresh } = renderPanel();
    const szkielet = screen.getAllByRole("listitem")[0].className;

    loaded(todo("t1", { title: NOTATKA }));
    refresh();

    expect(screen.getAllByRole("listitem")[0].className).toBe(szkielet);
  });

  it("pusta odpowiedź daje zaproszenie do dodania pierwszego zadania", () => {
    loaded();
    const { container } = renderPanel();

    expect(screen.getByText(dockPl.dock.todos.empty)).toBeTruthy();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("lista pokazuje zadania razem z chipem priorytetu", () => {
    loaded(
      todo("t1", { title: NOTATKA, priority: "urgent" }),
      todo("t2", { title: ZAPROSZENIA, priority: "low" }),
    );
    renderPanel();

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    // Selektor `span` odcina `<option>` listy priorytetu w tym samym wierszu:
    // opcje noszą te same napisy ze słownika, co chip.
    expect(chipIn(row(NOTATKA), dockPl.dock.todos.priority.urgent)).toBeTruthy();
    expect(chipIn(row(ZAPROSZENIA), dockPl.dock.todos.priority.low)).toBeTruthy();
  });
});

describe("dodawanie zadania", () => {
  it("przycisk jest wyłączony, dopóki tytuł to same białe znaki", () => {
    loaded();
    renderPanel();

    expect(addButton()).toBeDisabled();
    fireEvent.change(titleField(), { target: { value: "   " } });
    expect(addButton()).toBeDisabled();

    fireEvent.change(titleField(), { target: { value: NOTATKA } });
    expect(addButton()).not.toBeDisabled();
  });

  it("zatwierdzenie samych białych znaków nie wysyła NICZEGO", () => {
    // Przycisk jest wtedy wyłączony, ale formularz da się zatwierdzić
    // klawiszem Enter - strażnik w `submit` jest jedyną realną blokadą.
    loaded();
    renderPanel();
    const input = titleField();
    fireEvent.change(input, { target: { value: "   " } });

    fireEvent.submit(formOf(input));

    expect(h.created).toHaveLength(0);
    expect(screen.getByText(dockPl.dock.todos.empty)).toBeTruthy();
  });

  it("wysłanie przekazuje tytuł z wybranym priorytetem i czyści pole", () => {
    loaded();
    renderPanel();
    // Przy pustej liście etykietę priorytetu nosi wyłącznie lista formularza.
    const draftPriority = screen.getByLabelText(dockPl.dock.todos.priority.label);
    expect(draftPriority).toHaveValue("medium");

    fireEvent.change(titleField(), { target: { value: RAPORT } });
    fireEvent.change(draftPriority, { target: { value: "urgent" } });
    fireEvent.click(addButton());

    expect(h.created).toEqual([{ title: RAPORT, priority: "urgent" }]);
    expect(titleField()).toHaveValue("");
    expect(addButton()).toBeDisabled();
  });

  it("trwający zapis blokuje przycisk, choć tytuł jest wpisany", () => {
    loaded();
    const { refresh } = renderPanel();
    fireEvent.change(titleField(), { target: { value: ZAPROSZENIA } });
    expect(addButton()).not.toBeDisabled();

    h.createPending = true;
    refresh();

    expect(addButton()).toBeDisabled();
    expect(titleField()).toHaveValue(ZAPROSZENIA);
  });
});

describe("zakładki i licznik otwartych", () => {
  it("zakładki dzielą listę na do zrobienia i zrobione", () => {
    loaded(
      todo("t1", { title: NOTATKA }),
      todo("t2", { title: RAPORT, done: true, done_at: FIXED_NOW_ISO }),
    );
    renderPanel();

    const open = tabButton(dockPl.dock.todos.tabs.open);
    const done = tabButton(dockPl.dock.todos.tabs.done);
    expect(open.getAttribute("aria-pressed")).toBe("true");
    expect(done.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText(NOTATKA)).toBeTruthy();
    expect(screen.queryByText(RAPORT)).toBeNull();

    fireEvent.click(done);

    expect(tabButton(dockPl.dock.todos.tabs.done).getAttribute("aria-pressed")).toBe("true");
    expect(tabButton(dockPl.dock.todos.tabs.open).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText(RAPORT)).toBeTruthy();
    expect(screen.queryByText(NOTATKA)).toBeNull();
  });

  it("licznik liczy WYŁĄCZNIE niezrobione, niezależnie od zakładki", () => {
    loaded(
      todo("t1", { title: NOTATKA }),
      todo("t2", { title: ZAPROSZENIA }),
      todo("t3", { title: RAPORT, done: true }),
    );
    renderPanel();

    const licznik = dockPl.dock.todos.openCount.replace("{{count}}", "2");
    expect(screen.getByText(licznik)).toBeTruthy();

    fireEvent.click(tabButton(dockPl.dock.todos.tabs.done));

    expect(screen.getByText(licznik)).toBeTruthy();
  });

  it("zakładka bez pozycji pokazuje pusty stan, choć lista zadań nie jest pusta", () => {
    loaded(todo("t1", { title: NOTATKA }));
    renderPanel();

    fireEvent.click(tabButton(dockPl.dock.todos.tabs.done));

    expect(screen.getByText(dockPl.dock.todos.empty)).toBeTruthy();
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it.fails("DEFEKT: pusta zakładka „Zrobione” twierdzi, że zadań NIE MA", () => {
    // MECHANIZM: gałąź pustego stanu (TodoPanel.tsx:145) pyta o `items`, czyli
    // listę PO odfiltrowaniu zakładką, ale drukuje napis pisany dla przypadku
    // globalnego - „Brak zadań. Dodaj pierwsze powyżej.". Przy jednym otwartym
    // zadaniu i zerze zrobionych licznik obok mówi więc „Otwarte: 1", a treść
    // pod nim - że zadań nie ma, i zaprasza do akcji, która do TEJ zakładki
    // nic nie doda (nowe zadanie rodzi się niezrobione).
    //
    // Naprawa wymaga OSOBNEGO klucza na pustą zakładkę, a tego testu nie wolno
    // zazielenić dopisaniem klucza do słownika - stoi tu jako rejestracja
    // usterki dla właściciela panelu, nie jako zadanie dla tego pliku.
    loaded(todo("t1", { title: NOTATKA }));
    renderPanel();

    fireEvent.click(tabButton(dockPl.dock.todos.tabs.done));

    expect(
      screen.getByText(dockPl.dock.todos.openCount.replace("{{count}}", "1")),
    ).toBeTruthy();
    expect(screen.queryByText(dockPl.dock.todos.empty)).toBeNull();
  });
});

describe("wiersz zadania", () => {
  it("odhaczenie wysyła wartość ODWRÓCONĄ - w obie strony", () => {
    loaded(
      todo("t1", { title: NOTATKA }),
      todo("t2", { title: RAPORT, done: true, done_at: FIXED_NOW_ISO }),
    );
    renderPanel();

    fireEvent.click(screen.getByLabelText(NOTATKA));
    fireEvent.click(tabButton(dockPl.dock.todos.tabs.done));
    fireEvent.click(screen.getByLabelText(RAPORT));

    expect(h.toggled).toEqual([
      { id: "t1", done: true },
      { id: "t2", done: false },
    ]);
  });

  it("zmiana priorytetu w wierszu wysyła identyfikator i nową wartość", () => {
    loaded(todo("t1", { title: NOTATKA, priority: "medium" }));
    renderPanel();

    const wiersz = within(row(NOTATKA)).getByLabelText(dockPl.dock.todos.priority.label);
    fireEvent.change(wiersz, { target: { value: "low" } });

    expect(h.prioritised).toEqual([{ id: "t1", priority: "low" }]);
    // Lista formularza jest odrębnym stanem - wybór w wierszu jej nie rusza.
    expect(screen.getAllByLabelText(dockPl.dock.todos.priority.label)[0]).toHaveValue("medium");
  });

  it("wiersz zrobiony traci listę priorytetu, ale zachowuje chip", () => {
    loaded(todo("t1", { title: RAPORT, priority: "high", done: true }));
    renderPanel();
    fireEvent.click(tabButton(dockPl.dock.todos.tabs.done));

    const wiersz = row(RAPORT);
    expect(within(wiersz).queryByLabelText(dockPl.dock.todos.priority.label)).toBeNull();
    expect(chipIn(wiersz, dockPl.dock.todos.priority.high)).toBeTruthy();
    // Zostaje jedna lista priorytetu na cały panel: ta w formularzu.
    expect(screen.getAllByLabelText(dockPl.dock.todos.priority.label)).toHaveLength(1);
  });

  it("usunięcie wysyła identyfikator TEGO wiersza", () => {
    loaded(todo("t1", { title: NOTATKA }), todo("t2", { title: ZAPROSZENIA }));
    renderPanel();

    fireEvent.click(within(row(ZAPROSZENIA)).getByLabelText(dockPl.dock.todos.remove));

    expect(h.removed).toEqual(["t2"]);
  });
});

describe("powłoka panelu", () => {
  it("panel jest okienkiem o nazwie ze słownika, a zamknięcie woła onClose", () => {
    loaded(todo("t1", { title: NOTATKA }));
    const { onClose } = renderPanel();

    expect(screen.getByRole("dialog", { name: dockPl.dock.todos.title })).toBeTruthy();

    fireEvent.click(screen.getByLabelText(dockPl.dock.close));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("panel z listą nie ma naruszeń axe", async () => {
    // Lista priorytetu jest tu atrapą natywną, więc mierzymy dostępność
    // powłoki, formularza, zakładek i wierszy - czyli tego, co panel pisze sam.
    loaded(todo("t1", { title: NOTATKA }), todo("t2", { title: RAPORT, done: true }));
    const { container } = renderPanel();
    await waitFor(() => expect(screen.getByText(NOTATKA)).toBeTruthy());

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
