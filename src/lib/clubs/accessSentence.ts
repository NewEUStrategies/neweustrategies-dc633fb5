// Żywy podgląd ustawień dostępu jako JEDNO ZDANIE.
//
// Zakładka "Dostęp" ma cztery droplisty. Administrator, który je ustawia, musi
// w głowie złożyć ich iloczyn - a to jest dokładnie ten moment, w którym
// powstają kluby widoczne dla wszystkich zamiast dla członków. Zamiast tego
// składamy zdanie za niego.
//
// Czysta funkcja bez Reacta i bez i18next: przyjmuje gotowe tłumaczenia
// fragmentów i zwraca listę zdań. Dzięki temu testuje się ją bez renderu
// i bez mockowania tłumaczeń.
import type { ClubAttributionMode, ClubJoinPolicy, ClubPostPolicy, ClubVisibility } from "./types";

export interface AccessSentenceInput {
  visibility: ClubVisibility;
  joinPolicy: ClubJoinPolicy;
  attributionMode: ClubAttributionMode;
  whoCanPost: ClubPostPolicy;
  minTierRank: number;
}

/** Fragmenty zdania dostarczone przez warstwę i18n (już przetłumaczone). */
export interface AccessSentenceLabels {
  visibility: Record<ClubVisibility, string>;
  joinPolicy: Record<ClubJoinPolicy, string>;
  attribution: Record<ClubAttributionMode, string>;
  whoCanPost: Record<ClubPostPolicy, string>;
  /** Zdanie o planie; `{{rank}}` zostanie podmienione na rangę. */
  tierRequired: string;
  tierNone: string;
}

/**
 * Zwraca listę krótkich zdań zamiast jednego długiego łańcucha: przy pięciu
 * wymiarach jedno zdanie robi się nieczytelne, a lista czyta się skanując.
 * Kolejność jest stała i odpowiada kolejności pól w formularzu - dzięki temu
 * zmiana droplisty rusza zdaniem w tej samej pozycji, co ułatwia zauważenie
 * skutku zmiany.
 */
export function buildAccessSentences(
  input: AccessSentenceInput,
  labels: AccessSentenceLabels,
): string[] {
  const tier =
    input.minTierRank > 0
      ? labels.tierRequired.replace("{{rank}}", String(input.minTierRank))
      : labels.tierNone;

  return [
    labels.visibility[input.visibility],
    labels.joinPolicy[input.joinPolicy],
    tier,
    labels.whoCanPost[input.whoCanPost],
    labels.attribution[input.attributionMode],
  ];
}

/**
 * Kombinacje warte ostrzeżenia. To nie są błędy - każda z nich jest poprawna
 * i czasem zamierzona - ale każda jest też typową pomyłką, którą taniej
 * zauważyć przed zapisem niż po pierwszym wycieku treści.
 */
export type AccessWarning = "public_open" | "secret_public_entry" | "chatham_public";

export function detectAccessWarnings(input: AccessSentenceInput): AccessWarning[] {
  const warnings: AccessWarning[] = [];

  // Klub publiczny + wejście otwarte = każdy anonim widzi treść, a każde
  // konto wchodzi bez decyzji człowieka. Bywa zamierzone (lejek pozyskania),
  // ale częściej jest pomyłką przy kopiowaniu ustawień.
  if (input.visibility === "public" && input.joinPolicy === "open") {
    warnings.push("public_open");
  }

  // Klub ukryty z otwartym wejściem jest wewnętrznie sprzeczny: nikt spoza
  // klubu go nie widzi, więc "otwarte wejście" nie ma jak zadziałać.
  if (input.visibility === "secret" && input.joinPolicy === "open") {
    warnings.push("secret_public_entry");
  }

  // Chatham House w klubie publicznym: anonimowość wobec czytelników, których
  // nie da się policzyć. Jeśli to świadome, trzeba to potwierdzić.
  if (input.attributionMode === "chatham" && input.visibility === "public") {
    warnings.push("chatham_public");
  }

  return warnings;
}
