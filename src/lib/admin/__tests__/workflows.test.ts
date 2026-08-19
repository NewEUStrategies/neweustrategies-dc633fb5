// Czyste helpery warstwy danych modułu „Automatyzacje": parsowanie i
// serializacja kroków, wartości warunku (containment), walidacja draftu,
// agregacja statystyk przebiegów oraz parytet katalogu akcji z i18n.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {},
}));

import {
  WORKFLOW_ACTIONS,
  WORKFLOW_ACTION_PARAMS,
  aggregateRunStats,
  conditionToPairs,
  conditionValueToInput,
  draftFromDefinition,
  emptyWorkflowDraft,
  isValidEventType,
  isWorkflowAction,
  pairsToCondition,
  parseConditionValue,
  parseWorkflowSteps,
  serializeWorkflowSteps,
  validateWorkflowDraft,
  type WorkflowDefinitionRow,
  type WorkflowStep,
} from "@/lib/admin/workflows";
import { workflowsPl, workflowsEn } from "@/lib/i18n-admin-workflows";

describe("parseWorkflowSteps", () => {
  it("parsuje kroki flagowych szablonów z migracji", () => {
    const steps = parseWorkflowSteps([
      { action: "create_crm_lead", params: { newsletter: true } },
      {
        action: "notify_followers",
        params: { kind: "content", href: "{post_href}", icon: "newspaper" },
      },
      // Szablony retencyjne (migracja 20260723140000): anulowanie -> zadanie CRM.
      {
        action: "create_crm_task",
        params: {
          title: "Retencja: klient zaplanował anulowanie subskrypcji",
          due_days: "2",
          user_from: "user_id",
        },
      },
    ]);
    expect(steps).toEqual([
      { action: "create_crm_lead", params: { newsletter: true } },
      {
        action: "notify_followers",
        params: { kind: "content", href: "{post_href}", icon: "newspaper" },
      },
      {
        action: "create_crm_task",
        params: {
          title: "Retencja: klient zaplanował anulowanie subskrypcji",
          due_days: "2",
          user_from: "user_id",
        },
      },
    ]);
  });

  it("odrzuca nieznane akcje i zdeformowane wpisy (kontrakt silnika)", () => {
    expect(
      parseWorkflowSteps([
        { action: "emit_event", params: {} },
        "tekst",
        42,
        null,
        { params: {} },
        { action: "notify_staff", params: { roles: ["admin"], nested: { x: 1 }, n: 7 } },
      ]),
    ).toEqual([{ action: "notify_staff", params: { roles: ["admin"] } }]);
  });

  it("zwraca [] dla nie-tablicy", () => {
    expect(parseWorkflowSteps({})).toEqual([]);
    expect(parseWorkflowSteps(null)).toEqual([]);
    expect(parseWorkflowSteps("x")).toEqual([]);
  });
});

