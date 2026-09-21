// POWIADOMIENIE O DECYZJI W SPRAWIE ZGŁOSZENIA KLUBOWEGO - kto dostaje mail,
// kiedy NIE dostaje, i co zostaje w bazie, gdy wysyłka padnie.
//
// SPROSTOWANIE ZLECENIA (przeczytane w kodzie, nie założone).
// Zlecenie mówiło: „powiadomienie idzie do właściwych odbiorców (opiekunowie
// klubu, nie wszyscy członkowie)". To NIE JEST kontrakt tego modułu i test,
// który by tego dowodził, dowodziłby rzeczy nieistniejącej. Jak jest naprawdę:
//
//   * `notifyClubApplicationStatus` wysyła DOKŁADNIE JEDEN mail i DOKŁADNIE
//     DO KANDYDATA. Adres pochodzi z kolumny `email` WIERSZA ZGŁOSZENIA,
//     czytanego przez RPC `admin_club_application_notify_payload`
//     (`SELECT a.email … FROM club_applications a WHERE a.id = p_id AND
//     a.tenant_id = assert_admin_tenant()`, migracja
//     `20260811114031_2ce402fd-…sql`). Nie ma tu żadnego odczytu członków ani
//     opiekunów klubu - nie ma nawet z czego zbudować listy odbiorców.
//   * Trzy typy poczty, jakie ten moduł potrafi wysłać
//     (`club_application_accepted`, `club_application_rejected`,
//     `club_application_more_info`), to w całości korespondencja DO kandydata -
//     patrz `src/lib/email-templates/tx-copy.ts`.
//   * OSOBNEJ ścieżki „powiadom opiekunów o nowym zgłoszeniu" w repozytorium
//     NIE MA. Sprawdzone: `grep -rn "club_application" src/lib src/routes`
//     nie pokazuje ani takiego typu maila, ani takiego RPC; zapis zgłoszenia
//     idzie przez `club_apply_submit`, które zakłada wyłącznie ślad w CRM
//     (`src/lib/clubs/applyApi.ts`). Nowe zgłoszenia opiekunowie odbierają
//     PULLEM - skrzynką w panelu (`ClubApplicationsInbox`), nie PUSHEM.
//     Nie ma więc czego pokrywać poza tym plikiem.
//
// Sensowna wersja tamtej intencji - i to jest tu faktycznie dowodzone -
// brzmi: „mail o decyzji trafia do JEDNEJ osoby, tej której decyzja dotyczy,
// i nie wychodzi poza najemcę zgłaszającego". Stąd dwie asercje, które
// wyglądają na trywialne, a nie są: `sendTxEmail` wywołane RÓWNO RAZ (brak
// rozsyłki) oraz `tenantId` przepisane z wiersza BEZ podmiany (granica
// najemcy; lista wykluczeń poczty jest tenant-scoped, więc podmieniony tenant
// to mail wysłany wbrew cudzej liście wykluczeń).
//
// CO JESZCZE JEST PRZEDMIOTEM DOWODU:
//   1. BRAMKA STATUSU. Panel wysyła decyzję z listy, która mogła się
//      zestarzeć. Ładunek niesie status Z CHWILI ODCZYTU; jeśli się rozjechał,
//      mail NIE MOŻE wyjść. Mail zaprzeczający aktualnej decyzji komisji jest
//      gorszy niż brak maila.
//   2. PIECZĘĆ `admin_club_application_mark_notified` STAWIANA ZAWSZE po
//      próbie wysyłki - przy sukcesie z `p_ok: true`, przy porażce z
//      `p_ok: false` i przyczyną. Nieudana wysyłka NIE wywraca zapisu i NIE
//      rzuca wyjątkiem: handler oddaje `{ ok: false, error }`, a operator
//      widzi w panelu powód, zamiast białego ekranu.
//   3. KLUCZ IDEMPOTENCJI `club-application:<id>:<status>` - dwa kliknięcia
//      w ten sam przycisk dają jeden mail.
//
// CO JEST ATRAPOWANE I DLACZEGO:
//   * `@tanstack/react-start` (`serverFnStubModule`) - `createServerFn` buduje
//     obiekt wywoływalny wyłącznie przez runtime frameworka; bez podmiany
//     fabryki ciało handlera jest z vitest nieosiągalne.
//   * `@/lib/email/transactional.server` - potok poczty ma własny test
//     (`src/lib/email/__tests__/transactional.server.test.ts`) i własnego
//     klienta service-role. Tutaj jest atrapą i LICZNIKIEM: w przypadkach
//     „mail nie wolno wysłać" asercja brzmi „`sendTxEmail` nie zostało
//     wywołane ANI RAZU". ŻADEN test nie wychodzi do sieci ani do bazy.
//   * `context.supabase` - dwa RPC rozdzielone po nazwie, żeby osobno badać
//     odczyt ładunku i osobno pieczęć.
//
// GRANICA DOWODU - UCZCIWIE. Atrapa `createServerFn` NIE URUCHAMIA middleware,
// więc ten plik nie mówi „anonim się nie dostanie". Mówi „funkcja DEKLARUJE
// `requireSupabaseAuth`" (test strukturalny na `asServerFn(...).middleware`).
// Prawdziwą bramką jest `assert_admin_tenant()` W BAZIE - obie funkcje RPC są
// SECURITY DEFINER i same odmawiają obcemu najemcy; server fn jest tu
// transportem, nie granicą bezpieczeństwa. Pilnują tego pgTAP i bramka
// statyczna `check:authz-snapshot`.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE: treści maili w PL/EN i kategorii wykluczeń -
// to zakres `applicationNotify.test.ts` obok.
//
// RODO: żadnych prawdziwych danych. Adresy wyłącznie `@example.com`, imiona
// i nazwiska umowne, identyfikatory zmyślone.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { asServerFn } from "@/test/serverFnHarness";
import { callServerFn } from "@/test/serverFn";
import type { TxSendInput, TxSendResult } from "@/lib/email/transactional.server";

