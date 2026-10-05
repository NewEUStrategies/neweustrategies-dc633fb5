// WIEDZA O SESJI BEZ KLIENTA SUPABASE: `src/integrations/supabase/sessionHint.ts`.
//
// CO TEN PLIK DOWODZI.
//   1. `hasStoredAuthSession()` zachowuje się DOKŁADNIE jak sonda, którą P1.7
//      przeniosło z `hooks/useAuth.tsx`: klucze klienta Supabase (także
//      dzielone na części i historyczny), pusta wartość to brak sesji, obcy
//      klucz nie udaje sesji, ramka podglądu = „może być", zablokowany magazyn
//      i brak `window` = gość.
//   2. `STORED_SESSION_EXPR` (fragment skryptu inline dla P2.1) daje TEN SAM
//      wynik co funkcja w każdym z tych scenariuszy i jest bezpieczny do
//      wklejenia w `<script>`: jedno wyrażenie, bez `</`, bez cudzysłowów.
//   3. `urlHasAuthParams()` rozpoznaje powroty z linku magicznego, OAuth (oba
//      przepływy), odzyskiwania hasła i błąd dostawcy - i NIE myli z nimi
//      zwykłych parametrów (`?promo_code=`, `?type=article`).
//   4. Rejestr utworzenia klienta: słuchacz biegnie raz, od razu przy
//      gotowym kliencie, wypisany nie biegnie wcale, a wyjątek jednego nie
//      zatrzymuje pozostałych.
//   5. `client.ts` zgłasza utworzenie klienta przy PIERWSZYM dostępie, po
//      przypisaniu klienta (słuchacz może już wołać `supabase.auth`), i ani
//      razu więcej; reeksportuje zapis z tego modułu.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  STORED_SESSION_EXPR,
  STORED_SESSION_KEY_RE,
  __resetSupabaseClientRegistryForTests,
  hasStoredAuthSession,
  markSupabaseClientCreated,
  onSupabaseClientCreated,
  urlHasAuthParams,
} from "../sessionHint";

const evalExpr = (): boolean => new Function(`return ${STORED_SESSION_EXPR};`)() as boolean;

beforeEach(() => {
  window.localStorage.clear();
  __resetSupabaseClientRegistryForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("STORED_SESSION_KEY_RE", () => {
  it.each([
    ["sb-placeholder-auth-token", true],
    ["sb-abcdefghijklmnop-auth-token", true],
    ["sb-placeholder-auth-token.0", true],
    ["sb-placeholder-auth-token.12", true],
    ["supabase.auth.token", true],
    ["sb-placeholder-auth-token-code-verifier", false],
    ["sb--auth-token", false],
    ["theme", false],
    ["xsb-placeholder-auth-token", false],
  ])("%s -> %s", (key, expected) => {
    expect(STORED_SESSION_KEY_RE.test(key)).toBe(expected);
  });
});

describe("hasStoredAuthSession() i STORED_SESSION_EXPR - ten sam wynik", () => {
  const scenarios: [string, () => void, boolean][] = [
    ["pusty magazyn", () => {}, false],
    [
      "sesja klienta Supabase",
      () => window.localStorage.setItem("sb-placeholder-auth-token", '{"access_token":"t"}'),
      true,
    ],
    [
      "sesja dzielona na części",
      () => window.localStorage.setItem("sb-placeholder-auth-token.0", "część"),
      true,
    ],
    ["klucz historyczny", () => window.localStorage.setItem("supabase.auth.token", "t"), true],
    [
      "pusta wartość pod kluczem sesji",
      () => window.localStorage.setItem("sb-placeholder-auth-token", ""),
      false,
    ],
    ["obcy klucz", () => window.localStorage.setItem("theme", "dark"), false],
    [
      "ramka podglądu (broker sesji, pusty magazyn)",
      () => vi.stubGlobal("parent", { nazwa: "okno edytora" }),
      true,
    ],
  ];

  it.each(scenarios)("%s", (_name, arrange, expected) => {
    arrange();
    expect(hasStoredAuthSession()).toBe(expected);
    expect(evalExpr()).toBe(expected);
  });

  it("zablokowany magazyn (tryb prywatny) to gość - funkcja i wyrażenie nie rzucają", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("magazyn zablokowany", "SecurityError");
    });
    expect(hasStoredAuthSession()).toBe(false);
    expect(evalExpr()).toBe(false);
  });

  it("bez window (serwer) - gość, a zapisany token nie jest czytany", () => {
    window.localStorage.setItem("sb-placeholder-auth-token", '{"access_token":"t"}');
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    vi.stubGlobal("window", undefined);
    try {
      expect(hasStoredAuthSession()).toBe(false);
      expect(evalExpr()).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(getItem).not.toHaveBeenCalled();
  });
});

