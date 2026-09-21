// Ingest telemetrii błędów przeglądarki: POST /api/public/client-errors.
//
// PO CO. Publiczna, niepodpisana ścieżka zapisu: przeglądarka beaconuje tu
// nieprzechwycone wyjątki, odrzucone obietnice i przechwyty granic błędów
// Reacta (`src/lib/observability/report.ts`), a endpoint wstawia wiersz
// klientem service_role. Do wydania 8 audytu stał na 0/26 linii.
//
// Ten endpoint ma JEDNO ryzyko więcej niż pozostałe trzy: przyjmuje TREŚĆ
// BŁĘDU. Komunikaty i stosy rutynowo niosą adresy e-mail wpisane w formularz,
// tokeny z query stringa i nagłówki `Authorization` zalogowane przez wrapper
// fetcha. Bez `redactPii`/`redactUrl`/`redactMeta` tabela obserwowalności
// staje się wtórnym magazynem danych osobowych i sekretów - dlatego rozdział
// "RODO" niżej sprawdza NIEOBECNOŚĆ oryginału, a nie samo to, że coś wróciło.
//
// Reszta kontraktu jak w każdym beaconie: walidacja, limiter, 204 na KAŻDEJ
// ścieżce (wzorzec: `-popup-event.test.ts`).
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  insert: vi.fn(),
  tenantId: "tenant-1" as string | null,
  tenantThrows: false,
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: () => ({ insert: h.insert }) },
}));
vi.mock("@/lib/server/tenant.server", () => ({
  resolveTenantIdForHost: async () => {
    if (h.tenantThrows) throw new Error("brak katalogu tenantów");
    return h.tenantId;
  },
}));
vi.mock("@/lib/http/requestHost", () => ({
  currentTenantHost: async () => "redakcja.example.test",
}));

const req = vi.hoisted(() => ({ current: null as Request | null }));
vi.mock("@tanstack/react-start/server", () => ({ getRequest: () => req.current }));

import { routeServerHandlers } from "@/test/routeHarness";
import { Route } from "@/routes/api/public/client-errors";

const handler = routeServerHandlers(Route).POST!;

