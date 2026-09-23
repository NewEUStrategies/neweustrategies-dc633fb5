// Organizm „AuthProvider na ścieżkach zdegradowanych" - sonda zapisanej sesji,
// terminy na sesję i role oraz kontekst bez prowajdera.
//
// Plik obok (`useAuth.test.tsx`) mierzy ścieżki szczęśliwe i główne awarie
// backendu. Tutaj zostają przypadki, w których środowisko NIE zachowuje się jak
// zwykła karta przeglądarki: ramka podglądu, zablokowany magazyn, brak `window`,
// odmowa RLS, zmiana konta w locie, odmontowanie w trakcie czekania i zegar,
// który nie anulował terminu.
//
// CO TEN PLIK DOWODZI.
//   1. RAMKA PODGLĄDU CZEKA NA BROKER. W ramce pośrednika (podgląd Lovable)
//      sesja nie mieszka w `localStorage`, więc pusty magazyn NIE znaczy tam
//      „gość" - `loading` trwa, aż broker (`getSession()`) odpowie.
//   2. ZABLOKOWANY MAGAZYN TO PEWNY GOŚĆ. Tryb prywatny / zablokowane ciasteczka
//      (odczyt `localStorage` rzuca) kończą `loading` od razu, bez czekania na
//      sieć - klient Supabase też nic z takiego magazynu nie odczyta.
//   3. BEZ `window` SONDA NIE CZYTA MAGAZYNU. Zapisany token nie wstrzymuje
//      wtedy odpowiedzi - odwiedzający od razu jest gościem.
//   4. ODMOWA ODCZYTU RÓL TO NAJMNIEJSZE UPRAWNIENIA. `user_roles` z
//      `data: null` (np. odmowa RLS) daje pusty zestaw ról i zamyka `loading`;
//      sesja i tenant zostają.
//   5. ZMIANA KONTA RESTARTUJE TERMIN RÓL. Termin poprzedniego konta nie może
//      zwolnić widoku nowego konta przed czasem.
//   6. ODMONTOWANIE GASI TERMINY. Ani termin sesji, ani termin ról nie odpala
//      po odmontowaniu prowajdera, a nasłuch Supabase jest odpięty.
//   7. SPÓŹNIONY TERMIN NIE PODNOSI FAŁSZYWEGO ALARMU. Gdy termin sesji odpali
//      mimo udzielonej odpowiedzi (zegar nie anulował), nie ogłasza „sesja nie
//      rozstrzygnęła się" i nie zmienia stanu.
//   8. BEZ PROWAJDERA KONTEKST MÓWI „NIE WIEMY". `useAuth()` poza
//      `AuthProvider` zwraca `loading`, brak sesji i ról, a `signOut()` nie
//      robi niczego - ani wylogowania w Supabase, ani nawigacji.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Terminu sesji przy wiszącym `getSession()`,
// odrzuconego `getSession()`, terminu ról przy wiszących zapytaniach, dedupe
// `INITIAL_SESSION`, re-gatingu cache'u i `signOut()` z przekierowaniem - to jest
// w `useAuth.test.tsx`. Ścieżki serwerowej (render bez `window`, `signOut()` bez
// `window`) - to jest w `useAuthWithoutWindow.node.test.tsx`, bo wymaga
// środowiska `node`.
//
// DLACZEGO TEZA 3 ZNIKA `window` TYLKO NA CZAS SONDY. React DOM sam czyta
// `window.event` przy planowaniu aktualizacji, więc pełny render klienta bez
// `window` jest niemożliwy w żadnym środowisku testowym. Efekt potomka (efekty
// dzieci biegną przed efektem rodzica) chowa `window` tuż przed efektem
// prowajdera, a pierwsze `clearTimeout` (domknięcie odpowiedzi zaraz po sondzie)
// je przywraca - zanim React dostanie jakąkolwiek aktualizację.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";

type WynikRol = { data: { role: string }[] | null; error: { message: string } | null };
type WynikProfilu = { data: { tenant_id: string } | null; error: null };
type WynikSesji = { data: { session: unknown } };

