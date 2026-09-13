// GRANICA NAJEMCY W DZIENNIKU POCZTY - od PRODUCENTA wiersza do RAPORTU.
//
// PO CO OSOBNY PLIK, skoro producenci i raport mają własne testy. Bo defekt,
// którego ten plik pilnuje, nie mieści się w żadnym z nich. Migracja
// 20260913101000 dała `email_send_log` kolumnę `tenant_id` - NULLOWALNĄ, bez
// DEFAULT i (do 20260913140000) bez triggera - a `fetchSystemEmailReport`
// zaczął filtrować dziennik RÓWNOŚCIOWO po tej kolumnie. Obie strony miały
// komplet zielonych testów i obie były osobno poprawne. Razem dawały panel,
// który pokazuje wyłącznie zamrożoną historię: każdy wiersz zapisany po
// wdrożeniu miał `tenant_id IS NULL`, więc nie spełniał predykatu dla ŻADNEGO
// najemcy i znikał - pending, sent, failed, suppressed i DLQ naraz.
//
// Test producenta tego nie złapie, bo producent nie wie, po czym czyta raport.
// Test raportu tego nie złapie, bo karmi się własną fabryką wierszy, a ta ma
// `tenant_id` z definicji. Dlatego tutaj ŻADEN wiersz nie jest pisany ręcznie:
// dziennik wypełniają PRAWDZIWI producenci (`sendTxEmail`, `enqueueRawEmail`,
// dren kolejki), a czyta go PRAWDZIWY raport. Jedyna atrapa między nimi to
// tabela trzymana w pamięci - i ta atrapa REALNIE FILTRUJE po argumencie
// `.eq()`, więc gdyby producent przestał zapisywać najemcę albo raport
// przestał go filtrować, asercja padnie z właściwej strony.
//
// DWIE ASERCJE NA KAŻDĄ ŚCIEŻKĘ, bo defekt ma dwie strony: wiersz MUSI być
// widoczny w raporcie swojego najemcy (diagnostyka) i MUSI być niewidoczny
// w raporcie cudzego (izolacja). Sam pierwszy warunek spełnia też brak filtru.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ok, okCount, supabaseFromStub, type SupabaseFromStub } from "@/test/supabase/chain";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import { freezeClock } from "@/test/time";
import type { SystemEmailQuery, SystemEmailReport } from "@/lib/email/system-log.server";

const LOG = "email_send_log";
const SUPPRESSIONS = "email_suppressions";
const NAJEMCA_A = "aaaaaaaa-1111-4111-8111-111111111111";
const NAJEMCA_B = "bbbbbbbb-2222-4222-8222-222222222222";

/**
 * Tabela `email_send_log` trzymana w pamięci. Piszą do niej producenci, czyta
 * z niej raport - to jedyny punkt styku obu stron i jedyne miejsce, w którym
 * ten test cokolwiek udaje.
 */
const dziennik: Record<string, unknown>[] = [];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Zapis wiersza tak, jak zrobiłaby to baza: `created_at` z zegara serwera. */
function zapisz(values: unknown): void {
  if (!isRecord(values)) return;
  dziennik.push({ ...values, created_at: new Date().toISOString() });
}

const h = vi.hoisted(() => ({
  createClient: vi.fn<(url: string, key: string, options?: unknown) => never>(),
  sendEmail: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({ createClient: h.createClient }));

vi.mock("../provider.server", () => ({
  sendEmail: (...args: unknown[]) => h.sendEmail(...args),
  emailProviderConfigured: () => true,
}));

// Raport czyta klientem serwisowym, który RLS OMIJA - dokładnie dlatego jego
// jedyną granicą jest jawny filtr w zapytaniu, a nie polityka.
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => czytelnik.from(table) },
}));

import { drainEmailQueues } from "../queueDrain.server";
import { enqueueRawEmail, sendTxEmail } from "../transactional.server";
import { fetchSystemEmailReport } from "@/lib/email/system-log.server";

freezeClock();

let producent: SupabaseFromStub;
let czytelnik: SupabaseFromStub;
let rpc: SupabaseRpcStub;

const ENV_KEYS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;

/**
 * Atrapa czytelnika REALNIE FILTRUJE po argumencie `.eq("tenant_id", …)`.
 * Bez filtru oddaje WSZYSTKO - tak jak zrobiłby PostgREST - żeby test „obcy
 * wiersz nie wchodzi do raportu" padał także wtedy, gdyby filtr w produkcji
 * w ogóle zniknął.
 */