let ipCounter = 0;
function uniqueIp(): string {
  ipCounter += 1;
  return `10.3.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
}

async function post(body: unknown, raw?: string) {
  req.current = new Request("https://redakcja.example.test/api/public/client-errors", {
    method: "POST",
    headers: { "x-forwarded-for": uniqueIp() },
    body: raw ?? JSON.stringify(body),
  });
  return handler({ request: req.current });
}

/** Skrót: prawidłowy raport błędu z nadpisanymi polami. */
async function postError(patch: Record<string, unknown> = {}) {
  return post({ message: "TypeError: x is not a function", source: "onerror", ...patch });
}

function row(): Record<string, unknown> {
  return (h.insert.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  h.insert.mockReset();
  h.insert.mockResolvedValue({ error: null });
  h.tenantId = "tenant-1";
  h.tenantThrows = false;
});

// ---------------------------------------------------------------------------
describe("zapis raportu", () => {
  it("prawidłowy raport zapisuje wiersz z tenantem", async () => {
    const res = await postError({
      stack: "at foo (/app/main.js:1:1)",
      url: "/wpis/x",
      meta: { boundary: "PostBody" },
    });

    expect(res.status).toBe(204);
    expect(row()).toMatchObject({
      message: "TypeError: x is not a function",
      stack: "at foo (/app/main.js:1:1)",
      source: "onerror",
      path: "/wpis/x",
      meta: { boundary: "PostBody" },
      tenant_id: "tenant-1",
    });
  });

  it("wszystkie trzy ŹRÓDŁA z kontraktu report.ts są przyjmowane", async () => {
    for (const source of ["onerror", "unhandledrejection", "react_error_boundary"]) {
      h.insert.mockClear();
      await postError({ source });
      expect(row()).toMatchObject({ source });
    }
  });

  it("`path` jest czytane z `url`, a gdy go brak - z `path`", async () => {
    await postError({ path: "/z-pola-path" });
    expect(row()).toMatchObject({ path: "/z-pola-path" });

    h.insert.mockClear();
    await postError({ url: "/z-pola-url", path: "/z-pola-path" });
    expect(row()).toMatchObject({ path: "/z-pola-url" });
  });

  it("BRAK tenanta zostawia kolumnę pustą - domyślna wartość kolumny wchodzi w grę", async () => {
    h.tenantId = null;

    await postError();

    expect(Object.keys(row())).not.toContain("tenant_id");
    expect(h.insert).toHaveBeenCalledTimes(1);
  });

  it("AWARIA rozwiązania tenanta nie blokuje zapisu", async () => {
    h.tenantThrows = true;

    const res = await postError();

    expect(res.status).toBe(204);
    expect(h.insert).toHaveBeenCalled();
  });

  it("odpowiedź NIE JEST cachowana", async () => {
    const res = await postError();

    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.status).toBe(204);
  });

  it("przyjmuje ciało wysłane jako BLOB `application/json` - tak beaconuje report.ts", async () => {
    // `sendBeaconPayload` pakuje ładunek w Blob; endpoint czyta `req.text()`,
    // więc musi obsłużyć oba kształty ciała. Bez tego ujednolicenie transportu
    // beaconów (N3) zabiłoby ingest błędów.
    req.current = new Request("https://redakcja.example.test/api/public/client-errors", {
      method: "POST",
      headers: { "x-forwarded-for": uniqueIp() },
      body: new Blob([JSON.stringify({ message: "z bloba", source: "onerror" })], {
        type: "application/json",
      }),
    });

    const res = await handler({ request: req.current });

    expect(res.status).toBe(204);
    expect(row()).toMatchObject({ message: "z bloba" });
  });
});

// ---------------------------------------------------------------------------
describe("walidacja wejścia", () => {
  it("raport BEZ komunikatu jest odrzucany - komunikat to minimum sygnału", async () => {
    const res = await post({ source: "onerror", stack: "at foo" });

    expect(res.status).toBe(204);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("PUSTY komunikat jest odrzucany", async () => {
    await post({ message: "", source: "onerror" });

    expect(h.insert).not.toHaveBeenCalled();
  });

  it("komunikat innego typu niż napis jest odrzucany", async () => {
    await post({ message: { toString: "nope" }, source: "onerror" });

    expect(h.insert).not.toHaveBeenCalled();
  });

  it("ŹRÓDŁO spoza trzech dozwolonych jest zerowane, ale raport zostaje", async () => {
    // Nieznane źródło rozsypałoby grupowanie w panelu; sam błąd jest zbyt
    // cenny, żeby go z tego powodu wyrzucić.
    await postError({ source: "cokolwiek" });

    expect(row()).toMatchObject({ source: null, message: "TypeError: x is not a function" });
  });

  it("komunikat i stos są PRZYCINANE do limitów kolumn", async () => {
    // Krótkie słowa ze spacjami: długi ciąg alfanumeryczny wpadłby pod regułę
    // redakcji nieprzejrzystych blobów i test mierzyłby co innego.
    await postError({ message: "blad ".repeat(600), stack: "at f ".repeat(2_000) });

    expect((row().message as string).length).toBe(2_000);
    expect((row().stack as string).length).toBe(8_000);
  });

  it("ciało ponad 16 000 znaków jest odrzucane BEZ parsowania", async () => {
    const raw = JSON.stringify({ message: "x", source: "onerror", stack: "y".repeat(20_000) });
    expect(raw.length).toBeGreaterThan(16_000);

    const res = await post(null, raw);

    expect(res.status).toBe(204);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("META ponad 4 000 znaków jest pomijana, a sam błąd zapisany", async () => {
    await postError({ meta: { componentStack: "c".repeat(5_000) } });

    expect(row()).toMatchObject({ meta: null });
    expect(h.insert).toHaveBeenCalledTimes(1);
  });

  it("META niebędąca obiektem (tablica/napis) jest pomijana", async () => {
    await postError({ meta: ["a", "b"] });
    expect(row()).toMatchObject({ meta: null });

    h.insert.mockClear();
    await postError({ meta: "boundary" });
    expect(row()).toMatchObject({ meta: null });
  });

  it("PUSTE body nie wywala endpointu", async () => {
    const res = await post(null, "");

    expect(res.status).toBe(204);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("body, które nie jest JSON-em, nie wywala endpointu", async () => {
    const res = await post(null, "<html>502 Bad Gateway</html>");

    expect(res.status).toBe(204);
    expect(h.insert).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe("bramka szumu - druga linia obrony, po stronie serwera", () => {
  // Klient odsiewa szum u ŹRÓDŁA (`src/lib/observability/report.ts`), ale ta
  // bramka jest jedyną, która dosięga bundli zacache'owanych sprzed tamtej
  // zmiany - a to one wypełniły panel `/admin/performance?tab=errors` w 82%.
  // Gdyby przestała działać, panel znów przestałby pokazywać awarie: prawdziwy
  // błąd tonie w tysiącach wpisów o anulowanych żądaniach.

  it("ARTEFAKT UKŁADU (ResizeObserver loop) NIE zakłada wiersza", async () => {
    // Specyfikacja każe przeglądarce zgłosić to jako błąd okna, choć nic się
    // nie zepsuło - wpis nie niesie żadnej diagnostyki.
    const res = await postError({
      message: "ResizeObserver loop completed with undelivered notifications.",
    });

    expect(res.status).toBe(204);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("ANULOWANE ŻĄDANIE nie zakłada wiersza - to zachowanie ZAMIERZONE, nie awaria", async () => {
    // Każdy `AbortController` sprzątany przy odmontowaniu komponentu i każda
    // przerwana nawigacja produkują dokładnie te komunikaty.
    for (const message of [
      "AbortError: signal is aborted without reason",
      "The user aborted a request.",
    ]) {
      h.insert.mockClear();

      const res = await postError({ message, source: "unhandledrejection" });

      expect(res.status, message).toBe(204);
      expect(h.insert, message).not.toHaveBeenCalled();
    }
  });

  it('PREFIKS `[boot]` jest zdejmowany PRZED bramką - „[boot] undefined" też jest szumem', async () => {
    // Sonda bootu serializuje brak komunikatu jako „[boot] undefined". Bez
    // zdjęcia prefiksu filtr oglądałby napis z prefiksem, nie samo
    // „undefined", i przepuszczałby wpis mówiący wyłącznie tyle, że coś się
    // stało - czyli dokładnie tę klasę, którą bramka ma zatrzymać.
    await postError({ message: "[boot] undefined" });
    expect(h.insert).not.toHaveBeenCalled();

    h.insert.mockClear();
    await postError({ message: "[object Object]" });
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("bramka jest WĄSKA - prawdziwa awaria sieci nadal wchodzi do tabeli", async () => {
    // Gdyby filtr łapał samo słowo „fetch" albo „abort", wyciszyłby klasę
    // błędów, dla której ten endpoint w ogóle istnieje.
    await postError({ message: "TypeError: Failed to fetch" });

    expect(row()).toMatchObject({ message: "TypeError: Failed to fetch" });
  });
});

// ---------------------------------------------------------------------------
describe("RODO: dane osobowe i sekrety nie mogą wejść do tabeli", () => {
  it("ADRES E-MAIL z komunikatu NIE trafia do kolumny", async () => {
    await postError({ message: "Nie znaleziono konta jan.kowalski@example.com" });

    const message = row().message as string;
    expect(message).not.toContain("jan.kowalski@example.com");
    expect(message).not.toContain("@");
    expect(message).toContain("[redacted-email]");
  });

  it("TOKEN JWT ze stosu NIE trafia do kolumny", async () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJlLXRlc3Rvd2E";
    await postError({ stack: `at fetch (Authorization: Bearer ${jwt})` });

    const stack = row().stack as string;
    expect(stack).not.toContain(jwt);
    expect(stack).not.toContain("eyJ");
  });

  it("QUERY STRING z adresu NIE trafia do kolumny", async () => {
    await postError({ url: "/reset?token=abcdef0123456789abcdef01&email=jan@example.org" });

    const path = row().path as string;
    expect(path).not.toContain("abcdef0123456789abcdef01");
    expect(path).not.toContain("jan@example.org");
    expect(path.startsWith("/reset")).toBe(true);
  });

  it("META jest SKRUBOWANA GŁĘBOKO - e-mail w zagnieżdżonym polu też znika", async () => {
    await postError({
      meta: { boundary: "Form", detail: { hint: "zapisano jan.kowalski@example.com" } },
    });

    const serialized = JSON.stringify(row().meta);
    expect(serialized).not.toContain("jan.kowalski@example.com");
    expect(serialized).toContain("[redacted-email]");
    // Struktura przeżywa skrubowanie - panel nadal grupuje po `boundary`.
    expect(row().meta).toMatchObject({ boundary: "Form" });
  });

  it("ADRES IP wpisany w komunikat NIE trafia do kolumny", async () => {
    await postError({ message: "Połączenie z 192.168.13.240 odrzucone" });

    const message = row().message as string;
    expect(message).not.toContain("192.168.13.240");
    expect(message).toContain("[redacted-ip]");
  });
});

// ---------------------------------------------------------------------------
describe("odporność", () => {
  it("AWARIA zapisu nadal oddaje 204", async () => {
    h.insert.mockRejectedValue(new Error("baza padla"));

    const res = await postError();

    expect(res.status).toBe(204);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("LIMITER (30 żetonów, 0,5/s) wycisza zalew z jednego adresu, nie zwracając błędu", async () => {
    // Strona, która eksploduje w pętli renderu, potrafi wygenerować setki
    // raportów na sekundę - limiter jest jedyną zaporą przed zalaniem tabeli.
    const statuses: number[] = [];
    for (let i = 0; i < 45; i += 1) {
      req.current = new Request("https://redakcja.example.test/api/public/client-errors", {
        method: "POST",
        headers: { "x-forwarded-for": "10.7.7.7" },
        body: JSON.stringify({ message: `blad ${i}`, source: "onerror" }),
      });
      statuses.push((await handler({ request: req.current })).status);
    }

    expect(new Set(statuses)).toEqual(new Set([204]));
    expect(h.insert.mock.calls.length).toBeLessThan(45);
  });
});
