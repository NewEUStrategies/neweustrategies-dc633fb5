// Reguły edytora przepisu automatyzacji. Dialog, z którego wyszły, miał 70
// mierzonych linii i 39 funkcji na okrągłym zerze - a decyduje o tym, CO silnik
// wykona i W JAKIEJ KOLEJNOŚCI.
//
// Każda z tych reguł łamie się cicho: kolejność kroków to inny efekt tego samego
// przepisu, wyzwalacz spoza katalogu to przepis, który nigdy się nie odpali,
// a parametr roli zamieniony w napis „a,b" zamiast dwóch ról to zaproszenie do
// wysyłki, która trafia w nikogo.
import { describe, expect, it } from "vitest";
import { DOMAIN_EVENT_TYPES } from "@/lib/realtime/domainEvents";
import { WORKFLOW_ACTIONS, type WorkflowStep } from "@/lib/admin/workflows";
import {
  CUSTOM_TRIGGER,
  applyTriggerSelection,
  defaultStep,
  emptyConditionPair,
  isCustomTriggerType,
  moveStep,
  paramInputValue,
  patchConditionPair,
  removeAt,
  replaceAt,
  stepWithParam,
  triggerSelectValue,
} from "../editorDraft";

const KNOWN_EVENT = DOMAIN_EVENT_TYPES[0];

describe("isCustomTriggerType", () => {
  it("zdarzenie z katalogu NIE jest typem własnym", () => {
    expect(isCustomTriggerType(KNOWN_EVENT)).toBe(false);
  });

  it("zdarzenie spoza katalogu jest typem własnym", () => {
    expect(isCustomTriggerType("moje.zdarzenie.v1")).toBe(true);
  });

  it("REGUŁA: pusty typ to BRAK wyboru, nie typ własny", () => {
    // Inaczej nowy przepis otwiera się z polem tekstowym zamiast z listą,
    // a redaktor wpisuje nazwę zdarzenia z palca, obok katalogu - i przepis
    // nigdy się nie odpala, bo silnik nie emituje takiego typu.
    expect(isCustomTriggerType("")).toBe(false);
  });

  it("rozróżnia wielkość liter - typ zdarzenia jest identyfikatorem", () => {
    expect(isCustomTriggerType(KNOWN_EVENT.toUpperCase())).toBe(true);
  });
});

describe("triggerSelectValue", () => {
  it("tryb własny zawsze pokazuje pozycję „inny typ”", () => {
    expect(triggerSelectValue(true, "cokolwiek")).toBe(CUSTOM_TRIGGER);
  });

  it("wybrane zdarzenie pokazuje się wprost", () => {
    expect(triggerSelectValue(false, KNOWN_EVENT)).toBe(KNOWN_EVENT);
  });

  it("brak wyboru to `undefined`, nie pusty napis", () => {
    // Radix pokazuje podpowiedź (placeholder) TYLKO dla wartości
    // niezdefiniowanej; pusty napis to dla niego wybrana wartość pusta, więc
    // wybierak nowego przepisu wyglądałby na wypełniony.
    expect(triggerSelectValue(false, "")).toBeUndefined();
  });
});

describe("applyTriggerSelection", () => {
  it("REGUŁA: wybór „inny typ” ZERUJE typ zdarzenia", () => {
    // Zostawienie poprzedniej wartości dałoby przepis, który w polu tekstowym
    // pokazuje zdarzenie z katalogu i wygląda na gotowy, choć redaktor wszedł
    // w tryb ręczny właśnie po to, żeby wpisać coś innego.
    expect(applyTriggerSelection(CUSTOM_TRIGGER)).toEqual({
      customTrigger: true,
      triggerEventType: "",
    });
  });

  it("wybór zdarzenia z katalogu WYCHODZI z trybu ręcznego", () => {
    expect(applyTriggerSelection(KNOWN_EVENT)).toEqual({
      customTrigger: false,
      triggerEventType: KNOWN_EVENT,
    });
  });
});

describe("moveStep", () => {
  const steps = ["a", "b", "c"];

  it("przesuwa krok w dół, zachowując resztę kolejności", () => {
    expect(moveStep(steps, 0, 1)).toEqual(["b", "a", "c"]);
  });

  it("przesuwa krok w górę", () => {
    expect(moveStep(steps, 2, -1)).toEqual(["a", "c", "b"]);
  });

  it("REGUŁA: ruch poza zakres oddaje TĘ SAMĄ tablicę, nie kopię", () => {
    // Nowa referencja przy braku ruchu renderowałaby listę od nowa i gubiła
    // fokus w polach parametrów - a przyciski krańcowe są wyłączone właśnie
    // po to, żeby ten przypadek nie zachodził.
    expect(moveStep(steps, 0, -1)).toBe(steps);
    expect(moveStep(steps, 2, 1)).toBe(steps);
  });

  it("nie mutuje wejścia", () => {
    const original = [...steps];
    moveStep(steps, 0, 1);
    expect(steps).toEqual(original);
  });

  it("jednoelementowa sekwencja nie ma dokąd się ruszyć", () => {
    const one = ["a"];
    expect(moveStep(one, 0, 1)).toBe(one);
    expect(moveStep(one, 0, -1)).toBe(one);
  });
});

