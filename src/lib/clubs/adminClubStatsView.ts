// Wiersz `admin_club_stats` -> DESKRYPTORY kafli zakładki „Statystyki".
//
// CO BYŁO W JSX-IE. Dwanaście wywołań `<StatCard>`, a w każdym - wpleciona
// w atrybut - reguła odczytu metryki. Trzy z nich decydują o tym, czy panel
// mówi prawdę:
//
//   1. „BRAK DANYCH" TO NIE ZERO. Klub bez ani jednej odpowiedzi nie ma
//      mediany czasu do pierwszej odpowiedzi - i to nie jest „0 godzin",
//      tylko brak danych. Odsetek tematów bez odpowiedzi w klubie bez tematów
//      też nie istnieje: mianownik jest zerem, więc RPC oddaje NULL, a nie
//      zero. Kafel pokazujący „0%" tam, gdzie danych nie ma, mówi
//      administratorowi, że klub jest zdrowy, kiedy jest po prostu pusty.
//      Dlatego wartość jest UNIĄ: brak / liczba / zdanie i18n - nigdy `NaN`
//      i nigdy gołe `undefined`.
//   2. PRÓG KOLORU. „Powyżej 40% bez odpowiedzi" i „powyżej 72 godzin" to
//      decyzja redakcyjna, a nie liczba do wklejenia w klasę Tailwinda. Stoi
//      w jednym miejscu, żeby dyskusja „czy 40% to już źle" miała gdzie się
//      toczyć. Kolor dostają WYŁĄCZNIE te dwie metryki - obsada klubu nie ma
//      progu „za mało członków".
//   3. LICZNIK W PODPOWIEDZI. Podpowiedzi „30 dni" niosą wartość CAŁKOWITĄ
//      (łącznie w klubie), więc przy braku wiersza muszą pokazać zero, a nie
//      puste miejsce - inaczej podpowiedź czyta się jak awarię.
//
// UKŁADEM (i dlatego tego tu nie ma) jest: podział na dwie sekcje, siatka
// kafli, dobór ikon i klasy koloru.
//
// Zero Reacta, zero i18n, zero klienta Supabase - wychodzą stąd KLUCZE i18n
// z parametrami, a tłumaczy je molekuła kafla.
//
// SŁOWNIK PANELU, A NIE PUBLICZNY. Klucze `adminClubs.*` zwracane przez ten
// moduł mieszkają w `i18n-clubs-admin`, który trzeba jawnie dociągnąć przez
// `ensureAdminClubsI18n()`. Moduł tego NIE robi i nie może - nie zna Reacta
// ani i18next - i dlatego jest osiągalny WYŁĄCZNIE z organizmów panelu, które
// `ensureAdminClubsI18n()` wołają. Ta granica jest pilnowana bramką
// `adminClubsI18nLoading.gate`; jej złamanie kończy się gołym kluczem na
// ekranie i widać je dopiero w przeglądarce.

/**
 * Wiersz statystyk z JAWNIE nullowalnymi metrykami.
 *
 * Generator typów Supabase opisuje kolumny wyliczane jako `number`, ale
 * `admin_club_stats` liczy medianę i odsetek AGREGATEM - a agregat po pustym
 * zbiorze oddaje NULL. `AdminClubStatsRow` (wszystkie pola `number`) pasuje do
 * tego kształtu, więc organizm podaje wiersz z hooka bez żadnego rzutowania,
 * a test może podać to, co realnie przychodzi z bazy.
 */
export interface ClubStatsSource {
  member_count: number | null;
  active_members_30d: number | null;
  pending_members: number | null;
  group_count: number | null;
  thread_count: number | null;
  reply_count: number | null;
  threads_30d: number | null;
  replies_30d: number | null;
  unanswered_count: number | null;
  unanswered_pct: number | null;
  median_first_reply_hours: number | null;
  leads_count: number | null;
  moderators_count: number | null;
  banned_count: number | null;
}

export type ClubStatTone = "ok" | "warn" | "bad" | "neutral";

/** Identyfikator kafla - jest też kluczem doboru ikony w molekule. */
export type ClubStatId =
  | "unanswered"
  | "firstReply"
  | "threads30d"
  | "replies30d"
  | "members"
  | "active30d"
  | "pending"
  | "groups"
  | "threads"
  | "leads"
  | "moderators"
  | "banned";

/**
 * Wartość kafla. `missing` niesie informację „nie ma czego pokazać" JAWNIE,
 * zamiast liczyć na to, że `undefined` gdzieś dalej zamieni się w kreskę.
 */
export type ClubStatValue =
  | { kind: "missing" }
  | { kind: "plain"; text: string }
  | { kind: "i18n"; key: string; params: Record<string, string> };