describe("serializeWorkflowSteps", () => {
  it("przycina stringi i wyrzuca puste wartości", () => {
    const steps: WorkflowStep[] = [
      {
        action: "notify_user",
        params: { user_from: "  user_id  ", title_pl: "", icon: "bell" },
      },
    ];
    expect(serializeWorkflowSteps(steps)).toEqual([
      { action: "notify_user", params: { user_from: "user_id", icon: "bell" } },
    ]);
  });

  it("dzieli surowy CSV parametru roles na tablicę (edytor trzyma tekst)", () => {
    const steps: WorkflowStep[] = [
      { action: "notify_staff", params: { roles: " admin,  editor ,, " } },
    ];
    expect(serializeWorkflowSteps(steps)).toEqual([
      { action: "notify_staff", params: { roles: ["admin", "editor"] } },
    ]);
  });

  it("zachowuje roles podane jako tablica i wyrzuca pustą tablicę", () => {
    expect(
      serializeWorkflowSteps([
        { action: "notify_staff", params: { roles: ["admin"] } },
        { action: "notify_staff", params: { roles: [] } },
      ]),
    ).toEqual([
      { action: "notify_staff", params: { roles: ["admin"] } },
      { action: "notify_staff", params: {} },
    ]);
  });

  it("CSV z samych separatorów daje pusty parametr, nie tablicę pustych ról", () => {
    // Redaktor wpisał przecinki i skasował nazwy - po podziale nie zostaje ani
    // jedna rola, więc parametr nie ma prawa pojechać do silnika jako [].
    expect(
      serializeWorkflowSteps([{ action: "notify_staff", params: { roles: " , ,, " } }]),
    ).toEqual([{ action: "notify_staff", params: {} }]);
  });

  it("boolean: true zostaje, false wypada (default silnika)", () => {
    expect(
      serializeWorkflowSteps([
        { action: "create_crm_lead", params: { newsletter: true, marketing: false } },
      ]),
    ).toEqual([{ action: "create_crm_lead", params: { newsletter: true } }]);
  });

  it("round-trip: parse(serialize(x)) jest stabilne", () => {
    const steps: WorkflowStep[] = [
      { action: "add_cross_reference", params: { target_id_from: "post_id", relation: "related" } },
    ];
    expect(parseWorkflowSteps(serializeWorkflowSteps(steps))).toEqual(steps);
  });
});

describe("parseConditionValue / conditionToPairs", () => {
  it("typuje literały JSON, resztę zostawia tekstem", () => {
    expect(parseConditionValue("won")).toBe("won");
    expect(parseConditionValue("true")).toBe(true);
    expect(parseConditionValue("false")).toBe(false);
    expect(parseConditionValue("null")).toBe(null);
    expect(parseConditionValue("42")).toBe(42);
    expect(parseConditionValue("-3.5")).toBe(-3.5);
    expect(parseConditionValue('"quoted"')).toBe("quoted");
    expect(parseConditionValue('{"a":1}')).toEqual({ a: 1 });
    expect(parseConditionValue("{zepsuty json")).toBe("{zepsuty json");
  });

  it("round-trip par warunku zachowuje typy (kontrakt @> containment)", () => {
    const condition = { new_stage: "won", status: "pending", flag: true, depth: 2 };
    const pairs = conditionToPairs(condition);
    expect(pairsToCondition(pairs)).toEqual(condition);
  });

  it("pomija pary z pustym kluczem", () => {
    expect(pairsToCondition([{ key: "  ", value: "x" }])).toEqual({});
  });

  it("conditionToPairs: nie-obiekty dają []", () => {
    expect(conditionToPairs([])).toEqual([]);
    expect(conditionToPairs(null)).toEqual([]);
  });
});

describe("validateWorkflowDraft", () => {
  it("pusty draft zgłasza name, trigger i steps", () => {
    expect(validateWorkflowDraft(emptyWorkflowDraft())).toEqual(["name", "trigger", "steps"]);
  });

  it("poprawny draft przechodzi", () => {
    const draft = {
      ...emptyWorkflowDraft(),
      name: "Lead won -> staff",
      triggerEventType: "crm_lead.stage_changed.v1",
      steps: [{ action: "notify_staff", params: {} } satisfies WorkflowStep],
    };
    expect(validateWorkflowDraft(draft)).toEqual([]);
  });

  it("wartość warunku bez klucza zgłasza conditionKey", () => {
    const draft = {
      ...emptyWorkflowDraft(),
      name: "x",
      triggerEventType: "post.published.v1",
      steps: [{ action: "notify_staff", params: {} } satisfies WorkflowStep],
      conditionPairs: [{ key: "", value: "won" }],
    };
    expect(validateWorkflowDraft(draft)).toEqual(["conditionKey"]);
  });
});

describe("isValidEventType / isWorkflowAction", () => {
  it("akceptuje format agregat.czasownik.vN (CHECK z domain_events)", () => {
    expect(isValidEventType("post.published.v1")).toBe(true);
    expect(isValidEventType("newsletter_subscriber.confirmed.v12")).toBe(true);
    expect(isValidEventType("Post.published.v1")).toBe(false);
    expect(isValidEventType("post.published")).toBe(false);
    expect(isValidEventType("")).toBe(false);
  });

  it("isWorkflowAction rozpoznaje wyłącznie katalog silnika", () => {
    for (const action of WORKFLOW_ACTIONS) expect(isWorkflowAction(action)).toBe(true);
    expect(isWorkflowAction("emit_event")).toBe(false);
  });
});

