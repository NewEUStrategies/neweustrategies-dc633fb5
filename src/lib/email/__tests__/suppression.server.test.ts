// Warstwa serwerowa listy wykluczeń - JEDYNE miejsce, przez które przechodzi
// pytanie „czy wolno wysłać na ten adres?" i każdy zapis blokady.
//
// DLACZEGO TEN PLIK MA WYŻSZY PRÓG NIŻ SĄSIEDNIE. Łańcuch skutków nie kończy
// się na newsletterze: kampania wysłana na martwe adresy psuje reputację
// domeny nadawczej, a razem z nią przestaje dochodzić poczta TRANSAKCYJNA -
// w tym reset hasła. Użytkownik nie może wtedy wejść na konto i nie ma jak
// tego zgłosić, bo formularz kontaktowy też idzie mailem. To jedyny łańcuch
// w tym repo, w którym defekt jednego modułu zamyka drogę wyjścia z niego.
//
// CZEGO TEN TEST NIE DUBLUJE. Unikalność adresu bez rozróżniania wielkości
// liter, deduplikację zdarzeń kampanii i unifikację dwóch list wykluczeń
// dowodzi pgTAP (`email_suppression_test.sql`,
// `email_suppression_unification_test.sql`, `newsletter_email_ci_unique_test.sql`).
// Tutaj dowodzimy warstwy, której baza nie widzi: czy aplikacja W OGÓLE pyta
// o tłumienia przed wysyłką, z jakim argumentem pyta i co robi z odpowiedzią -
// w tym z odpowiedzią BŁĘDNĄ.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import {
  applyDeliveryEvent,
  checkSendAllowed,
  fetchSuppressedEmails,
  isEmailSuppressed,
  recordSuppression,
  resolveTenantForAddress,
  unsubscribeByToken,
  type ApplyDeliveryEventInput,
} from "../suppression.server";

const TENANT = "11111111-1111-4111-8111-111111111111";

/** Jedno zarejestrowane wywołanie RPC - do asercji o ARGUMENCIE zapytania. */
interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

type RpcReply = { data: unknown; error: { message: string } | null };
type RpcResponder = (args: Record<string, unknown>) => RpcReply;

/**
 * Atrapa klienta service-role zawężona do jednego wywołania, którego ten moduł
 * naprawdę używa: `rpc(fn, args)`. Świadomie NIE symuluje PostgREST-a - cała
 * warstwa wykluczeń idzie przez SECURITY DEFINER RPC, więc atrapa `from()`
 * udawałaby drogę, której w tym pliku nie ma.
 *
 * `as never` na granicy klienta jest idiomem tego repo (por.
 * `__tests__/queueDrain.test.ts`): funkcje przyjmują `SupabaseClient<Database>`,
 * a pełny ten typ jest niekonstruowalny w teście bez `as unknown as`.
 */
function fakeAdmin() {
  const calls: RpcCall[] = [];
  const responders = new Map<string, RpcResponder>();

  const client = {
    rpc: async (fn: string, args: Record<string, unknown>): Promise<RpcReply> => {
      calls.push({ fn, args });
      const responder = responders.get(fn);
      // Brak zaplanowanej odpowiedzi to BŁĄD testu, nie „puste dane": ciche
      // `null` udawałoby poprawny odczyt RPC, którego test nie zaplanował.
      if (!responder) return { data: null, error: { message: `test: nieoczekiwane rpc ${fn}` } };
      return responder(args);
    },
  };

  return {
    admin: client as never,
    calls,
    /** Odpowiedź dla RPC (funkcja - żeby odpowiadać różnie na różne argumenty). */
    on(fn: string, responder: RpcResponder | RpcReply) {
      responders.set(fn, typeof responder === "function" ? responder : () => responder);
    },
    callsTo: (fn: string) => calls.filter((c) => c.fn === fn),
    lastCall: (fn: string) => calls.filter((c) => c.fn === fn).at(-1),
  };
}