const h = vi.hoisted(() => ({
  authCb: null as null | ((event: string, session: unknown) => void),
  unsub: vi.fn(),
  /** Obietnica `getSession()`; `null` = od razu „brak sesji". */
  sesja: null as Promise<WynikSesji> | null,
  /** Odpowiedzi `user_roles` per uid; brak wpisu = pusty zestaw ról. */
  role: new Map<string, Promise<WynikRol>>(),
  /** Odpowiedzi `profiles` per uid; brak wpisu = brak profilu. */
  profile: new Map<string, Promise<WynikProfilu>>(),
  signOut: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: h.rpc,
    auth: {
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        h.authCb = cb;
        return { data: { subscription: { unsubscribe: h.unsub } } };
      },
      getSession: () => h.sesja ?? Promise.resolve({ data: { session: null } }),
      signOut: h.signOut,
    },
    from: (table: string) => {
      if (table === "user_roles") {
        return {
          select: () => ({
            eq: (_kolumna: string, uid: string) =>
              h.role.get(uid) ?? Promise.resolve({ data: [], error: null }),
          }),
        };
      }
      if (table === "profiles") {
        return {
          select: () => ({
            eq: (_kolumna: string, uid: string) => ({
              maybeSingle: () => h.profile.get(uid) ?? Promise.resolve({ data: null, error: null }),
            }),
          }),
        };
      }
      throw new Error(`nieoczekiwana tabela ${table}`);
    },
  },
}));

vi.mock("@/lib/personalization/anonMerge", () => ({
  hasAnonPersonalization: () => false,
  mergeAnonPersonalization: async () => {},
}));

import {
  AuthProvider,
  ROLE_SETTLE_TIMEOUT_MS,
  SESSION_SETTLE_TIMEOUT_MS,
  useAuth,
} from "@/hooks/useAuth";

/** Klucz, pod którym klient Supabase trzyma sesję dla `placeholder.supabase.co`. */
const KLUCZ_SESJI = "sb-placeholder-auth-token";
const ALARM_SESJI = "sesja nie rozstrzygnęła się";
const ALARM_RÓL = "role i tenant nie wróciły";

const wisi = <T,>(): Promise<T> => new Promise<T>(() => {});

function sesja(uid: string) {
  return { user: { id: uid }, access_token: `tok-${uid}` };
}

function odroczona<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function Sonda() {
  const { session, roles, tenantId, loading, isStaff } = useAuth();
  return (
    <div>
      <span data-testid="uid">{session?.user?.id ?? "anon"}</span>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="roles">{roles.join(",")}</span>
      <span data-testid="tenant">{tenantId ?? "brak"}</span>
      <span data-testid="isStaff">{String(isStaff)}</span>
    </div>
  );
}

function renderuj(extra: ReactNode = null) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider>
        <Sonda />
        {extra}
      </AuthProvider>
    </QueryClientProvider>,
  );
}

const pole = (id: string): string => screen.getByTestId(id).textContent ?? "";

function alarmy(warn: { mock: { calls: unknown[][] } }, fraza: string): number {
  return warn.mock.calls.filter(([pierwszy]) => String(pierwszy).includes(fraza)).length;
}

async function przesuń(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  h.authCb = null;
  h.unsub.mockReset();
  h.sesja = null;
  h.role = new Map();
  h.profile = new Map();
  h.signOut.mockReset().mockResolvedValue({ error: null });
  h.rpc.mockReset().mockResolvedValue({ data: null, error: null });
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.localStorage.clear();
});

