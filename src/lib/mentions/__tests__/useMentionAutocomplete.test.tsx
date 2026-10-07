// Logika typeahead @wzmianek - `useMentionAutocomplete`.
//
// CO TEN PLIK DOWODZI (bez pola tekstowego, na samym haku):
// (1) WZORZEC COMBOBOX (ARIA 1.2): `aria-expanded`, `aria-controls` i
//     `aria-activedescendant` mówią prawdę o liście - także wtedy, gdy jest
//     zamknięta (wtedy NIE wskazują nieistniejącego elementu).
// (2) KLAWIATURA: strzałki krążą po liście w obie strony, Enter i Tab
//     wybierają, Esc chowa listę do następnej zmiany treści. Klawisze, których
//     hak nie obsługuje, NIE są blokowane - pole i powłoka kompozytora (skróty
//     formatowania) muszą je dostać.
// (3) WYBÓR podmienia token pod kursorem, a po renderze przywraca fokus
//     i kursor za wstawioną wzmianką.
// (4) WYŁĄCZONY hak nie wykrywa wzmianek i nie pyta o podpowiedzi.
// (5) ZAKRES KLUBU (`scope`) dojeżdża do zapytania o podpowiedzi bez zmian -
//     bez niego kompozytor w klubie nie podpowiadałby członków klubu.
//
// Zapytanie RPC (`useMentionSuggestions`) i opóźnienie są atrapami - mają
// własne testy; tu liczy się stan i klawiatura.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { KeyboardEvent } from "react";
import type { MentionSuggestion } from "@/lib/mentions/useMentionSuggestions";

const state = vi.hoisted(() => ({
  suggestions: [] as unknown[],
  fetching: false,
  queries: [] as Array<string | null>,
  scopes: [] as unknown[],
}));

vi.mock("@/hooks/useDebouncedValue", () => ({ useDebouncedValue: <T,>(value: T) => value }));
vi.mock("@/lib/mentions/useMentionSuggestions", () => ({
  MENTION_SUGGESTION_LIMIT: 6,
  useMentionSuggestions: (query: string | null, _lang: string, scope?: unknown) => {
    state.queries.push(query);
    state.scopes.push(scope);
    return { data: query === null ? [] : state.suggestions, isFetching: state.fetching };
  },
}));

import {
  useMentionAutocomplete,
  type UseMentionAutocompleteOptions,
} from "@/lib/mentions/useMentionAutocomplete";

function person(slug: string, name: string): MentionSuggestion {
  return {
    kind: "person",
    slug,
    name,
    avatarUrl: null,
    logoUrl: null,
    website: null,
    subtitle: null,
    verified: false,
  };
}

const JAN = person("jan-kowalski", "Jan Kowalski");
const ANNA = person("anna-nowak", "Anna Nowak");
const OLA = person("ola-lis", "Ola Lis");

/** Zdarzenie klawiatury w kształcie, którego używa hak. */
function key(name: string): KeyboardEvent<HTMLTextAreaElement> & { prevented: boolean } {
  const event = {
    key: name,
    prevented: false,
    preventDefault() {
      event.prevented = true;
    },
  };
  return event as unknown as KeyboardEvent<HTMLTextAreaElement> & { prevented: boolean };
}

/** Pole z wartością i kursorem na końcu - tak, jak zostawia je pisanie. */
function textarea(value: string, caret = value.length): HTMLTextAreaElement {
  const el = document.createElement("textarea");
  el.value = value;
  el.setSelectionRange(caret, caret);
  document.body.appendChild(el);
  return el;
}

function setup(over: Partial<UseMentionAutocompleteOptions> = {}, initial = "") {
  const onChange = vi.fn();
  const hook = renderHook(
    (props: { value: string }) =>
      useMentionAutocomplete({ value: props.value, onChange, lang: "pl", ...over }),
    { initialProps: { value: initial } },
  );
  /** Wpisuje treść i przesuwa kursor - jak `onChange` pola. */
  const type = (value: string, caret = value.length) => {
    const el = textarea(value, caret);
    hook.rerender({ value });
    act(() => hook.result.current.handleValueChange(el));
    return el;
  };
  return { ...hook, onChange, type };
}

