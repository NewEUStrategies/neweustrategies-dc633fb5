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
// Przy zerze pokazanych ofert skuteczność to `null`, nie 0% - brak próby nie
// jest porażką i nie ma prawa wyglądać w panelu jak porażka.
import type { RetentionFeedbackRow } from "@/lib/retention/queries";

const WINDOW_DAYS = 90;

export interface RetentionStats {
  /** Liczba rezygnacji w oknie. */
  total: number;
  /** Ile z nich przyjęło kontrofertę. */
  accepted: number;
  /** Odsetek przyjęć wśród POKAZANYCH ofert; `null`, gdy nie było żadnej. */
  acceptRate: number | null;
  /** Trzy najczęstsze powody odejścia: `[etykieta, liczba]`. */
  topReasons: [string, number][];
}

export function retentionStats(
  feedback: RetentionFeedbackRow[],
  now: number = Date.now(),
): RetentionStats {
  const cutoff = now - WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const recent = feedback.filter((row) => new Date(row.created_at).getTime() >= cutoff);
  const shown = recent.filter((row) => row.offer_shown);
  const accepted = recent.filter((row) => row.offer_accepted);
  const byReason = new Map<string, number>();
  for (const row of recent) {
    byReason.set(row.reason_label, (byReason.get(row.reason_label) ?? 0) + 1);
  }
  const topReasons = [...byReason.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  return {
    total: recent.length,
    accepted: accepted.length,
    acceptRate: shown.length > 0 ? Math.round((accepted.length / shown.length) * 100) : null,
    topReasons,
  };
}
