// Atomy testowe powierzchni SIECI KONTAKTÓW (atomic design zastosowany do
// testów): jedno źródło prawdy dla stanu relacji, atrap zapytań/mutacji i
// stubu tłumaczeń. Trzynaście plików testowych w
// src/components/network/__tests__ składa się z tych samych atomów, więc
// zmiana kontraktu warstwy danych psuje JEDEN plik, nie trzynaście.
//
// Świadomie BEZ JSX i bez importu komponentów - moduł jest wciągany także
// z wnętrza fabryk `vi.mock` (przez dynamiczny import, patrz reactI18nextStub),
// więc musi być tani i wolny od side-effectów.
import { vi, type Mock } from "vitest";
import type {
  ConnectionState,
  ConnectionStatus,
  MyConnectionRow,
  PolicyItemFollowerRow,
} from "@/lib/network/useConnections";
import type { IntroductionRow } from "@/lib/network/useIntroductions";
import type { ProfileViewer } from "@/lib/network/useProfileViews";
import type { Recommendation } from "@/lib/network/useRecommendations";

/**
 * Identyfikatory testowe. Tenant jest tu jawny, bo wszystkie RPC sieci są
 * SECURITY DEFINER i filtrują po `tenant_id` wołającego - testy, które
 * dotykają izolacji kont/tenanta, mają się odwoływać do tych stałych, a nie
 * do literałów rozsypanych po plikach.
 */
export const NETWORK_IDS = {
  me: "user-me",
  peer: "user-peer",
  bridge: "user-bridge",
  tenant: "tenant-alfa",
  foreignTenant: "tenant-beta",
  connection: "conn-1",
  item: "item-1",
  event: "event-1",
  conversation: "conv-1",
} as const;

export const PEER_NAME = "Anna Nowak";

/** Stan relacji z `connection_statuses` (domyślnie: brak relacji, można zaprosić). */
export function connectionState(overrides: Partial<ConnectionState> = {}): ConnectionState {
  return {
    status: "none",
    connectionId: null,
    mutualCount: 0,
    canInvite: true,
    // Domyślnie 3. stopień - fixture "brak relacji" nie może udawać bliskości.
    degree: 3,
    ...overrides,
  };
}

/** Stan dla konkretnego statusu; dla stanów z wierszem dokłada `connectionId`. */
export function stateFor(
  status: ConnectionStatus,
  overrides: Partial<ConnectionState> = {},
): ConnectionState {
  const needsRow = status !== "none";
  return connectionState({
    status,
    connectionId: needsRow ? NETWORK_IDS.connection : null,
    // Stopień wynika ze statusu tak samo, jak w `connection_statuses`:
    // połączenie to 1. stopień, wszystko inne domyślnie 3. (chyba że test
    // jawnie ustawi 2. przez `overrides`).
    degree: status === "connected" ? 1 : 3,
    ...overrides,
  });
}

/** Mapa statusów w formacie zwracanym przez `useConnectionStatuses`. */
export function statusMap(
  entries: Readonly<Record<string, ConnectionState>>,
): ReadonlyMap<string, ConnectionState> {
  return new Map(Object.entries(entries));
}

// --- wiersze RPC ------------------------------------------------------------
// Kształty 1:1 z `Database["public"]["Functions"][...]["Returns"]`, więc rozjazd
// kolumny w migracji wychodzi na typach w KAŻDYM teście, który tego wiersza
// używa - a nie dopiero w runtime na produkcji.

/** Wiersz `my_connections` (moja sieć). */
export function myConnectionRow(overrides: Partial<MyConnectionRow> = {}): MyConnectionRow {
  return {
    user_id: NETWORK_IDS.bridge,
    display_name: "Jan Kowalski",
    avatar_url: "",
    slug: "jan-kowalski",
    job_title: "Dyrektor",
    current_company: "NES",
    location: "Warszawa",
    specialization: "Energia",
    verified: true,
    connection_id: NETWORK_IDS.connection,
    connected_at: "2026-01-15T10:00:00.000Z",
    total_count: 1,
    ...overrides,
  };
}

