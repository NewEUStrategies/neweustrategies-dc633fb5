// Z-S5-05 - TEST INTEGRACYJNY: mail marketingowy ścieżki ma JEDNĄ stopkę wypisu.
//
// DEFEKT (dziennik §20.5, pakiet I9-2). Render ścieżki doklejał własną stopkę
// „Wypisz się jednym kliknięciem", kolejka aplikacji ZAWSZE ustawia domenę
// nadawczą platformy, a nadawca platformy dokleja swoją stopkę wypisu, której
// nie da się wyłączyć. Każdy z trzech kroków osobno był poprawny - błąd był
// w ich złożeniu, więc dowód musi przejść przez wszystkie trzy:
//   render (`renderJourneyEmail`) -> kolejka (`enqueueRawEmail`, ładunek
//   `enqueue_email`) -> dostawca (`sendEmail` z mapowaniem pól jak w drenie)
//   -> ciało przekazane nadawcy platformy.
// Granice atrapowane: klient bazy (`createClient`) i SDK nadawcy platformy.
// Mapowanie ładunku kolejki na `sendEmail` jest kopią drenu - test źródła
// niżej pilnuje, że dren nadal przekazuje treść i domenę bez obróbki.
//
// CZEGO TEN TEST NIE DOWODZI. Faktycznego wyglądu stopki platformy w skrzynce
// - to zostaje weryfikacją na żywo właściciela (M3, dziennik §20.9 pkt 7).
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabase/chain";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";

