// Dwie trasy podglądu szablonów PO bramce autoryzacji.
//
// PODZIAŁ Z SĄSIADEM: `-preview-secrets.test.ts` pilnuje SAMEJ bramki
// (porównanie sekretu w stałym czasie). Tutaj zaczynamy tam, gdzie tamten
// kończy: co te trasy robią z ładunkiem, gdy wołający jest już wpuszczony.
//
// DLACZEGO TO MA ZNACZENIE. Podgląd jest jedynym miejscem, w którym człowiek
// widzi treść maila PRZED wysyłką - a maila nie da się wycofać. Trzy zachowania
// decydują, czy podgląd mówi prawdę:
//   * szablon bez danych przykładowych musi być OZNACZONY jako taki, a nie
//     pokazany jako pusty „gotowy" - inaczej redaktor zatwierdza pustą treść;
//   * błąd renderu JEDNEGO szablonu nie może zabrać całej listy - inaczej jedna
//     zepsuta pozycja gasi podgląd wszystkich pozostałych;
//   * język wybrany trzema różnymi drogami (`?lang`, pole ciała, sufiks
//     `signup:en`) musi dać ten sam wynik, bo panel Cloud używa każdej z nich.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const API_KEY = "sekret-api-key-lovable-0123456789";

const h = vi.hoisted(() => ({
  /** Kolejne odpowiedzi silnika renderu: HTML, błąd albo wartość nie-Error do rzucenia. */
  renderResults: [] as Array<string | Error | { throwValue: unknown }>,
  renderCalls: 0,
  templates: {} as Record<string, unknown>,
}));

vi.mock("@/lib/server/jobsTick.server", () => ({
  secretsEqual: async (a: string, b: string) => a === b,
}));
// Trasy nie dadzą się zaimportować z prawdziwym routerem (kontekst żądania
// frameworka); interesuje nas wyłącznie ciało handlera.
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}));
vi.mock("@react-email/render", () => ({
  render: async () => {
    const next = h.renderResults[h.renderCalls] ?? "<html>podglad</html>";
    h.renderCalls += 1;
    if (next instanceof Error) throw next;
    if (typeof next === "object") throw next.throwValue;
    return next;
  },
}));
vi.mock("@/lib/email-templates/registry", () => ({
  get TEMPLATES() {
    return h.templates;
  },
}));

import { routeServerHandlers } from "@/test/routeHarness";
import { Route as TxPreviewRoute } from "@/routes/platform/email/transactional/preview";
import { Route as AuthPreviewRoute } from "@/routes/platform/email/auth/preview";

