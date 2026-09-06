import { QueryClient } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import {
  HOME_SSR_BUDGET_MS,
  HOME_THEME_BUDGET_MS,
  HOME_ABOVE_FOLD_BUDGET_MS,
  hasSsrQueryData,
  homeSsrDeadline,
  remainingHomeBudget,
} from "../homeSsrBudget";

afterEach(() => vi.useRealTimers());

it("shares one 600 ms clock within a request, never across requests/tenants", () => {
  vi.useFakeTimers();
  const first = new QueryClient();
  const deadline = homeSsrDeadline(first);
  vi.advanceTimersByTime(300);
  expect(homeSsrDeadline(first)).toBe(deadline);
  expect(homeSsrDeadline(new QueryClient())).toBe(deadline + 300);
  expect(HOME_SSR_BUDGET_MS).toBe(600);
  expect(HOME_THEME_BUDGET_MS).toBeLessThanOrEqual(400);
  expect(HOME_ABOVE_FOLD_BUDGET_MS).toBeLessThanOrEqual(500);
});

it("caps each phase by the remaining time and reports zero after expiry", () => {
  const now = Date.now();
  expect(remainingHomeBudget(now + 300, 500)).toBeLessThanOrEqual(300);
  expect(remainingHomeBudget(now + 600, 400)).toBe(400);
  expect(remainingHomeBudget(now - 1, 500)).toBe(0);
});

it("distinguishes valid empty results from absent and fallback query data", () => {
  const qc = new QueryClient();
  const key = ["home-test"];
  expect(hasSsrQueryData(qc, key)).toBe(false);
  qc.setQueryData(key, null, { updatedAt: 0 });
  expect(hasSsrQueryData(qc, key)).toBe(false);
  qc.setQueryData(key, null);
  expect(hasSsrQueryData(qc, key)).toBe(true);
  qc.clear();
});
