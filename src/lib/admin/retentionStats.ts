// Skuteczność kontroferty retencyjnej - liczby, na których redakcja opiera
// decyzję „czy w ogóle proponować rabat odchodzącym".
//
// Dwie rzeczy, w których panel mógłby skłamać, i dlatego są tu, nie w JSX:
//
//   OKNO. Liczymy WYŁĄCZNIE ostatnie 90 dni. Kontroferta zmienia się w czasie
//   (procent, liczba okresów), więc mieszanie jej z odpowiedziami z zeszłego
//   roku daje średnią, której nie da się użyć do żadnej decyzji.
//
//   MIANOWNIK. Skuteczność to przyjęte / POKAZANE, a nie przyjęte / wszystkie
//   rezygnacje. Gdyby dzielić przez wszystkie, wyłączenie kontroferty albo
//   rezygnacje bez oferty (np. z panelu operatora) rozcieńczałyby wynik i
//   „rabat nie działa" wyszłoby z arytmetyki, a nie z zachowania klientów.
//
//   ODPOWIEDŹ. Liczymy WYŁĄCZNIE wiersze z powodem. Przepływ anulowania (S2)
//   zapisuje wiersz już przy otwarciu dialogu (`started`, powód NULL), a skaner
//   domyka porzucony do `abandoned` - wciąż bez powodu. Taki wiersz to ani
//   odpowiedź ankiety, ani odejście: wliczony do `total` i do mianownika
//   pokazanych ofert, podbijałby liczbę rezygnacji każdym samym otwarciem
//   dialogu i rozcieńczał skuteczność kontroferty.
//
// Przy zerze pokazanych ofert skuteczność to `null`, nie 0% - brak próby nie
// jest porażką i nie ma prawa wyglądać w panelu jak porażka.
//
//   RANKING BEZ „NIE PODANO" (Z-S2-04, I9 - Z-S7-08). `not_given` to
//   „Anuluj mimo to" przed wyborem powodu - odpowiedź (liczy się do `total`
//   i skuteczności), ale NIE powód: w rankingu wypchnęłaby prawdziwe powody,
//   więc stoi osobno w `notGiven` (jak w hubie, `ChurnReasonsCard`).
import { NOT_GIVEN_REASON } from "@/lib/retention/reasonLabel";
import type { RetentionFeedbackRow } from "@/lib/retention/queries";

/**
 * Okno statystyk w dniach. Eksportowane, bo to samo okno musi trafić do
 * ZAPYTANIA (`retentionFeedbackQueryOptions`) - statystyka liczona z odczytu
 * węższego niż okno (dawny `limit(100)`) kłamie o skuteczności (def. 13).
 */
export const RETENTION_STATS_WINDOW_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Dolna granica odczytu odpowiedzi dla okna statystyk: początek doby UTC
 * sprzed `RETENTION_STATS_WINDOW_DAYS` dni. Zaokrąglenie do doby sprawia, że
 * granica (część klucza zapytania) jest stała przez całą dobę - bez niego
 * każdy render dawałby nowy klucz i nowe zapytanie. Odczyt bywa przez to
 * o kilka godzin SZERSZY niż okno; `retentionStats` i tak odcina dokładnie
 * `now - okno`, więc wynik się nie zmienia.
 */
export function retentionStatsSinceIso(now: number = Date.now()): string {
  const dayStart = Math.floor(now / DAY_MS) * DAY_MS;
  return new Date(dayStart - RETENTION_STATS_WINDOW_DAYS * DAY_MS).toISOString();
}

export interface RetentionStats {
  /** Liczba odpowiedzi (wierszy z powodem) w oknie. */
  total: number;
  /** Ile z nich przyjęło kontrofertę. */
  accepted: number;
  /** Odsetek przyjęć wśród POKAZANYCH ofert; `null`, gdy nie było żadnej. */
  acceptRate: number | null;
  /** Trzy najczęstsze powody odejścia: `[etykieta, liczba]` - bez `not_given`. */
  topReasons: [string, number][];
  /** Odpowiedzi „bez podanego powodu" (`not_given`) - poza rankingiem. */
  notGiven: number;
}

export function retentionStats(
  feedback: RetentionFeedbackRow[],
  now: number = Date.now(),
): RetentionStats {
  const cutoff = now - RETENTION_STATS_WINDOW_DAYS * DAY_MS;
  const recent = feedback.filter(
    (row): row is RetentionFeedbackRow & { reason_label: string } =>
      row.reason_label !== null && new Date(row.created_at).getTime() >= cutoff,
  );
  const shown = recent.filter((row) => row.offer_shown);
  const accepted = recent.filter((row) => row.offer_accepted);
  const byReason = new Map<string, number>();
  let notGiven = 0;
  for (const row of recent) {
    if (row.reason_label === NOT_GIVEN_REASON) {
      notGiven += 1;
      continue;
    }
    byReason.set(row.reason_label, (byReason.get(row.reason_label) ?? 0) + 1);
  }
  const topReasons = [...byReason.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  return {
    total: recent.length,
    accepted: accepted.length,
    acceptRate: shown.length > 0 ? Math.round((accepted.length / shown.length) * 100) : null,
    topReasons,
    notGiven,
  };
}