function wpiszCzytelnika(stub: SupabaseFromStub): void {
  stub.setResponse(LOG, (chain) => {
    // Kolejność ODWRÓCONA względem zapisu, bo produkcja czyta
    // `.order("created_at", { ascending: false })`, a deduplikacja raportu bierze
    // wiersz PIERWSZY z wejścia jako stan najnowszy. Przy zamrożonym zegarze
    // wszystkie wiersze mają ten sam `created_at`, więc porządek musi odwzorować
    // kolejność zapisu wprost - inaczej ślad 'failed' przegrałby z 'pending'
    // z tej samej wiadomości i test dowodziłby czegoś innego, niż opisuje.
    const widok = [...dziennik].reverse();
    const args = chain.argsOf("eq");
    if (!args || args[0] !== "tenant_id") return ok(widok);
    return ok(widok.filter((row) => row.tenant_id === args[1]));
  });
  stub.setResponse(SUPPRESSIONS, okCount(0));
}

function zapytanie(tenantId: string): SystemEmailQuery {
  return {
    tenantId,
    days: 7,
    template: null,
    status: null,
    search: null,
    page: 1,
    pageSize: 50,
  };
}

function raport(tenantId: string): Promise<SystemEmailReport> {
  return fetchSystemEmailReport(zapytanie(tenantId));
}

/** Adresy odbiorców widoczne w raporcie danego najemcy. */
async function odbiorcyWRaporcie(tenantId: string): Promise<string[]> {
  const wynik = await raport(tenantId);
  return wynik.rows.map((row) => row.recipientEmail);
}

/** Minimalna atrapa klienta drenu - tylko to, czego dren naprawdę używa. */
function klientDrenu(kolejka: Record<string, unknown>[]) {
  const table = (name: string) => {
    if (name === "email_send_state") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                retry_after_until: null,
                batch_size: 10,
                send_delay_ms: 0,
                auth_email_ttl_minutes: 15,
                transactional_email_ttl_minutes: 60,
              },
              error: null,
            }),
          }),
        }),
        update: () => ({ eq: async () => ({ error: null }) }),
      };
    }
    if (name === LOG) {
      return {
        insert: async (row: Record<string, unknown>) => {
          zapisz(row);
          return { error: null };
        },
        select: () => ({
          in: () => ({ eq: async () => ({ data: [], error: null }) }),
          eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        }),
      };
    }
    throw new Error(`test: dren sięgnął po nieprzewidzianą tabelę ${name}`);
  };

  const rpcFn = async (fn: string, args: Record<string, unknown>) => {
    if (fn === "read_email_batch") {
      const rows = args.queue_name === "transactional_emails" ? kolejka : [];
      return { data: rows, error: null };
    }
    if (fn === "delete_email" || fn === "move_to_dlq") return { data: true, error: null };
    // Adres spoza ładunku rozstrzyga baza - tu zawsze najemca A, żeby dowód
    // dotyczył ZAPISU najemcy, a nie samego rozstrzygania.
    if (fn === "email_resolve_tenant_for_address") return { data: NAJEMCA_A, error: null };
    if (fn === "email_filter_suppressed") return { data: [], error: null };
    throw new Error(`test: dren zawołał nieprzewidziane RPC ${fn}`);
  };

  return { from: table, rpc: rpcFn } as never;
}

function wiadomoscWKolejce(payload: Record<string, unknown>) {
  return {
    msg_id: 1,
    read_ct: 0,
    enqueued_at: new Date().toISOString(),
    message: {
      message_id: "msg-kolejka",
      to: "borys@example.test",
      subject: "Podsumowanie dnia",
      html: "<p>Treść</p>",
      label: "digest_daily",
      queued_at: new Date().toISOString(),
      ...payload,
    },
  };
}

