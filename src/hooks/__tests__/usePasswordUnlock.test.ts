// usePasswordUnlock: odblokowanie wpisu chronionego hasłem (tryb `password`).
// Hasło weryfikuje serwer (verify_content_password przez server fn), hook
// trzyma odblokowane body i pamięta hasło w sessionStorage karty, żeby
// odświeżenie nie pytało ponownie.
//
// Trzy kontrakty, których pilnuje ta suita:
//  1. ODMOWA MA POWÓD. Złe hasło, serwerowy limit prób i awaria transportu to
//     trzy różne komunikaty - wyjątek nigdy nie jest "złym hasłem" i nie może
//     skasować poprawnego hasła zapamiętanego w karcie.
//  2. TREŚĆ NALEŻY DO WPISU. Trasa `$` nie przemontowuje strony między wpisami,
//     więc body odblokowane na A (albo spóźniona odpowiedź dla A) nie może
//     wyrenderować się na B.
//  3. STORAGE TO WYGODA. Zablokowany sessionStorage (tryb prywatny, SecurityError
//     już przy odczycie właściwości) nie wywraca strony ani odblokowania.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { PAYWALL_IDS } from "@/test/paywall/fixtures";

type UnlockRow = {
  ok: boolean;
  content_pl: string | null;
  content_en: string | null;
  builder_data: unknown;
  blocks_data: unknown;
};

const h = vi.hoisted(() => ({ unlock: vi.fn() }));

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => h.unlock,
}));
// Server fn jest tylko tokenem dla useServerFn - moduł ciągnie warstwę serwerową.
vi.mock("@/lib/auth/bruteforce.functions", () => ({ unlockContentPassword: {} }));

import { usePasswordUnlock } from "@/hooks/usePasswordUnlock";

const POST_A = PAYWALL_IDS.entity;
const POST_B = "post-2";
const keyFor = (id: string) => `content-pwd:post:${id}`;

const granted = (content: string): UnlockRow => ({
  ok: true,
  content_pl: content,
  content_en: null,
  builder_data: null,
  blocks_data: null,
});
const refused: UnlockRow = {
  ok: false,
  content_pl: null,
  content_en: null,
  builder_data: null,
  blocks_data: null,
};

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function mount(entityId: string | null = POST_A, enabled = true) {
  return renderHook(({ id, on }) => usePasswordUnlock("post", id, on), {
    initialProps: { id: entityId, on: enabled },
  });
}

