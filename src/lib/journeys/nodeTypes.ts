// TYPY WĘZŁÓW ŚCIEŻKI - jedna lista dla edytora (S8), walidacji grafu,
// server fn i silnika SQL (S5).
//
// Lista jest kontraktem z bazą: `journey_validate_graph` trzyma tę samą
// tablicę (`v_types`), `journey_advance` wykonuje węzły bazy, a
// `_journey_exec_action` - akcje CRM. Test `nodeTypesParity.test.ts` czyta
// migracje i pilnuje, żeby nowy typ nie powstał tylko po jednej stronie:
// węzeł znany edytorowi, a nieznany silnikowi, zatrzymałby kontakt na zawsze.
//
// Moduł bez zależności runtime (liść): czyta go też kanwa w przeglądarce.

export const JOURNEY_NODE_TYPES = [
  "trigger",
  "wait",
  "send_email",
  "ab_split",
  "if_else",
  "set_lifecycle_stage",
  "set_crm_stage",
  "create_crm_task",
  "add_tag",
  "remove_tag",
  "newsletter_list",
  "notify_staff",
  "goal",
  "exit",
] as const;
export type JourneyNodeType = (typeof JOURNEY_NODE_TYPES)[number];

/** Gałęzie krawędzi (`edges[].branch`). */
export const JOURNEY_EDGE_BRANCHES = ["next", "yes", "no", "A", "B", "event", "timeout"] as const;
export type JourneyEdgeBranch = (typeof JOURNEY_EDGE_BRANCHES)[number];

/**
 * Rodzina węzła - grupa w palecie edytora i sposób wykonania:
 *   `start`    - wyzwalacz (dokładnie jeden);
 *   `timing`   - czekanie (zapis śpi w bazie, budzi go termin albo zdarzenie);
 *   `message`  - mail (składa runner TS, bramka zgody i limitu);
 *   `logic`    - rozgałęzienie (A/B, warunek);
 *   `action`   - akcja CRM/listy/personelu (`_journey_exec_action`);
 *   `terminal` - koniec ścieżki (cel albo wyjście).
 */
export type JourneyNodeFamily = "start" | "timing" | "message" | "logic" | "action" | "terminal";

export const JOURNEY_NODE_FAMILY: Readonly<Record<JourneyNodeType, JourneyNodeFamily>> = {
  trigger: "start",
  wait: "timing",
  send_email: "message",
  ab_split: "logic",
  if_else: "logic",
  set_lifecycle_stage: "action",
  set_crm_stage: "action",
  create_crm_task: "action",
  add_tag: "action",
  remove_tag: "action",
  newsletter_list: "action",
  notify_staff: "action",
  goal: "terminal",
  exit: "terminal",
};

/** Węzły wykonywane przez `_journey_exec_action` (akcje bazy). */
export const JOURNEY_ACTION_NODE_TYPES = JOURNEY_NODE_TYPES.filter(
  (type) => JOURNEY_NODE_FAMILY[type] === "action",
);

/** Węzły końcowe - jedyne bez krawędzi wychodzących. */
export function isTerminalNodeType(type: JourneyNodeType): boolean {
  return JOURNEY_NODE_FAMILY[type] === "terminal";
}

/**
 * Gałęzie, które węzeł MUSI mieć (i żadnych innych). Czekanie na zdarzenie
 * rozgałęzia się na „przyszło" i „minął termin"; pozostałe czekania mają
 * jedno wyjście - stąd parametr.
 */
export function requiredBranches(
  type: JourneyNodeType,
  params?: unknown,
): readonly JourneyEdgeBranch[] {
  switch (type) {
    case "goal":
    case "exit":
      return [];
    case "ab_split":
      return ["A", "B"];
    case "if_else":
      return ["yes", "no"];
    case "wait": {
      const mode =
        typeof params === "object" && params !== null
          ? (params as Record<string, unknown>).mode
          : undefined;
      return mode === "until_event" ? ["event", "timeout"] : ["next"];
    }
    default:
      return ["next"];
  }
}
