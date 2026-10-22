// SESJA EDYTORA ŚCIEŻKI (S8) - szkic lokalny, autozapis z CAS, konflikt
// i stany „tylko do odczytu”. Czysta maszyna stanów + hook, który ją napędza.
//
// SZKIC LOKALNY W HISTORII. Kanwa, lista i panele zmieniają WARTOŚĆ sesji
// (graf + ustawienia + nazwa, opis, kategoria i podstawa prawna - te pola idą
// w tym samym `saveJourneyDraft`) przez `update(…, { label })`; etykieta
// operacji trafia do historii (`useHistory`: cofnij/ponów) i do komunikatu
// `aria-live`. Pisanie w polu łączy kolejne znaki jednym `coalesceKey`.
//
// AUTOZAPIS 2 s Z CAS. `useAutosave` zapisuje po 2 s bezczynności, zawsze
// z tokenem `p_expected_updated_at`: pierwszy z `getJourneyDetail`, każdy
// następny z WYNIKU poprzedniego zapisu (`useSaveJourneyDraft` wpisuje go też
// do cache szczegółu, więc refetch nie cofa tokenu). Zapisy idą po kolei -
// `useAutosave` szereguje je i zbiera zmiany z czasu trwania zapisu.
//
// WŁASNY ZAPIS ≠ OBCY. Każdy zapis emituje `journey.changed.v1`, a szyna
// unieważnia `detail(id)` TAKŻE w karcie, która zapisała. Rozstrzyga token:
//   * token znany (nasz zapis albo stan już przyjęty) -> nic nie robimy;
//     refetch nigdy nie nadpisze szkicu, który właśnie piszesz;
//   * zapis w locie -> decyzję odkładamy do jego końca (wynik zapisu może
//     dopiero powiedzieć, że ten token jest nasz);
//   * obcy token przy czystym szkicu -> przyjmujemy wersję serwera
//     (komunikat „wczytano zmiany z innej karty”, historia od nowa);
//   * obcy token przy brudnym szkicu -> KONFLIKT (dialog różnic), chyba że
//     serwer ma dokładnie nasz stan (cicho) albo tę samą treść co nasza baza,
//     a przesunął się tylko token (publikacja, pauza) - wtedy ponawiamy zapis
//     z nowym tokenem bez pytania.
// Odrzucenie zapisu z `conflict` też otwiera konflikt: pobieramy szczegół
// i porównujemy jak wyżej. Do rozstrzygnięcia autozapis stoi.
//
// ROZSTRZYGNIĘCIE. „Zachowaj moje” = zapis lokalnego szkicu z tokenem wersji
// serwera (świadome nadpisanie), „weź serwera” = wersja serwera jako nowa,
// czysta baza (bez zapisu). Dane do dialogu: `journeyConflictDiff`.
//
// TREŚĆ MAILA PO ZAPISANYM WĘŹLE. `admin_journey_email_content_save` szuka
// węzła `send_email` w ZAPISANYM szkicu (`node_not_email`), a treść nie ma
// CAS - edytor maila woła `ensureNodeSaved(nodeId)` (flush grafu) przed
// pierwszym zapisem treści nowego kroku.
//
// STANY SESJI: „wybierz wyzwalacz” (szkic z `createJourney` nie ma
// `triggerEventType`, więc nie przechodzi `JourneyDraftSchema` i nie da się go
// zapisać - wybór wyzwalacza zapisuje go od razu), „szkic do naprawy” (stary
// szkic spoza schematu), „tylko do odczytu” (rola bez `canEdit`, podgląd
// wersji `?version=k`, ścieżka w archiwum - RPC i tak odrzuca zapis
// `journey_archived`). Ochrona przed utratą: `useUnsavedChangesGuard(isDirty)`.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAutosave, type AutosaveStatus } from "@/hooks/useAutosave";
import { useHistory } from "@/hooks/useHistory";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { diffLines, type DiffLine } from "@/lib/content/revisionDiff";
import { ensureI18n } from "@/lib/i18n-admin-journeys-editor";
import {
  JourneyDraftSchema,
  JourneyGraphSchema,
  JourneySettingsSchema,
  emptyJourneyGraph,
  type JourneyDraft,
  type JourneySettings,
} from "@/lib/journeys/graph";
import { JOURNEY_LIMITS, type JourneyCategory } from "@/lib/journeys/limits";
import { isMfaRequiredError, type JourneyCapabilities } from "./access";
import { stableStringify } from "./hash";
import type {
  JourneyDefinitionDto,
  JourneyDetailDto,
  JourneyDetailRead,
} from "./journeyEditor.functions";
import { journeyDetailQueryOptions } from "./journeyQueries";
import {
  mutationErrorText,
  useSaveJourneyDraft,
  type JourneyMutationFailure,
} from "./journeyMutations";

/** Autozapis po 2 s bezczynności (SPEC §6.3). */
export const JOURNEY_AUTOSAVE_DELAY_MS = 2_000;

/**
 * Ile tokenów pamiętamy jako „nasze”. Refetch może przynieść token sprzed
 * kilku naszych zapisów (wyścig zapytań), nigdy sprzed dziesiątek - 32 to
 * zapas, a lista nie rośnie przez całą sesję.
 */
const KNOWN_TOKENS_LIMIT = 32;

// ── Wartość sesji ───────────────────────────────────────────────────────────

/** Pola definicji zapisywane razem ze szkicem (puste = NULL w bazie). */
export interface JourneyDefinitionFields {
  name: string;
  description: string;
  category: JourneyCategory;
  legalBasis: string;
}

/** To, co edytor zmienia i autozapis wysyła jednym `saveJourneyDraft`. */
export interface JourneyEditorValue {
  draft: JourneyDraft;
  definition: JourneyDefinitionFields;
}

