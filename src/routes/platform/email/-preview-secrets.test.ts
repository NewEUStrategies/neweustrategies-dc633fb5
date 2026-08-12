// Bramka defektu K9 (audyt 12.08, moduł Poczta): obie trasy podglądu szablonów
// porównywały sekret LOVABLE_API_KEY operatorem `!==` (auth/preview dodatkowo
// porównywało CAŁY nagłówek z prefiksem `Bearer`, czyli sekret ze stringiem
// zawierającym sekret). Repo ma na to jeden standard - `secretsEqual`
// (timingSafeEqual) z `lib/server/jobsTick.server`, ten sam co /api/public/jobs-tick.
//
// DWIE WARSTWY, BO CZASU PORÓWNANIA NIE DA SIĘ ZMIERZYĆ W TEŚCIE JEDNOSTKOWYM:
//
//   1. ZACHOWANIE (runtime). Bramka autoryzacji nadal odrzuca zły sekret i
//      przepuszcza dobry, a do porównania idzie GOŁY token (bez `Bearer `) -
//      sekret przeciw sekretowi. Fałszywy `secretsEqual` zapisuje argumenty.
//   2. UŻYCIE HELPERA (statycznie, z treści źródła). Test zachowania przejdzie
//      też dla `token === apiKey`, więc powrót do porównania operatorem łapiemy
//      na źródle: helper musi być zaimportowany i wywołany.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const API_KEY = "sekret-api-key-lovable-0123456789";

const secrets = vi.hoisted(() => ({ calls: [] as Array<[string, string]> }));

vi.mock("@/lib/server/jobsTick.server", () => ({
  secretsEqual: async (a: string, b: string) => {
    secrets.calls.push([a, b]);
    return a.length === b.length && a === b;
  },
}));

// Trasy nie dadzą się zaimportować z prawdziwym routerem i silnikiem react-email
// (kontekst żądania frameworka, renderowanie szablonów) - tu liczy się wyłącznie
// bramka autoryzacji przed nimi.
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}));
vi.mock("@react-email/render", () => ({ render: async () => "<html>podglad</html>" }));
vi.mock("@/lib/email-templates/registry", () => ({
  TEMPLATES: {
    "free-rsvp-pl": { component: () => null, subject: "Temat", previewData: { a: 1 } },
  },
}));
vi.mock("@/lib/email-templates/signup", () => ({ SignupEmail: () => null }));
vi.mock("@/lib/email-templates/invite", () => ({ InviteEmail: () => null }));
vi.mock("@/lib/email-templates/magic-link", () => ({ MagicLinkEmail: () => null }));
vi.mock("@/lib/email-templates/recovery", () => ({ RecoveryEmail: () => null }));
vi.mock("@/lib/email-templates/email-change", () => ({ EmailChangeEmail: () => null }));
vi.mock("@/lib/email-templates/reauthentication", () => ({ ReauthenticationEmail: () => null }));

type PostHandler = (ctx: { request: Request }) => Promise<Response>;

async function postHandler(module: "auth" | "transactional"): Promise<PostHandler> {
  const mod =
    module === "auth" ? await import("./auth/preview") : await import("./transactional/preview");
  const options = (mod.Route as { options?: { server?: { handlers?: { POST?: PostHandler } } } })
    .options;
  const handler = options?.server?.handlers?.POST;
  if (!handler) throw new Error(`trasa podglądu ${module} nie rejestruje handlera POST`);
  return handler;
}

function previewRequest(authorization: string | null): Request {
  return new Request("https://nes.test/platform/email/auth/preview", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body: JSON.stringify({ type: "signup" }),
  });
}

describe.each(["auth", "transactional"] as const)("podgląd szablonów: %s", (module) => {
  beforeEach(() => {
    secrets.calls.length = 0;
    process.env.LOVABLE_API_KEY = API_KEY;
  });

  afterEach(() => {
    delete process.env.LOVABLE_API_KEY;
  });

  it("porównuje GOŁY token z sekretem, nie nagłówek z prefiksem", async () => {
    const handler = await postHandler(module);
    const response = await handler({ request: previewRequest("Bearer zly-token") });
    expect(response.status).toBe(401);
    expect(secrets.calls).toEqual([["zly-token", API_KEY]]);
  });

  it("odrzuca żądanie bez nagłówka Authorization", async () => {
    const handler = await postHandler(module);
    const response = await handler({ request: previewRequest(null) });
    expect(response.status).toBe(401);
    expect(secrets.calls).toEqual([["", API_KEY]]);
  });

  it("przepuszcza poprawny sekret", async () => {
    const handler = await postHandler(module);
    const response = await handler({ request: previewRequest(`Bearer ${API_KEY}`) });
    expect(response.status).toBe(200);
    expect(secrets.calls).toEqual([[API_KEY, API_KEY]]);
  });

  it("bez skonfigurowanego LOVABLE_API_KEY nie porównuje niczego", async () => {
    const handler = await postHandler(module);
    delete process.env.LOVABLE_API_KEY;
    const response = await handler({ request: previewRequest(`Bearer ${API_KEY}`) });
    expect(response.status).toBe(500);
    expect(secrets.calls).toEqual([]);
  });
});

describe("źródła tras podglądu", () => {
  const files = {
    auth: "src/routes/platform/email/auth/preview.ts",
    transactional: "src/routes/platform/email/transactional/preview.ts",
  };

  it.each(Object.entries(files))(
    "%s porównuje sekret wspólnym helperem timing-safe",
    (_module, path) => {
      const source = readFileSync(path, "utf8");
      expect(source).toContain('await import("@/lib/server/jobsTick.server")');
      expect(source).toContain("await secretsEqual(token, apiKey)");
      expect(source).not.toMatch(/[!=]==\s*apiKey/);
      expect(source).not.toContain("`Bearer ${apiKey}`");
    },
  );
});