const h = vi.hoisted(() => ({
  sendTxEmail: vi.fn<(input: TxSendInput) => Promise<TxSendResult>>(),
}));

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});

vi.mock("@/lib/email/transactional.server", () => ({ sendTxEmail: h.sendTxEmail }));

const { NOTIFIABLE_STATUSES, emailTypeForStatus, isNotifiableStatus, notifyClubApplicationStatus } =
  await import("@/lib/clubs/applicationNotify.functions");
import type {
  ClubApplicationNotifyResult,
  NotifiableStatus,
} from "@/lib/clubs/applicationNotify.functions";

const PAYLOAD_RPC = "admin_club_application_notify_payload";
const MARK_RPC = "admin_club_application_mark_notified";

const APP_ID = "3f1c8a52-9d0b-4e77-8a21-6b5c4d3e2f10";
const OTHER_APP_ID = "8c2d7b41-1a5e-4f63-9b08-2d7e6c5a4b39";
const TENANT_ID = "b7e14d90-52a3-4c81-9f26-0a8b3c5d7e42";

/** Wiersz oddawany przez `admin_club_application_notify_payload`. */
interface NotifyRow {
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  lang: string | null;
  status: string;
  specialization_slug: string | null;
  tenant_id: string | null;
}

/** Kandydatka w pełni uzupełniona - dane wyłącznie zmyślone. */
function row(overrides: Partial<NotifyRow> = {}): NotifyRow {
  return {
    email: "kandydatka@example.com",
    first_name: "Zofia",
    last_name: "Przykladowska",
    lang: "pl",
    status: "accepted",
    specialization_slug: "energetyka",
    tenant_id: TENANT_ID,
    ...overrides,
  };
}

interface RpcCall {
  name: string;
  params: unknown;
}

interface Scenario {
  /** Surowa odpowiedź RPC ładunku - świadomie `unknown`, bo testujemy też kształty spoza kontraktu. */
  rows?: unknown;
  payloadError?: { message: string } | null;
  markError?: { message: string } | null;
}

function stubSupabase(scenario: Scenario) {
  const calls: RpcCall[] = [];
  const rpc = vi.fn(async (name: string, params?: unknown) => {
    calls.push({ name, params });
    if (name === PAYLOAD_RPC) {
      return { data: scenario.rows ?? null, error: scenario.payloadError ?? null };
    }
    return { data: null, error: scenario.markError ?? null };
  });
  return { supabase: { rpc }, calls };
}

/** Wywołanie przez PRAWDZIWY walidator i PRAWDZIWY handler. */
async function notify(input: unknown, scenario: Scenario = {}) {
  const { supabase, calls } = stubSupabase(scenario);
  const result = await callServerFn<ClubApplicationNotifyResult>(
    notifyClubApplicationStatus,
    input,
    { supabase },
  );
  return { result, calls };
}