beforeEach(() => {
  dziennik.length = 0;

  for (const key of ENV_KEYS) process.env[key] = "atrapa";
  process.env.SUPABASE_URL = "https://baza.example.test";

  producent = supabaseFromStub();
  czytelnik = supabaseFromStub();
  rpc = supabaseRpcStub();

  // Dziennik po stronie producenta obsługuje DWA zapytania: zapis próby
  // (`insert`) i pytanie o duplikat (`select`). Bez rozróżnienia pierwszy zapis
  // udawałby, że wiadomość już poszła.
  producent.setResponse(LOG, (chain) => {
    const values = chain.argsOf("insert")?.[0];
    if (values !== undefined) {
      zapisz(values);
      return ok(null);
    }
    return ok([]);
  });
  producent.setResponse("email_unsubscribe_tokens", ok(null));
  producent.setResponse("newsletter_subscribers", ok(null));
  producent.setResponse("name_dictionary", ok(null));
  producent.setResponse("site_settings", ok(null));

  wpiszCzytelnika(czytelnik);

  rpc.setData("email_resolve_tenant_for_address", NAJEMCA_A);
  rpc.setData("email_filter_suppressed", []);
  rpc.setData("enqueue_email", null);

  h.createClient.mockReset();
  h.createClient.mockReturnValue({ from: producent.from, rpc: rpc.rpc } as never);
  h.sendEmail.mockReset();
  h.sendEmail.mockResolvedValue({ ok: true });

  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("sendTxEmail - wiersz dziennika należy do najemcy wysyłki", () => {
  it("ślad 'pending' widzi TYLKO najemca odbiorcy", async () => {
    await sendTxEmail({
      type: "payment_failed",
      to: "anna@example.test",
      idempotencyKey: "faktura-2026-09-1",
      tenantId: NAJEMCA_A,
    });

    // Najpierw dowód po stronie zapisu: bez tej kolumny reszta testu nie ma
    // czego szukać, a raport nie ma czego pokazać.
    expect(dziennik).toHaveLength(1);
    expect(dziennik[0]?.tenant_id).toBe(NAJEMCA_A);

    await expect(odbiorcyWRaporcie(NAJEMCA_A)).resolves.toEqual(["anna@example.test"]);
    await expect(odbiorcyWRaporcie(NAJEMCA_B)).resolves.toEqual([]);
  });

  it("nierozstrzygnięty najemca bierze się z bazy, a nie z pustki", async () => {
    // Wywołujący nie podaje najemcy - rozstrzyga go brama listy wykluczeń
    // (`email_resolve_tenant_for_address`). Wiersz ma trafić do TEGO najemcy.
    await sendTxEmail({
      type: "payment_failed",
      to: "anna@example.test",
      idempotencyKey: "faktura-2026-09-2",
    });

    expect(dziennik[0]?.tenant_id).toBe(NAJEMCA_A);
    const swoj = await raport(NAJEMCA_A);
    expect(swoj.totals.total).toBe(1);
    expect((await raport(NAJEMCA_B)).totals.total).toBe(0);
  });

  it("ślad 'failed' po odmowie kolejkowania też ma najemcę", async () => {
    rpc.setError("enqueue_email", "kolejka niedostępna");

    await sendTxEmail({
      type: "payment_failed",
      to: "anna@example.test",
      idempotencyKey: "faktura-2026-09-3",
      tenantId: NAJEMCA_B,
    });

    // Dwa wiersze tej samej wiadomości: 'pending' i 'failed'. Oba są dowodem
    // awarii, więc oba muszą dojść do operatora - tego samego operatora.
    expect(dziennik.map((row) => row.status)).toEqual(["pending", "failed"]);
    expect(dziennik.every((row) => row.tenant_id === NAJEMCA_B)).toBe(true);

    const swoj = await raport(NAJEMCA_B);
    expect(swoj.totals.failed).toBe(1);
    expect((await raport(NAJEMCA_A)).totals.total).toBe(0);
  });

  it("ślad 'suppressed' jest widoczny u najemcy, którego lista zatrzymała wysyłkę", async () => {
    rpc.setData("email_filter_suppressed", [
      { email: "anna@example.test", reason: "complaint", scope: "permanent", expires_at: null },
    ]);

    const wynik = await sendTxEmail({
      type: "payment_failed",
      to: "anna@example.test",
      idempotencyKey: "faktura-2026-09-4",
      tenantId: NAJEMCA_A,
    });

    expect(wynik.skipped).toBe("suppressed");
    expect(dziennik[0]?.tenant_id).toBe(NAJEMCA_A);

    // Cisza w skrzynce ma być widoczna w panelu - inaczej nie da się odróżnić
    // „nie wysłaliśmy świadomie" od „potok się zepsuł".
    expect((await raport(NAJEMCA_A)).totals.suppressed).toBe(1);
    expect((await raport(NAJEMCA_B)).totals.suppressed).toBe(0);
  });
});

describe("enqueueRawEmail - ta sama granica dla poczty z własnym szablonem", () => {
  it("ślad 'pending' digestu widzi TYLKO jego najemca", async () => {
    await enqueueRawEmail({
      to: "borys@example.test",
      subject: "Podsumowanie dnia",
      html: "<p>Trzy nowe komentarze</p>",
      label: "digest_daily",
      idempotencyKey: "digest-2026-09-13-borys",
      tenantId: NAJEMCA_B,
    });

    expect(dziennik[0]?.tenant_id).toBe(NAJEMCA_B);
    await expect(odbiorcyWRaporcie(NAJEMCA_B)).resolves.toEqual(["borys@example.test"]);
    await expect(odbiorcyWRaporcie(NAJEMCA_A)).resolves.toEqual([]);
  });
});

describe("dren kolejki - wiersze rozstrzygnięcia wysyłki", () => {
  it("ślad 'sent' trafia do najemcy, w którego kontekście poszła wiadomość", async () => {
    const wynik = await drainEmailQueues(
      klientDrenu([wiadomoscWKolejce({ tenant_id: NAJEMCA_A })]),
      { queues: ["transactional_emails"] },
    );

    expect(wynik.sent).toBe(1);
    expect(dziennik[0]).toMatchObject({ status: "sent", tenant_id: NAJEMCA_A });
    await expect(odbiorcyWRaporcie(NAJEMCA_A)).resolves.toEqual(["borys@example.test"]);
    await expect(odbiorcyWRaporcie(NAJEMCA_B)).resolves.toEqual([]);
  });

  it("ślad 'failed' po odmowie dostawcy również ma najemcę", async () => {
    h.sendEmail.mockResolvedValue({ ok: false, status: 500, error: "provider_5xx" });

    const wynik = await drainEmailQueues(
      klientDrenu([wiadomoscWKolejce({ tenant_id: NAJEMCA_A })]),
      { queues: ["transactional_emails"] },
    );

    expect(wynik.failed).toBe(1);
    expect(dziennik[0]).toMatchObject({ status: "failed", tenant_id: NAJEMCA_A });
    expect((await raport(NAJEMCA_A)).totals.failed).toBe(1);
    expect((await raport(NAJEMCA_B)).totals.total).toBe(0);
  });

  it("wywózka do DLQ bierze najemcę z ŁADUNKU - do bramy ta wiadomość nie dociera", async () => {
    // Wiadomość bez tematu leci do DLQ PRZED bramą higieny listy, więc
    // `gate.tenantId` jeszcze nie istnieje. Jedynym nośnikiem najemcy jest
    // ładunek kolejki - i to on musi wylądować w dzienniku, inaczej najgłośniejsza
    // awaria potoku byłaby niewidoczna dla kogokolwiek.
    const wynik = await drainEmailQueues(
      klientDrenu([wiadomoscWKolejce({ tenant_id: NAJEMCA_B, subject: "" })]),
      { queues: ["transactional_emails"] },
    );

    expect(wynik.dlq).toBe(1);
    expect(dziennik[0]).toMatchObject({ status: "dlq", tenant_id: NAJEMCA_B });
    expect((await raport(NAJEMCA_B)).totals.failed).toBe(1);
    expect((await raport(NAJEMCA_A)).totals.total).toBe(0);
  });

  it("trwała odmowa dostawcy nie rozrywa historii wiadomości na dwa panele", async () => {
    // Ładunek BEZ najemcy (tak wygląda każda wiadomość z kolejki `auth_emails`),
    // za to brama rozstrzygnęła adres. Wiersz DLQ ma iść do TEGO najemcy -
    // inaczej wiadomość, która ma już u niego ślad próby, kończyłaby bieg
    // w cudzym panelu albo w niczyim.
    h.sendEmail.mockResolvedValue({ ok: false, permanent: true, status: 422, error: "rejected" });

    const wynik = await drainEmailQueues(klientDrenu([wiadomoscWKolejce({})]), {
      queues: ["transactional_emails"],
    });

    expect(wynik.dlq).toBe(1);
    expect(dziennik[0]).toMatchObject({ status: "dlq", tenant_id: NAJEMCA_A });
    expect((await raport(NAJEMCA_A)).totals.failed).toBe(1);
    expect((await raport(NAJEMCA_B)).totals.total).toBe(0);
  });
});

describe("wiersz bez najemcy", () => {
  it("nie pokazuje się NIKOMU - i to jest decyzja, nie przeoczenie", async () => {
    // Taki wiersz może dziś powstać tylko poza tymi modułami (webhook auth,
    // trasa `/platform/email/transactional/send`) i tylko wtedy, gdy kaskada
    // triggera 20260913140000 nie rozstrzygnie adresu - czyli gdy adres nie
    // istnieje w żadnej organizacji albo istnieje w DWÓCH. Pokazanie go
    // któremukolwiek adminowi znaczyłoby pokazanie cudzego adresu e-mail,
    // a przy adresie z dwóch organizacji - obu naraz.
    dziennik.push({
      tenant_id: null,
      message_id: "sierota",
      template_name: "password_reset",
      recipient_email: "nieznany@example.test",
      status: "sent",
      error_message: null,
      created_at: new Date().toISOString(),
    });

    await expect(odbiorcyWRaporcie(NAJEMCA_A)).resolves.toEqual([]);
    await expect(odbiorcyWRaporcie(NAJEMCA_B)).resolves.toEqual([]);
  });
});