beforeEach(() => {
  h.unlock.mockReset();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("usePasswordUnlock - weryfikacja ręczna", () => {
  it("poprawne hasło: body z serwera, hasło zapamiętane w karcie, loading tylko w trakcie", async () => {
    const pending = deferred<UnlockRow>();
    h.unlock.mockReturnValueOnce(pending.promise);
    const { result } = mount();
    expect(result.current.body).toBeNull();

    let verdict: Promise<unknown> = Promise.resolve();
    act(() => {
      verdict = result.current.verify("sezam");
    });
    expect(result.current.loading).toBe(true);
    expect(h.unlock).toHaveBeenCalledWith({
      data: { entityType: "post", entityId: POST_A, password: "sezam" },
    });

    await act(async () => {
      pending.resolve({ ...granted("<p>Pełna treść</p>"), content_en: "<p>Full</p>" });
      await verdict;
    });
    await expect(verdict).resolves.toEqual({ ok: true });
    expect(result.current.loading).toBe(false);
    expect(result.current.body).toEqual({
      content_pl: "<p>Pełna treść</p>",
      content_en: "<p>Full</p>",
      builder_data: null,
      blocks_data: null,
    });
    expect(window.sessionStorage.getItem(keyFor(POST_A))).toBe("sezam");
  });

  it("złe hasło: powód invalid, brak body i brak zapamiętanego hasła", async () => {
    h.unlock.mockResolvedValueOnce(refused);
    const { result } = mount();
    let verdict: unknown;
    await act(async () => {
      verdict = await result.current.verify("zle");
    });
    expect(verdict).toEqual({ ok: false, reason: "invalid" });
    expect(result.current.body).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(window.sessionStorage.getItem(keyFor(POST_A))).toBeNull();
  });

  it.each([
    ["content_password: rate_limited", "rate_limited"],
    ["content_password: failed", "failed"],
    ["Failed to fetch", "failed"],
  ] as const)("wyjątek %j to powód %s, nigdy złe hasło", async (message, reason) => {
    h.unlock.mockRejectedValueOnce(new Error(message));
    const { result } = mount();
    let verdict: unknown;
    await act(async () => {
      verdict = await result.current.verify("haslo");
    });
    expect(verdict).toEqual({ ok: false, reason });
    expect(result.current.loading).toBe(false);
    expect(result.current.body).toBeNull();
  });

  it("odrzucenie wartością spoza Error też jest awarią, nie złym hasłem", async () => {
    h.unlock.mockRejectedValueOnce("socket hang up");
    const { result } = mount();
    let verdict: unknown;
    await act(async () => {
      verdict = await result.current.verify("haslo");
    });
    expect(verdict).toEqual({ ok: false, reason: "failed" });
    expect(result.current.loading).toBe(false);
  });

  it("bez identyfikatora wpisu nie wysyła hasła na serwer", async () => {
    const { result } = mount(null);
    let verdict: unknown;
    await act(async () => {
      verdict = await result.current.verify("haslo");
    });
    expect(verdict).toEqual({ ok: false, reason: "invalid" });
    expect(h.unlock).not.toHaveBeenCalled();
  });

  it("pełny limit sessionStorage nie blokuje odblokowania", async () => {
    const real = window.sessionStorage;
    const full: Storage = {
      get length() {
        return real.length;
      },
      clear: () => real.clear(),
      getItem: (key) => real.getItem(key),
      key: (index) => real.key(index),
      removeItem: (key) => real.removeItem(key),
      setItem: () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
    };
    vi.spyOn(window, "sessionStorage", "get").mockReturnValue(full);
    h.unlock.mockResolvedValueOnce(granted("<p>Treść</p>"));
    const { result } = mount();
    await act(async () => {
      await result.current.verify("sezam");
    });
    expect(result.current.body?.content_pl).toBe("<p>Treść</p>");
    expect(window.sessionStorage.getItem(keyFor(POST_A))).toBeNull();
  });
});

describe("usePasswordUnlock - cichy powrót po odświeżeniu", () => {
  it("zapamiętane hasło odblokowuje wpis po montażu", async () => {
    window.sessionStorage.setItem(keyFor(POST_A), "sezam");
    h.unlock.mockResolvedValueOnce(granted("<p>Po odświeżeniu</p>"));
    const { result } = mount();
    await waitFor(() => expect(result.current.body?.content_pl).toBe("<p>Po odświeżeniu</p>"));
    expect(h.unlock).toHaveBeenCalledWith({
      data: { entityType: "post", entityId: POST_A, password: "sezam" },
    });
  });

  it("nieaktualne hasło (zmienione przez autora) znika z karty", async () => {
    window.sessionStorage.setItem(keyFor(POST_A), "stare");
    h.unlock.mockResolvedValueOnce(refused);
    const { result } = mount();
    await waitFor(() => expect(window.sessionStorage.getItem(keyFor(POST_A))).toBeNull());
    expect(result.current.body).toBeNull();
  });

  it.each(["content_password: rate_limited", "Failed to fetch"])(
    "chwilowa odmowa (%s) NIE kasuje zapamiętanego hasła",
    async (message) => {
      window.sessionStorage.setItem(keyFor(POST_A), "sezam");
      h.unlock.mockRejectedValueOnce(new Error(message));
      const { result } = mount();
      await waitFor(() => expect(h.unlock).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(window.sessionStorage.getItem(keyFor(POST_A))).toBe("sezam");
      expect(result.current.body).toBeNull();
    },
  );

  it("wyłączony hook (wpis nie wymaga hasła) nie próbuje cichego odblokowania", () => {
    window.sessionStorage.setItem(keyFor(POST_A), "sezam");
    const { result } = mount(POST_A, false);
    expect(h.unlock).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });

  it("zablokowany sessionStorage (SecurityError) nie wywraca strony, a ręczne hasło działa", async () => {
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });
    h.unlock.mockResolvedValueOnce(granted("<p>Bez storage</p>"));
    const { result } = mount();
    expect(h.unlock).not.toHaveBeenCalled();

    let verdict: unknown;
    await act(async () => {
      verdict = await result.current.verify("sezam");
    });
    expect(verdict).toEqual({ ok: true });
    expect(result.current.body?.content_pl).toBe("<p>Bez storage</p>");
  });
});

describe("usePasswordUnlock - treść należy do wpisu", () => {
  it("body odblokowane na wpisie A nie renderuje się po przejściu na wpis B", async () => {
    h.unlock.mockResolvedValueOnce(granted("<p>Treść A</p>"));
    const { result, rerender } = mount(POST_A);
    await act(async () => {
      await result.current.verify("haslo-a");
    });
    expect(result.current.body?.content_pl).toBe("<p>Treść A</p>");

    rerender({ id: POST_B, on: true });
    expect(result.current.body).toBeNull();
    // Powrót na A pokazuje treść A - odblokowanie dotyczyło właśnie tego wpisu.
    rerender({ id: POST_A, on: true });
    expect(result.current.body?.content_pl).toBe("<p>Treść A</p>");
  });

  it("spóźniona odpowiedź dla A po przejściu na B nie odblokowuje B ani nie trzyma loading", async () => {
    const slow = deferred<UnlockRow>();
    h.unlock.mockReturnValueOnce(slow.promise);
    const { result, rerender } = mount(POST_A);
    let verdict: Promise<unknown> = Promise.resolve();
    act(() => {
      verdict = result.current.verify("haslo-a");
    });
    expect(result.current.loading).toBe(true);

    rerender({ id: POST_B, on: true });
    expect(result.current.loading).toBe(false);
    await act(async () => {
      slow.resolve(granted("<p>Treść A</p>"));
      await verdict;
    });
    expect(result.current.body).toBeNull();
    expect(result.current.loading).toBe(false);
    // Hasło trafia pod klucz wpisu, dla którego zostało zweryfikowane.
    expect(window.sessionStorage.getItem(keyFor(POST_A))).toBe("haslo-a");
    expect(window.sessionStorage.getItem(keyFor(POST_B))).toBeNull();
  });

  it("spóźniona odpowiedź dla A nie zdejmuje spinnera z trwającej weryfikacji B", async () => {
    const slowA = deferred<UnlockRow>();
    const slowB = deferred<UnlockRow>();
    h.unlock.mockReturnValueOnce(slowA.promise).mockReturnValueOnce(slowB.promise);
    const { result, rerender } = mount(POST_A);
    let verdictA: Promise<unknown> = Promise.resolve();
    act(() => {
      verdictA = result.current.verify("haslo-a");
    });
    rerender({ id: POST_B, on: true });
    let verdictB: Promise<unknown> = Promise.resolve();
    act(() => {
      verdictB = result.current.verify("haslo-b");
    });
    expect(result.current.loading).toBe(true);

    await act(async () => {
      slowA.resolve(refused);
      await verdictA;
    });
    // Formularz B dalej czeka na swój werdykt - nie da się wysłać drugiej próby.
    expect(result.current.loading).toBe(true);

    await act(async () => {
      slowB.resolve({ ...refused, ok: true, builder_data: { sections: [{ id: "s1" }] } });
      await verdictB;
    });
    expect(result.current.loading).toBe(false);
    // Wpis z samego buildera (bez HTML) odblokowuje się z pustymi kolumnami HTML.
    expect(result.current.body).toEqual({
      content_pl: null,
      content_en: null,
      builder_data: { sections: [{ id: "s1" }] },
      blocks_data: null,
    });
  });
});
