// Odroczone odpowiedzi: co wolno wstawić pod kursor czytelnika, a czego nie.
//
// To jest wymaganie projektowe modułu (V1 §5.4), a nie szczegół implementacji:
// nowe odpowiedzi NIE wskakują same do widoku, tylko czekają za paskiem
// „N nowych". Test pilnuje tej reguły ORAZ jej jedynego wyjątku - własnego
// wpisu autora - bo wyjątek najłatwiej rozlać na całą regułę.
//
// Dokładnie tak wyglądał błąd, który `accept()` naprawia: własną odpowiedź
// pokazywano przez `reveal()`, czyli przyjmując PRZY OKAZJI każdy cudzy wpis,
// który dojechał w międzyczasie. Autor wysyłał zdanie i dostawał pod kursor
// trzy cudze - w chwili, w której najmniej się tego spodziewa.
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDeferredReplies } from "../useDeferredReplies";
import type { ClubReplyRow } from "../types";

const THREAD = "11111111-1111-1111-1111-111111111111";

function row(id: string): ClubReplyRow {
  // Projekcja jest szeroka, a ten moduł czyta z niej WYŁĄCZNIE `id` - reszta
  // pól nie ma tu żadnego wpływu na zachowanie.
  return { id } as ClubReplyRow;
}

describe("useDeferredReplies", () => {
  it("pierwsza partia wchodzi bez pytania", () => {
    const { result } = renderHook(() => useDeferredReplies([row("a"), row("b")], THREAD));
    expect(result.current.rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(result.current.pendingCount).toBe(0);
  });

  it("kolejne wpisy czekają, zamiast wskoczyć pod kursor", () => {
    const { result, rerender } = renderHook(({ rows }) => useDeferredReplies(rows, THREAD), {
      initialProps: { rows: [row("a")] },
    });
    rerender({ rows: [row("a"), row("b"), row("c")] });
    expect(result.current.rows.map((r) => r.id)).toEqual(["a"]);
    expect(result.current.pendingCount).toBe(2);
  });

  it("accept wpuszcza WSKAZANY wpis i zostawia resztę w kolejce", () => {
    const { result, rerender } = renderHook(({ rows }) => useDeferredReplies(rows, THREAD), {
      initialProps: { rows: [row("a")] },
    });
    rerender({ rows: [row("a"), row("obcy"), row("moja")] });

    act(() => result.current.accept(["moja"]));

    expect(result.current.rows.map((r) => r.id)).toEqual(["a", "moja"]);
    // To jest sedno: cudza odpowiedź NADAL czeka, mimo że autor właśnie
    // zobaczył swoją.
    expect(result.current.pendingCount).toBe(1);
  });

  it("reveal wpuszcza wszystko - to jest świadoma decyzja czytelnika", () => {
    const { result, rerender } = renderHook(({ rows }) => useDeferredReplies(rows, THREAD), {
      initialProps: { rows: [row("a")] },
    });
    rerender({ rows: [row("a"), row("b"), row("c")] });

    act(() => result.current.reveal());

    expect(result.current.pendingCount).toBe(0);
  });

  it("zmiana wątku zeruje licznik", () => {
    const { result, rerender } = renderHook(
      ({ rows, thread }) => useDeferredReplies(rows, thread),
      { initialProps: { rows: [row("a")], thread: THREAD } },
    );
    // Drugi wątek ma własne wiersze; pasek „2 nowe" liczony względem
    // pierwszego byłby liczbą bez znaczenia.
    rerender({ rows: [row("x"), row("y")], thread: "22222222-2222-2222-2222-222222222222" });
    expect(result.current.rows.map((r) => r.id)).toEqual(["x", "y"]);
    expect(result.current.pendingCount).toBe(0);
  });
});