/** Odpowiedź trasy podglądu transakcyjnego dla podanego rejestru szablonów. */
async function txPreview(templates: Record<string, unknown>): Promise<Response> {
  h.templates = templates;
  return routeServerHandlers(TxPreviewRoute).POST({
    request: new Request("https://example.test/platform/email/transactional/preview", {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}` },
      body: "{}",
    }),
  });
}

/** Odpowiedź trasy podglądu maili autoryzacyjnych. */
function authPreview(body: unknown, query = ""): Promise<Response> {
  return routeServerHandlers(AuthPreviewRoute).POST({
    request: new Request(`https://example.test/platform/email/auth/preview${query}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}` },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  });
}

let errorSpy: ReturnType<typeof vi.spyOn>;
let savedKey: string | undefined;

beforeEach(() => {
  savedKey = process.env.LOVABLE_API_KEY;
  process.env.LOVABLE_API_KEY = API_KEY;
  h.renderResults = [];
  h.renderCalls = 0;
  h.templates = {};
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.LOVABLE_API_KEY;
  else process.env.LOVABLE_API_KEY = savedKey;
  errorSpy.mockRestore();
});

/** Wpis rejestru w kształcie, jaki czyta trasa podglądu. */
interface PreviewTemplate {
  templateName: string;
  displayName: string;
  subject: string;
  html: string;
  status: string;
  errorMessage?: string;
}

async function templatesOf(res: Response): Promise<PreviewTemplate[]> {
  const body = (await res.json()) as { templates: PreviewTemplate[] };
  return body.templates;
}

describe("podgląd transakcyjny - stan każdego szablonu", () => {
  it("szablon BEZ danych przykładowych jest oznaczony, a nie pokazany jako pusty gotowy", () => {
    // „Gotowy" z pustym HTML-em to podgląd, który kłamie: redaktor zatwierdza
    // wiadomość, której nigdy nie zobaczył.
    return txPreview({
      "bez-danych": { component: () => null, subject: "Temat", displayName: "Bez danych" },
    })
      .then(templatesOf)
      .then((lista) => {
        expect(lista).toHaveLength(1);
        expect(lista[0].status).toBe("preview_data_required");
        expect(lista[0].html).toBe("");
        expect(h.renderCalls).toBe(0);
      });
  });

  it("szablon z danymi renderuje się i wraca jako gotowy", async () => {
    h.renderResults = ["<html>tresc</html>"];

    const lista = await templatesOf(
      await txPreview({
        gotowy: {
          component: () => null,
          subject: "Temat stały",
          displayName: "Gotowy",
          previewData: { a: 1 },
        },
      }),
    );

    expect(lista[0]).toMatchObject({
      templateName: "gotowy",
      displayName: "Gotowy",
      subject: "Temat stały",
      html: "<html>tresc</html>",
      status: "ready",
    });
  });

  it("temat podany FUNKCJĄ jest wyliczany z danych przykładowych", async () => {
    // Część szablonów składa temat z danych zdarzenia. Gdyby trasa wstawiła tu
    // samą funkcję, panel pokazałby „function (data)" jako temat maila.
    h.renderResults = ["<html>x</html>"];

    const lista = await templatesOf(
      await txPreview({
        dynamiczny: {
          component: () => null,
          subject: (data: { plan: string }) => `Plan ${data.plan}`,
          displayName: "Dynamiczny",
          previewData: { plan: "Pro" },
        },
      }),
    );

    expect(lista[0].subject).toBe("Plan Pro");
  });

  it("brak nazwy wyświetlanej schodzi na klucz rejestru, a nie zostawia pustki", async () => {
    h.renderResults = ["<html>x</html>"];

    const lista = await templatesOf(
      await txPreview({
        "klucz-rejestru": { component: () => null, subject: "T", previewData: {} },
      }),
    );

    expect(lista[0].displayName).toBe("klucz-rejestru");
  });

  it("BŁĄD renderu jednego szablonu nie zabiera listy pozostałym", async () => {
    // Jedna zepsuta pozycja gasiłaby podgląd wszystkich - a wtedy nikt nie
    // sprawdzi treści przed wysyłką żadnego z maili.
    h.renderResults = [new Error("brakuje propsa `amount`"), "<html>ok</html>"];

    const lista = await templatesOf(
      await txPreview({
        zepsuty: { component: () => null, subject: "A", previewData: {} },
        dobry: { component: () => null, subject: "B", previewData: {} },
      }),
    );

    expect(lista.map((t) => t.status)).toEqual(["render_failed", "ready"]);
    expect(lista[0].errorMessage).toBe("brakuje propsa `amount`");
    expect(errorSpy).toHaveBeenCalled();
  });

  it("wyjątek, który nie jest `Error`, też trafia do komunikatu jako tekst", async () => {
    // Silnik renderu potrafi rzucić samym napisem - wtedy `err.message` nie
    // istnieje, a pusty komunikat nie mówi operatorowi nic o przyczynie.
    h.renderResults = [{ throwValue: "szablon nie istnieje" }];

    const lista = await templatesOf(
      await txPreview({ zepsuty: { component: () => null, subject: "A", previewData: {} } }),
    );

    expect(lista[0].status).toBe("render_failed");
    expect(lista[0].errorMessage).toBe("szablon nie istnieje");
  });

  it("pusty rejestr daje pustą listę, a nie błąd", async () => {
    const lista = await templatesOf(await txPreview({}));

    expect(lista).toEqual([]);
  });
});

describe("podgląd maili autoryzacyjnych - wybór typu i języka", () => {
  it("ciało niebędące poprawnym JSON-em kończy się 400, nie awarią", async () => {
    const res = await authPreview("{to nie jest json");

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Invalid JSON in request body" });
  });

  it("nieznany typ maila kończy się 400 z nazwą typu w komunikacie", async () => {
    const res = await authPreview({ type: "nie-ma-takiego" });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Unknown email type: nie-ma-takiego" });
  });

  it("domyślnym językiem podglądu jest polski", async () => {
    const res = await authPreview({ type: "recovery" });

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Email-Lang")).toBe("pl");
  });

  it.each([
    ["pole `lang` w ciele", { type: "recovery", lang: "en" }, ""],
    ["parametr adresu `?lang=en`", { type: "recovery" }, "?lang=en"],
    ["sufiks typu `recovery:en`", { type: "recovery:en" }, ""],
  ])("angielski wybrany przez %s daje ten sam wynik", async (_n, body, query) => {
    // Panel Cloud używa każdej z trzech dróg. Rozjazd między nimi to podgląd
    // w innym języku niż mail, który naprawdę wyjdzie.
    const res = await authPreview(body, query);

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Email-Lang")).toBe("en");
  });

  it("sufiks języka jest ODCINANY od typu - inaczej `recovery:en` byłby nieznanym typem", async () => {
    const res = await authPreview({ type: "recovery:en" });

    expect(res.status).toBe(200);
  });

  it("wartość języka spoza `en*` zostaje przy polskim", async () => {
    const res = await authPreview({ type: "recovery", lang: "de" });

    expect(res.headers.get("X-Email-Lang")).toBe("pl");
  });

  it("pole `lang` niebędące napisem nie wywraca żądania", async () => {
    const res = await authPreview({ type: "recovery", lang: 7 });

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Email-Lang")).toBe("pl");
  });

  it("odpowiedź niesie temat zakodowany w nagłówku i nadawcę z domeny serwisu", async () => {
    // Temat idzie nagłówkiem, więc znaki diakrytyczne MUSZĄ być zakodowane -
    // surowy nagłówek z polskimi znakami jest niepoprawny w HTTP/1.1.
    const res = await authPreview({ type: "recovery" });

    const subject = res.headers.get("X-Email-Subject") ?? "";
    expect(subject.length).toBeGreaterThan(0);
    expect(decodeURIComponent(subject)).not.toBe("");
    expect(res.headers.get("X-Email-From")).toMatch(/<noreply@/);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
  });
});
