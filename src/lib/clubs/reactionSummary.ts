// Ile RÓŻNYCH osób zareagowało na cel - czysta reguła licznika pod kartą.
//
// DLACZEGO TO NIE JEST SUMA. Jedna osoba może postawić kilka reakcji naraz
// (np. „wnosi wiedzę" i „poparte źródłem"), więc suma liczników z
// `club_reactions_for` liczy REAKCJE, nie ludzi. Zdanie „Anna Nowak i 3 inne
// osoby" zbudowane z sumy kłamałoby przy każdej wielokrotnej reakcji.
//
// SKĄD WIEMY, ŻE LICZBA JEST PEWNA. Liczba osób jest pewna w dwóch sytuacjach:
//   * pod celem stoi JEDEN rodzaj reakcji - każdy może go postawić raz, więc
//     licznik tego rodzaju to liczba osób;
//   * lista twarzy z `club_reaction_actors` jest KOMPLETNA - RPC oddaje
//     najwyżej `CLUB_REACTION_ACTOR_LIMIT` osób na rodzaj, więc komplet jest
//     wtedy, gdy żaden rodzaj nie przekracza limitu, a żadna osoba nie jest
//     ukryta trybem poufnym (anonimów nie da się scalić między rodzajami).
// W każdym innym przypadku funkcja oddaje `null`, a licznik mówi „i inni"
// zamiast zmyślonej liczby.
import type { ClubReactionActor, ClubReactionTally } from "@/lib/clubs/types";

/** Ile osób na rodzaj reakcji oddaje `club_reaction_actors` w strumieniu. */
export const CLUB_REACTION_ACTOR_LIMIT = 6;

export function countDistinctReactors(
  tallies: readonly ClubReactionTally[],
  actors: readonly ClubReactionActor[] | undefined,
  limit: number = CLUB_REACTION_ACTOR_LIMIT,
): number | null {
  const placed = tallies.filter((tally) => tally.total > 0);
  const [only] = placed;
  if (only === undefined) return 0;
  if (placed.length === 1) return only.total;
  if (actors === undefined) return null;
  if (actors.some((actor) => actor.userId === null)) return null;
  if (placed.some((tally) => tally.total > limit)) return null;
  // Twarze i liczniki jadą dwoma zapytaniami - przez chwilę mogą się
  // rozjechać. Najliczniejszy rodzaj jest twardym dolnym ograniczeniem.
  return Math.max(actors.length, ...placed.map((tally) => tally.total));
}