/** Skrót na najczęstszy układ: wiersz zgodny ze statusem żądania. */
async function notifyRow(status: NotifiableStatus, overrides: Partial<NotifyRow> = {}) {
  return notify({ applicationId: APP_ID, status }, { rows: [row({ status, ...overrides })] });
}

function sentMail(index = 0): TxSendInput {
  const call = h.sendTxEmail.mock.calls[index];
  if (!call) throw new Error("test: sendTxEmail nie zostało wywołane");
  return call[0];
}

function callsTo(calls: RpcCall[], name: string): RpcCall[] {
  return calls.filter((call) => call.name === name);
}

beforeEach(() => {
  h.sendTxEmail.mockReset();
  h.sendTxEmail.mockResolvedValue({ ok: true });
});

describe("kto jest odbiorcą - sprostowanie zlecenia", () => {
  it("mail idzie na adres Z WIERSZA ZGŁOSZENIA, czyli do kandydata", async () => {
    await notifyRow("accepted", { email: "zofia.p@example.com" });
    expect(sentMail().to).toBe("zofia.p@example.com");
  });

  it("wychodzi RÓWNO JEDEN mail - to korespondencja 1:1, nie rozsyłka", async () => {
    // Gdyby ten moduł kiedykolwiek zaczął zawiadamiać opiekunów albo członków
    // klubu, ta asercja padnie pierwsza - i dobrze, bo taka zmiana wymaga
    // własnej podstawy prawnej i własnej kategorii w liście wykluczeń.
    await notifyRow("rejected");
    expect(h.sendTxEmail).toHaveBeenCalledTimes(1);
  });

  it("nie pyta bazy o nikogo poza tym jednym zgłoszeniem", async () => {
    // Dwa RPC i ani jednego odczytu członków, opiekunów czy ról klubu.
    const { calls } = await notifyRow("accepted");
    expect(calls.map((call) => call.name)).toEqual([PAYLOAD_RPC, MARK_RPC]);
  });

  it("czyta ładunek po identyfikatorze zgłoszenia, w parametrze `p_id`", async () => {
    // Supabase mapuje argumenty PO NAZWIE - literówka w `p_id` to błąd dopiero
    // w bazie, w czasie wykonania.
    const { calls } = await notifyRow("needs_info");
    expect(calls[0]).toEqual({ name: PAYLOAD_RPC, params: { p_id: APP_ID } });
  });
});

describe("isNotifiableStatus - które decyzje kandydat MUSI poznać", () => {
  it.each(["accepted", "rejected", "needs_info"])("status %s powiadamia kandydata", (status) => {
    expect(isNotifiableStatus(status)).toBe(true);
  });

  it.each([
    ["pending", "status początkowy - nie ma o czym zawiadamiać"],
    ["review", "komisja pracuje, decyzji jeszcze nie ma"],
    ["withdrawn", "wycofanie robi kandydat, nie dowiaduje się o nim od nas"],
    ["", "pusty napis - kolumna bez wartości nie może włączyć wysyłki"],
    ["accepted ", "spacja na końcu: to inny napis, nie ten sam status"],
    ["Accepted", "wielkość liter ma znaczenie - baza trzyma małe litery"],
    ["needs-info", "dywiz zamiast podkreślenia: podobny, ale inny"],
    ["needs_information", "prefiks znanego statusu to nadal nie ten status"],
    ["accepted,rejected", "wstrzyknięta lista nie jest pojedynczym statusem"],
  ])("status %s nie powiadamia (%s)", (status) => {
    expect(isNotifiableStatus(status)).toBe(false);
  });

  it("zbiór powiadamialnych statusów to dokładnie te trzy", () => {
    expect([...NOTIFIABLE_STATUSES]).toEqual(["accepted", "rejected", "needs_info"]);
  });
});

describe("emailTypeForStatus - mapowanie 1:1 statusu na szablon", () => {
  it("każdy status ma własny szablon", () => {
    expect(emailTypeForStatus("accepted")).toBe("club_application_accepted");
    expect(emailTypeForStatus("rejected")).toBe("club_application_rejected");
    expect(emailTypeForStatus("needs_info")).toBe("club_application_more_info");
  });

  it("żadne dwa statusy nie dzielą szablonu", () => {
    // Wspólny szablon dla dwóch decyzji oznacza wspólny klucz idempotencji
    // dla pary - i uciszony drugi mail.
    const types = NOTIFIABLE_STATUSES.map(emailTypeForStatus);
    expect(new Set(types).size).toBe(NOTIFIABLE_STATUSES.length);
  });
});

