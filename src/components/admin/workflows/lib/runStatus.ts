// Katalog statusów pokazywanych odznaką w panelu „Automatyzacje" - LUSTRO
// CHECK-ów z migracji, nie osobna lista życzeń.
//
// Odznaka obsługuje DWIE powierzchnie naraz:
//   * przebiegi przepisów  - `workflow_runs.status`
//     CHECK (status IN ('succeeded', 'failed'))            [20260711204000:58]
//   * dostawy outboxu      - `integration_deliveries.status`
//     CHECK (status IN ('queued','delivering','delivered','failed','dead'))
//                                                          [20260711203000:166]
//
// Mapa w komponencie zdążyła się od nich rozjechać w OBIE strony: znała dwa
// statusy, których żaden CHECK nie dopuszcza ('pending', 'retry' - pozostałość
// po wcześniejszym kształcie tabeli), a nie znała dwóch, które realnie
// występują ('queued', 'delivering'). Te dwa trafiały do gałęzi domyślnej,
// czyli redaktor widział w polskim panelu surową wartość z bazy.
//
// Moduł zwraca DESKRYPTOR (ton, ikona, klucz i18n), nie gotowy tekst - dzięki
// temu reguła jest testowalna bez renderu, a tłumaczenie zostaje w słowniku.

/** Statusy przebiegu przepisu (`workflow_runs.status`). */
export const WORKFLOW_RUN_STATUSES = ["succeeded", "failed"] as const;

/** Statusy dostawy outboxu (`integration_deliveries.status`). */
export const DELIVERY_STATUSES = ["queued", "delivering", "delivered", "failed", "dead"] as const;

/** Wszystko, co odznaka musi umieć nazwać. */
export const BADGE_STATUSES = [
  ...new Set<string>([...WORKFLOW_RUN_STATUSES, ...DELIVERY_STATUSES]),
] as const;

export type StatusTone = "success" | "danger" | "warning" | "neutral";
export type StatusIcon = "check" | "x" | "clock" | "skull";

export interface RunStatusDescriptor {
  tone: StatusTone;
  icon: StatusIcon;
  /**
   * Klucz i18n etykiety albo `null` dla statusu spoza katalogu - wtedy widok
   * pokazuje surową wartość z bazy. `null` jest tu CELOWE: nieznany status ma
   * być widoczny jako nieznany, a nie ukryty pod wymyśloną etykietą.
   */
  labelKey: string | null;
}

const DESCRIPTORS: Record<string, RunStatusDescriptor> = {
  succeeded: { tone: "success", icon: "check", labelKey: "adminWorkflows.runs.statusSucceeded" },
  delivered: { tone: "success", icon: "check", labelKey: "adminWorkflows.runs.statusDelivered" },
  failed: { tone: "danger", icon: "x", labelKey: "adminWorkflows.runs.statusFailed" },
  queued: { tone: "warning", icon: "clock", labelKey: "adminWorkflows.runs.statusQueued" },
  delivering: { tone: "warning", icon: "clock", labelKey: "adminWorkflows.runs.statusDelivering" },
  dead: { tone: "neutral", icon: "skull", labelKey: "adminWorkflows.runs.statusDead" },
};

/** Ton, ikona i klucz etykiety dla statusu przebiegu albo dostawy. */
export function runStatusDescriptor(status: string): RunStatusDescriptor {
  return DESCRIPTORS[status] ?? { tone: "neutral", icon: "clock", labelKey: null };
}