export type JourneyDraftState = "valid" | "needs_trigger" | "invalid";

/** Stan ścieżki z serwera w kształcie sesji (z jednego odczytu szczegółu). */
export interface JourneyServerSnapshot {
  /** `journey_definitions.updated_at` - token CAS. */
  token: string;
  definition: JourneyDefinitionFields;
  draft: JourneyDraft | null;
  /** Surowy szkic (naprawa szkicu spoza schematu). */
  draftRaw: unknown;
  draftState: JourneyDraftState;
  draftIssue: string | null;
  archived: boolean;
  /** Szkic + definicja; `null`, gdy szkic nie przechodzi schematu. */
  value: JourneyEditorValue | null;
}

export function definitionFields(definition: JourneyDefinitionDto): JourneyDefinitionFields {
  return {
    name: definition.name,
    description: definition.description ?? "",
    category: definition.category,
    legalBasis: definition.legalBasis ?? "",
  };
}

const TRIGGER_RE = JOURNEY_LIMITS.triggerEventTypePattern;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Szkic odrzucony przez schemat: bez poprawnego wyzwalacza = „wybierz
 * wyzwalacz” (pusty szkic z `createJourney`), z wyzwalaczem = „do naprawy”.
 */
export function draftStateOf(
  detail: Pick<JourneyDetailDto, "draftValid" | "draftRaw">,
): JourneyDraftState {
  if (detail.draftValid) return "valid";
  const settings = isRecord(detail.draftRaw) ? detail.draftRaw.settings : undefined;
  const trigger = isRecord(settings) ? settings.triggerEventType : undefined;
  return typeof trigger === "string" && TRIGGER_RE.test(trigger) ? "invalid" : "needs_trigger";
}

export function serverSnapshot(detail: JourneyDetailDto): JourneyServerSnapshot {
  const definition = definitionFields(detail.definition);
  const draft = detail.draftValid ? detail.draft : null;
  return {
    token: detail.definition.updatedAt,
    definition,
    draft,
    draftRaw: detail.draftRaw,
    draftState: draftStateOf(detail),
    draftIssue: detail.draftIssue,
    archived: detail.definition.status === "archived",
    value: draft ? { draft, definition } : null,
  };
}

/**
 * Postać porównywana: pola definicji przycięte (serwer zapisuje je po `trim`,
 * więc spacja na końcu nazwy w trakcie pisania to nie zmiana).
 */
function canonical(value: JourneyEditorValue): unknown {
  const { name, description, category, legalBasis } = value.definition;
  return {
    draft: value.draft,
    definition: {
      name: name.trim(),
      description: description.trim(),
      category,
      legalBasis: legalBasis.trim(),
    },
  };
}

/** Równość treści (stabilny JSON - kolejność kluczy po jsonb nie ma znaczenia). */
export function sameEditorValue(
  a: JourneyEditorValue | null,
  b: JourneyEditorValue | null,
): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return stableStringify(canonical(a)) === stableStringify(canonical(b));
}

/**
 * Klucz porównania tokenów. Ten sam `updated_at` przychodzi z tabeli
 * (PostgREST) i z wyniku RPC (jsonb) - zapis strefy i ułamka sekundy może się
 * różnić, chwila nie. Mikrosekundy zostają (dwa zapisy w jednej milisekundzie
 * to wciąż dwa tokeny).
 */
export function normalizeToken(token: string): string {
  const match =
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(
      token.trim(),
    );
  if (!match) return token;
  const [, day, time, fraction = "", zone = "Z"] = match;
  const offset =
    zone === "Z"
      ? "Z"
      : zone.length === 3
        ? `${zone}:00`
        : zone.replace(/^(.\d{2})(\d{2})$/, "$1:$2");
  const seconds = Date.parse(`${day}T${time}${offset}`);
  if (Number.isNaN(seconds)) return token;
  return `${seconds / 1000}.${fraction.padEnd(6, "0").slice(0, 6)}`;
}

/** Ustawienia wyzwalacza zachowujące te klucze surowych ustawień, które przechodzą schemat. */
function salvageSettings(raw: unknown, triggerEventType: string): JourneySettings | null {
  const start = JourneySettingsSchema.safeParse({ triggerEventType });
  if (!start.success) return null;
  let settings: JourneySettings = start.data;
  if (!isRecord(raw)) return settings;
  for (const key of Object.keys(raw).sort()) {
    if (key === "triggerEventType") continue;
    const next = JourneySettingsSchema.safeParse({ ...settings, [key]: raw[key] });
    if (next.success) settings = next.data;
  }
  return settings;
}

/**
 * Szkic z surowych danych: wyzwalacz (podany albo zapisany), ustawienia,
 * które da się odczytać, i graf, jeśli przechodzi schemat (inaczej - albo gdy
 * jest pusty - `emptyJourneyGraph()`). `null` = brak poprawnego wyzwalacza.
 */
export function repairDraft(raw: unknown, triggerEventType?: string | null): JourneyDraft | null {
  const record = isRecord(raw) ? raw : {};
  const rawSettings = isRecord(record.settings) ? record.settings : {};
  const trigger = triggerEventType ?? rawSettings.triggerEventType;
  if (typeof trigger !== "string") return null;
  const settings = salvageSettings(rawSettings, trigger);
  if (!settings) return null;
  const graph = JourneyGraphSchema.safeParse(record.graph);
  const draft = JourneyDraftSchema.safeParse({
    graph: graph.success && graph.data.nodes.length > 0 ? graph.data : emptyJourneyGraph(),
    settings,
  });
  return draft.success ? draft.data : null;
}