const h = vi.hoisted(() => ({
  createClient: vi.fn<(url: string, key: string, options?: unknown) => never>(),
  sendLovableEmail: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({ createClient: h.createClient }));
vi.mock("@lovable.dev/email-js", () => ({ sendLovableEmail: h.sendLovableEmail }));

import { sendEmail } from "@/lib/email/provider.server";
import { __resetServiceClientForTests, enqueueRawEmail } from "@/lib/email/transactional.server";
import { journeyUnsubscribeUrl, renderJourneyEmail } from "@/lib/journeys/render.server";
import { button, emailDoc, paragraph } from "@/lib/journeys/templates/doc";

const ORIGIN = "https://nes.example.test";
const MESSAGE = "adcf4729-2d9b-4ef2-bf9a-bdd0cbfe79f9";
const TENANT = "11111111-1111-4111-8111-111111111111";
const UNSUBSCRIBE_PL = "Wypisz się jednym kliknięciem";

const ENV_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "LOVABLE_API_KEY",
  "RESEND_API_KEY",
  "SESSION_SECRET",
] as const;

let db: SupabaseFromStub;
let rpc: SupabaseRpcStub;
let savedEnv: Record<string, string | undefined>;

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.SUPABASE_URL = "https://baza.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-atrapa";
  // Oba klucze: gateway Resend jest skonfigurowany, a mimo to poczta kolejki
  // (z domeną nadawczą) idzie nadawcą platformy - to jest warunek defektu.
  process.env.LOVABLE_API_KEY = "lov-key";
  process.env.RESEND_API_KEY = "re-key";
  process.env.SESSION_SECRET = "test-secret-journeys";

  db = supabaseFromStub();
  rpc = supabaseRpcStub();
  db.setResponse("email_send_log", (chain) => (chain.has("insert") ? ok(null) : ok([])));
  db.setResponse("email_unsubscribe_tokens", ok({ token: "tok-platformy", used_at: null }));
  rpc.setData("email_resolve_tenant_for_address", TENANT);
  rpc.setData("email_filter_suppressed", []);
  rpc.setData("enqueue_email", null);

  __resetServiceClientForTests();
  h.createClient.mockReset();
  h.createClient.mockReturnValue({ from: db.from, rpc: rpc.rpc } as never);
  h.sendLovableEmail.mockReset().mockResolvedValue({});
  vi.stubGlobal("fetch", vi.fn());
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Ładunek ostatniego `enqueue_email` - to, co dren wyjmie z kolejki. */
function queuedPayload(): Record<string, unknown> {
  const payload = rpc.lastCall("enqueue_email")?.arg("payload");
  if (!payload || typeof payload !== "object") throw new Error("test: brak ładunku kolejki");
  return payload as Record<string, unknown>;
}

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

/** Mapowanie pól ładunku na `sendEmail` - jak w `queueDrain.server.ts`. */
function sendLikeDrain(payload: Record<string, unknown>) {
  return sendEmail({
    to: String(payload.to),
    subject: String(payload.subject),
    html: String(payload.html),
    text: str(payload.text),
    from: str(payload.from),
    senderDomain: str(payload.sender_domain),
    listUnsubscribeUrl: str(payload.unsubscribe_url) ?? null,
    replyTo: str(payload.reply_to) ?? null,
    unsubscribeToken: str(payload.unsubscribe_token),
    idempotencyKey: str(payload.idempotency_key),
    messageId: str(payload.message_id),
    label: String(payload.label),
  });
}

describe("mail marketingowy ścieżki: render -> kolejka -> nadawca platformy", () => {
  it("do platformy idzie treść BEZ stopki ścieżki (jedna stopka - platformy) i z tokenem wypisu", async () => {
    const unsubscribeUrl = journeyUnsubscribeUrl(ORIGIN, MESSAGE);
    const rendered = renderJourneyEmail({
      doc: emailDoc(
        paragraph("p1", "Witaj, {{first_name}}.", "Hello, {{first_name}}."),
        button("b1", "Cennik", "Pricing", "{{pricing_url}}"),
      ),
      subject: "Na start",
      locale: "pl",
      vars: { first_name: "Anna", pricing_url: `${ORIGIN}/pricing` },
      origin: ORIGIN,
      messageId: MESSAGE,
      unsubscribeUrl,
      measurementOptOutUrl: `${ORIGIN}/newsletter/measurement?t=x`,
    });
    // Render sam w sobie niesie stopkę - dokładnie raz, w znacznikach.
    expect(occurrences(rendered.html, UNSUBSCRIBE_PL)).toBe(1);
    expect(occurrences(rendered.text, UNSUBSCRIBE_PL)).toBe(1);

    const queued = await enqueueRawEmail({
      to: "anna@example.test",
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      label: "journey",
      category: "bulk",
      idempotencyKey: `journey:e1:mail`,
      tenantId: TENANT,
      unsubscribeUrl,
    });
    expect(queued).toEqual({ ok: true });
    const payload = queuedPayload();
    // Kolejka nie obrabia treści, a domena nadawcza jest zawsze ustawiona.
    expect(payload.html).toBe(rendered.html);
    expect(payload.sender_domain).toEqual(expect.any(String));

    const result = await sendLikeDrain(payload);
    expect(result).toMatchObject({ ok: true, provider: "platform" });

    expect(h.sendLovableEmail).toHaveBeenCalledTimes(1);
    const [sent] = h.sendLovableEmail.mock.calls[0] as [Record<string, unknown>];
    const html = String(sent.html);
    const text = String(sent.text);
    expect(occurrences(html, UNSUBSCRIBE_PL)).toBe(0);
    expect(occurrences(text, UNSUBSCRIBE_PL)).toBe(0);
    expect(html).not.toContain("nes:unsub");
    expect(text).not.toContain("nes:unsub");
    // Treść i linia „Nie mierz…" (to nie jest stopka wypisu) zostają.
    expect(html).toContain("Witaj, Anna.");
    expect(text).toContain("/newsletter/measurement?t=x");
    // Stopkę wypisu platforma dokleja z tego tokenu.
    expect(sent.unsubscribe_token).toBe("tok-platformy");
  });

  it("komunikacja usługowa ścieżki: bez stopki ścieżki od początku, treść bez zmian u platformy", async () => {
    const rendered = renderJourneyEmail({
      doc: emailDoc(paragraph("p1", "Twoja próba kończy się jutro.", "Trial ends tomorrow.")),
      subject: "Próba",
      locale: "pl",
      vars: {},
      origin: ORIGIN,
      messageId: MESSAGE,
      unsubscribeUrl: null,
    });
    await enqueueRawEmail({
      to: "anna@example.test",
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      label: "journey_service",
      idempotencyKey: "journey:e2:mail",
      tenantId: TENANT,
    });
    await sendLikeDrain(queuedPayload());

    const [sent] = h.sendLovableEmail.mock.calls[0] as [Record<string, unknown>];
    expect(sent.html).toBe(rendered.html);
    expect(sent.text).toBe(rendered.text);
  });
});

describe("premisa mapowania: dren przekazuje treść i domenę z kolejki bez obróbki", () => {
  it("`queueDrain.server.ts` woła `sendEmail` z html/text/sender_domain/unsubscribe_token ładunku", () => {
    const drain = readFileSync("src/lib/email/queueDrain.server.ts", "utf8");
    const call = drain.slice(drain.indexOf("await sendEmail({"));
    expect(call).toContain("html: text(payload.html)");
    expect(call).toContain("text: text(payload.text) || undefined");
    expect(call).toContain("senderDomain: nullableText(payload.sender_domain) ?? undefined");
    expect(call).toContain(
      "unsubscribeToken: nullableText(payload.unsubscribe_token) ?? undefined",
    );
  });
});