describe("sonda zapisanej sesji", () => {
  it("w ramce podglądu pusty magazyn nie jest dowodem gościa - czekamy na broker sesji", async () => {
    // Ramka pośrednika: `window.parent` to okno edytora, nie ta sama karta.
    vi.stubGlobal("parent", { nazwa: "okno edytora" });
    const broker = odroczona<WynikSesji>();
    h.sesja = broker.promise;

    renderuj();
    await act(async () => {});
    expect(pole("loading")).toBe("true");

    await act(async () => {
      broker.resolve({ data: { session: sesja("u-ramka") } });
    });
    await waitFor(() => expect(pole("loading")).toBe("false"));
    expect(pole("uid")).toBe("u-ramka");
  });

  it("zablokowany magazyn (tryb prywatny) to pewny gość - bez czekania na sieć", async () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("magazyn zablokowany", "SecurityError");
    });
    h.sesja = wisi<WynikSesji>();

    renderuj();
    await act(async () => {});

    // Bez `waitFor`: odpowiedź ma być w pierwszym przebiegu efektów, a nie po
    // terminie sesji (ten też zdjąłby `loading`, tylko 5 s później).
    expect(pole("loading")).toBe("false");
    expect(pole("uid")).toBe("anon");
    expect(h.signOut).not.toHaveBeenCalled();
  });

  it("bez window sonda nie czyta magazynu - zapisany token nie wstrzymuje gościa", async () => {
    // Ten sam zestaw co „sesja w magazynie + wiszący getSession()" w pliku
    // obok, gdzie `loading` trwa aż do terminu. Bez `window` odpowiedź ma być
    // natychmiastowa.
    window.localStorage.setItem(KLUCZ_SESJI, JSON.stringify({ access_token: "stary" }));
    h.sesja = wisi<WynikSesji>();

    let oknoSchowane = false;
    const prawdziweClearTimeout = globalThis.clearTimeout;
    vi.spyOn(globalThis, "clearTimeout").mockImplementation((uchwyt) => {
      if (oknoSchowane) {
        oknoSchowane = false;
        vi.unstubAllGlobals();
      }
      prawdziweClearTimeout(uchwyt);
    });
    function ChowaOkno() {
      useEffect(() => {
        oknoSchowane = true;
        vi.stubGlobal("window", undefined);
      }, []);
      return null;
    }

    renderuj(<ChowaOkno />);
    await act(async () => {});

    expect(typeof window).toBe("object");
    expect(oknoSchowane).toBe(false);
    expect(pole("loading")).toBe("false");
    expect(pole("uid")).toBe("anon");
    // Magazyn nietknięty - sonda go nie czytała i nikt go nie czyścił.
    expect(window.localStorage.getItem(KLUCZ_SESJI)).not.toBeNull();
    expect(h.signOut).not.toHaveBeenCalled();
  });
});

describe("role i tenant", () => {
  it("odmowa odczytu ról (data: null) daje najmniejsze uprawnienia, a sesja i tenant zostają", async () => {
    h.role.set(
      "u-rls",
      Promise.resolve({ data: null, error: { message: "permission denied for table user_roles" } }),
    );
    h.profile.set("u-rls", Promise.resolve({ data: { tenant_id: "t-rls" }, error: null }));

    renderuj();
    await waitFor(() => expect(pole("loading")).toBe("false"));
    await act(async () => {
      h.authCb!("SIGNED_IN", sesja("u-rls"));
    });

    await waitFor(() => expect(pole("tenant")).toBe("t-rls"));
    expect(pole("loading")).toBe("false");
    expect(pole("roles")).toBe("");
    expect(pole("isStaff")).toBe("false");
    expect(pole("uid")).toBe("u-rls");
  });
});