export type JourneyValueIssueField =
  "name" | "description" | "legalBasis" | "legalBasisRequired" | "draft";

export interface JourneyValueIssue {
  field: JourneyValueIssueField;
  /** Ścieżka pola szkicu odrzuconego przez schemat (`graph.nodes.3.params`). */
  path?: string;
}

/**
 * Wartość, której serwer nie przyjmie - autozapis jej nie wysyła (zapis
 * zakończyłby się `invalid`/`limit_exceeded`, a szkic zostaje brudny i chroniony).
 * Limity = walidator `saveJourneyDraft` i CHECK-i `journey_definitions`.
 */
export function validateEditorValue(value: JourneyEditorValue): JourneyValueIssue | null {
  const { name, description, category, legalBasis } = value.definition;
  const trimmedName = name.trim();
  if (trimmedName.length < JOURNEY_LIMITS.nameMin || trimmedName.length > JOURNEY_LIMITS.nameMax) {
    return { field: "name" };
  }
  if (description.trim().length > JOURNEY_LIMITS.descriptionMax) return { field: "description" };
  if (legalBasis.trim().length > JOURNEY_LIMITS.legalBasisMax) return { field: "legalBasis" };
  if (category === "service" && legalBasis.trim() === "") return { field: "legalBasisRequired" };
  const draft = JourneyDraftSchema.safeParse(value.draft);
  if (!draft.success) {
    return { field: "draft", path: draft.error.issues[0]?.path.join(".") ?? "" };
  }
  return null;
}

// ── Maszyna stanów ──────────────────────────────────────────────────────────

export interface JourneyEditorConflict {
  /** Szkic lokalny w chwili wykrycia konfliktu. */
  local: JourneyEditorValue;
  /** Wersja z serwera; `null` - jeszcze ją pobieramy (konflikt zgłosił zapis). */
  server: JourneyServerSnapshot | null;
}

export interface JourneySessionState {
  /** Token następnego zapisu (`p_expected_updated_at`). */
  token: string | null;
  /** Ostatni stan zgodny z serwerem - odniesienie „brudności” szkicu. */
  base: JourneyEditorValue | null;
  /** Tokeny nasze i przyjęte (znormalizowane, ostatnie `KNOWN_TOKENS_LIMIT`). */
  known: readonly string[];
  conflict: JourneyEditorConflict | null;
}

export const INITIAL_JOURNEY_SESSION: JourneySessionState = {
  token: null,
  base: null,
  known: [],
  conflict: null,
};

export type JourneySessionEvent =
  | {
      type: "server";
      snapshot: JourneyServerSnapshot;
      local: JourneyEditorValue | null;
      /** Zapis w locie - obcy token rozstrzygamy dopiero po nim. */
      saving: boolean;
      /** Odczyt na żądanie po konflikcie: rozstrzyga nawet znany token. */
      authoritative?: boolean;
    }
  | { type: "saved"; token: string; value: JourneyEditorValue }
  | { type: "save_conflict"; local: JourneyEditorValue }
  | { type: "keep_mine" }
  | { type: "take_server" }
  | { type: "adopt_token"; token: string };

/**
 * Skutek przejścia dla hooka:
 *   * `load`    - szkic lokalny := `state.base` (nowa baza, historia od nowa);
 *   * `adopt`   - jak `load` + komunikat o zmianach z innej karty;
 *   * `defer`   - zapis w locie, rozstrzygnąć po nim;
 *   * `conflict`- otworzyć dialog różnic;
 *   * `refetch` - pobrać szczegół (konflikt bez wersji serwera);
 *   * `retry`   - przesunął się tylko token: zapisać szkic jeszcze raz;
 *   * `flush`   - „zachowaj moje”: zapisać szkic z tokenem serwera.
 */
export type JourneySessionEffect =
  "none" | "load" | "adopt" | "defer" | "conflict" | "refetch" | "retry" | "flush";

export interface JourneySessionTransition {
  state: JourneySessionState;
  effect: JourneySessionEffect;
}

function remember(known: readonly string[], token: string): readonly string[] {
  const key = normalizeToken(token);
  if (known.includes(key)) return known;
  return [...known, key].slice(-KNOWN_TOKENS_LIMIT);
}

function isKnown(state: JourneySessionState, token: string): boolean {
  return state.known.includes(normalizeToken(token));
}

function sameToken(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && normalizeToken(a) === normalizeToken(b);
}

function withToken(state: JourneySessionState, token: string): JourneySessionState {
  return { ...state, token, known: remember(state.known, token) };
}

/** Konflikt z wersją serwera w ręku: cicho, ponowienie albo dialog. */
function resolveConflict(
  state: JourneySessionState,
  conflict: JourneyEditorConflict,
  snapshot: JourneyServerSnapshot,
): JourneySessionTransition {
  if (snapshot.value && sameEditorValue(snapshot.value, conflict.local)) {
    return {
      state: { ...withToken(state, snapshot.token), base: snapshot.value, conflict: null },
      effect: "none",
    };
  }
  if (
    snapshot.value &&
    sameEditorValue(snapshot.value, state.base) &&
    !sameToken(snapshot.token, state.token)
  ) {
    return { state: { ...withToken(state, snapshot.token), conflict: null }, effect: "retry" };
  }
  return { state: { ...state, conflict: { ...conflict, server: snapshot } }, effect: "conflict" };
}

