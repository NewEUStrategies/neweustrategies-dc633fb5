import { describe, it, expect } from "vitest";
import {
  scoreAnswers,
  isComplete,
  answeredCount,
  type PersonalityQuestion,
} from "../profile/personality";

const Q: PersonalityQuestion[] = [
  { id: 1, axis: "openness", reverse: false, text_pl: "", text_en: "", sort_order: 1 },
  { id: 2, axis: "openness", reverse: false, text_pl: "", text_en: "", sort_order: 2 },
  { id: 3, axis: "openness", reverse: true, text_pl: "", text_en: "", sort_order: 3 },
  { id: 4, axis: "conscientiousness", reverse: false, text_pl: "", text_en: "", sort_order: 4 },
  { id: 5, axis: "conscientiousness", reverse: true, text_pl: "", text_en: "", sort_order: 5 },
  { id: 6, axis: "extraversion", reverse: false, text_pl: "", text_en: "", sort_order: 6 },
  { id: 7, axis: "agreeableness", reverse: false, text_pl: "", text_en: "", sort_order: 7 },
  { id: 8, axis: "neuroticism", reverse: true, text_pl: "", text_en: "", sort_order: 8 },
];

describe("personality scoring", () => {
  it("returns 0 for axis without answers", () => {
    const s = scoreAnswers({}, Q);
    expect(s.openness).toBe(0);
    expect(s.conscientiousness).toBe(0);
    expect(s.extraversion).toBe(0);
    expect(s.agreeableness).toBe(0);
    expect(s.neuroticism).toBe(0);
  });

  it("returns 100 when all forward items are max and reverse are min", () => {
    const s = scoreAnswers({ 1: 5, 2: 5, 3: 1, 4: 5, 5: 1, 6: 5, 7: 5, 8: 1 }, Q);
    expect(s.openness).toBe(100);
    expect(s.conscientiousness).toBe(100);
    expect(s.extraversion).toBe(100);
    expect(s.agreeableness).toBe(100);
    expect(s.neuroticism).toBe(100);
  });

  it("returns 0 for max-low scenario (forward=1, reverse=5)", () => {
    const s = scoreAnswers({ 1: 1, 2: 1, 3: 5, 4: 1, 5: 5, 6: 1, 7: 1, 8: 5 }, Q);
    expect(s.openness).toBe(0);
    expect(s.conscientiousness).toBe(0);
    expect(s.neuroticism).toBe(0);
  });

  it("midpoints return 50", () => {
    const s = scoreAnswers({ 1: 3, 2: 3, 3: 3, 4: 3, 5: 3, 6: 3, 7: 3, 8: 3 }, Q);
    expect(s.openness).toBe(50);
    expect(s.conscientiousness).toBe(50);
    expect(s.extraversion).toBe(50);
  });

  it("ignores invalid values (out of 1..5)", () => {
    const s = scoreAnswers({ 1: 0, 2: 9, 3: 3, 4: 3, 5: 3, 6: 3, 7: 3, 8: 3 }, Q);
    // only id=3 answered for openness, reverse: (6-3)=3 → midpoint
    expect(s.openness).toBe(50);
  });

  it("isComplete + answeredCount", () => {
    expect(isComplete({ 1: 3 }, Q)).toBe(false);
    expect(answeredCount({ 1: 3, 2: 4 }, Q)).toBe(2);
    const full = Object.fromEntries(Q.map((q) => [q.id, 3]));
    expect(isComplete(full, Q)).toBe(true);
  });
});