describe("STORED_SESSION_EXPR jako fragment skryptu inline", () => {
  it("jest jednym wyrażeniem ES5, bez sekwencji domykających znacznik ani napis", () => {
    expect(() => new Function(`return (${STORED_SESSION_EXPR});`)).not.toThrow();
    expect(STORED_SESSION_EXPR).not.toMatch(/<\/|<!--|-->|["'`]/);
    expect(STORED_SESSION_EXPR).not.toMatch(/\b(?:let|const|class)\b|=>/);
    // Jedno źródło prawdy: wzorzec klucza wprost ze stałej modułu.
    expect(STORED_SESSION_EXPR).toContain(`/${STORED_SESSION_KEY_RE.source}/`);
  });
});

describe("urlHasAuthParams()", () => {
  it.each([
    ["#access_token=a&refresh_token=r&type=magiclink", true],
    ["#access_token=a&type=recovery", true],
    ["#type=recovery", true],
    ["#error=access_denied&error_description=Odmowa", true],
    ["?code=pkce-123", true],
    ["?lang=pl&code=pkce-123", true],
    ["?refresh_token=r", true],
    ["?token_hash=h&type=signup", true],
    ["?type=invite", true],
    ["?promo_code=LATO", false],
    ["?type=article", false],
    ["?typeface=serif", false],
    ["#sekcja-2", false],
    ["", false],
  ])("%s -> %s", (fragment, expected) => {
    const parts = fragment.startsWith("#") ? { hash: fragment } : { search: fragment };
    expect(urlHasAuthParams(parts)).toBe(expected);
  });

  it("sprawdza `search` i `hash` razem - `type` przed fragmentem adresu też się liczy", () => {
    expect(urlHasAuthParams({ search: "?type=recovery", hash: "#sekcja" })).toBe(true);
    expect(urlHasAuthParams({ search: "?lang=pl", hash: "#access_token=a" })).toBe(true);
    expect(urlHasAuthParams({ search: "?type=article", hash: "#type" })).toBe(false);
  });

  it("bez argumentu czyta bieżący adres okna", () => {
    window.history.replaceState(null, "", "/powrot#access_token=a&type=magiclink");
    expect(urlHasAuthParams()).toBe(true);
    window.history.replaceState(null, "", "/artykul?utm_source=x");
    expect(urlHasAuthParams()).toBe(false);
  });

  it("brakujące pola adresu (atrapa `location`) i brak window - false", () => {
    expect(urlHasAuthParams({})).toBe(false);
    expect(urlHasAuthParams({ search: null, hash: null })).toBe(false);
    vi.stubGlobal("window", undefined);
    try {
      expect(urlHasAuthParams()).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("rejestr utworzenia klienta", () => {
  it("słuchacz biegnie raz, przy zgłoszeniu; drugie zgłoszenie nic nie robi", () => {
    const listener = vi.fn();
    onSupabaseClientCreated(listener);
    expect(listener).not.toHaveBeenCalled();
    markSupabaseClientCreated();
    markSupabaseClientCreated();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("klient już istnieje - słuchacz biegnie od razu, synchronicznie", () => {
    markSupabaseClientCreated();
    const listener = vi.fn();
    onSupabaseClientCreated(listener);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("wypisany słuchacz nie biegnie", () => {
    const listener = vi.fn();
    const stop = onSupabaseClientCreated(listener);
    stop();
    markSupabaseClientCreated();
    expect(listener).not.toHaveBeenCalled();
  });

  it("słuchacz wypisany przez wcześniejszego słuchacza w trakcie zgłoszenia już nie biegnie", () => {
    const second = vi.fn();
    let stopSecond = () => {};
    onSupabaseClientCreated(() => stopSecond());
    stopSecond = onSupabaseClientCreated(second);
    markSupabaseClientCreated();
    expect(second).not.toHaveBeenCalled();
  });

  it("wyjątek słuchacza nie zatrzymuje pozostałych i jest zgłoszony głośno", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const second = vi.fn();
    onSupabaseClientCreated(() => {
      throw new Error("zepsuty słuchacz");
    });
    onSupabaseClientCreated(second);
    expect(() => markSupabaseClientCreated()).not.toThrow();
    expect(second).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      "[supabase] słuchacz utworzenia klienta rzucił wyjątek",
      expect.any(Error),
    );
  });
});

describe("client.ts zgłasza utworzenie klienta", () => {
  it("przy pierwszym dostępie, po przypisaniu klienta, raz; reeksport to ten sam zapis", async () => {
    vi.resetModules();
    const auth = { onAuthStateChange: vi.fn(() => ({ data: { subscription: {} } })) };
    const createClient = vi.fn(() => ({ auth, from: vi.fn() }));
    vi.doMock("@supabase/supabase-js", () => ({ createClient }));
    vi.doMock("@/lib/supabasePublicConfig", () => ({
      resolveSupabasePublicConfig: () => ({ url: "https://placeholder.supabase.co", key: "anon" }),
    }));
    vi.doMock("@/integrations/supabase/previewAuthStorage", () => ({
      brokeredPreviewStorage: () => undefined,
    }));
    try {
      const hint = await import("@/integrations/supabase/sessionHint");
      const client = await import("@/integrations/supabase/client");
      expect(client.onSupabaseClientCreated).toBe(hint.onSupabaseClientCreated);

      const seen: unknown[] = [];
      client.onSupabaseClientCreated(() => {
        // Słuchacz woła klienta - Proxy już go ma, bez rekursji i drugiego createClient.
        seen.push(client.supabase.auth);
      });
      expect(createClient).not.toHaveBeenCalled();

      expect(client.supabase.from).toBeDefined();
      expect(createClient).toHaveBeenCalledTimes(1);
      expect(seen).toEqual([auth]);

      void client.supabase.auth;
      expect(seen).toHaveLength(1);
      const late = vi.fn();
      client.onSupabaseClientCreated(late);
      expect(late).toHaveBeenCalledTimes(1);
    } finally {
      vi.doUnmock("@supabase/supabase-js");
      vi.doUnmock("@/lib/supabasePublicConfig");
      vi.doUnmock("@/integrations/supabase/previewAuthStorage");
      vi.resetModules();
    }
  });
});
