// Big Five personality scoring helpers.
// Each axis has 6 items; half are reverse-keyed.
// Item ids 1..30, mapped to axes per seed in migration.

export type Axis =
  | "openness"
  | "conscientiousness"
  | "extraversion"
  | "agreeableness"
  | "neuroticism";

export const AXES: ReadonlyArray<Axis> = [
  "openness",
  "conscientiousness",
  "extraversion",
  "agreeableness",
  "neuroticism",
];

export interface AxisScores {
  openness: number;
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  neuroticism: number;
}

export interface PersonalityQuestion {
  id: number;
  axis: Axis;
  reverse: boolean;
  text_pl: string;
  text_en: string;
  sort_order: number;
}

/**
 * Score answers (id -> 1..5) into 0..100 per axis.
 * Reverse items are flipped (6 - value) so higher always means more of the axis.
 * Each axis: 6 items × 5 max = 30 raw → normalized to 0..100.
 */
export function scoreAnswers(
  answers: Record<number, number>,
  questions: ReadonlyArray<PersonalityQuestion>,
): AxisScores {
  const sums: Record<Axis, number> = {
    openness: 0,
    conscientiousness: 0,
    extraversion: 0,
    agreeableness: 0,
    neuroticism: 0,
  };
  const counts: Record<Axis, number> = {
    openness: 0,
    conscientiousness: 0,
    extraversion: 0,
    agreeableness: 0,
    neuroticism: 0,
  };

  for (const q of questions) {
    const raw = answers[q.id];
    if (typeof raw !== "number" || raw < 1 || raw > 5) continue;
    const v = q.reverse ? 6 - raw : raw;
    sums[q.axis] += v;
    counts[q.axis] += 1;
  }

  const toScore = (axis: Axis): number => {
    const n = counts[axis];
    if (n === 0) return 0;
    const max = n * 5;
    const min = n * 1;
    return Math.round(((sums[axis] - min) / (max - min)) * 100);
  };

  return {
    openness: toScore("openness"),
    conscientiousness: toScore("conscientiousness"),
    extraversion: toScore("extraversion"),
    agreeableness: toScore("agreeableness"),
    neuroticism: toScore("neuroticism"),
  };
}

export function isComplete(
  answers: Record<number, number>,
  questions: ReadonlyArray<PersonalityQuestion>,
): boolean {
  return questions.every((q) => {
    const v = answers[q.id];
    return typeof v === "number" && v >= 1 && v <= 5;
  });
}

export function answeredCount(
  answers: Record<number, number>,
  questions: ReadonlyArray<PersonalityQuestion>,
): number {
  return questions.filter((q) => {
    const v = answers[q.id];
    return typeof v === "number" && v >= 1 && v <= 5;
  }).length;
}