describe("terminy na sesję i role", () => {
  it("zmiana konta w trakcie wczytywania ról zaczyna termin od nowa", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.role.set("u-pierwsze", wisi<WynikRol>());
    h.role.set("u-drugie", wisi<WynikRol>());

    renderuj();
    await przesuń(1);
    expect(pole("loading")).toBe("false");

    act(() => {
      h.authCb!("SIGNED_IN", sesja("u-pierwsze"));
    });
    await przesuń(5_000);
    expect(pole("loading")).toBe("true");

    act(() => {
      h.authCb!("SIGNED_IN", sesja("u-drugie"));
    });
    // Termin PIERWSZEGO konta minąłby tutaj - widok drugiego konta nadal czeka
    // na jego role, bo termin liczy się od zmiany konta.
    await przesuń(ROLE_SETTLE_TIMEOUT_MS - 5_000 + 1);
    expect(pole("loading")).toBe("true");
    expect(alarmy(warn, ALARM_RÓL)).toBe(0);

    await przesuń(5_000);
    expect(pole("loading")).toBe("false");
    expect(pole("uid")).toBe("u-drugie");
    expect(alarmy(warn, ALARM_RÓL)).toBe(1);
  });

  it("odmontowanie w trakcie czekania na sesję gasi termin sesji i odpina nasłuch", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    window.localStorage.setItem(KLUCZ_SESJI, JSON.stringify({ access_token: "stary" }));
    h.sesja = wisi<WynikSesji>();

    const { unmount } = renderuj();
    expect(pole("loading")).toBe("true");

    unmount();
    expect(h.unsub).toHaveBeenCalledTimes(1);

    await przesuń(SESSION_SETTLE_TIMEOUT_MS * 2);
    expect(alarmy(warn, ALARM_SESJI)).toBe(0);
  });

  it("odmontowanie w trakcie wczytywania ról gasi termin ról - brak alarmu po odmontowaniu", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.role.set("u-wisi", wisi<WynikRol>());

    const { unmount } = renderuj();
    await przesuń(1);
    act(() => {
      h.authCb!("SIGNED_IN", sesja("u-wisi"));
    });
    await przesuń(1);
    expect(pole("loading")).toBe("true");

    unmount();
    await przesuń(ROLE_SETTLE_TIMEOUT_MS * 2);
    expect(alarmy(warn, ALARM_RÓL)).toBe(0);
  });

  it("termin sesji, który odpalił mimo odpowiedzi (zegar nie anulował), nie podnosi fałszywego alarmu", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Zegar, który nie anuluje: uchwyt z innej implementacji timerów (np.
    // podmiana zegara między ustawieniem a skasowaniem) - termin zostaje.
    const clear = vi.spyOn(globalThis, "clearTimeout").mockImplementation(() => {});
    try {
      renderuj();
      await przesuń(0);
      expect(pole("loading")).toBe("false");
      expect(pole("uid")).toBe("anon");
      // Odpowiedź przyszła (pusty magazyn + `getSession()`), a termin wciąż czeka.
      expect(clear).toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(1);

      await przesuń(SESSION_SETTLE_TIMEOUT_MS);

      expect(vi.getTimerCount()).toBe(0);
      expect(alarmy(warn, ALARM_SESJI)).toBe(0);
      expect(pole("loading")).toBe("false");
      expect(pole("uid")).toBe("anon");
    } finally {
      // Kolejność ma znaczenie: najpierw zdjąć szpiega z atrapy zegara, potem
      // przywrócić prawdziwy zegar - inaczej atrapa wróciłaby na `globalThis`.
      clear.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe("useAuth poza AuthProvider", () => {
  it("kontekst domyślny mówi „nie wiemy”, a signOut() niczego nie robi", async () => {
    const oryginalnaLokalizacja = window.location;
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { ...window.location, assign },
    });
    const przechwycone: { signOut: (() => Promise<void>) | null } = { signOut: null };
    function Przechwyt() {
      przechwycone.signOut = useAuth().signOut;
      return null;
    }
    try {
      render(
        <>
          <Sonda />
          <Przechwyt />
        </>,
      );

      expect(pole("loading")).toBe("true");
      expect(pole("uid")).toBe("anon");
      expect(pole("roles")).toBe("");
      expect(pole("tenant")).toBe("brak");
      expect(pole("isStaff")).toBe("false");

      const wyloguj = przechwycone.signOut;
      if (wyloguj === null) throw new Error("Przechwyt nie dostał signOut z kontekstu");
      await expect(wyloguj()).resolves.toBeUndefined();
      expect(h.signOut).not.toHaveBeenCalled();
      expect(assign).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        writable: true,
        value: oryginalnaLokalizacja,
      });
    }
  });
});