function onServer(
  state: JourneySessionState,
  event: Extract<JourneySessionEvent, { type: "server" }>,
): JourneySessionTransition {
  const { snapshot, local } = event;
  if (state.token === null) {
    return {
      state: { ...withToken(state, snapshot.token), base: snapshot.value },
      effect: "load",
    };
  }
  const { conflict } = state;
  if (conflict) {
    if (conflict.server && sameToken(conflict.server.token, snapshot.token)) {
      return { state, effect: "none" };
    }
    // Czekamy na OBCĄ wersję - znany token to jeszcze stary obraz cache.
    if (!event.authoritative && conflict.server === null && isKnown(state, snapshot.token)) {
      return { state, effect: "none" };
    }
    if (event.saving) return { state, effect: "defer" };
    return resolveConflict(state, conflict, snapshot);
  }
  if (isKnown(state, snapshot.token)) return { state, effect: "none" };
  if (event.saving) return { state, effect: "defer" };

  const dirty = local !== null && state.base !== null && !sameEditorValue(local, state.base);
  if (!dirty) {
    const silent = sameEditorValue(snapshot.value, local);
    return {
      state: { ...withToken(state, snapshot.token), base: snapshot.value },
      effect: silent ? "none" : "adopt",
    };
  }
  if (snapshot.value && sameEditorValue(snapshot.value, local)) {
    return { state: { ...withToken(state, snapshot.token), base: snapshot.value }, effect: "none" };
  }
  if (snapshot.value && sameEditorValue(snapshot.value, state.base)) {
    return { state: withToken(state, snapshot.token), effect: "retry" };
  }
  return { state: { ...state, conflict: { local, server: snapshot } }, effect: "conflict" };
}

/** Jedno przejście maszyny sesji - czyste, bez Reacta. */
export function reduceJourneySession(
  state: JourneySessionState,
  event: JourneySessionEvent,
): JourneySessionTransition {
  switch (event.type) {
    case "server":
      return onServer(state, event);
    case "saved":
      return { state: { ...withToken(state, event.token), base: event.value }, effect: "none" };
    case "save_conflict":
      if (state.conflict) return { state, effect: "none" };
      return {
        state: { ...state, conflict: { local: event.local, server: null } },
        effect: "refetch",
      };
    case "keep_mine": {
      const server = state.conflict?.server;
      if (!server) return { state, effect: "none" };
      return {
        state: { ...withToken(state, server.token), base: server.value, conflict: null },
        effect: "flush",
      };
    }
    case "take_server": {
      const server = state.conflict?.server;
      if (!server) return { state, effect: "none" };
      return {
        state: { ...withToken(state, server.token), base: server.value, conflict: null },
        effect: "load",
      };
    }
    case "adopt_token":
      return { state: withToken(state, event.token), effect: "none" };
  }
}

// ── Tryb sesji ──────────────────────────────────────────────────────────────

export type JourneySessionMode = "loading" | "needs_trigger" | "invalid" | "edit" | "readonly";
export type JourneyReadOnlyReason = "role" | "version" | "archived";

export function journeySessionMode(input: {
  snapshot: JourneyServerSnapshot | null;
  hasBase: boolean;
  canEdit: boolean;
  versionPreview: boolean;
}): { mode: JourneySessionMode; readOnlyReason: JourneyReadOnlyReason | null } {
  const { snapshot } = input;
  if (!snapshot) return { mode: "loading", readOnlyReason: null };
  const reason: JourneyReadOnlyReason | null = !input.canEdit
    ? "role"
    : input.versionPreview
      ? "version"
      : snapshot.archived
        ? "archived"
        : null;
  if (reason) return { mode: "readonly", readOnlyReason: reason };
  if (!input.hasBase) {
    return {
      mode: snapshot.draftState === "valid" ? "loading" : snapshot.draftState,
      readOnlyReason: null,
    };
  }
  return { mode: "edit", readOnlyReason: null };
}

export type JourneySessionNotice =
  "needs_trigger" | "draft_invalid" | "archived" | "version" | "role" | "conflict";

/** Zdania stanów sesji (pasek nad kanwą - S8.3d). */
export const JOURNEY_SESSION_NOTICE_KEY: Readonly<Record<JourneySessionNotice, string>> = {
  needs_trigger: "adminJourneys.editor.session.notice.needsTrigger",
  draft_invalid: "adminJourneys.editor.session.notice.draftInvalid",
  archived: "adminJourneys.editor.session.notice.archived",
  version: "adminJourneys.editor.session.notice.version",
  role: "adminJourneys.editor.session.notice.role",
  conflict: "adminJourneys.editor.session.notice.conflict",
};

/** Powody wstrzymania autozapisu przez walidację lokalną. */
export const JOURNEY_VALUE_ISSUE_KEY: Readonly<Record<JourneyValueIssueField, string>> = {
  name: "adminJourneys.editor.autosave.invalid.name",
  description: "adminJourneys.editor.autosave.invalid.description",
  legalBasis: "adminJourneys.editor.autosave.invalid.legalBasis",
  legalBasisRequired: "adminJourneys.editor.autosave.invalid.legalBasisRequired",
  draft: "adminJourneys.editor.autosave.invalid.draft",
};

// ── Różnice konfliktu ───────────────────────────────────────────────────────

export type JourneyConflictSectionId = "definition" | "settings" | "nodes" | "edges";

export const JOURNEY_CONFLICT_SECTIONS: readonly JourneyConflictSectionId[] = [
  "definition",
  "settings",
  "nodes",
  "edges",
];

export interface JourneyConflictSection {
  id: JourneyConflictSectionId;
  /** `removed` = tylko na serwerze, `added` = tylko w szkicu lokalnym. */
  lines: DiffLine[];
}

function definitionLines(definition: JourneyDefinitionFields): string[] {
  return [
    `name: ${JSON.stringify(definition.name.trim())}`,
    `description: ${JSON.stringify(definition.description.trim())}`,
    `category: ${JSON.stringify(definition.category)}`,
    `legalBasis: ${JSON.stringify(definition.legalBasis.trim())}`,
  ];
}