export interface ClubStatHint {
  key: string;
  params: Record<string, number>;
}

export interface ClubStatCard {
  id: ClubStatId;
  labelKey: string;
  value: ClubStatValue;
  hint: ClubStatHint | null;
  tone: ClubStatTone;
}

/**
 * Progi kolorystyczne. Odsetek tematów bez odpowiedzi w procentach, mediana
 * pierwszej odpowiedzi w godzinach.
 */
export const CLUB_STATS_THRESHOLDS = {
  unansweredWarnPct: 20,
  unansweredBadPct: 40,
  firstReplyWarnHours: 24,
  firstReplyBadHours: 72,
} as const;

const STATS_PREFIX = "adminClubs.stats";

/** Liczba nadająca się do pokazania, albo `null`. Odsiewa NULL i `NaN`. */
function usable(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Ton metryki rosnącej. Brak danych to `neutral`, nie `ok` - kafel bez danych
 * nie ma prawa świecić na zielono.
 */
export function clubStatTone(
  value: number | null | undefined,
  warn: number,
  bad: number,
): ClubStatTone {
  const safe = usable(value);
  if (safe === null) return "neutral";
  if (safe >= bad) return "bad";
  if (safe >= warn) return "warn";
  return "ok";
}

/** Liczba całkowita jako wartość kafla; brak danych zostaje brakiem. */
function countValue(value: number | null | undefined): ClubStatValue {
  const safe = usable(value);
  return safe === null ? { kind: "missing" } : { kind: "plain", text: String(safe) };
}

function hint(key: string, count: number | null | undefined): ClubStatHint {
  return { key: `${STATS_PREFIX}.${key}`, params: { count: usable(count) ?? 0 } };
}

/**
 * Trzy metryki zdrowia dyskusji plus rytm. Kolejność jest tezą: klub umiera na
 * tematy bez odpowiedzi, nie na małą liczbę członków.
 */
export function clubStatsHealthCards(row: ClubStatsSource | null | undefined): ClubStatCard[] {
  const unanswered = usable(row?.unanswered_pct);
  const median = usable(row?.median_first_reply_hours);
  return [
    {
      id: "unanswered",
      labelKey: `${STATS_PREFIX}.unanswered`,
      value:
        unanswered === null
          ? { kind: "missing" }
          : { kind: "plain", text: `${Math.round(unanswered)}%` },
      hint: hint("unansweredHint", row?.unanswered_count),
      tone: clubStatTone(
        unanswered,
        CLUB_STATS_THRESHOLDS.unansweredWarnPct,
        CLUB_STATS_THRESHOLDS.unansweredBadPct,
      ),
    },
    {
      id: "firstReply",
      labelKey: `${STATS_PREFIX}.firstReply`,
      value:
        median === null
          ? { kind: "missing" }
          : { kind: "i18n", key: `${STATS_PREFIX}.hours`, params: { value: median.toFixed(1) } },
      hint: { key: `${STATS_PREFIX}.firstReplyHint`, params: {} },
      tone: clubStatTone(
        median,
        CLUB_STATS_THRESHOLDS.firstReplyWarnHours,
        CLUB_STATS_THRESHOLDS.firstReplyBadHours,
      ),
    },
    {
      id: "threads30d",
      labelKey: `${STATS_PREFIX}.threads30d`,
      value: countValue(row?.threads_30d),
      hint: hint("threads30dHint", row?.thread_count),
      tone: "neutral",
    },
    {
      id: "replies30d",
      labelKey: `${STATS_PREFIX}.replies30d`,
      value: countValue(row?.replies_30d),
      hint: hint("replies30dHint", row?.reply_count),
      tone: "neutral",
    },
  ];
}

/**
 * Obsada klubu. Osiem liczników bez progów i bez podpowiedzi - żadna z tych
 * liczb nie ma „złej" wartości, więc kolor byłby tu kłamstwem.
 */
export function clubStatsRosterCards(row: ClubStatsSource | null | undefined): ClubStatCard[] {
  const cards: readonly [ClubStatId, number | null | undefined][] = [
    ["members", row?.member_count],
    ["active30d", row?.active_members_30d],
    ["pending", row?.pending_members],
    ["groups", row?.group_count],
    ["threads", row?.thread_count],
    ["leads", row?.leads_count],
    ["moderators", row?.moderators_count],
    ["banned", row?.banned_count],
  ];
  return cards.map(([id, value]) => ({
    id,
    labelKey: `${STATS_PREFIX}.${id}`,
    value: countValue(value),
    hint: null,
    tone: "neutral",
  }));
}
