// TABELA ROZMIARÓW CZCIONEK - odczyt na każdej trasie, zapis z panelu.
//
// CO DOWODZI TEN PLIK. `useSaveFontScale` nie miał ani jednego wywołania,
// a to on stoi między polem w panelu a zmiennymi `--fs-*` całej platformy.
// Kontrakty:
//   * odczyt jest CZYSTO PREZENTACYJNY - brak wiersza tokenów daje tabelę
//     pustą (rozmiary domyślne z arkusza), a nie wyjątek na trasie;
//   * zapis PRZYCINA wartość do znanych tokenów i ich zakresów ZANIM pójdzie
//     do bazy - śmieć z formularza nie dociera do CSS ani do `jsonb`;
//   * zapis jest per najemca (`onConflict: tenant_id`), a po sukcesie cache
//     dostaje wartość PRZYCIĘTĄ, więc podgląd od razu pokazuje to, co w bazie.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, waitFor } from "@testing-library/react";
import type { SupabaseFromStub } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({
  from: null as SupabaseFromStub | null,
  row: null as null | { font_scale: unknown },
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  h.from = from;
  return { supabase: { from: from.from } };
});
vi.mock("@/lib/builder/designTokens", () => ({
  fetchSiteDesignTokensRow: () => Promise.resolve(h.row),
}));
vi.mock("@/lib/notify", () => ({
  notifySuccess: h.notifySuccess,
  notifyError: h.notifyError,
}));

import { fail, ok } from "@/test/supabaseChain";
import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";
import {
  fontScaleQueryOptions,
  fontScaleToCss,
  useFontScale,
  useSaveFontScale,
} from "../useFontScale";

function db(): SupabaseFromStub {
  if (!h.from) throw new Error("brak atrapy Supabase");
  return h.from;
}

beforeEach(() => {
  db().reset();
  h.row = null;
  h.notifySuccess.mockReset();
  h.notifyError.mockReset();
});

describe("useFontScale - odczyt", () => {
  it("brak wiersza tokenów to tabela PUSTA (rozmiary domyślne), nie wyjątek", async () => {
    const { result } = renderHookWithQueryClient(() => useFontScale());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({});
  });

  it("zapis z bazy jest przycinany do znanych tokenów i zakresów", async () => {
    h.row = { font_scale: { label: 40, input: "14", nieznany: 12, button: "abc" } };
    const { result } = renderHookWithQueryClient(() => useFontScale());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // `label` ma górną granicę 18 px; `input` z napisu staje się liczbą.
    expect(result.current.data).toEqual({ label: 18, input: 14 });
  });

  it("re-eksportuje generator CSS dla stylu korzenia", () => {
    expect(fontScaleToCss).toBeTypeOf("function");
    expect(fontScaleQueryOptions.queryKey).toEqual(["site_font_scale"]);
  });
});

describe("useSaveFontScale - zapis", () => {
  it("wysyła wartość PRZYCIĘTĄ, per najemca, i wkłada ją do cache", async () => {
    db().setResponse("site_design_tokens", ok(null));
    const { result, queryClient } = renderHookWithQueryClient(() => useSaveFontScale());

    await act(async () => {
      await result.current.mutateAsync({ label: 2, input: 15, obcy: 99 });
    });

    const upsert = db().lastChain("site_design_tokens");
    expect(upsert?.argsOf("upsert")).toEqual([
      { font_scale: { label: 9, input: 15 } },
      { onConflict: "tenant_id" },
    ]);
    expect(queryClient.getQueryData(["site_font_scale"])).toEqual({ label: 9, input: 15 });
    expect(h.notifySuccess).toHaveBeenCalledTimes(1);
    expect(h.notifyError).not.toHaveBeenCalled();
  });

  it("odmowa bazy zgłasza komunikat bazy i nie rusza cache", async () => {
    db().setResponse("site_design_tokens", fail("permission denied for table"));
    const { result, queryClient } = renderHookWithQueryClient(() => useSaveFontScale());

    await act(async () => {
      await result.current.mutateAsync({ label: 12 }).catch(() => undefined);
    });

    expect(h.notifyError).toHaveBeenCalledWith("permission denied for table");
    expect(h.notifySuccess).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(["site_font_scale"])).toBeUndefined();
  });

  it("błąd bez treści dostaje komunikat zapasowy zamiast pustego toastu", async () => {
    db().setResponse("site_design_tokens", fail(""));
    const { result } = renderHookWithQueryClient(() => useSaveFontScale());
    await act(async () => {
      await result.current.mutateAsync({}).catch(() => undefined);
    });
    expect(h.notifyError).toHaveBeenCalledTimes(1);
    expect(h.notifyError.mock.calls[0]?.[0]).not.toBe("");
  });
});
