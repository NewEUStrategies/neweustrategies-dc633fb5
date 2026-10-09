import { QueryClient } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import {
  HOME_CHROME_LATE_BUDGET_MS,
  HOME_CONTENT_BUDGET_MS,
  HOME_CRAWLER_CONTENT_BUDGET_MS,
  HOME_SSR_BUDGET_MS,
  HOME_THEME_BUDGET_MS,
  HOME_ABOVE_FOLD_BUDGET_MS,
  hasSsrQueryData,
  homeContentDeadline,
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

// P3.6b, R3a: ścieżka krytyczna treści (strona + tryb) ma WŁASNY, dłuższy
// termin, ale na TYM SAMYM zegarze żądania - korzeń, który wystartował zegar
// wcześniej, nie daje treści świeżych 1 200 ms.
it("gives the content critical path its own deadline on the shared request clock", () => {
  vi.useFakeTimers();
  const qc = new QueryClient();
  const start = Date.now();
  const shared = homeSsrDeadline(qc);
  vi.advanceTimersByTime(400);
  expect(homeContentDeadline(qc)).toBe(start + HOME_CONTENT_BUDGET_MS);
  expect(homeContentDeadline(qc) - shared).toBe(HOME_CONTENT_BUDGET_MS - HOME_SSR_BUDGET_MS);
  expect(HOME_CONTENT_BUDGET_MS).toBeGreaterThan(HOME_SSR_BUDGET_MS);
  // Twardy sufit, nie „czekaj do skutku": najwyżej 1,5 s dla treści i chrome'u.
  expect(HOME_CONTENT_BUDGET_MS).toBeLessThanOrEqual(1_500);
  expect(HOME_CHROME_LATE_BUDGET_MS).toBeLessThanOrEqual(1_500);
  // Inne żądanie = inny zegar.
  expect(homeContentDeadline(new QueryClient())).toBe(start + 400 + HOME_CONTENT_BUDGET_MS);
});

// Zgłoszenie 2026-10-09: crawler indeksujący dostaje dłuższy termin treści
// (dokument bez treści JEST dla niego stroną główną), ale na tym samym zegarze
// żądania i nadal z twardym sufitem - wspólny termin chrome'u się nie zmienia.
it("gives an indexing crawler a longer, still bounded content deadline", () => {
  vi.useFakeTimers();
  const qc = new QueryClient();
  const start = Date.now();
  const shared = homeSsrDeadline(qc);
  expect(homeContentDeadline(qc, true)).toBe(start + HOME_CRAWLER_CONTENT_BUDGET_MS);
  expect(homeContentDeadline(qc, false)).toBe(start + HOME_CONTENT_BUDGET_MS);
  expect(homeSsrDeadline(qc)).toBe(shared);
  expect(HOME_CRAWLER_CONTENT_BUDGET_MS).toBeGreaterThan(HOME_CONTENT_BUDGET_MS);
  expect(HOME_CRAWLER_CONTENT_BUDGET_MS).toBeLessThanOrEqual(5_000);
});
