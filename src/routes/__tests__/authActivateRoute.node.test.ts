// @vitest-environment node
//
// Trasa `/auth/activate` - adres linku aktywacyjnego NA NASZEJ domenie, który
// przekazuje token jednorazowy do weryfikacji dostawcy tożsamości. To drugie
// wejście magic linka (zaproszenia z panelu, `invitations.functions.ts`)
// i do 2026-10-01 stało na 0% razem z `/auth/callback`.
//
// Trzy klasy błędów, których pilnuje ten plik:
//   * PRZEPUSZCZENIE: token spoza bezpiecznego alfabetu albo typ spoza listy
//     zamkniętej doklejony do adresu dostawcy - trasa jest publiczna, więc
//     każdy może jej podać dowolny ciąg,
//   * ZŁY CEL ODMOWY: do 2026-10-01 odmowa szła na `/auth?error=...`, a trasy
//     `/auth` nie ma - odbiorca przyciętego linku dostawał 404,
//   * ZŁY POWRÓT: `redirect_to` musi wskazywać `/auth/callback` na naszej
//     domenie, inaczej sesja ląduje na stronie, która jej nie odbierze.
//
// Środowisko `node`: przedmiotem dowodu jest `Response` i nagłówki odpowiedzi,
// a te mają być dokładnie takie, jak w runtime serwera, nie w happy-dom.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routeServerHandlers } from "@/test/routeHarness";
import { Route } from "@/routes/auth.activate";

const SUPABASE_URL = "https://ref.supabase.co";
const APP = "https://neweuropeanstrategies.com";
/** Token o długości ze środka dozwolonego zakresu, z pełnym alfabetem URL-safe. */
const TOKEN = "Abc_def-0123456789xyz";

async function activate(query: string): Promise<Response> {
  const { GET } = routeServerHandlers(Route);
  return GET({ request: new Request(`${APP}/auth/activate${query}`) });
}

/** Adres z nagłówka `Location` - twardy błąd, gdy go nie ma. */
function location(res: Response): URL {
  const value = res.headers.get("location");
  if (!value) throw new Error("test: odpowiedź bez nagłówka Location");
  return new URL(value);
}

beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", SUPABASE_URL);
  vi.stubEnv("PUBLIC_APP_URL", APP);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("/auth/activate - poprawny link", () => {
  it("przekazuje token 302 do weryfikacji dostawcy z powrotem na /auth/callback", async () => {
    const res = await activate(`?token=${TOKEN}&type=invite`);

    expect(res.status).toBe(302);
    const target = location(res);
    expect(target.origin).toBe(SUPABASE_URL);
    expect(target.pathname).toBe("/auth/v1/verify");
    expect(target.searchParams.get("token")).toBe(TOKEN);
    expect(target.searchParams.get("type")).toBe("invite");
    expect(target.searchParams.get("redirect_to")).toBe(`${APP}/auth/callback`);
  });

  it("zakazuje cache'owania przekierowania - token jest jednorazowy", async () => {
    const res = await activate(`?token=${TOKEN}&type=invite`);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("bez parametru `type` przyjmuje `invite` (tak buduje link panel zaproszeń)", async () => {
    const target = location(await activate(`?token=${TOKEN}`));
    expect(target.pathname).toBe("/auth/v1/verify");
    expect(target.searchParams.get("type")).toBe("invite");
  });

  it.each(["invite", "magiclink", "signup", "recovery", "email_change"])(
    "przepuszcza typ z listy zamkniętej: %s",
    async (type) => {
      const target = location(await activate(`?token=${TOKEN}&type=${type}`));
      expect(target.pathname).toBe("/auth/v1/verify");
      expect(target.searchParams.get("type")).toBe(type);
    },
  );

  it("przyjmuje token na obu granicach długości (16 i 512 znaków)", async () => {
    for (const token of ["a".repeat(16), "b".repeat(512)]) {
      const target = location(await activate(`?token=${token}&type=invite`));
      expect(target.pathname).toBe("/auth/v1/verify");
      expect(target.searchParams.get("token")).toBe(token);
    }
  });
});

describe("/auth/activate - odmowa ląduje na istniejącej stronie z kodem błędu", () => {
  it.each([
    ["brak tokenu", ""],
    ["pusty token", "?token="],
    ["token za krótki (15)", `?token=${"a".repeat(15)}`],
    ["token za długi (513)", `?token=${"a".repeat(513)}`],
    ["znak spoza alfabetu URL-safe", `?token=${TOKEN}.evil`],
    [
      "próba doklejenia parametru do adresu dostawcy",
      `?token=${encodeURIComponent(`${TOKEN}&type=recovery`)}`,
    ],
    ["typ spoza listy", `?token=${TOKEN}&type=admin`],
    ["pusty typ", `?token=${TOKEN}&type=`],
  ])("%s -> /auth/callback?error=invalid_link", async (_label, query) => {
    const res = await activate(query);

    expect(res.status).toBe(302);
    const target = location(res);
    // Regresja 2026-10-01: wcześniej `/auth`, którego w aplikacji nie ma (404).
    expect(target.origin).toBe(APP);
    expect(target.pathname).toBe("/auth/callback");
    expect(target.searchParams.get("error")).toBe("invalid_link");
    // Odmowa nie może nieść tokenu dalej - ani do nas, ani do dostawcy.
    expect(target.searchParams.has("token")).toBe(false);
  });

  it("bez SUPABASE_URL zgłasza błąd konfiguracji i kieruje na activation_unavailable", async () => {
    vi.stubEnv("SUPABASE_URL", undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await activate(`?token=${TOKEN}&type=invite`);

    expect(res.status).toBe(302);
    const target = location(res);
    expect(target.origin).toBe(APP);
    expect(target.pathname).toBe("/auth/callback");
    expect(target.searchParams.get("error")).toBe("activation_unavailable");
    expect(error).toHaveBeenCalledWith("[auth-activate] SUPABASE_URL not configured");
  });

  it("walidacja tokenu wyprzedza sprawdzenie konfiguracji (śmieci nie logują błędu serwera)", async () => {
    vi.stubEnv("SUPABASE_URL", undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const target = location(await activate("?token=short"));

    expect(target.searchParams.get("error")).toBe("invalid_link");
    expect(error).not.toHaveBeenCalled();
  });
});

describe("/auth/activate - domena aplikacji", () => {
  it("bez PUBLIC_APP_URL używa domeny produkcyjnej", async () => {
    vi.stubEnv("PUBLIC_APP_URL", undefined);

    const ok = location(await activate(`?token=${TOKEN}`));
    expect(ok.searchParams.get("redirect_to")).toBe(
      "https://neweuropeanstrategies.com/auth/callback",
    );

    const denied = location(await activate("?token=x"));
    expect(denied.origin).toBe("https://neweuropeanstrategies.com");
    expect(denied.pathname).toBe("/auth/callback");
  });

  it("PUBLIC_APP_URL z końcowym ukośnikiem nie daje podwójnego `//` w adresach", async () => {
    vi.stubEnv("PUBLIC_APP_URL", "https://staging.example.org/");

    const ok = location(await activate(`?token=${TOKEN}`));
    expect(ok.searchParams.get("redirect_to")).toBe("https://staging.example.org/auth/callback");

    const denied = location(await activate("?token=x"));
    expect(denied.toString()).toBe("https://staging.example.org/auth/callback?error=invalid_link");
  });
});