describe("walidator wejścia - jedyna bariera przed dowolnym POST", () => {
  const validate = (input: unknown) => asServerFn(notifyClubApplicationStatus).validator?.(input);

  it.each([...NOTIFIABLE_STATUSES])("przepuszcza poprawny UUID ze statusem %s", (status) => {
    expect(validate({ applicationId: APP_ID, status })).toEqual({
      applicationId: APP_ID,
      status,
    });
  });

  it("odrzuca identyfikator, który nie jest UUID", () => {
    expect(() => validate({ applicationId: "1 OR 1=1", status: "accepted" })).toThrow();
    expect(() => validate({ applicationId: "", status: "accepted" })).toThrow();
    expect(() => validate({ applicationId: `${APP_ID} `, status: "accepted" })).toThrow();
  });

  it("odrzuca identyfikator, który nie jest tekstem albo go brak", () => {
    expect(() => validate({ applicationId: 42, status: "accepted" })).toThrow();
    expect(() => validate({ applicationId: null, status: "accepted" })).toThrow();
    expect(() => validate({ status: "accepted" })).toThrow();
  });

  it("odrzuca status spoza enuma - także ten, który baza zna, a poczta nie", () => {
    expect(() => validate({ applicationId: APP_ID, status: "pending" })).toThrow();
    expect(() => validate({ applicationId: APP_ID, status: "review" })).toThrow();
    expect(() => validate({ applicationId: APP_ID, status: "" })).toThrow();
    expect(() => validate({ applicationId: APP_ID, status: "ACCEPTED" })).toThrow();
    expect(() => validate({ applicationId: APP_ID })).toThrow();
  });

  it("odrzuca wejście, które w ogóle nie jest obiektem", () => {
    expect(() => validate(null)).toThrow();
    expect(() => validate("accepted")).toThrow();
    expect(() => validate([APP_ID, "accepted"])).toThrow();
  });
});

describe("odmowa odczytu - nic nie wychodzi i nic się nie stempluje", () => {
  it("oddaje komunikat bazy, gdy RPC odmawia (np. bramka najemcy)", async () => {
    const { result, calls } = await notify(
      { applicationId: APP_ID, status: "accepted" },
      { payloadError: { message: "permission denied for function" } },
    );
    expect(result).toEqual({ ok: false, error: "permission denied for function" });
    expect(h.sendTxEmail).not.toHaveBeenCalled();
    expect(callsTo(calls, MARK_RPC)).toHaveLength(0);
  });

  it.each([
    ["brak danych", null],
    ["pusta tablica", []],
    ["wartość skalarna zamiast wiersza", "kandydatka@example.com"],
    ["obiekt zamiast tablicy `setof`", { email: "kandydatka@example.com" }],
  ])("%s to `not_found`, a nie mail w próżnię", async (_label, rows) => {
    const { result } = await notify({ applicationId: APP_ID, status: "accepted" }, { rows });
    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(h.sendTxEmail).not.toHaveBeenCalled();
  });

  it.each([
    ["kolumna pusta", ""],
    ["kolumna NULL", null],
  ])("wiersz bez adresu (%s) to `not_found`", async (_label, email) => {
    const { result, calls } = await notify(
      { applicationId: APP_ID, status: "accepted" },
      { rows: [row({ email })] },
    );
    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(h.sendTxEmail).not.toHaveBeenCalled();
    expect(callsTo(calls, MARK_RPC)).toHaveLength(0);
  });
});

