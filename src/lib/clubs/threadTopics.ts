// Zliczanie wątków po obszarze tematycznym - odpowiednik `countClubTopics`
// dla wątków wewnątrz JEDNEGO klubu, zamiast klubów na katalogu głównym.
//
// PO CO OSOBNO OD `topics.ts`. Tamta funkcja liczy kluby po `policy_area`
// (kolumna klubu, stała dla całego klubu). Ta liczy wątki po `topic`
// (kolumna wątku - klub wielodomenowy miesza wiele obszarów, więc nie da się
// tu użyć jednej wartości klubu). Dwie różne kolumny, dwa różne poziomy -
// wspólny tylko kształt wyniku (`ClubTopicCount`), więc go importujemy
// zamiast duplikować.
import type { ClubTopicCount } from "./topics";
import type { ClubThreadListRow } from "./types";

/** Wątek bez obszaru nie tworzy chipa - trafia do "wszystkie" i tam się znajdzie. */
export function countThreadTopics(
  threads: readonly Pick<ClubThreadListRow, "topic">[],
): ClubTopicCount[] {
  const tally = new Map<string, number>();
  for (const thread of threads) {
    const topic = thread.topic;
    if (topic === null || topic === undefined || topic.trim() === "") continue;
    tally.set(topic, (tally.get(topic) ?? 0) + 1);
  }
  // Najliczniejsze pierwsze, remisy alfabetycznie - ta sama reguła, co
  // w `countClubTopics`, żeby kolejność nie skakała przy każdym refetchu.
  return [...tally.entries()]
    .map(([area, count]) => ({ area, count }))
    .sort((a, b) => b.count - a.count || a.area.localeCompare(b.area));
}