describe("aggregateRunStats", () => {
  it("liczy total/failed i najświeższy przebieg per definicja", () => {
    const stats = aggregateRunStats([
      { workflow_id: "a", status: "succeeded", created_at: "2026-07-20T10:00:00Z" },
      { workflow_id: "a", status: "failed", created_at: "2026-07-20T12:00:00Z" },
      { workflow_id: "b", status: "succeeded", created_at: "2026-07-19T09:00:00Z" },
    ]);
    expect(stats.get("a")).toEqual({
      total: 2,
      failed: 1,
      lastRunAt: "2026-07-20T12:00:00Z",
      lastStatus: "failed",
    });
    expect(stats.get("b")).toEqual({
      total: 1,
      failed: 0,
      lastRunAt: "2026-07-19T09:00:00Z",
      lastStatus: "succeeded",
    });
  });
});

describe("draftFromDefinition", () => {
  it("mapuje wiersz DB na edytowalny draft", () => {
    const row: WorkflowDefinitionRow = {
      id: "def-1",
      tenant_id: "t-1",
      name: "Comment pending",
      template_key: "comment-pending-notify-staff",
      enabled: true,
      trigger_event_type: "comment.created.v1",
      condition: { status: "pending" },
      steps: [{ action: "notify_staff", params: { kind: "comment" } }],
      created_by: null,
      created_at: "2026-07-11T20:40:00Z",
      updated_at: "2026-07-11T20:40:00Z",
    };
    expect(draftFromDefinition(row)).toEqual({
      id: "def-1",
      name: "Comment pending",
      enabled: true,
      triggerEventType: "comment.created.v1",
      conditionPairs: [{ key: "status", value: "pending" }],
      steps: [{ action: "notify_staff", params: { kind: "comment" } }],
    });
  });
});