describe("replaceAt / removeAt", () => {
  it("podmienia dokładnie jeden element", () => {
    expect(replaceAt(["a", "b", "c"], 1, "x")).toEqual(["a", "x", "c"]);
  });

  it("podmiana nie rusza tożsamości pozostałych elementów", () => {
    // Zachowana referencja to warunek działania `key`-owanych list i memoizacji
    // w edytorze kroku.
    const a = { id: "a" };
    const b = { id: "b" };
    const result = replaceAt([a, b], 1, { id: "x" });
    expect(result[0]).toBe(a);
  });

  it("indeks poza zakresem nie dodaje elementu", () => {
    expect(replaceAt(["a"], 5, "x")).toEqual(["a"]);
  });

  it("usuwa dokładnie jeden element", () => {
    expect(removeAt(["a", "b", "c"], 1)).toEqual(["a", "c"]);
  });

  it("usunięcie spoza zakresu zostawia listę bez zmian", () => {
    expect(removeAt(["a", "b"], 9)).toEqual(["a", "b"]);
  });
});

describe("patchConditionPair", () => {
  const pairs = [
    { key: "status", value: "published" },
    { key: "lang", value: "pl" },
  ];

  it("zmiana klucza NIE rusza wartości tej samej pary", () => {
    expect(patchConditionPair(pairs, 0, { key: "state" })[0]).toEqual({
      key: "state",
      value: "published",
    });
  });

  it("zmiana dotyczy wyłącznie wskazanej pary", () => {
    expect(patchConditionPair(pairs, 0, { value: "draft" })[1]).toEqual(pairs[1]);
  });

  it("nie mutuje wejścia", () => {
    patchConditionPair(pairs, 0, { key: "x" });
    expect(pairs[0].key).toBe("status");
  });
});

describe("wartości domyślne", () => {
  it("nowa para warunku jest pusta po obu stronach", () => {
    expect(emptyConditionPair()).toEqual({ key: "", value: "" });
  });

  it("każde wywołanie oddaje NOWY obiekt", () => {
    // Wspólna referencja oznaczałaby, że wpisanie klucza w jednej parze
    // wypełnia wszystkie dodane później.
    expect(emptyConditionPair()).not.toBe(emptyConditionPair());
  });

  it("domyślny krok używa akcji, którą silnik zna", () => {
    expect(WORKFLOW_ACTIONS).toContain(defaultStep().action);
    expect(defaultStep().params).toEqual({});
  });

  it("każdy nowy krok ma WŁASNY obiekt parametrów", () => {
    // Współdzielony `params` sprawiłby, że wpisanie parametru w jednym kroku
    // pojawia się w każdym innym kroku tej samej akcji.
    expect(defaultStep().params).not.toBe(defaultStep().params);
  });
});

describe("paramInputValue", () => {
  it("REGUŁA: tablica ról pokazuje się jako CSV do edycji", () => {
    // Baza trzyma `string[]`, pole edycji trzyma surowy napis - podział należy
    // do serializacji przy zapisie. Gdyby robiło go pole, wpisywany przecinek
    // znikałby przy każdym renderze i nie dałoby się wpisać drugiej roli.
    expect(paramInputValue(["editor", "admin"])).toBe("editor, admin");
  });

  it("napis przechodzi bez zmian - w trakcie pisania widać dokładnie to, co wpisano", () => {
    expect(paramInputValue("editor, ")).toBe("editor, ");
  });

  it("brak wartości to pusty napis, nie „undefined” w polu", () => {
    expect(paramInputValue(undefined)).toBe("");
    expect(paramInputValue(null)).toBe("");
  });

  it("wartość logiczna nie wchodzi do pola tekstowego", () => {
    // Parametry logiczne mają własny przełącznik; `true` wpisane do inputa
    // zapisałoby się jako napis „true”.
    expect(paramInputValue(true)).toBe("");
  });

  it("pusta tablica daje pusty napis", () => {
    expect(paramInputValue([])).toBe("");
  });
});

describe("stepWithParam", () => {
  const step: WorkflowStep = { action: "notify_staff", params: { roles: "editor", silent: true } };

  it("zmienia jeden parametr i zostawia pozostałe", () => {
    expect(stepWithParam(step, "roles", "admin").params).toEqual({
      roles: "admin",
      silent: true,
    });
  });

  it("nie rusza akcji kroku", () => {
    expect(stepWithParam(step, "roles", "admin").action).toBe("notify_staff");
  });

  it("nie mutuje kroku wejściowego", () => {
    stepWithParam(step, "roles", "admin");
    expect(step.params.roles).toBe("editor");
  });

  it("dokłada parametr, którego jeszcze nie było", () => {
    expect(stepWithParam(step, "template", "welcome").params.template).toBe("welcome");
  });
});