describe("bramka statusu - mail nie może zaprzeczać aktualnej decyzji", () => {
  it.each([
    ["accepted", "needs_info"],
    ["rejected", "accepted"],
    ["needs_info", "rejected"],
  ] as const)("żądanie %s milczy, gdy wiersz zdążył przejść na %s", async (requested, current) => {
    const { result, calls } = await notify(
      { applicationId: APP_ID, status: requested },
      { rows: [row({ status: current })] },
    );
    expect(result).toEqual({ ok: true, skipped: "not_notifiable" });
    expect(h.sendTxEmail).not.toHaveBeenCalled();
    // Pieczęć też nie: nie było próby wysyłki, więc nie ma czego odnotować.
    expect(callsTo(calls, MARK_RPC)).toHaveLength(0);
  });

  it("milczy, gdy wiersz cofnięto do statusu bez poczty", async () => {
    const { result } = await notify(
      { applicationId: APP_ID, status: "accepted" },
      { rows: [row({ status: "pending" })] },
    );
    expect(result).toEqual({ ok: true, skipped: "not_notifiable" });
    expect(h.sendTxEmail).not.toHaveBeenCalled();
  });

  it("odmowa braku adresu ma pierwszeństwo przed bramką statusu", async () => {
    // Kolejność jest istotna: brak adresu to błąd danych, a nie „pominięto".
    const { result } = await notify(
      { applicationId: APP_ID, status: "accepted" },
      { rows: [row({ email: null, status: "pending" })] },
    );
    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it("zgodny status przepuszcza mail - kontrola dodatnia bramki", async () => {
    const { result } = await notifyRow("accepted");
    expect(result).toEqual({ ok: true });
    expect(h.sendTxEmail).toHaveBeenCalledTimes(1);
  });
});

describe("treść zlecenia wysyłki - co dokładnie idzie do potoku poczty", () => {
  it("przekazuje komplet pól w jednym zleceniu", async () => {
    await notifyRow("accepted", { lang: "en", first_name: "Zofia" });
    expect(h.sendTxEmail).toHaveBeenCalledWith({
      type: "club_application_accepted",
      to: "kandydatka@example.com",
      lang: "en",
      subjectName: "energetyka",
      ctaPath: "/club",
      metaName: "Zofia",
      tenantId: TENANT_ID,
      idempotencyKey: `club-application:${APP_ID}:accepted`,
    });
  });

  it.each([
    ["accepted", "club_application_accepted"],
    ["rejected", "club_application_rejected"],
    ["needs_info", "club_application_more_info"],
  ] as const)("status %s wysyła szablon %s", async (status, type) => {
    await notifyRow(status);
    expect(sentMail().type).toBe(type);
  });

  it.each([
    ["accepted", "/club"],
    ["rejected", "/club"],
    ["needs_info", "/club/apply"],
  ] as const)("status %s prowadzi przyciskiem do %s", async (status, ctaPath) => {
    // Odrzucony kandydat wraca do klubu (katalog, inne specjalizacje),
    // a proszony o uzupełnienie - do formularza, który ma poprawić.
    await notifyRow(status);
    expect(sentMail().ctaPath).toBe(ctaPath);
  });

  it("przekazuje specjalizację jako nazwę do tematu, a jej brak jako `null`", async () => {
    await notifyRow("accepted");
    expect(sentMail().subjectName).toBe("energetyka");
    h.sendTxEmail.mockClear();
    await notifyRow("accepted", { specialization_slug: null });
    expect(sentMail().subjectName).toBeNull();
  });

  it("przekazuje imię do personalizacji, a jego brak jako `null`", async () => {
    await notifyRow("rejected");
    expect(sentMail().metaName).toBe("Zofia");
    h.sendTxEmail.mockClear();
    await notifyRow("rejected", { first_name: null });
    expect(sentMail().metaName).toBeNull();
  });

  it("nie dokłada własnego napisu przycisku ani szczegółów", async () => {
    // `ctaLabel` i `details` zostają domyślne z `tx-copy` - inaczej treść
    // maila rozjechałaby się z podglądem w panelu.
    await notifyRow("accepted");
    expect(sentMail()).not.toHaveProperty("ctaLabel");
    expect(sentMail()).not.toHaveProperty("details");
  });
});

describe("język - angielski tylko dla dokładnie `en`", () => {
  it("`en` wysyła po angielsku", async () => {
    await notifyRow("accepted", { lang: "en" });
    expect(sentMail().lang).toBe("en");
  });

  it.each([
    ["pl", "polski wprost"],
    ["en-GB", "znacznik BCP-47 to nie jest nasz kod języka"],
    ["EN", "wielkość liter ma znaczenie"],
    ["", "pusta kolumna"],
    ["de", "język, którego nie mamy w szablonach"],
    [null, "kolumna NULL - zgłoszenie sprzed dodania kolumny"],
  ])("%s wysyła po polsku (%s)", async (lang, _why) => {
    await notifyRow("accepted", { lang });
    expect(sentMail().lang).toBe("pl");
  });
});

describe("granica najemcy - mail nie może wyjść poza tenanta zgłaszającego", () => {
  it("przepisuje `tenant_id` z wiersza BEZ podmiany", async () => {
    // Lista wykluczeń poczty jest tenant-scoped. Podmieniony tenant to mail
    // wysłany wbrew CUDZEJ liście wykluczeń.
    const other = "d4a91f37-6c28-4b5d-8e13-7f90a2b6c5d1";
    await notifyRow("accepted", { tenant_id: other });
    expect(sentMail().tenantId).toBe(other);
  });

  it("`tenant_id: null` przechodzi jako `null`, a nie jako podstawiony tenant", async () => {
    // Zgłoszenie bez najemcy MUSI zostać bez najemcy: potok poczty rozwiązuje
    // wtedy tenanta z adresu. Podstawienie „domyślnego" tenanta w tym miejscu
    // przypisałoby cudzą korespondencję do niewłaściwej organizacji.
    await notifyRow("accepted", { tenant_id: null });
    const mail = sentMail();
    expect(mail.tenantId).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(mail, "tenantId")).toBe(true);
  });
});

describe("klucz idempotencji - dwa kliknięcia, jeden mail", () => {
  it("ma kształt `club-application:<id>:<status>`", async () => {
    await notifyRow("needs_info");
    expect(sentMail().idempotencyKey).toBe(`club-application:${APP_ID}:needs_info`);
  });

  it("powtórzone wywołanie liczy TEN SAM klucz i oddaje `duplicate`", async () => {
    // Pierwsze kliknięcie wysyła, drugie trafia w dedup potoku poczty. Gdyby
    // klucz nie był identyczny, drugi klik wysłałby drugi mail.
    await notifyRow("accepted");
    h.sendTxEmail.mockResolvedValue({ ok: true, skipped: "duplicate" });
    const { result } = await notifyRow("accepted");

    expect(sentMail(0).idempotencyKey).toBe(sentMail(1).idempotencyKey);
    expect(result).toEqual({ ok: true, skipped: "duplicate" });
  });

  it("różne decyzje o tym samym zgłoszeniu mają różne klucze", async () => {
    await notifyRow("accepted");
    await notifyRow("rejected");
    expect(sentMail(0).idempotencyKey).not.toBe(sentMail(1).idempotencyKey);
  });

  it("różne zgłoszenia z tą samą decyzją mają różne klucze", async () => {
    await notifyRow("accepted");
    await notify(
      { applicationId: OTHER_APP_ID, status: "accepted" },
      { rows: [row({ status: "accepted" })] },
    );
    expect(sentMail(0).idempotencyKey).not.toBe(sentMail(1).idempotencyKey);
  });

  it("pominięcie inne niż `duplicate` nie przecieka do wyniku", async () => {
    // `sendTxEmail` potrafi oddać `{ ok: true, skipped: "no_recipient" }`.
    // Kontrakt handlera zna tylko „duplikat" - reszta jest zwykłym sukcesem.
    h.sendTxEmail.mockResolvedValue({ ok: true, skipped: "no_recipient" });
    const { result } = await notifyRow("accepted");
    expect(result).toEqual({ ok: true });
  });
});

describe("pieczęć powiadomienia - porażka wysyłki nie wywraca zapisu", () => {
  it("po udanej wysyłce stempluje `p_ok: true` bez powodu błędu", async () => {
    const { calls } = await notifyRow("accepted");
    expect(callsTo(calls, MARK_RPC)).toStrictEqual([
      {
        name: MARK_RPC,
        params: { p_id: APP_ID, p_status: "accepted", p_ok: true, p_error: undefined },
      },
    ]);
  });

  it("stempluje DOPIERO PO wysyłce, nie przed", async () => {
    // Odwrotna kolejność zapisywałaby „powiadomiono" o mailu, który jeszcze
    // nie wyszedł - i który mógł nie wyjść wcale.
    // Jedna wspólna oś czasu dla obu atrap - inaczej test porównywałby
    // kolejność w dwóch osobnych listach, czyli nic.
    const order: string[] = [];
    h.sendTxEmail.mockImplementation(async () => {
      order.push("send");
      return { ok: true };
    });
    const rpc = vi.fn(async (name: string) => {
      order.push(name);
      return name === PAYLOAD_RPC
        ? { data: [row({ status: "accepted" })], error: null }
        : { data: null, error: null };
    });
    await callServerFn<ClubApplicationNotifyResult>(
      notifyClubApplicationStatus,
      { applicationId: APP_ID, status: "accepted" },
      { supabase: { rpc } },
    );
    expect(order).toEqual([PAYLOAD_RPC, "send", MARK_RPC]);
  });

  it.each([
    [
      "powód ma pierwszeństwo przed surowym błędem",
      { ok: false, skipped: "suppressed", reason: "suppressed:complaint", error: "ignored" },
      "suppressed:complaint",
    ],
    [
      "bez powodu idzie surowy błąd potoku",
      { ok: false, error: "supabase_unavailable" },
      "supabase_unavailable",
    ],
    ["bez powodu i bez błędu idzie `send_failed`", { ok: false }, "send_failed"],
  ] as const)("porażka wysyłki: %s", async (_label, sendResult, expected) => {
    h.sendTxEmail.mockResolvedValue(sendResult);
    const { result, calls } = await notifyRow("rejected");

    // 1. Zapis stanu ZAWSZE, z przyczyną - operator ma w panelu powód ciszy.
    expect(callsTo(calls, MARK_RPC)).toStrictEqual([
      {
        name: MARK_RPC,
        params: { p_id: APP_ID, p_status: "rejected", p_ok: false, p_error: expected },
      },
    ]);
    // 2. Handler ODDAJE błąd zamiast rzucać - panel pokazuje komunikat,
    //    a nie biały ekran.
    expect(result).toEqual({ ok: false, error: expected });
  });

  it("nie rzuca wyjątkiem, gdy potok poczty odmawia", async () => {
    h.sendTxEmail.mockResolvedValue({ ok: false, reason: "suppressed:bounce" });
    await expect(notifyRow("needs_info")).resolves.toBeDefined();
  });

  it("duplikat też stempluje `p_ok: true` - mail jednak poszedł", async () => {
    // Pierwsza próba mogła paść PO wysyłce, przed pieczęcią. Duplikat jest
    // wtedy jedyną okazją, żeby ślad w bazie dogonił rzeczywistość.
    h.sendTxEmail.mockResolvedValue({ ok: true, skipped: "duplicate" });
    const { result, calls } = await notifyRow("accepted");
    expect(callsTo(calls, MARK_RPC)).toHaveLength(1);
    expect(callsTo(calls, MARK_RPC)[0].params).toMatchObject({ p_ok: true });
    expect(result).toEqual({ ok: true, skipped: "duplicate" });
  });

  it("stempluje status Z ŻĄDANIA, nie z odczytanego wiersza", async () => {
    // Oba są w tym miejscu równe (bramka statusu wyżej to gwarantuje), ale
    // źródłem musi zostać żądanie: to ono wyznacza klucz idempotencji, więc
    // pieczęć i dedup opisują dokładnie to samo zdarzenie.
    const { calls } = await notifyRow("needs_info");
    expect(callsTo(calls, MARK_RPC)[0].params).toMatchObject({ p_status: "needs_info" });
  });

  it("nieudana pieczęć nie zmienia wyniku udanej wysyłki", async () => {
    // ŚWIADOMY KONTRAKT, nie przeoczenie: mail już wyszedł, więc zgłoszenie
    // porażki kazałoby operatorowi kliknąć ponownie - a wtedy dedup po kluczu
    // idempotencji zatrzyma drugi mail i pieczęć dostanie drugą szansę.
    const { result } = await notify(
      { applicationId: APP_ID, status: "accepted" },
      { rows: [row({ status: "accepted" })], markError: { message: "not_found" } },
    );
    expect(result).toEqual({ ok: true });
  });
});

describe("obudowa server fn - deklaracje, których handler nie egzekwuje", () => {
  it("deklaruje `requireSupabaseAuth` - anonim nie ma jak wejść na tę ścieżkę", () => {
    expect(asServerFn(notifyClubApplicationStatus).middleware).toContain(requireSupabaseAuth);
  });

  it("jest POST-em z walidatorem wejścia", () => {
    // GET niósłby identyfikator zgłoszenia w adresie, czyli w logach serwera
    // i w historii przeglądarki.
    const spec = asServerFn(notifyClubApplicationStatus);
    expect(spec.method).toBe("POST");
    expect(typeof spec.validator).toBe("function");
  });
});
