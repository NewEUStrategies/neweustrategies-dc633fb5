// useUnlockedContent: kliencki dociąg zabramkowanego body dla zalogowanego
// czytelnika, którego SSR (anonimowy) obsłużył pustym body. Serwer
// (get_entity_content, SECURITY DEFINER) decyduje o uprawnieniu - hook pilnuje
// tylko, KIEDY pyta i CZYJE body zwraca:
//  * bez sesji, bez wpisu albo z wyłączonym sygnałem "needs unlock" nie pyta
//    wcale (anonimowy dociąg byłby zbędnym RPC z gwarantowanym pustym wynikiem),
//  * klucz zawiera użytkownika i wpis, więc body jednego konta / wpisu nigdy
//    nie wraca dla drugiego - także w oknie, zanim nowe zapytanie wróci,
//  * odmowa serwera zostawia null (paywall), a nie wyjątek w renderze.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";
import { PAYWALL_IDS } from "@/test/paywall/fixtures";
import type { BodyParts } from "@/lib/access/gating";

const h = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  entityId: null as string | null,
  enabled: true,
  fetchGatedBody: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ session: h.session }) }));
vi.mock("@/lib/queries/public", () => ({ fetchGatedBody: h.fetchGatedBody }));

import { useUnlockedContent } from "@/hooks/useUnlockedContent";

const body = (content: string): BodyParts => ({
  content_pl: content,
  content_en: null,
  builder_data: null,
  blocks_data: null,
});

function mount() {
  return renderHookWithQueryClient(() => useUnlockedContent("post", h.entityId, h.enabled));
}

beforeEach(() => {
  h.session = { user: { id: PAYWALL_IDS.user } };
  h.entityId = PAYWALL_IDS.entity;
  h.enabled = true;
  h.fetchGatedBody.mockReset();
});

describe("useUnlockedContent - kiedy pyta serwer", () => {
  it("zalogowany i zabramkowany wpis: dociąga body tym samym RPC co SSR", async () => {
    h.fetchGatedBody.mockResolvedValueOnce(body("<p>Premium</p>"));
    const { result } = mount();
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toEqual(body("<p>Premium</p>")));
    expect(h.fetchGatedBody).toHaveBeenCalledWith("post", PAYWALL_IDS.entity);
  });

  it.each([
    [
      "anonim (brak sesji)",
      () => {
        h.session = null;
      },
    ],
    [
      "wyłączony sygnał needs-unlock",
      () => {
        h.enabled = false;
      },
    ],
    [
      "brak identyfikatora wpisu",
      () => {
        h.entityId = null;
      },
    ],
  ])("%s: zero zapytań i brak body", (_label, arrange) => {
    arrange();
    const { result, queryClient } = mount();
    expect(result.current).toBeNull();
    expect(h.fetchGatedBody).not.toHaveBeenCalled();
    // Zapytanie wstrzymane flagą `enabled` nie startuje wcale (nie tylko chowa wynik).
    expect(queryClient.isFetching()).toBe(0);
  });

  it("odmowa serwera zostawia null (paywall), bez wyjątku w renderze", async () => {
    h.fetchGatedBody.mockRejectedValueOnce(new Error("permission denied"));
    const { result, queryClient } = mount();
    await waitFor(() =>
      expect(
        queryClient.getQueryState(["unlocked-body", "post", PAYWALL_IDS.entity, PAYWALL_IDS.user])
          ?.status,
      ).toBe("error"),
    );
    expect(result.current).toBeNull();
  });
});

describe("useUnlockedContent - czyje body", () => {
  it("zmiana konta nie podaje body poprzedniego użytkownika", async () => {
    h.fetchGatedBody.mockResolvedValueOnce(body("<p>Konto A</p>"));
    const { result, rerender } = mount();
    await waitFor(() => expect(result.current?.content_pl).toBe("<p>Konto A</p>"));

    let release: (value: BodyParts) => void = () => {};
    h.fetchGatedBody.mockReturnValueOnce(
      new Promise<BodyParts>((res) => {
        release = res;
      }),
    );
    h.session = { user: { id: "user-other" } };
    rerender();
    // Zanim serwer odpowie dla nowego konta, body A nie jest już zwracane.
    expect(result.current).toBeNull();
    expect(h.fetchGatedBody).toHaveBeenCalledTimes(2);
    release(body("<p>Konto B</p>"));
    await waitFor(() => expect(result.current?.content_pl).toBe("<p>Konto B</p>"));
  });

  it("wylogowanie natychmiast chowa odblokowane body", async () => {
    h.fetchGatedBody.mockResolvedValueOnce(body("<p>Premium</p>"));
    const { result, rerender } = mount();
    await waitFor(() => expect(result.current).not.toBeNull());
    h.session = null;
    rerender();
    expect(result.current).toBeNull();
    expect(h.fetchGatedBody).toHaveBeenCalledTimes(1);
  });

  it("przejście na inny wpis nie podaje body poprzedniego wpisu", async () => {
    h.fetchGatedBody.mockResolvedValueOnce(body("<p>Wpis A</p>"));
    const { result, rerender } = mount();
    await waitFor(() => expect(result.current?.content_pl).toBe("<p>Wpis A</p>"));

    h.fetchGatedBody.mockReturnValueOnce(new Promise<BodyParts>(() => {}));
    h.entityId = "post-2";
    rerender();
    expect(result.current).toBeNull();
    expect(h.fetchGatedBody).toHaveBeenLastCalledWith("post", "post-2");
  });
});