describe("parytet katalogu akcji z i18n (PL i EN)", () => {
  const dictionaries = [
    ["pl", workflowsPl.adminWorkflows] as const,
    ["en", workflowsEn.adminWorkflows] as const,
  ];

  it("każda akcja ma nazwę i opis w obu językach", () => {
    for (const [lang, dict] of dictionaries) {
      for (const action of WORKFLOW_ACTIONS) {
        const entry = dict.actions[action];
        expect(entry, `${lang}: brak wpisu actions.${action}`).toBeDefined();
        expect(entry.name.length).toBeGreaterThan(0);
        expect(entry.description.length).toBeGreaterThan(0);
      }
    }
  });

  it("każdy parametr formularza ma etykietę w obu językach", () => {
    const paramKeys = new Set(
      Object.values(WORKFLOW_ACTION_PARAMS).flatMap((specs) => specs.map((s) => s.key)),
    );
    for (const [lang, dict] of dictionaries) {
      const labels = dict.params as Record<string, string>;
      for (const key of paramKeys) {
        expect(labels[key], `${lang}: brak etykiety params.${key}`).toBeTruthy();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// NIEDOBITE RAMIONA WALIDACJI (dopisane 18.08 po audycie pokrycia).
//
// Audyt zmierzył 55% gałęzi w tym pliku i nazwał to wprost: „połowa ramion
// walidacji nigdy nie została wykonana - tam siedzą błędy typu «zły warunek
// przechodzi cicho»". Ta sekcja dobija te ramiona. Nie powtarza reguł
// dowiedzionych wyżej - dokłada przypadki brzegowe, które wyżej nie wystąpiły.
// ---------------------------------------------------------------------------

describe("parseWorkflowSteps - ramiona odrzucania kształtu", () => {
  it("TABLICA jako wpis kroku jest odrzucana (typeof [] === 'object')", () => {
    // `typeof item === "object"` przepuszcza tablicę, więc bez jawnego
    // `Array.isArray` tablica trafiłaby do `record.action` jako undefined.
    // Ramię istnieje w kodzie i do 18.08 nie było wykonane ani raz.
    expect(parseWorkflowSteps([[{ action: "notify_staff" }]])).toEqual([]);
  });

  it("params podane jako TABLICA dają pusty zestaw parametrów, nie indeksy", () => {
    // Bez `!Array.isArray(rawParams)` Object.entries(["a","b"]) dałoby
    // params { "0": "a", "1": "b" } - śmieci wysłane do silnika.
    expect(parseWorkflowSteps([{ action: "notify_staff", params: ["a", "b"] }])).toEqual([
      { action: "notify_staff", params: {} },
    ]);
  });

  it("params jako prymityw lub null dają pusty zestaw", () => {
    expect(parseWorkflowSteps([{ action: "notify_staff", params: "roles" }])).toEqual([
      { action: "notify_staff", params: {} },
    ]);
    expect(parseWorkflowSteps([{ action: "notify_staff", params: null }])).toEqual([
      { action: "notify_staff", params: {} },
    ]);
    // Brak klucza `params` w ogóle.
    expect(parseWorkflowSteps([{ action: "notify_staff" }])).toEqual([
      { action: "notify_staff", params: {} },
    ]);
  });

  it("akcja nie-stringowa jest odrzucana", () => {
    expect(parseWorkflowSteps([{ action: 42, params: {} }])).toEqual([]);
    expect(parseWorkflowSteps([{ action: null, params: {} }])).toEqual([]);
  });

  it("tablica MIESZANA nie jest listą ról - parametr wypada", () => {
    // isStringArray wymaga, by KAŻDY element był stringiem. Tablica ["admin", 1]
    // pochodzi z ręcznie zepsutego jsonb; wpuszczona dalej wysłałaby liczbę
    // tam, gdzie silnik oczekuje nazwy roli.
    expect(
      parseWorkflowSteps([{ action: "notify_staff", params: { roles: ["admin", 1] } }]),
    ).toEqual([{ action: "notify_staff", params: {} }]);
  });

  it("zachowuje kolejność kroków (sekwencja akcji ma znaczenie)", () => {
    const steps = parseWorkflowSteps([
      { action: "notify_staff", params: {} },
      { action: "create_crm_lead", params: {} },
      { action: "add_cross_reference", params: {} },
    ]);
    expect(steps.map((s) => s.action)).toEqual([
      "notify_staff",
      "create_crm_lead",
      "add_cross_reference",
    ]);
  });
});

describe("parseConditionValue - ramiona brzegowe", () => {
  it("pusty i sam-biały-znak dają pusty string (warunek na pustą wartość)", () => {
    expect(parseConditionValue("")).toBe("");
    expect(parseConditionValue("   ")).toBe("");
  });

  it("notacja wykładnicza NIE jest liczbą (wzorzec wymaga cyfr i kropki)", () => {
    // Świadomie: payloady emiterów nie niosą 1e5, a wpisanie takiego tekstu
    // ma dać warunek na string, nie na 100000.
    expect(parseConditionValue("1e5")).toBe("1e5");
    expect(parseConditionValue("0x10")).toBe("0x10");
    expect(parseConditionValue("42abc")).toBe("42abc");
  });

  it("wielkość litery ma znaczenie - TRUE zostaje tekstem", () => {
    expect(parseConditionValue("TRUE")).toBe("TRUE");
    expect(parseConditionValue("Null")).toBe("Null");
  });

  it("zepsuta tablica i zepsuty string JSON wracają jako tekst", () => {
    expect(parseConditionValue("[1,")).toBe("[1,");
    expect(parseConditionValue('"bez zamkniecia')).toBe('"bez zamkniecia');
  });

  it("liczby: zero, ujemna całkowita i ułamek", () => {
    expect(parseConditionValue("0")).toBe(0);
    expect(parseConditionValue("-7")).toBe(-7);
    expect(parseConditionValue("3.14")).toBe(3.14);
  });
});

describe("pairsToCondition / conditionToPairs - ramiona brzegowe", () => {
  it("klucz jest przycinany, wartość zachowuje swoje spacje wewnętrzne", () => {
    expect(pairsToCondition([{ key: "  new_stage  ", value: "  won  " }])).toEqual({
      new_stage: "won",
    });
    expect(pairsToCondition([{ key: "note", value: "dwa  slowa" }])).toEqual({
      note: "dwa  slowa",
    });
  });

  it("powtórzony klucz: ostatnia para wygrywa", () => {
    expect(
      pairsToCondition([
        { key: "status", value: "pending" },
        { key: "status", value: "approved" },
      ]),
    ).toEqual({ status: "approved" });
  });

  it("pusta lista par daje pusty warunek (= „zawsze”), nie null", () => {
    // Panel pokazuje pusty warunek jako „zawsze"; `null` w kolumnie zmieniłby
    // semantykę containment.
    expect(pairsToCondition([])).toEqual({});
  });

  it("conditionToPairs zachowuje kolejność kluczy i typuje wartości do inputu", () => {
    expect(conditionToPairs({ flag: true, depth: 2, name: "x", empty: null })).toEqual([
      { key: "flag", value: "true" },
      { key: "depth", value: "2" },
      { key: "name", value: "x" },
      { key: "empty", value: "null" },
    ]);
  });
});

describe("emptyWorkflowDraft", () => {
  it("nowy przepis jest WŁĄCZONY i bez id", () => {
    const d = emptyWorkflowDraft();
    expect(d.id).toBeNull();
    expect(d.enabled).toBe(true);
    expect(d.name).toBe("");
    expect(d.triggerEventType).toBe("");
  });

  it("każde wywołanie daje ŚWIEŻE tablice (brak współdzielonej referencji)", () => {
    // Gdyby fabryka zwracała wspólne tablice, dodanie kroku w jednym dialogu
    // pojawiłoby się w następnym „nowym" przepisie.
    const a = emptyWorkflowDraft();
    const b = emptyWorkflowDraft();
    a.steps.push({ action: "notify_staff", params: {} });
    a.conditionPairs.push({ key: "k", value: "v" });
    expect(b.steps).toEqual([]);
    expect(b.conditionPairs).toEqual([]);
  });
});

describe("draftFromDefinition - ramiona pustych kolumn", () => {
  const base: WorkflowDefinitionRow = {
    id: "def-2",
    tenant_id: "t-1",
    name: "Bez warunku",
    template_key: null,
    enabled: false,
    trigger_event_type: "post.published.v1",
    condition: null,
    steps: null,
    created_by: null,
    created_at: "2026-08-18T10:00:00Z",
    updated_at: "2026-08-18T10:00:00Z",
  };

  it("condition: null i steps: null dają puste listy, nie wysypkę", () => {
    expect(draftFromDefinition(base)).toEqual({
      id: "def-2",
      name: "Bez warunku",
      enabled: false,
      triggerEventType: "post.published.v1",
      conditionPairs: [],
      steps: [],
    });
  });

  it("krok z akcją nieznaną silnikowi jest pomijany przy wczytaniu do edytora", () => {
    // Edytor nie może wyrenderować formularza akcji, której silnik nie zna -
    // zapis takiego kroku uszkodziłby definicję.
    const draft = draftFromDefinition({
      ...base,
      steps: [
        { action: "emit_event", params: {} },
        { action: "notify_staff", params: {} },
      ],
    });
    expect(draft.steps).toEqual([{ action: "notify_staff", params: {} }]);
  });
});

describe("validateWorkflowDraft - pozostałe kombinacje", () => {
  const valid = {
    ...emptyWorkflowDraft(),
    name: "x",
    triggerEventType: "post.published.v1",
    steps: [{ action: "notify_staff", params: {} } satisfies WorkflowStep],
  };

  it("zgłasza wszystkie cztery błędy naraz", () => {
    expect(
      validateWorkflowDraft({
        ...emptyWorkflowDraft(),
        name: "   ",
        triggerEventType: "zly-typ",
        conditionPairs: [{ key: "", value: "won" }],
      }),
    ).toEqual(["name", "trigger", "steps", "conditionKey"]);
  });

  it("para CAŁKIEM pusta nie jest błędem (wiersz dodany i nietknięty)", () => {
    // Redaktor klika „dodaj warunek" i się rozmyśla - to nie jest błąd,
    // bo `pairsToCondition` taki wiersz i tak pomija.
    expect(validateWorkflowDraft({ ...valid, conditionPairs: [{ key: "", value: "  " }] })).toEqual(
      [],
    );
  });

  it("nazwa z samych spacji jest pusta", () => {
    expect(validateWorkflowDraft({ ...valid, name: "   " })).toEqual(["name"]);
  });

  it("wyzwalacz jest przycinany przed sprawdzeniem wzorca", () => {
    expect(validateWorkflowDraft({ ...valid, triggerEventType: "  post.published.v1  " })).toEqual(
      [],
    );
  });
});

describe("isValidEventType - pozostałe odrzucenia", () => {
  it("odrzuca braki i złe separatory", () => {
    expect(isValidEventType("post.published.v")).toBe(false);
    expect(isValidEventType("post.published.1")).toBe(false);
    expect(isValidEventType("post-published-v1")).toBe(false);
    expect(isValidEventType("post..v1")).toBe(false);
    expect(isValidEventType("post.published.v1.extra")).toBe(false);
    expect(isValidEventType(".published.v1")).toBe(false);
    expect(isValidEventType("post.published.V1")).toBe(false);
  });

  it("przyjmuje podkreślenia i cyfry w segmentach", () => {
    expect(isValidEventType("crm_task.due.v1")).toBe(true);
    expect(isValidEventType("a1.b2.v10")).toBe(true);
  });
});

describe("aggregateRunStats - ramiona brzegowe", () => {
  it("puste okno daje pustą mapę", () => {
    expect(aggregateRunStats([]).size).toBe(0);
  });

  it("najświeższy przebieg wygrywa niezależnie od kolejności wejścia", () => {
    // Okno przychodzi z bazy DESC, ale panel nie ma prawa na tym polegać -
    // porównanie idzie po dacie, nie po pozycji w tablicy.
    const stats = aggregateRunStats([
      { workflow_id: "a", status: "succeeded", created_at: "2026-07-20T08:00:00Z" },
      { workflow_id: "a", status: "failed", created_at: "2026-07-20T12:00:00Z" },
      { workflow_id: "a", status: "succeeded", created_at: "2026-07-20T09:00:00Z" },
    ]);
    expect(stats.get("a")).toEqual({
      total: 3,
      failed: 1,
      lastRunAt: "2026-07-20T12:00:00Z",
      lastStatus: "failed",
    });
  });

  it("status inny niż `failed` liczy się jako udany (kontrakt dwuwartościowy)", () => {
    const stats = aggregateRunStats([
      { workflow_id: "a", status: "succeeded", created_at: "2026-07-20T10:00:00Z" },
    ]);
    expect(stats.get("a")?.failed).toBe(0);
    expect(stats.get("a")?.lastStatus).toBe("succeeded");
  });
});

// ---------------------------------------------------------------------------
// RUNDA WARTOŚCI WARUNKU JEST BEZSTRATNA (regresja naprawionego defektu).
//
// Do 18.08 runda `conditionToPairs` -> (edytor) -> `pairsToCondition` gubiła
// typ: wartość, która W BAZIE jest STRINGIEM wyglądającym jak inny typ JSON
// ("true", "42", "null", '{"a":1}'), wracała z niej jako TEN INNY TYP.
//
// Skutek produkcyjny był cichy i kosztowny: redaktor otwierał istniejący
// przepis, zapisywał BEZ TKNIĘCIA warunku, a `payload @> condition` przestawał
// pasować, bo containment na jsonb rozróżnia typy. Przepis przestawał się
// odpalać, bez ani jednego komunikatu - dokładnie klasa „zły warunek przechodzi
// cicho".
//
// Naprawa: `conditionValueToInput` wypisuje string W CUDZYSŁOWACH, gdy inaczej
// zmieniłby typ. Ten blok jest więc teraz TESTEM REGRESJI, nie świadkiem defektu.
// ---------------------------------------------------------------------------

describe("runda warunku zachowuje typ (także dla stringów wyglądających jak JSON)", () => {
  const roundTrip = (value: unknown) => pairsToCondition(conditionToPairs({ k: value } as never));

  it("runda ZACHOWUJE typy, które nie kolidują z tekstem", () => {
    expect(roundTrip(true)).toEqual({ k: true });
    expect(roundTrip(false)).toEqual({ k: false });
    expect(roundTrip(null)).toEqual({ k: null });
    expect(roundTrip(42)).toEqual({ k: 42 });
    expect(roundTrip(-3.5)).toEqual({ k: -3.5 });
    expect(roundTrip("won")).toEqual({ k: "won" });
    expect(roundTrip("")).toEqual({ k: "" });
    expect(roundTrip({ a: 1 })).toEqual({ k: { a: 1 } });
    expect(roundTrip([1, 2])).toEqual({ k: [1, 2] });
    expect(roundTrip("tekst z, przecinkiem")).toEqual({ k: "tekst z, przecinkiem" });
  });

  it("runda ZACHOWUJE typ string dla wartości wyglądających jak literał JSON", () => {
    // Każda z tych linii to przepis, który PRZED naprawą po otwarciu i zapisie
    // przestawał pasować do payloadu.
    expect(roundTrip("true")).toEqual({ k: "true" });
    expect(roundTrip("false")).toEqual({ k: "false" });
    expect(roundTrip("null")).toEqual({ k: "null" });
    expect(roundTrip("42")).toEqual({ k: "42" });
    expect(roundTrip("-3.5")).toEqual({ k: "-3.5" });
    expect(roundTrip('{"a":1}')).toEqual({ k: '{"a":1}' });
    expect(roundTrip("[1,2]")).toEqual({ k: "[1,2]" });
    // Naprawa domknęła też przypadki, których defekt dotyczył ubocznie:
    // wiodące zera i otaczające spacje przestały być zjadane.
    expect(roundTrip("007")).toEqual({ k: "007" });
    expect(roundTrip("  spacja  ")).toEqual({ k: "  spacja  " });
  });

  it("conditionValueToInput ODRÓŻNIA stringa `true` od boolean true", () => {
    // To była przyczyna źródłowa straty: reprezentacja tekstowa obu wartości
    // była identyczna, więc `parseConditionValue` nie miał z czego odtworzyć
    // intencji. Teraz string, który zmieniłby typ, jedzie w cudzysłowach.
    expect(conditionValueToInput(true)).toBe("true");
    expect(conditionValueToInput("true")).toBe('"true"');
    expect(conditionValueToInput(42)).toBe("42");
    expect(conditionValueToInput("42")).toBe('"42"');
    expect(conditionValueToInput(null)).toBe("null");
    expect(conditionValueToInput("null")).toBe('"null"');
  });

  it("zwykłe wartości tekstowe WYGLĄDAJĄ jak dotąd (brak szumu cudzysłowów)", () => {
    // Naprawa nie ma prawa zmienić tego, co redaktor widzi w typowym warunku -
    // cudzysłowy pojawiają się WYŁĄCZNIE tam, gdzie ratują typ.
    expect(conditionValueToInput("won")).toBe("won");
    expect(conditionValueToInput("pending_review")).toBe("pending_review");
    expect(conditionValueToInput("")).toBe("");
    expect(conditionValueToInput("tekst z, przecinkiem")).toBe("tekst z, przecinkiem");
    expect(conditionValueToInput("1e5")).toBe("1e5");
    expect(conditionValueToInput("TRUE")).toBe("TRUE");
  });
});