beforeEach(() => {
  state.suggestions = [JAN, ANNA, OLA];
  state.fetching = false;
  state.queries = [];
  state.scopes = [];
  document.body.innerHTML = "";
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

describe("useMentionAutocomplete - stan listy i ARIA", () => {
  it("bez aktywnej wzmianki lista jest zamknięta, a ARIA nic nie wskazuje", () => {
    const { result, type } = setup();
    type("zwykły tekst");

    expect(result.current.open).toBe(false);
    expect(result.current.textareaProps).toMatchObject({
      role: "combobox",
      "aria-expanded": false,
      "aria-controls": undefined,
      "aria-autocomplete": "list",
      "aria-activedescendant": undefined,
    });
    expect(state.queries.at(-1)).toBeNull();
  });

  it("token `@ja` otwiera listę i wskazuje pierwszą opcję", () => {
    const { result, type } = setup();
    type("cc @ja");

    expect(state.queries.at(-1)).toBe("ja");
    expect(result.current.open).toBe(true);
    expect(result.current.textareaProps["aria-controls"]).toBe(result.current.listId);
    expect(result.current.textareaProps["aria-activedescendant"]).toBe(
      `${result.current.listId}-opt-0`,
    );
  });

  it("w trakcie pobierania lista jest otwarta także bez wyników", () => {
    state.suggestions = [];
    state.fetching = true;
    const { result, type } = setup();
    type("@j");

    expect(result.current.open).toBe(true);
    // Otwarta, ale bez opcji - nie wskazujemy elementu, którego nie ma.
    expect(result.current.textareaProps["aria-activedescendant"]).toBeUndefined();
  });

  it("brak wyników po pobraniu zamyka listę", () => {
    state.suggestions = [];
    const { result, type } = setup();
    type("@zzz");

    expect(result.current.open).toBe(false);
  });

  it("wyłączony hak nie wykrywa wzmianek i nie pyta o podpowiedzi", () => {
    const { result, type } = setup({ enabled: false });
    type("@jan");

    expect(result.current.open).toBe(false);
    expect(state.queries.every((query) => query === null)).toBe(true);
  });

  it("kliknięcie i zaznaczenie w polu też przesuwają kursor wzmianki", () => {
    const { result, rerender } = setup({}, "@jan i tekst");
    rerender({ value: "@jan i tekst" });
    expect(result.current.open).toBe(false);

    act(() => result.current.textareaProps.onClick({ currentTarget: textarea("@jan i tekst", 4) }));
    expect(result.current.open).toBe(true);

    act(() =>
      result.current.textareaProps.onSelect({ currentTarget: textarea("@jan i tekst", 9) }),
    );
    expect(result.current.open).toBe(false);

    act(() =>
      result.current.textareaProps.onKeyUp({
        currentTarget: textarea("@jan i tekst", 2),
      } as unknown as KeyboardEvent<HTMLTextAreaElement>),
    );
    expect(result.current.open).toBe(true);
  });
});

describe("useMentionAutocomplete - klawiatura", () => {
  it("strzałki krążą po liście w obie strony", () => {
    const { result, type } = setup();
    type("@a");

    act(() => result.current.textareaProps.onKeyDown(key("ArrowUp")));
    expect(result.current.highlight).toBe(2);
    act(() => result.current.textareaProps.onKeyDown(key("ArrowDown")));
    expect(result.current.highlight).toBe(0);
    act(() => result.current.textareaProps.onKeyDown(key("ArrowDown")));
    expect(result.current.highlight).toBe(1);
    expect(result.current.textareaProps["aria-activedescendant"]).toBe(
      `${result.current.listId}-opt-1`,
    );
  });

  it.each(["Enter", "Tab"])("%s wybiera podświetloną osobę i blokuje domyślną akcję", (name) => {
    const { result, type, onChange } = setup();
    type("cc @an");
    act(() => result.current.setHighlight(1));

    const event = key(name);
    act(() => result.current.textareaProps.onKeyDown(event));

    expect(event.prevented).toBe(true);
    expect(onChange).toHaveBeenCalledWith("cc @anna-nowak ");
  });

  it("Esc chowa listę do następnej zmiany treści", () => {
    const { result, type } = setup();
    type("@ja");

    const event = key("Escape");
    act(() => result.current.textareaProps.onKeyDown(event));
    expect(event.prevented).toBe(true);
    expect(result.current.open).toBe(false);

    type("@jan");
    expect(result.current.open).toBe(true);
  });

  it("Esc chowa także listę, która dopiero się ładuje", () => {
    state.suggestions = [];
    state.fetching = true;
    const { result, type } = setup();
    type("@j");

    act(() => result.current.textareaProps.onKeyDown(key("Escape")));

    expect(result.current.open).toBe(false);
  });

  it("klawisze spoza listy przechodzą dalej bez blokady (skróty, pisanie)", () => {
    const { result, type, onChange } = setup();
    type("@ja");

    for (const name of ["b", "Shift", "Home"]) {
      const event = key(name);
      act(() => result.current.textareaProps.onKeyDown(event));
      expect(event.prevented).toBe(false);
    }
    expect(onChange).not.toHaveBeenCalled();
  });

  it("przy zamkniętej liście Enter i strzałki należą do pola", () => {
    const { result, type, onChange } = setup();
    type("zwykły tekst");

    for (const name of ["Enter", "ArrowDown", "Escape"]) {
      const event = key(name);
      act(() => result.current.textareaProps.onKeyDown(event));
      expect(event.prevented).toBe(false);
    }
    expect(onChange).not.toHaveBeenCalled();
  });

  it("zmiana zestawu podpowiedzi wraca podświetleniem na początek", () => {
    const { result, type } = setup();
    type("@a");
    act(() => result.current.setHighlight(2));

    state.suggestions = [JAN, ANNA];
    type("@an");

    expect(result.current.highlight).toBe(0);
  });
});

describe("useMentionAutocomplete - wybór", () => {
  it("po wyborze fokus i kursor wracają za wstawioną wzmiankę", () => {
    const ref = { current: null as HTMLTextAreaElement | null };
    const { result, type, onChange } = setup({ textareaRef: ref });
    const el = type("hej @ja dzięki", 7);
    act(() => result.current.setTextarea(el));
    expect(ref.current).toBe(el);
    // Pole kontrolowane: nowa wartość trafia do elementu przed klatką animacji.
    onChange.mockImplementation((next: string) => {
      el.value = next;
    });

    act(() => result.current.choose(JAN));

    expect(onChange).toHaveBeenCalledWith("hej @jan-kowalski  dzięki");
    expect(document.activeElement).toBe(el);
    expect(el.selectionStart).toBe("hej @jan-kowalski ".length);
  });

  it("wybór bez aktywnej wzmianki niczego nie zmienia", () => {
    const { result, type, onChange } = setup();
    type("bez wzmianki");

    act(() => result.current.choose(JAN));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("wybór po odpięciu pola nie sięga po nieistniejący element", () => {
    const { result, type, onChange } = setup();
    const el = type("@ja");
    act(() => result.current.setTextarea(el));
    act(() => result.current.setTextarea(null));

    act(() => result.current.choose(JAN));

    expect(onChange).toHaveBeenCalledWith("@jan-kowalski ");
    expect(document.activeElement).not.toBe(el);
  });
});

describe("useMentionAutocomplete - zakres klubu", () => {
  it("zakres dojeżdża do podpowiedzi bez zmian", () => {
    const scope = { clubId: "club-1" };
    const { type } = setup({ scope });
    type("@an");

    expect(state.queries.at(-1)).toBe("an");
    expect(state.scopes.at(-1)).toEqual({ clubId: "club-1" });
  });

  it("bez zakresu podpowiedzi dostają `null` - katalog publiczny", () => {
    const { type } = setup();
    type("@an");

    expect(state.scopes.at(-1)).toBeNull();
  });
});
