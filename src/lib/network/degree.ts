// Stopień oddalenia w sieci kontaktów - jedno źródło prawdy dla WSZYSTKICH
// powierzchni (karty /people, sugestie /network, profil autora, wspólne
// kontakty) i dla obu RPC, które go zwracają (connection_statuses,
// connection_suggestions).
//
// Dlaczego osobny moduł, a nie pole w useConnections: stopień jest pojęciem
// domenowym, nie szczegółem jednego hooka. Komponenty prezentacyjne (atomy)
// mają go rozumieć BEZ importowania warstwy react-query - inaczej atom
// „1°/2°/3°" ciągnąłby za sobą klienta Supabase do każdego testu i do każdego
// chunka, który go montuje.
//
// Semantyka (graf wyłącznie ZAAKCEPTOWANYCH relacji, liczony w bazie):
//   1 - jesteście połączeni,
//   2 - macie wspólny kontakt,
//   3 - kontakt kontaktu Twojego kontaktu,
//   0 - poza zasięgiem (dalej niż 3 stopnie albo brak ścieżki).
// Zaproszenie w toku NIE robi 1. stopnia - stopień opisuje relacje, nie intencje.

/** Stopień oddalenia; 0 oznacza „poza zasięgiem Twojej sieci". */
export type ConnectionDegree = 0 | 1 | 2 | 3;

/**
 * Most: MÓJ kontakt 1. stopnia, przez którego biegnie najkrótsza ścieżka.
 * Baza nazywa wyłącznie profile z opt-inem `discoverable`, więc `null` przy
 * stopniu 2/3 znaczy „droga istnieje, ale nie mamy prawa jej nazwać".
 */
export interface ConnectionBridge {
  readonly id: string;
  readonly name: string;
  readonly avatarUrl: string | null;
  readonly slug: string | null;
}

/** Surowe kolumny mostu wspólne dla obu RPC (kontrakt z migracją 20260807100000). */
export interface BridgeColumns {
  readonly bridge_id?: string | null;
  readonly bridge_name?: string | null;
  readonly bridge_avatar?: string | null;
  readonly bridge_slug?: string | null;
}

/** Surowe kolumny stopnia + mostu. */
export interface DegreeColumns extends BridgeColumns {
  readonly degree?: number | null;
}

const DEGREES: ReadonlyArray<ConnectionDegree> = [0, 1, 2, 3];

/**
 * Normalizacja `degree` z RPC. Wartość spoza zakresu (starsza wersja funkcji
 * w bazie, null z LEFT JOIN) degraduje się do 0, czyli „nic nie twierdzimy" -
 * UI wtedy po prostu nie pokazuje odznaki zamiast renderować „NaN°".
 */
export function normalizeDegree(value: number | null | undefined): ConnectionDegree {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const rounded = Math.trunc(value);
  return DEGREES.find((d) => d === rounded) ?? 0;
}

/** Most z surowych kolumn RPC; `null`, gdy baza nie miała prawa go nazwać. */
export function toBridge(row: BridgeColumns): ConnectionBridge | null {
  const id = row.bridge_id?.trim();
  const name = row.bridge_name?.trim();
  if (!id || !name) return null;
  return {
    id,
    name,
    avatarUrl: row.bridge_avatar?.trim() ? row.bridge_avatar : null,
    slug: row.bridge_slug?.trim() ? row.bridge_slug : null,
  };
}

/** Para (stopień, most) z dowolnego wiersza RPC, który je zwraca. */
export function readDegree(row: DegreeColumns): {
  degree: ConnectionDegree;
  bridge: ConnectionBridge | null;
} {
  const degree = normalizeDegree(row.degree);
  // Przy 1. stopniu most nie ma sensu (nie ma czego mostkować), a przy 0 nie
  // istnieje - baza i tak zwraca NULL, ale klient nie ma być od tego zależny.
  return { degree, bridge: degree === 2 || degree === 3 ? toBridge(row) : null };
}

/** Czy stopień w ogóle nadaje się do pokazania (0 = brak twierdzenia). */
export function isDegreeVisible(degree: ConnectionDegree): degree is 1 | 2 | 3 {
  return degree === 1 || degree === 2 || degree === 3;
}

/** Sufiks klucza i18n dla stopnia - `network.degree.first|second|third`. */
export const DEGREE_I18N_SUFFIX = {
  1: "first",
  2: "second",
  3: "third",
} as const satisfies Record<1 | 2 | 3, string>;
