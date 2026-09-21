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

  it("pusty wynik zapytania nie zamraża niczego - lista jest pusta, kolejka też", () => {
    // Pierwszy render wątku dostaje `undefined`: zapytanie jeszcze leci.
    // Efekt „przyjmij pierwszą partię" musi wtedy MILCZEĆ - inaczej zapisałby
    // pustą partię jako przyjętą i pierwsza prawdziwa odpowiedź wylądowałaby
    // za paskiem „1 nowa", zamiast po prostu się pokazać.
    const initialProps: { rows: ClubReplyRow[] | undefined } = { rows: undefined };
    const { result, rerender } = renderHook(
      ({ rows }: { rows: ClubReplyRow[] | undefined }) => useDeferredReplies(rows, THREAD),
      { initialProps },
    );
    expect(result.current.rows).toEqual([]);
    expect(result.current.pendingCount).toBe(0);

    rerender({ rows: [row("a"), row("b")] });
    expect(result.current.rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(result.current.pendingCount).toBe(0);
  });

  it("reveal przed dojechaniem danych nie wybucha i niczego nie przyjmuje", () => {
    // Czytelnik może kliknąć „pokaż nowe" w tej samej klatce, w której
    // zapytanie jeszcze nie wróciło - pasek bywa widoczny z poprzedniego
    // renderu. Bez strażnika `latest === undefined` byłoby to `.map` na
    // `undefined`.
    const { result } = renderHook(() => useDeferredReplies(undefined, THREAD));

    act(() => result.current.reveal());

    expect(result.current.rows).toEqual([]);
    expect(result.current.pendingCount).toBe(0);
  });

  it("accept bez wpisów i accept już przyjętych NIE zmienia stanu", () => {
    const { result, rerender } = renderHook(({ rows }) => useDeferredReplies(rows, THREAD), {
      initialProps: { rows: [row("a")] },
    });
    rerender({ rows: [row("a"), row("obcy")] });
    const before = result.current.rows;

    // Pusta lista to zwykły przypadek: widok woła `accept(ids)` z wynikiem
    // mutacji, a ten bywa pusty (np. odpowiedź trafiła do moderacji).
    act(() => result.current.accept([]));
    expect(result.current.rows).toBe(before);

    // Ponowne przyjęcie tego samego wpisu też nie ma prawa przerysować listy:
    // `new Set(prev)` przy każdym wywołaniu zmieniałoby referencję stanu
    // i wymuszał render pod kursorem czytelnika.
    act(() => result.current.accept(["a"]));
    expect(result.current.rows).toBe(before);
    expect(result.current.pendingCount).toBe(1);
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