/** Wiersz `policy_item_followers` (obserwujący dossier). */
export function policyFollowerRow(
  overrides: Partial<PolicyItemFollowerRow> = {},
): PolicyItemFollowerRow {
  return {
    user_id: NETWORK_IDS.peer,
    display_name: PEER_NAME,
    avatar_url: "",
    slug: "anna-nowak",
    job_title: "Analityk",
    current_company: "NES",
    verified: false,
    total_count: 1,
    ...overrides,
  };
}

/** Wiersz `my_introduction_requests` (wprowadzenia). */
export function introductionRow(overrides: Partial<IntroductionRow> = {}): IntroductionRow {
  return {
    id: "intro-1",
    status: "pending",
    message: "Chciałbym poznać tę osobę w sprawie pakietu energetycznego.",
    created_at: "2026-02-01T09:00:00.000Z",
    requester_id: "user-requester",
    requester_name: "Marek Requester",
    requester_avatar: "",
    bridge_id: NETWORK_IDS.bridge,
    bridge_name: "Jan Kowalski",
    bridge_avatar: "",
    target_id: NETWORK_IDS.peer,
    target_name: PEER_NAME,
    target_avatar: "",
    ...overrides,
  };
}

/** Wiersz listy rekomendacji (model widoku, nie surowy wiersz RPC). */
export function recommendationRow(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id: "rec-1",
    author_id: "user-author",
    author_name: "Ewa Autorka",
    author_avatar: null,
    author_headline: "Ekspertka ds. klimatu",
    relationship: "colleague",
    body: "Współpraca wzorowa - konkretnie, terminowo, z wyczuciem kontekstu unijnego.",
    status: "published",
    created_at: "2026-03-10T08:00:00.000Z",
    ...overrides,
  };
}

/** Wiersz `my_profile_viewers` (kto oglądał profil). */
export function profileViewerRow(overrides: Partial<ProfileViewer> = {}): ProfileViewer {
  return {
    viewer_id: NETWORK_IDS.peer,
    viewer_mode: "public",
    display_name: PEER_NAME,
    avatar_url: null,
    job_title: "Analityk",
    company: "NES",
    viewed_at: "2026-04-01T12:00:00.000Z",
    ...overrides,
  };
}

/** Znacznik czasu „N minut temu" - do stabilnych testów czasu względnego. */
export function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

export interface QueryStub<T> {
  data: T | undefined;
  isPending: boolean;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: Mock;
}

/** Atrapa `useQuery`: dane rozstrzygnięte. */
export function queryStub<T>(data: T, overrides: Partial<QueryStub<T>> = {}): QueryStub<T> {
  return {
    data,
    isPending: false,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  };
}

