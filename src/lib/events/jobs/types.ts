// Kontrakt zadań uczestnika wołanych z harmonogramu (jobs-tick, cron
// społeczności). Foundation podpina wywołania; tory A/B/C wymieniają TREŚĆ
// swojego modułu zadania, nigdy tej sygnatury (C.0.2).

/** Opcje jednego przebiegu. */
export interface ParticipantJobOptions {
  /** Epoch ms - po tej chwili zadanie kończy porcję i oddaje resztę następnemu tickowi. */
  deadlineAt: number;
  /** Górny limit pozycji w przebiegu (zadanie ma też własny sufit). */
  limit?: number;
}

/** Liczniki przebiegu - trafiają do odpowiedzi ticku i logu harmonogramu. */
export interface ParticipantJobResult {
  claimed: number;
  sent: number;
  skipped: number;
  failed: number;
  /** Krótki opis bez danych osobowych (np. `stub`, `deadline`). */
  note?: string;
}

export const EMPTY_JOB_RESULT: Readonly<ParticipantJobResult> = Object.freeze({
  claimed: 0,
  sent: 0,
  skipped: 0,
  failed: 0,
});