function settingsLines(settings: JourneySettings | null): string[] {
  if (!settings) return [];
  const record = settings as Record<string, unknown>;
  return Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${key}: ${stableStringify(record[key])}`);
}

/**
 * Linie stabilnego JSON-u: jedna linia na pole definicji, klucz ustawień,
 * krok i połączenie. Kroki i połączenia w kolejności grafu (kolejność krawędzi
 * decyduje o rodzicu w widoku). Linia na krok zamiast JSON-a „pretty”: graf
 * 60 kroków mieści się w limicie `diffLines` (800 linii) z zapasem.
 */
export function journeyConflictLines(
  definition: JourneyDefinitionFields,
  draft: JourneyDraft | null,
): Record<JourneyConflictSectionId, string[]> {
  return {
    definition: definitionLines(definition),
    settings: settingsLines(draft?.settings ?? null),
    nodes: (draft?.graph.nodes ?? []).map((node) => stableStringify(node)),
    edges: (draft?.graph.edges ?? []).map((edge) => stableStringify(edge)),
  };
}

/** Sekcje, które się różnią (stała kolejność), z liniami do `collapseContext`. */
export function journeyConflictDiff(
  local: JourneyEditorValue,
  server: JourneyServerSnapshot,
): JourneyConflictSection[] {
  const mine = journeyConflictLines(local.definition, local.draft);
  const theirs = journeyConflictLines(server.definition, server.draft);
  return JOURNEY_CONFLICT_SECTIONS.flatMap((id) => {
    if (mine[id].join("\n") === theirs[id].join("\n")) return [];
    return [{ id, lines: diffLines(theirs[id], mine[id]) }];
  });
}

// ── Hook ────────────────────────────────────────────────────────────────────

export interface UseJourneyEditorSessionOptions {
  journeyId: string;
  /** Po hydratacji i z najemcą (`useHydrated()` + `useAuth().tenantId`). */
  enabled: boolean;
  capabilities: Pick<JourneyCapabilities, "canEdit">;
  /** Podgląd opublikowanej wersji (`?version=k`) - szkic tylko do odczytu. */
  versionPreview?: boolean;
  /** Tylko testy; produkcja = `JOURNEY_AUTOSAVE_DELAY_MS`. */
  delayMs?: number;
}

export interface JourneyUpdateOptions {
  /** Przetłumaczona nazwa operacji - historia i `aria-live`. */
  label: string;
  /** Kolejne zmiany z tym samym kluczem = jeden wpis historii (pisanie w polu). */
  coalesceKey?: string;
  /**
   * `false` - komunikat ogłasza widok, który wykonał operację (kanwa i lista
   * mówią „Wykonano: …” albo powód odmowy i przenoszą fokus), więc sesja go
   * nie powtarza; etykieta zostaje w historii dla „Cofnięto: …”.
   */
  announce?: boolean;
}

export type JourneySessionActionResult = { ok: true } | { ok: false; message: string };

export interface JourneySessionAnnouncement {
  /** Rośnie przy każdym komunikacie - ten sam tekst ogłasza się drugi raz. */
  id: number;
  text: string;
}

export interface JourneyEditorSession {
  /** Odczyt szczegółu (stany `forbidden`/`unavailable`/`not_found` rysuje edytor). */
  read: JourneyDetailRead<JourneyDetailDto> | null;
  /** Błąd zapytania (`isMfaRequiredError` -> `MfaRequiredNotice`). */
  error: unknown;
  detail: JourneyDetailDto | null;
  mode: JourneySessionMode;
  readOnlyReason: JourneyReadOnlyReason | null;
  /** Wolno zmieniać szkic (tryb `edit` i brak konfliktu). */
  editable: boolean;
  notice: { code: JourneySessionNotice; text: string } | null;
  value: JourneyEditorValue | null;
  draft: JourneyDraft | null;
  /** Token CAS do publikacji i statusu (`expectedUpdatedAt`). */
  token: string | null;
  isDirty: boolean;
  isSaving: boolean;
  update: (
    recipe: (value: JourneyEditorValue) => JourneyEditorValue,
    options: JourneyUpdateOptions,
  ) => boolean;
  updateDraft: (
    recipe: (draft: JourneyDraft) => JourneyDraft,
    options: JourneyUpdateOptions,
  ) => boolean;
  updateDefinition: (
    patch: Partial<JourneyDefinitionFields>,
    options: JourneyUpdateOptions,
  ) => boolean;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  discard: () => void;
  /** Zapis teraz; token po zapisie albo `null`, gdy się nie udał (konflikt, walidacja, sieć). */
  flush: () => Promise<string | null>;
  /** Węzeł `send_email` jest w ZAPISANYM szkicu (flush, jeśli trzeba). */
  ensureNodeSaved: (nodeId: string) => Promise<boolean>;
  /** „Wybierz wyzwalacz”: zapisuje szkic z wyzwalaczem od razu. */
  chooseTrigger: (triggerEventType: string) => Promise<JourneySessionActionResult>;
  /** „Napraw szkic”: zachowuje części szkicu, które przechodzą schemat. */
  repairDraft: () => Promise<JourneySessionActionResult>;
  conflict: JourneyEditorConflict | null;
  keepMine: () => Promise<boolean>;
  takeServer: () => void;
  /** Konflikt zgłoszony z zewnątrz (publikacja, status) - pobiera wersję serwera. */
  reportConflict: () => void;
  /** Token z własnej publikacji/zmiany statusu (szkic na serwerze bez zmian). */
  adoptToken: (token: string) => void;
  /** Gotowe propsy `<AutosaveBar {...session.autosaveBar} />`. */
  autosaveBar: {
    status: AutosaveStatus;
    error: string | null;
    canUndo: boolean;
    canRedo: boolean;
    onUndo: () => void;
    onRedo: () => void;
    onDiscard?: () => void;
  };
  lastSavedAt: number | null;
  announcement: JourneySessionAnnouncement | null;
}

type SaveFailure =
  | { kind: "conflict" }
  | { kind: "invalid"; issue: JourneyValueIssue }
  | { kind: "mutation"; failure: JourneyMutationFailure }
  | { kind: "mfa" }
  | { kind: "error" };

/** Zapis odrzucony przez sesję - `useAutosave` zostawia szkic brudny. */
class JourneySessionSaveError extends Error {
  constructor(readonly failure: SaveFailure) {
    super(`journey session: ${failure.kind}`);
    this.name = "JourneySessionSaveError";
  }
}

export function useJourneyEditorSession(
  options: UseJourneyEditorSessionOptions,
): JourneyEditorSession {
  ensureI18n();
  const { t } = useTranslation();
  const { journeyId, enabled, capabilities } = options;
  const versionPreview = options.versionPreview ?? false;
  const delayMs = options.delayMs ?? JOURNEY_AUTOSAVE_DELAY_MS;
  const queryClient = useQueryClient();

  const query = useQuery({ ...journeyDetailQueryOptions(journeyId), enabled });
  const read = query.data ?? null;
  const detail = read?.state === "ready" ? read.data : null;
  const snapshot = useMemo(() => (detail ? serverSnapshot(detail) : null), [detail]);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const history = useHistory<JourneyEditorValue | null>(null, { isEqual: sameEditorValue });
  const {
    state: local,
    set: setHistory,
    reset: resetHistory,
    undo: undoHistory,
    redo: redoHistory,
    canUndo,
    canRedo,
    lastLabel,
    nextLabel,
  } = history;
  const localRef = useRef(local);
  localRef.current = local;

  const [session, setSession] = useState<JourneySessionState>(INITIAL_JOURNEY_SESSION);
  const sessionRef = useRef(session);
  // Pokolenie bazy: zmiana = `useAutosave` przyjmuje bieżącą wartość jako czystą
  // (wczytanie, przyjęcie wersji z innej karty, „weź serwera”) zamiast jej zapisu.
  const [generation, setGeneration] = useState(0);
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const [announcement, setAnnouncement] = useState<JourneySessionAnnouncement | null>(null);
  const [settledTick, setSettledTick] = useState(0);
  const inFlightRef = useRef(0);
  const refetchAfterSaveRef = useRef(false);

  const { mode, readOnlyReason } = journeySessionMode({
    snapshot,
    hasBase: session.base !== null,
    canEdit: capabilities.canEdit,
    versionPreview,
  });
  const editable = mode === "edit" && session.conflict === null;
  const editableRef = useRef(editable);
  editableRef.current = editable;
  // Zapis wolny także w podglądzie wersji: szkic sprzed przełączenia ma dojść do bazy.
  const writable = capabilities.canEdit && !(snapshot?.archived ?? false);
  const writableRef = useRef(writable);
  writableRef.current = writable;

  const saveDraft = useSaveJourneyDraft(journeyId);
  const mutateAsync = saveDraft.mutateAsync;

  const announce = useCallback((text: string) => {
    setAnnouncement((previous) => ({ id: (previous?.id ?? 0) + 1, text }));
  }, []);

  const dispatch = useCallback((event: JourneySessionEvent): JourneySessionTransition => {
    const transition = reduceJourneySession(sessionRef.current, event);
    sessionRef.current = transition.state;
    setSession(transition.state);
    return transition;
  }, []);

  const rebase = useCallback(
    (value: JourneyEditorValue | null) => {
      resetHistory(value);
      setGeneration((current) => current + 1);
    },
    [resetHistory],
  );

  // `flush` z `useAutosave` jest znany dopiero po jego wywołaniu niżej.
  const autosaveFlushRef = useRef<() => Promise<void>>(async () => {});

  const flush = useCallback(async (): Promise<string | null> => {
    if (sessionRef.current.conflict || !writableRef.current) return null;
    try {
      await autosaveFlushRef.current();
    } catch {
      return null;
    }
    const after = sessionRef.current;
    return after.conflict ? null : after.token;
  }, []);

  const refetchServer = useCallback(async () => {
    try {
      const fresh = await queryClient.fetchQuery({
        ...journeyDetailQueryOptions(journeyId),
        staleTime: 0,
      });
      if (fresh.state !== "ready") return;
      const transition = dispatch({
        type: "server",
        snapshot: serverSnapshot(fresh.data),
        local: localRef.current,
        saving: inFlightRef.current > 0,
        authoritative: true,
      });
      applyRef.current(transition);
    } catch {
      // Odczyt się nie udał - konflikt czeka na wersję serwera (dialog
      // pokazuje wczytywanie), a dostarczy ją szyna albo kolejna próba.
    }
  }, [dispatch, journeyId, queryClient]);

  const apply = useCallback(
    ({ state, effect }: JourneySessionTransition) => {
      switch (effect) {
        case "load":
          rebase(state.base);
          return;
        case "adopt":
          rebase(state.base);
          announce(t("adminJourneys.editor.session.announce.external"));
          return;
        case "refetch":
          void refetchServer();
          return;
        case "retry":
          setFailure(null);
          void flush();
          return;
        default:
          return;
      }
    },
    [announce, flush, rebase, refetchServer, t],
  );
  const applyRef = useRef(apply);
  applyRef.current = apply;

  // Inna ścieżka bez odmontowania (nawigacja między edytorami): sesja od zera,
  // zanim maszyna zobaczy szczegół nowej ścieżki (efekty biegną po kolei).
  const sessionJourneyRef = useRef(journeyId);
  useEffect(() => {
    if (sessionJourneyRef.current === journeyId) return;
    sessionJourneyRef.current = journeyId;
    sessionRef.current = INITIAL_JOURNEY_SESSION;
    setSession(INITIAL_JOURNEY_SESSION);
    setFailure(null);
    setAnnouncement(null);
    rebase(null);
  }, [journeyId, rebase]);

  // Każdy nowy odczyt szczegółu (refetch po szynie, zapis do cache) i koniec
  // każdego zapisu (odłożone rozstrzygnięcia) przechodzą przez maszynę.
  useEffect(() => {
    if (!snapshot) return;
    applyRef.current(
      dispatch({
        type: "server",
        snapshot,
        local: localRef.current,
        saving: inFlightRef.current > 0,
      }),
    );
  }, [dispatch, snapshot, settledTick]);

  const persist = useCallback(
    async (value: JourneyEditorValue | null): Promise<void> => {
      if (value === null) return;
      const current = sessionRef.current;
      const fail = (reason: SaveFailure) => {
        setFailure(reason);
        return new JourneySessionSaveError(reason);
      };
      // Konflikt czeka na decyzję - zapis z nieaktualnym tokenem tylko by go powtórzył.
      if (current.conflict) throw fail({ kind: "conflict" });
      const token = current.token;
      if (!writableRef.current || token === null) throw fail({ kind: "error" });
      const issue = validateEditorValue(value);
      if (issue) throw fail({ kind: "invalid", issue });

      inFlightRef.current += 1;
      try {
        const result = await mutateAsync({
          expectedUpdatedAt: token,
          draft: value.draft,
          name: value.definition.name.trim(),
          description: value.definition.description,
          category: value.definition.category,
          legalBasis: value.definition.legalBasis,
        });
        if (result.ok) {
          dispatch({ type: "saved", token: result.data.updatedAt, value });
          setFailure(null);
          return;
        }
        if (result.error === "conflict") {
          const transition = dispatch({ type: "save_conflict", local: localRef.current ?? value });
          // Pobranie wersji serwera dopiero po zejściu zapisu z „w locie”.
          if (transition.effect === "refetch") refetchAfterSaveRef.current = true;
          throw fail({ kind: "conflict" });
        }
        throw fail({ kind: "mutation", failure: result });
      } catch (error) {
        if (!(error instanceof JourneySessionSaveError)) {
          setFailure(isMfaRequiredError(error) ? { kind: "mfa" } : { kind: "error" });
        }
        throw error;
      } finally {
        inFlightRef.current -= 1;
        setSettledTick((tick) => tick + 1);
        if (refetchAfterSaveRef.current && inFlightRef.current === 0) {
          refetchAfterSaveRef.current = false;
          void refetchServer();
        }
      }
    },
    [dispatch, mutateAsync, refetchServer],
  );

  const autosave = useAutosave<JourneyEditorValue | null>({
    value: local,
    save: persist,
    delayMs,
    enabled: session.base !== null && session.conflict === null && writable,
    equals: sameEditorValue,
    resetKey: `${journeyId}:${generation}`,
  });
  autosaveFlushRef.current = autosave.flush;

  const isDirty = useMemo(
    () => local !== null && session.base !== null && !sameEditorValue(local, session.base),
    [local, session.base],
  );
  useUnsavedChangesGuard(isDirty);

  const update = useCallback(
    (recipe: (value: JourneyEditorValue) => JourneyEditorValue, opts: JourneyUpdateOptions) => {
      const current = localRef.current;
      if (!editableRef.current || current === null) return false;
      const next = recipe(current);
      if (sameEditorValue(next, current)) return false;
      setHistory((previous) => (previous === current ? next : previous && recipe(previous)), {
        label: opts.label,
        coalesceKey: opts.coalesceKey,
      });
      // Pisanie w polu nie zalewa czytnika - ogłaszamy operacje, nie znaki.
      if (!opts.coalesceKey && opts.announce !== false) announce(opts.label);
      return true;
    },
    [announce, setHistory],
  );

  const updateDraft = useCallback(
    (recipe: (draft: JourneyDraft) => JourneyDraft, opts: JourneyUpdateOptions) =>
      update((value) => ({ ...value, draft: recipe(value.draft) }), opts),
    [update],
  );

  const updateDefinition = useCallback(
    (patch: Partial<JourneyDefinitionFields>, opts: JourneyUpdateOptions) =>
      update((value) => ({ ...value, definition: { ...value.definition, ...patch } }), opts),
    [update],
  );

  const undo = useCallback(() => {
    if (!editableRef.current || !canUndo) return;
    undoHistory();
    announce(
      lastLabel
        ? t("adminJourneys.editor.session.announce.undone", { label: lastLabel })
        : t("adminJourneys.editor.session.announce.undoneGeneric"),
    );
  }, [announce, canUndo, lastLabel, t, undoHistory]);

  const redo = useCallback(() => {
    if (!editableRef.current || !canRedo) return;
    redoHistory();
    announce(
      nextLabel
        ? t("adminJourneys.editor.session.announce.redone", { label: nextLabel })
        : t("adminJourneys.editor.session.announce.redoneGeneric"),
    );
  }, [announce, canRedo, nextLabel, redoHistory, t]);

  const discard = useCallback(() => {
    const base = sessionRef.current.base;
    if (!editableRef.current || base === null || sameEditorValue(localRef.current, base)) return;
    const label = t("adminJourneys.editor.session.announce.discarded");
    setHistory(base, { label });
    announce(label);
  }, [announce, setHistory, t]);

  const ensureNodeSaved = useCallback(
    async (nodeId: string) => {
      const saved = () =>
        sessionRef.current.base?.draft.graph.nodes.some(
          (node) => node.id === nodeId && node.type === "send_email",
        ) ?? false;
      if (saved()) return true;
      const token = await flush();
      return token !== null && saved();
    },
    [flush],
  );

  const failureText = useCallback(
    (reason: SaveFailure): string => {
      switch (reason.kind) {
        case "conflict":
          return t("adminJourneys.editor.autosave.conflict");
        case "invalid":
          return t(JOURNEY_VALUE_ISSUE_KEY[reason.issue.field], {
            max:
              reason.issue.field === "name"
                ? JOURNEY_LIMITS.nameMax
                : reason.issue.field === "description"
                  ? JOURNEY_LIMITS.descriptionMax
                  : JOURNEY_LIMITS.legalBasisMax,
            path: reason.issue.path ?? "",
          });
        case "mutation":
          return mutationErrorText(t, reason.failure);
        case "mfa":
          return t("adminJourneys.editor.autosave.mfa");
        case "error":
          return t("adminJourneys.editor.autosave.failed");
      }
    },
    [t],
  );

  const startDraft = useCallback(
    async (trigger: string | null): Promise<JourneySessionActionResult> => {
      const snap = snapshotRef.current;
      const token = sessionRef.current.token;
      const available =
        snap !== null &&
        token !== null &&
        sessionRef.current.base === null &&
        snap.draftState !== "valid" &&
        writableRef.current &&
        !versionPreview;
      const draft = available ? repairDraft(snap.draftRaw, trigger) : null;
      if (!available || !draft) {
        return { ok: false, message: t("adminJourneys.editor.session.startFailed") };
      }
      inFlightRef.current += 1;
      try {
        const result = await mutateAsync({ expectedUpdatedAt: token, draft });
        if (!result.ok) return { ok: false, message: mutationErrorText(t, result) };
        const value: JourneyEditorValue = { draft, definition: snap.definition };
        dispatch({ type: "saved", token: result.data.updatedAt, value });
        rebase(value);
        announce(
          t(
            snap.draftState === "needs_trigger"
              ? "adminJourneys.editor.session.announce.triggerChosen"
              : "adminJourneys.editor.session.announce.repaired",
          ),
        );
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          message: failureText(isMfaRequiredError(error) ? { kind: "mfa" } : { kind: "error" }),
        };
      } finally {
        inFlightRef.current -= 1;
        setSettledTick((tick) => tick + 1);
      }
    },
    [announce, dispatch, failureText, mutateAsync, rebase, t, versionPreview],
  );

  const chooseTrigger = useCallback((trigger: string) => startDraft(trigger), [startDraft]);
  const repair = useCallback(() => startDraft(null), [startDraft]);

  const keepMine = useCallback(async () => {
    const transition = dispatch({ type: "keep_mine" });
    if (transition.effect !== "flush") return false;
    setFailure(null);
    const token = await flush();
    if (token !== null) announce(t("adminJourneys.editor.session.announce.keptMine"));
    return token !== null;
  }, [announce, dispatch, flush, t]);

  const takeServer = useCallback(() => {
    const transition = dispatch({ type: "take_server" });
    if (transition.effect !== "load") return;
    setFailure(null);
    rebase(transition.state.base);
    announce(t("adminJourneys.editor.session.announce.tookServer"));
  }, [announce, dispatch, rebase, t]);

  const reportConflict = useCallback(() => {
    const current = localRef.current;
    if (current === null) return;
    applyRef.current(dispatch({ type: "save_conflict", local: current }));
  }, [dispatch]);

  const adoptToken = useCallback(
    (token: string) => {
      dispatch({ type: "adopt_token", token });
    },
    [dispatch],
  );

  const notice = useMemo((): JourneyEditorSession["notice"] => {
    const code: JourneySessionNotice | null = session.conflict
      ? "conflict"
      : mode === "readonly"
        ? readOnlyReason
        : mode === "needs_trigger"
          ? "needs_trigger"
          : mode === "invalid"
            ? "draft_invalid"
            : null;
    if (code === null) return null;
    return {
      code,
      text: t(JOURNEY_SESSION_NOTICE_KEY[code], { path: snapshot?.draftIssue ?? "" }),
    };
  }, [mode, readOnlyReason, session.conflict, snapshot, t]);

  const status: AutosaveStatus = session.conflict
    ? "error"
    : failure && autosave.status === "error"
      ? "error"
      : autosave.status;
  const errorText = session.conflict
    ? failureText({ kind: "conflict" })
    : status === "error"
      ? failureText(failure ?? { kind: "error" })
      : null;

  return {
    read,
    error: query.error,
    detail,
    mode,
    readOnlyReason,
    editable,
    notice,
    value: local,
    draft: local?.draft ?? null,
    token: session.token,
    isDirty,
    isSaving: autosave.status === "saving",
    update,
    updateDraft,
    updateDefinition,
    undo,
    redo,
    canUndo: editable && canUndo,
    canRedo: editable && canRedo,
    discard,
    flush,
    ensureNodeSaved,
    chooseTrigger,
    repairDraft: repair,
    conflict: session.conflict,
    keepMine,
    takeServer,
    reportConflict,
    adoptToken,
    autosaveBar: {
      status,
      error: errorText,
      canUndo: editable && canUndo,
      canRedo: editable && canRedo,
      onUndo: undo,
      onRedo: redo,
      onDiscard: editable && session.base !== null ? discard : undefined,
    },
    lastSavedAt: autosave.lastSavedAt,
    announcement,
  };
}