/** Atrapa `useQuery` w trakcie ładowania (bez danych). */
export function pendingQueryStub<T>(): QueryStub<T> {
  return {
    data: undefined,
    isPending: true,
    isLoading: true,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
}

/** Atrapa `useQuery` po błędzie. */
export function errorQueryStub<T>(message = "rpc failed"): QueryStub<T> {
  return {
    data: undefined,
    isPending: false,
    isLoading: false,
    isError: true,
    error: new Error(message),
    refetch: vi.fn(),
  };
}

/** Opcje `mutate()` używane przez komponenty sieci (podzbiór react-query). */
export interface MutateOptions<TData> {
  onSuccess?: (data: TData) => void;
  onError?: (error: Error) => void;
}

export interface MutationStub<TVars, TData> {
  mutate: Mock<(vars: TVars, options?: MutateOptions<TData>) => void>;
  isPending: boolean;
  reset: Mock;
  /** Zmienne ostatniego wywołania (skrót do asercji kontraktu z RPC). */
  lastVars: () => TVars | undefined;
}

type Outcome<TData> =
  | { readonly kind: "idle" }
  | { readonly kind: "success"; readonly data: TData }
  | { readonly kind: "error"; readonly error: Error };

function makeMutation<TVars, TData>(
  outcome: Outcome<TData>,
  isPending: boolean,
): MutationStub<TVars, TData> {
  const mutate: Mock<(vars: TVars, options?: MutateOptions<TData>) => void> = vi.fn(
    (_vars: TVars, options?: MutateOptions<TData>) => {
      if (outcome.kind === "success") options?.onSuccess?.(outcome.data);
      if (outcome.kind === "error") options?.onError?.(outcome.error);
    },
  );
  return {
    mutate,
    isPending,
    reset: vi.fn(),
    lastVars: () => mutate.mock.calls.at(-1)?.[0],
  };
}

/** Mutacja, która tylko zapisuje wywołanie (żaden callback nie odpala). */
export function idleMutation<TVars, TData = void>(): MutationStub<TVars, TData> {
  return makeMutation<TVars, TData>({ kind: "idle" }, false);
}

/** Mutacja w locie - komponenty mają wtedy blokować przyciski (`isPending`). */
export function pendingMutation<TVars, TData = void>(): MutationStub<TVars, TData> {
  return makeMutation<TVars, TData>({ kind: "idle" }, true);
}

/** Mutacja kończąca się sukcesem z podanym wynikiem (id konwersacji itp.). */
export function succeedingMutation<TVars, TData>(data: TData): MutationStub<TVars, TData> {
  return makeMutation<TVars, TData>({ kind: "success", data }, false);
}

/** Mutacja `void` kończąca się sukcesem (odpowiedź, wycofanie, usunięcie). */
export function succeedingVoidMutation<TVars>(): MutationStub<TVars, void> {
  return makeMutation<TVars, void>({ kind: "success", data: undefined }, false);
}

/**
 * Mutacja odrzucona. Komunikaty RPC są tu istotne: komponenty mapują
 * `rate limited` / `blocked` / `chat: tier disabled` na osobne teksty, więc
 * atrapa przenosi dokładny tekst błędu. Można też podać gotowy obiekt błędu -
 * także taki BEZ `message` albo strukturalny (nie instancja `Error`) - żeby
 * przejść obronne gałęzie mapperów bez rzutowań typu.
 */
export function failingMutation<TVars, TData = void>(
  error: string | Error,
): MutationStub<TVars, TData> {
  const resolved = typeof error === "string" ? new Error(error) : error;
  return makeMutation<TVars, TData>({ kind: "error", error: resolved }, false);
}

/** Odrzucenie NIE będące instancją `Error` (strukturalnie zgodne z typem). */
export function structuralError(message: string): Error {
  return { name: "RpcRejection", message };
}

/**
 * Echo klucza i18n: `t("a.b")` -> `"a.b"`, a z opcjami -> `a.b {"name":"Anna"}`.
 * Testy asertują KLUCZ, nie polski tekst, więc zmiana copy nie psuje testów,
 * a rozjazd klucza owszem (za parytet PL/EN odpowiadają dwie bramki i18n).
 */
export function translateKey(key: string, options?: Record<string, unknown>): string {
  if (options === undefined) return key;
  const entries = Object.entries(options);
  return entries.length === 0 ? key : `${key} ${JSON.stringify(Object.fromEntries(entries))}`;
}

/**
 * Ten sam stub dla wszystkich testów sieci - wołany z fabryki `vi.mock`.
 * Język czytamy przez getter, bo fabryka mocka wykonuje się RAZ, a testy
 * formatowania dat (PL vs EN) muszą móc przełączyć język między przypadkami.
 */
export function reactI18nextStub(getLanguage: () => string = () => "pl"): {
  useTranslation: () => { t: typeof translateKey; i18n: { language: string } };
  initReactI18next: { type: string; init: () => void };
} {
  return {
    useTranslation: () => ({ t: translateKey, i18n: { language: getLanguage() } }),
    initReactI18next: { type: "3rdParty", init: () => {} },
  };
}