/** Wiersz blokady w kształcie, w jakim oddaje go `email_filter_suppressed`. */
function suppressionRow(email: string, reason = "hard_bounce", scope = "permanent") {
  return { email, reason, scope, expires_at: null };
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Moduł loguje każdą awarię odczytu - bez wyciszenia raport testów tonie
  // w komunikatach, a spy pozwala dowieść, że awaria NIE JEST przemilczana.
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// isEmailSuppressed - pojedyncze sprawdzenie (double opt-in, wysyłka 1:1)
// ---------------------------------------------------------------------------
describe("isEmailSuppressed", () => {
  it("adres NA liście zwraca prawdę", async () => {
    const db = fakeAdmin();
    db.on("email_is_suppressed", { data: true, error: null });

    await expect(isEmailSuppressed(db.admin, TENANT, "blokada@example.test")).resolves.toBe(true);
    expect(db.callsTo("email_is_suppressed")).toHaveLength(1);
  });

  it("adres POZA listą zwraca fałsz", async () => {
    const db = fakeAdmin();
    db.on("email_is_suppressed", { data: false, error: null });

    await expect(isEmailSuppressed(db.admin, TENANT, "czysty@example.test")).resolves.toBe(false);
    expect(db.callsTo("email_is_suppressed")).toHaveLength(1);
  });

  it("pyta o adres MAŁYMI literami - tak samo, jak baza wymusza unikalność", async () => {
    // pgTAP dowodzi, że unikalność adresu jest bez rozróżniania wielkości liter.
    // Gdyby aplikacja pytała surowym „Jan.Kowalski@…", blokada postawiona na
    // „jan.kowalski@…" nie zostałaby znaleziona i wysyłka poszłaby dalej.
    const db = fakeAdmin();
    db.on("email_is_suppressed", { data: true, error: null });

    await isEmailSuppressed(db.admin, TENANT, "Jan.Kowalski@Example.TEST");

    expect(db.lastCall("email_is_suppressed")?.args).toEqual({
      p_tenant: TENANT,
      p_email: "jan.kowalski@example.test",
    });
    expect(db.calls.map((c) => c.fn)).toEqual(["email_is_suppressed"]);
  });

  it("obcina białe znaki wokół adresu przed zapytaniem", async () => {
    const db = fakeAdmin();
    db.on("email_is_suppressed", { data: true, error: null });

    await isEmailSuppressed(db.admin, TENANT, "  spacja@example.test \n");

    expect(db.lastCall("email_is_suppressed")?.args.p_email).toBe("spacja@example.test");
    expect(db.callsTo("email_is_suppressed")).toHaveLength(1);
  });

  it("pusty adres NIE pyta bazy - zapytanie o nic kosztowałoby przejazd", async () => {
    const db = fakeAdmin();

    await expect(isEmailSuppressed(db.admin, TENANT, "")).resolves.toBe(false);

    expect(db.calls).toHaveLength(0);
  });

  it("pusty tenant NIE pyta bazy", async () => {
    const db = fakeAdmin();

    await expect(isEmailSuppressed(db.admin, "", "ktos@example.test")).resolves.toBe(false);

    expect(db.calls).toHaveLength(0);
  });

  it("odpowiedź inna niż `true` (np. null) czyta się jako BRAK blokady", async () => {
    const db = fakeAdmin();
    db.on("email_is_suppressed", { data: null, error: null });

    await expect(isEmailSuppressed(db.admin, TENANT, "ktos@example.test")).resolves.toBe(false);
    // I nie jest to skutek błędu - zapytanie poszło i wróciło bez awarii.
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("PRZYPIĘCIE STANU FAKTYCZNEGO: przy błędzie bazy jest FAIL-OPEN", async () => {
    // To jest ustalenie, nie aprobata. Awaria odczytu listy wykluczeń oznacza,
    // że wiadomość POJDZIE na adres, który może być zablokowany po twardym
    // odbiciu albo po skardze. Kod nazywa to świadomym wyborem (nagłówek
    // `checkSendAllowed`): twarda blokada bez potwierdzenia z bazy zamilczałaby
    // pocztę transakcyjną, w tym reset hasła. Test PRZYPINA ten wybór, żeby
    // zmiana na fail-closed była decyzją, a nie skutkiem ubocznym refaktoru.
    const db = fakeAdmin();
    db.on("email_is_suppressed", { data: null, error: { message: "connection reset" } });

    await expect(isEmailSuppressed(db.admin, TENANT, "blokada@example.test")).resolves.toBe(false);
    // I stało się to PO zapytaniu, a nie zamiast niego - bramka naprawdę pytała.
    expect(db.callsTo("email_is_suppressed")).toHaveLength(1);
  });

  it("awaria odczytu zostaje ZALOGOWANA - fail-open nie może być cichy", async () => {
    const db = fakeAdmin();
    db.on("email_is_suppressed", { data: null, error: { message: "connection reset" } });

    await isEmailSuppressed(db.admin, TENANT, "blokada@example.test");

    expect(errorSpy).toHaveBeenCalledWith("[suppression] check failed", "connection reset");
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// fetchSuppressedEmails - filtr listy przed wysyłką kampanii
// ---------------------------------------------------------------------------
describe("fetchSuppressedEmails", () => {
  it("zwraca mapę trafień po adresie znormalizowanym", async () => {
    const db = fakeAdmin();
    db.on("email_filter_suppressed", () => ({
      data: [suppressionRow("blok@example.test", "complaint", "permanent")],
      error: null,
    }));

    const found = await fetchSuppressedEmails(db.admin, TENANT, [
      "BLOK@Example.test",
      "czysty@example.test",
    ]);

    expect(found.get("blok@example.test")).toEqual({
      email: "blok@example.test",
      reason: "complaint",
      scope: "permanent",
      expiresAt: null,
    });
    expect(found.has("czysty@example.test")).toBe(false);
  });

  it("odpytuje o adresy UNIKALNE po normalizacji - duplikaty nie mnożą pracy", async () => {
    const db = fakeAdmin();
    db.on("email_filter_suppressed", () => ({ data: [], error: null }));

    await fetchSuppressedEmails(db.admin, TENANT, [
      "Ten.Sam@example.test",
      "ten.sam@EXAMPLE.test",
      " ten.sam@example.test ",
    ]);

    expect(db.lastCall("email_filter_suppressed")?.args.p_emails).toEqual(["ten.sam@example.test"]);
    expect(db.callsTo("email_filter_suppressed")).toHaveLength(1);
  });

  it("pusta lista adresów NIE pyta bazy", async () => {
    const db = fakeAdmin();

    const found = await fetchSuppressedEmails(db.admin, TENANT, []);

    expect(found.size).toBe(0);
    expect(db.calls).toHaveLength(0);
  });

  it("sam biały znak jako adres odpada przed zapytaniem", async () => {
    const db = fakeAdmin();

    const found = await fetchSuppressedEmails(db.admin, TENANT, ["   ", ""]);

    expect(found.size).toBe(0);
    expect(db.calls).toHaveLength(0);
  });

  it("brak tenanta NIE pyta bazy", async () => {
    const db = fakeAdmin();

    const found = await fetchSuppressedEmails(db.admin, "", ["ktos@example.test"]);

    expect(found.size).toBe(0);
    expect(db.calls).toHaveLength(0);
  });

  it("dzieli listę na porcje po 500 - jedno zapytanie na 20 tysięcy adresów byłoby za duże", async () => {
    const db = fakeAdmin();
    db.on("email_filter_suppressed", () => ({ data: [], error: null }));
    const emails = Array.from({ length: 1101 }, (_, i) => `odbiorca${i}@example.test`);

    await fetchSuppressedEmails(db.admin, TENANT, emails);

    const calls = db.callsTo("email_filter_suppressed");
    expect(calls).toHaveLength(3);
    expect((calls[0].args.p_emails as string[]).length).toBe(500);
    expect((calls[1].args.p_emails as string[]).length).toBe(500);
    expect((calls[2].args.p_emails as string[]).length).toBe(101);
  });

  it("błąd JEDNEJ porcji nie przerywa pozostałych - kampania nie stoi na awarii odczytu", async () => {
    const db = fakeAdmin();
    let nth = 0;
    db.on("email_filter_suppressed", (args) => {
      nth += 1;
      if (nth === 1) return { data: null, error: { message: "timeout" } };
      return { data: [suppressionRow((args.p_emails as string[])[0])], error: null };
    });
    const emails = Array.from({ length: 600 }, (_, i) => `odbiorca${i}@example.test`);

    const found = await fetchSuppressedEmails(db.admin, TENANT, emails);

    expect(db.callsTo("email_filter_suppressed")).toHaveLength(2);
    expect(found.size).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith("[suppression] filter failed", "timeout");
  });

  it("odpowiedź, która nie jest tablicą, jest pomijana bez rzucania", async () => {
    const db = fakeAdmin();
    db.on("email_filter_suppressed", { data: { nie: "tablica" }, error: null });

    const found = await fetchSuppressedEmails(db.admin, TENANT, ["ktos@example.test"]);

    expect(found.size).toBe(0);
    expect(db.callsTo("email_filter_suppressed")).toHaveLength(1);
  });

  it("wiersz o nieznanym kształcie jest odsiewany, reszta porcji przechodzi", async () => {
    const db = fakeAdmin();
    db.on("email_filter_suppressed", {
      data: [
        null,
        "napis",
        { email: 42 },
        { email: "brak.reason@example.test" },
        suppressionRow("dobry@example.test"),
      ],
      error: null,
    });

    const found = await fetchSuppressedEmails(db.admin, TENANT, [
      "dobry@example.test",
      "brak.reason@example.test",
    ]);

    expect(Array.from(found.keys())).toEqual(["dobry@example.test"]);
    expect(db.callsTo("email_filter_suppressed")).toHaveLength(1);
  });

  it("brakujący `expires_at` czyta się jako null, nie undefined", async () => {
    const db = fakeAdmin();
    db.on("email_filter_suppressed", {
      data: [{ email: "blok@example.test", reason: "soft_bounce", scope: "transient" }],
      error: null,
    });

    const found = await fetchSuppressedEmails(db.admin, TENANT, ["blok@example.test"]);

    expect(found.get("blok@example.test")?.expiresAt).toBeNull();
    expect(db.callsTo("email_filter_suppressed")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// resolveTenantForAddress
// ---------------------------------------------------------------------------
describe("resolveTenantForAddress", () => {
  it("oddaje tenanta z RPC, pytając adresem znormalizowanym", async () => {
    const db = fakeAdmin();
    db.on("email_resolve_tenant_for_address", { data: TENANT, error: null });

    await expect(resolveTenantForAddress(db.admin, " Ktos@Example.TEST ")).resolves.toBe(TENANT);
    expect(db.lastCall("email_resolve_tenant_for_address")?.args.p_email).toBe("ktos@example.test");
  });

  it("pusty napis w odpowiedzi to BRAK tenanta, nie tenant o pustej nazwie", async () => {
    const db = fakeAdmin();
    db.on("email_resolve_tenant_for_address", { data: "", error: null });

    await expect(resolveTenantForAddress(db.admin, "ktos@example.test")).resolves.toBeNull();
    expect(db.callsTo("email_resolve_tenant_for_address")).toHaveLength(1);
  });

  it("odpowiedź nie-napisowa to brak tenanta", async () => {
    const db = fakeAdmin();
    db.on("email_resolve_tenant_for_address", { data: { id: TENANT }, error: null });

    await expect(resolveTenantForAddress(db.admin, "ktos@example.test")).resolves.toBeNull();
    expect(db.callsTo("email_resolve_tenant_for_address")).toHaveLength(1);
  });

  it("błąd bazy to brak tenanta i wpis w logu", async () => {
    const db = fakeAdmin();
    db.on("email_resolve_tenant_for_address", { data: null, error: { message: "no rpc" } });

    await expect(resolveTenantForAddress(db.admin, "ktos@example.test")).resolves.toBeNull();
    expect(errorSpy).toHaveBeenCalledWith("[suppression] tenant resolve failed", "no rpc");
  });
});

// ---------------------------------------------------------------------------
// checkSendAllowed - JEDNA brama wysyłki 1:1
// ---------------------------------------------------------------------------
describe("checkSendAllowed", () => {
  it("pusty adres jest ODRZUCANY bez żadnego zapytania", async () => {
    const db = fakeAdmin();

    const result = await checkSendAllowed(db.admin, { email: "   ", category: "transactional" });

    expect(result).toEqual({ allowed: false, hit: null, tenantId: null });
    expect(db.calls).toHaveLength(0);
  });

  it("znany tenant POMIJA zapytanie rozwiązujące", async () => {
    const db = fakeAdmin();
    db.on("email_filter_suppressed", { data: [], error: null });

    await checkSendAllowed(db.admin, {
      email: "ktos@example.test",
      category: "bulk",
      tenantId: TENANT,
    });

    expect(db.callsTo("email_resolve_tenant_for_address")).toHaveLength(0);
    expect(db.callsTo("email_filter_suppressed")).toHaveLength(1);
  });

  it("brak tenanta dla adresu PRZEPUSZCZA wysyłkę i nie pyta o listę", async () => {
    const db = fakeAdmin();
    db.on("email_resolve_tenant_for_address", { data: null, error: null });

    const result = await checkSendAllowed(db.admin, {
      email: "obcy@example.test",
      category: "bulk",
    });

    expect(result).toEqual({ allowed: true, hit: null, tenantId: null });
    expect(db.callsTo("email_filter_suppressed")).toHaveLength(0);
  });

  it("adres bez blokady przechodzi", async () => {
    const db = fakeAdmin();
    db.on("email_filter_suppressed", { data: [], error: null });

    const result = await checkSendAllowed(db.admin, {
      email: "czysty@example.test",
      category: "bulk",
      tenantId: TENANT,
    });

    expect(result.allowed).toBe(true);
    expect(result.hit).toBeNull();
    expect(result.tenantId).toBe(TENANT);
  });

  it("twarde odbicie zatrzymuje KAŻDĄ kategorię - także transakcyjną", async () => {
    const db = fakeAdmin();
    db.on("email_filter_suppressed", {
      data: [suppressionRow("martwy@example.test", "hard_bounce")],
      error: null,
    });

    const result = await checkSendAllowed(db.admin, {
      email: "martwy@example.test",
      category: "transactional",
      tenantId: TENANT,
    });

    expect(result.allowed).toBe(false);
    expect(result.hit?.reason).toBe("hard_bounce");
  });

  it("wypis z newslettera NIE zatrzymuje poczty transakcyjnej, ale zwraca trafienie", async () => {
    // Wycofanie zgody marketingowej nie jest oświadczeniem „nie chcę
    // potwierdzeń płatności" - takiej treści nie wolno zatrzymać.
    const db = fakeAdmin();
    db.on("email_filter_suppressed", {
      data: [suppressionRow("wypis@example.test", "unsubscribe")],
      error: null,
    });

    const result = await checkSendAllowed(db.admin, {
      email: "wypis@example.test",
      category: "transactional",
      tenantId: TENANT,
    });

    expect(result.allowed).toBe(true);
    expect(result.hit?.reason).toBe("unsubscribe");
  });

  it("wypis ZATRZYMUJE wysyłkę za zgodą (bulk)", async () => {
    const db = fakeAdmin();
    db.on("email_filter_suppressed", {
      data: [suppressionRow("wypis@example.test", "unsubscribe")],
      error: null,
    });

    const result = await checkSendAllowed(db.admin, {
      email: "wypis@example.test",
      category: "bulk",
      tenantId: TENANT,
    });

    expect(result.allowed).toBe(false);
    expect(db.callsTo("email_filter_suppressed")).toHaveLength(1);
  });

  it("PRZYPIĘCIE: awaria odczytu listy PRZEPUSZCZA wysyłkę (fail-open)", async () => {
    // Ta sama konsekwencja co przy `isEmailSuppressed`: awaria bazy = wysyłka
    // na adres, który mógł być zablokowany po skardze na spam.
    const db = fakeAdmin();
    db.on("email_filter_suppressed", { data: null, error: { message: "db down" } });

    const result = await checkSendAllowed(db.admin, {
      email: "moze.zablokowany@example.test",
      category: "bulk",
      tenantId: TENANT,
    });

    expect(result.allowed).toBe(true);
    expect(result.hit).toBeNull();
  });

  it("adres z wielkimi literami trafia w blokadę zapisaną małymi", async () => {
    const db = fakeAdmin();
    db.on("email_filter_suppressed", {
      data: [suppressionRow("wielkie@example.test", "complaint")],
      error: null,
    });

    const result = await checkSendAllowed(db.admin, {
      email: "WIELKIE@Example.Test",
      category: "bulk",
      tenantId: TENANT,
    });

    expect(result.allowed).toBe(false);
    expect(result.hit?.email).toBe("wielkie@example.test");
  });
});

// ---------------------------------------------------------------------------
// unsubscribeByToken - wypis jednym kliknięciem
//
// Wypis musi działać ZAWSZE i NATYCHMIAST: niedziałający link wypisu to
// naruszenie prawa, nie usterka wygody.
// ---------------------------------------------------------------------------
describe("unsubscribeByToken", () => {
  it("poprawny token wypisuje i oddaje tenanta", async () => {
    const db = fakeAdmin();
    db.on("email_unsubscribe_by_token", {
      data: { ok: true, already_unsubscribed: false, tenant_id: TENANT },
      error: null,
    });

    await expect(unsubscribeByToken(db.admin, "tok-1")).resolves.toEqual({
      ok: true,
      alreadyUnsubscribed: false,
      tenantId: TENANT,
      error: undefined,
    });
    expect(db.callsTo("email_unsubscribe_by_token")).toHaveLength(1);
  });

  it("przekazuje token DOSŁOWNIE - normalizacja adresu tokenu nie dotyczy", async () => {
    const db = fakeAdmin();
    db.on("email_unsubscribe_by_token", { data: { ok: true }, error: null });

    await unsubscribeByToken(db.admin, "TOK-Wielkie-Litery");

    expect(db.lastCall("email_unsubscribe_by_token")?.args).toEqual({
      p_token: "TOK-Wielkie-Litery",
    });
    expect(db.callsTo("email_unsubscribe_by_token")).toHaveLength(1);
  });

  it("DRUGIE kliknięcie w ten sam link NIE jest błędem - wypis jest idempotentny", async () => {
    const db = fakeAdmin();
    db.on("email_unsubscribe_by_token", {
      data: { ok: true, already_unsubscribed: true, tenant_id: TENANT },
      error: null,
    });

    const result = await unsubscribeByToken(db.admin, "tok-1");

    expect(result.ok).toBe(true);
    expect(result.alreadyUnsubscribed).toBe(true);
  });

  it("token nieistniejący oddaje powód, nie wyjątek", async () => {
    const db = fakeAdmin();
    db.on("email_unsubscribe_by_token", {
      data: { ok: false, error: "token_not_found" },
      error: null,
    });

    await expect(unsubscribeByToken(db.admin, "brak")).resolves.toEqual({
      ok: false,
      alreadyUnsubscribed: false,
      tenantId: null,
      error: "token_not_found",
    });
    expect(db.callsTo("email_unsubscribe_by_token")).toHaveLength(1);
  });

  it("token zużyty oddaje powód z bazy", async () => {
    const db = fakeAdmin();
    db.on("email_unsubscribe_by_token", {
      data: { ok: false, error: "token_consumed" },
      error: null,
    });

    await expect(unsubscribeByToken(db.admin, "zuzyty")).resolves.toMatchObject({
      ok: false,
      error: "token_consumed",
    });
    expect(db.callsTo("email_unsubscribe_by_token")).toHaveLength(1);
  });

  it("token wygasły oddaje powód z bazy", async () => {
    const db = fakeAdmin();
    db.on("email_unsubscribe_by_token", {
      data: { ok: false, error: "token_expired" },
      error: null,
    });

    await expect(unsubscribeByToken(db.admin, "stary")).resolves.toMatchObject({
      ok: false,
      error: "token_expired",
    });
    expect(db.callsTo("email_unsubscribe_by_token")).toHaveLength(1);
  });

  it("token innego najemcy nie wypisuje i nie oddaje cudzego tenanta", async () => {
    // Rozstrzygnięcie zakresu żyje w SQL; aplikacja ma nie „poprawiać" odmowy.
    const db = fakeAdmin();
    db.on("email_unsubscribe_by_token", {
      data: { ok: false, error: "tenant_mismatch", tenant_id: null },
      error: null,
    });

    const result = await unsubscribeByToken(db.admin, "obcy-tenant");

    expect(result.ok).toBe(false);
    expect(result.tenantId).toBeNull();
  });

  it("pusty token idzie do bazy i wraca odmową - decyzję podejmuje SQL", async () => {
    const db = fakeAdmin();
    db.on("email_unsubscribe_by_token", {
      data: { ok: false, error: "token_not_found" },
      error: null,
    });

    const result = await unsubscribeByToken(db.admin, "");

    expect(db.lastCall("email_unsubscribe_by_token")?.args.p_token).toBe("");
    expect(result.ok).toBe(false);
  });

  it("błąd bazy oddaje komunikat błędu i loguje go", async () => {
    const db = fakeAdmin();
    db.on("email_unsubscribe_by_token", { data: null, error: { message: "deadlock" } });

    await expect(unsubscribeByToken(db.admin, "tok-1")).resolves.toEqual({
      ok: false,
      alreadyUnsubscribed: false,
      tenantId: null,
      error: "deadlock",
    });
    expect(errorSpy).toHaveBeenCalledWith("[suppression] unsubscribe failed", "deadlock");
  });

  it("odpowiedź o nieznanym kształcie to `invalid_response`, nie cichy sukces", async () => {
    const db = fakeAdmin();
    db.on("email_unsubscribe_by_token", { data: "ok", error: null });

    await expect(unsubscribeByToken(db.admin, "tok-1")).resolves.toEqual({
      ok: false,
      alreadyUnsubscribed: false,
      tenantId: null,
      error: "invalid_response",
    });
    expect(db.callsTo("email_unsubscribe_by_token")).toHaveLength(1);
  });

  it("TABLICA w odpowiedzi też jest odrzucana - strażnik kształtu nie liczy tablicy za rekord", async () => {
    const db = fakeAdmin();
    db.on("email_unsubscribe_by_token", { data: [{ ok: true }], error: null });

    await expect(unsubscribeByToken(db.admin, "tok-1")).resolves.toMatchObject({
      ok: false,
      error: "invalid_response",
    });
    expect(db.callsTo("email_unsubscribe_by_token")).toHaveLength(1);
  });

  it("`null` w odpowiedzi jest odrzucany", async () => {
    const db = fakeAdmin();
    db.on("email_unsubscribe_by_token", { data: null, error: null });

    await expect(unsubscribeByToken(db.admin, "tok-1")).resolves.toMatchObject({
      ok: false,
      error: "invalid_response",
    });
    expect(db.callsTo("email_unsubscribe_by_token")).toHaveLength(1);
  });

  it("`tenant_id` nie-napisowy czyta się jako brak tenanta", async () => {
    const db = fakeAdmin();
    db.on("email_unsubscribe_by_token", {
      data: { ok: true, tenant_id: 7 },
      error: null,
    });

    await expect(unsubscribeByToken(db.admin, "tok-1")).resolves.toMatchObject({
      ok: true,
      tenantId: null,
    });
    expect(db.callsTo("email_unsubscribe_by_token")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// recordSuppression - zapis blokady
// ---------------------------------------------------------------------------
describe("recordSuppression", () => {
  it("zapisuje blokadę z adresem znormalizowanym", async () => {
    const db = fakeAdmin();
    db.on("email_record_suppression", { data: { ok: true }, error: null });

    await expect(
      recordSuppression(db.admin, {
        tenantId: TENANT,
        email: " Skarga@Example.TEST ",
        reason: "complaint",
      }),
    ).resolves.toBe(true);

    expect(db.lastCall("email_record_suppression")?.args.p_email).toBe("skarga@example.test");
  });

  it("domyślne źródło to `system`, a dostawca to `resend`", async () => {
    const db = fakeAdmin();
    db.on("email_record_suppression", { data: { ok: true }, error: null });

    await recordSuppression(db.admin, {
      tenantId: TENANT,
      email: "ktos@example.test",
      reason: "manual",
    });

    const args = db.lastCall("email_record_suppression")?.args ?? {};
    expect(args.p_source).toBe("system");
    expect(args.p_provider).toBe("resend");
    expect(args.p_meta).toEqual({});
  });

  it("pola opcjonalne bez wartości idą jako null, nie undefined", async () => {
    // `undefined` w argumencie RPC gubi się przy serializacji JSON i baza
    // dostałaby argument, którego w ogóle nie ma - a nie jawnego NULL-a.
    const db = fakeAdmin();
    db.on("email_record_suppression", { data: { ok: true }, error: null });

    await recordSuppression(db.admin, {
      tenantId: TENANT,
      email: "ktos@example.test",
      reason: "invalid",
    });

    const args = db.lastCall("email_record_suppression")?.args ?? {};
    expect(args.p_provider_message_id).toBeNull();
    expect(args.p_event_id).toBeNull();
    expect(args.p_campaign).toBeNull();
    expect(args.p_subscriber).toBeNull();
    expect(args.p_diagnostic).toBeNull();
  });

  it("przekazuje wszystkie podane korelatory zdarzenia", async () => {
    const db = fakeAdmin();
    db.on("email_record_suppression", { data: { ok: true }, error: null });

    await recordSuppression(db.admin, {
      tenantId: TENANT,
      email: "ktos@example.test",
      reason: "hard_bounce",
      source: "resend_webhook",
      provider: "platform",
      providerMessageId: "msg-1",
      eventId: "evt-1",
      campaignId: "camp-1",
      subscriberId: "sub-1",
      diagnostic: "550 unknown user",
      meta: { note: "test" },
    });

    expect(db.lastCall("email_record_suppression")?.args).toEqual({
      p_tenant: TENANT,
      p_email: "ktos@example.test",
      p_reason: "hard_bounce",
      p_source: "resend_webhook",
      p_provider: "platform",
      p_provider_message_id: "msg-1",
      p_event_id: "evt-1",
      p_campaign: "camp-1",
      p_subscriber: "sub-1",
      p_diagnostic: "550 unknown user",
      p_meta: { note: "test" },
    });
    expect(db.callsTo("email_record_suppression")).toHaveLength(1);
  });

  it("odpowiedź bez `ok: true` to porażka zapisu", async () => {
    const db = fakeAdmin();
    db.on("email_record_suppression", { data: { ok: false }, error: null });

    await expect(
      recordSuppression(db.admin, { tenantId: TENANT, email: "a@b.test", reason: "blocked" }),
    ).resolves.toBe(false);
    expect(db.callsTo("email_record_suppression")).toHaveLength(1);
  });

  it("odpowiedź o nieznanym kształcie to porażka, nie cichy sukces", async () => {
    const db = fakeAdmin();
    db.on("email_record_suppression", { data: [1, 2], error: null });

    await expect(
      recordSuppression(db.admin, { tenantId: TENANT, email: "a@b.test", reason: "blocked" }),
    ).resolves.toBe(false);
    expect(db.callsTo("email_record_suppression")).toHaveLength(1);
  });

  it("błąd bazy to porażka zapisu z wpisem w logu", async () => {
    const db = fakeAdmin();
    db.on("email_record_suppression", { data: null, error: { message: "permission denied" } });

    await expect(
      recordSuppression(db.admin, { tenantId: TENANT, email: "a@b.test", reason: "blocked" }),
    ).resolves.toBe(false);
    expect(errorSpy).toHaveBeenCalledWith("[suppression] record failed", "permission denied");
  });
});

// ---------------------------------------------------------------------------
// applyDeliveryEvent - księgowanie zdarzenia dostawcy
// ---------------------------------------------------------------------------
/** Wejście zdarzenia w kształcie, jaki składa webhook. */
function deliveryEvent(overrides: Partial<ApplyDeliveryEventInput> = {}): ApplyDeliveryEventInput {
  return {
    provider: "platform",
    eventId: "evt-1",
    eventType: "platform.bounce",
    kind: "bounced",
    email: "odbiorca@example.test",
    providerMessageId: "msg-1",
    bounceClass: "hard",
    diagnostic: "550 unknown user",
    occurredAt: "2026-08-22T10:00:00.000Z",
    ...overrides,
  };
}

describe("applyDeliveryEvent", () => {
  it("księguje twarde odbicie i melduje postawioną blokadę", async () => {
    const db = fakeAdmin();
    db.on("email_apply_delivery_event", {
      data: {
        ok: true,
        duplicate: false,
        tenant_id: TENANT,
        campaign_id: "camp-1",
        subscriber_id: "sub-1",
        suppression: { ok: true },
      },
      error: null,
    });

    await expect(applyDeliveryEvent(db.admin, deliveryEvent())).resolves.toEqual({
      ok: true,
      duplicate: false,
      tenantId: TENANT,
      campaignId: "camp-1",
      subscriberId: "sub-1",
      suppressed: true,
    });
  });

  it.each([
    ["odbicie twarde", "bounced", "hard"],
    ["odbicie miękkie", "bounced", "soft"],
    ["skarga", "complained", null],
    ["dostarczenie", "delivered", null],
    ["inne", "other", null],
  ] as const)("przekazuje zdarzenie typu %s bez zmiany klasyfikacji", async (_n, kind, cls) => {
    const db = fakeAdmin();
    db.on("email_apply_delivery_event", { data: { ok: true }, error: null });

    await applyDeliveryEvent(db.admin, deliveryEvent({ kind, bounceClass: cls }));

    const args = db.lastCall("email_apply_delivery_event")?.args ?? {};
    expect(args.p_kind).toBe(kind);
    expect(args.p_bounce_class).toBe(cls);
  });

  it("zdarzenie ZDUBLOWANE jest meldowane jako duplikat, nie jako porażka", async () => {
    // Idempotencja po (provider, event_id) żyje w SQL - aplikacja ma tę
    // informację PRZEKAZAĆ, żeby webhook mógł odpowiedzieć 200 na retry.
    const db = fakeAdmin();
    db.on("email_apply_delivery_event", {
      data: { ok: true, duplicate: true, tenant_id: TENANT, suppression: { ok: false } },
      error: null,
    });

    const result = await applyDeliveryEvent(db.admin, deliveryEvent());

    expect(result.ok).toBe(true);
    expect(result.duplicate).toBe(true);
    expect(result.suppressed).toBe(false);
  });

  it("zdarzenie BEZ adresu jest przekazywane z jawnym null-em", async () => {
    const db = fakeAdmin();
    db.on("email_apply_delivery_event", { data: { ok: true }, error: null });

    await applyDeliveryEvent(db.admin, deliveryEvent({ email: null }));

    expect(db.lastCall("email_apply_delivery_event")?.args.p_email).toBeNull();
    expect(db.callsTo("email_apply_delivery_event")).toHaveLength(1);
  });

  it("brakujące podpowiedzi korelacji idą jako null, a ładunek jako pusty obiekt", async () => {
    const db = fakeAdmin();
    db.on("email_apply_delivery_event", { data: { ok: true }, error: null });

    await applyDeliveryEvent(db.admin, deliveryEvent());

    const args = db.lastCall("email_apply_delivery_event")?.args ?? {};
    expect(args.p_tenant_hint).toBeNull();
    expect(args.p_campaign_hint).toBeNull();
    expect(args.p_subscriber_hint).toBeNull();
    expect(args.p_payload).toEqual({});
  });

  it("przekazuje podane podpowiedzi korelacji i ładunek", async () => {
    const db = fakeAdmin();
    db.on("email_apply_delivery_event", { data: { ok: true }, error: null });

    await applyDeliveryEvent(
      db.admin,
      deliveryEvent({
        tenantHint: TENANT,
        campaignHint: "camp-9",
        subscriberHint: "sub-9",
        payload: { raw: true },
      }),
    );

    const args = db.lastCall("email_apply_delivery_event")?.args ?? {};
    expect(args.p_tenant_hint).toBe(TENANT);
    expect(args.p_campaign_hint).toBe("camp-9");
    expect(args.p_subscriber_hint).toBe("sub-9");
    expect(args.p_payload).toEqual({ raw: true });
  });

  it("zdarzenie o nieznanym kształcie odpowiedzi NIE rzuca i nie zapisuje śmieci", async () => {
    const db = fakeAdmin();
    db.on("email_apply_delivery_event", { data: "przetworzono", error: null });

    await expect(applyDeliveryEvent(db.admin, deliveryEvent())).resolves.toEqual({
      ok: false,
      duplicate: false,
      tenantId: null,
      campaignId: null,
      subscriberId: null,
      suppressed: false,
    });
    expect(db.callsTo("email_apply_delivery_event")).toHaveLength(1);
  });

  it("TABLICA w odpowiedzi jest odrzucana przez strażnik kształtu", async () => {
    const db = fakeAdmin();
    db.on("email_apply_delivery_event", { data: [{ ok: true }], error: null });

    await expect(applyDeliveryEvent(db.admin, deliveryEvent())).resolves.toMatchObject({
      ok: false,
      suppressed: false,
    });
    expect(db.callsTo("email_apply_delivery_event")).toHaveLength(1);
  });

  it("zagnieżdżona `suppression` o nieznanym kształcie nie udaje postawionej blokady", async () => {
    const db = fakeAdmin();
    db.on("email_apply_delivery_event", {
      data: { ok: true, suppression: "postawiono" },
      error: null,
    });

    await expect(applyDeliveryEvent(db.admin, deliveryEvent())).resolves.toMatchObject({
      ok: true,
      suppressed: false,
    });
    expect(db.callsTo("email_apply_delivery_event")).toHaveLength(1);
  });

  it("identyfikatory nie-napisowe czytają się jako null", async () => {
    const db = fakeAdmin();
    db.on("email_apply_delivery_event", {
      data: { ok: true, tenant_id: 1, campaign_id: false, subscriber_id: {} },
      error: null,
    });

    await expect(applyDeliveryEvent(db.admin, deliveryEvent())).resolves.toMatchObject({
      tenantId: null,
      campaignId: null,
      subscriberId: null,
    });
    expect(db.callsTo("email_apply_delivery_event")).toHaveLength(1);
  });

  it("błąd bazy oddaje pusty wynik i zostawia ślad w logu", async () => {
    const db = fakeAdmin();
    db.on("email_apply_delivery_event", { data: null, error: { message: "rpc missing" } });

    await expect(applyDeliveryEvent(db.admin, deliveryEvent())).resolves.toEqual({
      ok: false,
      duplicate: false,
      tenantId: null,
      campaignId: null,
      subscriberId: null,
      suppressed: false,
    });
    expect(errorSpy).toHaveBeenCalledWith("[suppression] apply event failed", "rpc missing");
  });
});
