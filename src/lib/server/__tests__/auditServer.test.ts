// DZIENNIK AUDYTU: `recordAudit` z `src/lib/server/audit.server.ts`.
//
// PO CO TEN PLIK ISTNIEJE. Dziennik audytu jest tym, co DOWODZI, kto co zrobił:
// po awarii, po sporze o treść i przy każdym pytaniu regulatora czyta się
// `public.audit_log`, a nie kod. Do 04.09.2026 ten moduł miał 0/2 FUNKCJI
// pokrycia (0/14 linii w przebiegu podzbioru `src/lib/server/__tests__`,
// 1/14 w pełnej suicie - jedyna wykonana linia to regex na poziomie modułu).
//
// Zero nie brało się z braku testów wokół, a z ich rodzaju: `recordAudit`
// występuje w 13 plikach testowych WYŁĄCZNIE jako cel atrapy
// (`vi.mock(".../audit.server")`). Te testy dowodzą, ŻE handler mutacji woła
// audyt - i to jest wartościowe - ale ani jeden nie wykonuje jego ciała, więc
// cichy brak zapisu (albo odwrotnie: rzut wywalający mutację nadrzędną)
// przechodził przez CI bez śladu. Dowiedzielibyśmy się o tym dokładnie
// w momencie, w którym dowód jest potrzebny, czyli za późno.
//
// CO JEST PRZEDMIOTEM DOWODU:
//   1. wpis powstaje z poprawnym AKTOREM i NAJEMCĄ - wszystkie siedem kolumn,
//      z jawnymi wartościami domyślnymi (a nie `undefined`, które PostgREST
//      po cichu pomija),
//   2. `actorId` podany explicite wygrywa i sesja NIE jest w ogóle czytana,
//   3. bez `actorId` aktor pochodzi z `auth.getUser()`,
//   4. brak sesji ORAZ brak `actorId` -> insert POMINIĘTY, nie insert z NULL-em,
//   5. KONTRAKT BŁĘDU (niżej - to sedno tego pliku),
//   6. unieważnianie NES Edge Cache: `DOCUMENT_PURGE_ACTIONS` - obie strony
//      regexu, brak `await` i odporność na odrzucony purge.
//
// KONTRAKT BŁĘDU - ROZSTRZYGNIĘTY I PRZYPIĘTY. `recordAudit` NIGDY nie odrzuca
// obietnicy i nigdy nie rzuca: błąd insertu kończy się `console.warn`
// („[audit] insert failed"), a wyjątek w środku - `console.warn`
// („[audit] threw"). W obu przypadkach funkcja rozwiązuje się na `undefined`.
// Tak stanowi nagłówek modułu (:1-4) i komentarz przy pobieraniu sesji (:69-70),
// ale do dziś nic tego nie pilnowało.
//
// DLACZEGO WŁAŚNIE TAKI, A NIE „audyt musi się udać albo mutacja pada".
// `recordAudit` jest wołane PO tym, jak mutacja została już zatwierdzona
// w bazie - w tym momencie nie ma czego wycofać. Rzut zamieniłby wtedy
// UDANĄ mutację w błąd widoczny dla klienta, a klient (i ponowienie z panelu)
// zobaczyłby „nie udało się" dla zapisu, który JUŻ istnieje - czyli duplikaty
// treści zamiast brakującego wiersza w logu. Do tego `recordAudit` bywa wołane
// ze ścieżek bez sesji, gdzie sam odczyt aktora może się nie udać. Cena tej
// decyzji jest realna i świadoma: awaria audytu jest CICHA (widać ją tylko
// w logu serwera), więc jej wykrywanie należy do monitoringu, nie do tej
// funkcji. Ten plik przypina jedną i drugą stronę tej umowy.
//
// GRANICA, KTÓRĄ ATRAPUJEMY, I DLACZEGO:
//   * `src/lib/http/documentCache.server` (`purgeDocumentCacheForCurrentHost`)
//     - to SĄSIEDNI moduł z własnym testem, a jego prawdziwe wywołanie czyta
//       żądanie z kontekstu serwera, którego w teście jednostkowym nie ma.
//       Atrapa jest tu instrumentem pomiarowym (licznikiem wywołań), nie
//       zastępstwem dowodu.
//   * klient Supabase - podany jako argument, więc atrapa jest naturalną
//     granicą; łańcuch PostgREST pochodzi ze wspólnego `@/test/supabaseChain`,
//     żeby test widział DOKŁADNIE te ogniwa, które kod naprawdę wywołał.
// PRAWDZIWE zostaje wszystko, co jest przedmiotem dowodu: `recordAudit`,
// `DOCUMENT_PURGE_ACTIONS` i kolejność kroków. MODUŁU POKRYWANEGO NIE
// ATRAPUJEMY - to reguła, bez której ten plik byłby testem atrapy.
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, ok, supabaseFromStub, type SupabaseResult } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({
  purge: vi.fn<() => Promise<number>>(),
}));

vi.mock("@/lib/http/documentCache.server", () => ({
  purgeDocumentCacheForCurrentHost: h.purge,
}));

import { purgeDocumentCacheForCurrentHost } from "@/lib/http/documentCache.server";
import { recordAudit, type AuditAction } from "@/lib/server/audit.server";

// --- dane syntetyczne (RODO: żadnych prawdziwych identyfikatorów ani nazwisk)

const TENANT = "00000000-0000-4000-8000-0000000000aa";
/** Aktor podany przez wołającego (np. z kontekstu server fn). */
const EXPLICIT_ACTOR = "00000000-0000-4000-8000-000000000001";
/** Aktor, jakiego zwraca bieżąca sesja Supabase. */
const SESSION_ACTOR = "00000000-0000-4000-8000-000000000002";
const ENTITY = "00000000-0000-4000-8000-0000000000ee";

/** Kształt odpowiedzi `auth.getUser()`, z którego moduł czyta identyfikator. */
interface GetUserResult {
  data: { user: { id: string } | null };
}

/** Powierzchnia klienta, której dotyka `recordAudit`. */
interface AuditClientSurface {
  from: (table: string) => unknown;
  auth: { getUser: () => Promise<GetUserResult> };
}

/**
 * STRAŻNIK, nie rzutowanie. `as unknown as SupabaseClient` przepuściłby atrapę
 * BEZ ogniwa `auth` - czyli test „przeszedłby" tam, gdzie kod produkcyjny nie
 * miałby skąd wziąć aktora. Warunek sprawdza obie powierzchnie w runtime
 * i dopiero wtedy zawęża typ.
 */
function isAuditClient(
  candidate: AuditClientSurface,
): candidate is AuditClientSurface & SupabaseClient {
  return typeof candidate.from === "function" && typeof candidate.auth.getUser === "function";
}

interface HarnessOptions {
  /**
   * Sesja: `undefined` = zalogowany `SESSION_ACTOR`, `null` = BRAK sesji
   * (anonimowe serverFn). Rozróżnienie jest tu treścią, nie wygodą - to dwie
   * różne ścieżki modułu.
   */
  user?: { id: string } | null;
  /** Odpowiedź PostgREST na insert do `audit_log`. */
  insert?: SupabaseResult;
  /** Sesja niedostępna przez WYJĄTEK, a nie przez pusty wynik. */
  authThrows?: boolean;
  /** Klient rozłączony: samo `from()` rzuca, jeszcze przed zapytaniem. */
  fromThrows?: boolean;
}

function harness(opts: HarnessOptions = {}) {
  const stub = supabaseFromStub();
  stub.setResponse("audit_log", opts.insert ?? ok(null));
  const getUser = vi.fn(async (): Promise<GetUserResult> => {
    if (opts.authThrows) throw new Error("auth: sesja niedostępna");
    return { data: { user: opts.user === undefined ? { id: SESSION_ACTOR } : opts.user } };
  });
  const from = opts.fromThrows
    ? (): unknown => {
        throw new Error("supabase: klient rozłączony");
      }
    : stub.from;
  const candidate: AuditClientSurface = { from, auth: { getUser } };
  if (!isAuditClient(candidate)) {
    throw new Error("test: atrapa nie niesie from() i auth.getUser()");
  }
  return { supabase: candidate, stub, getUser };
}

/** Wiersz, który moduł wstawia do `public.audit_log`. */
interface AuditRow {
  tenant_id: string;
  actor_id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
}

function isAuditRow(value: unknown): value is AuditRow {
  return (
    typeof value === "object" &&
    value !== null &&
    "tenant_id" in value &&
    typeof value.tenant_id === "string" &&
    "actor_id" in value &&
    typeof value.actor_id === "string" &&
    "action" in value &&
    typeof value.action === "string" &&
    "entity_type" in value &&
    typeof value.entity_type === "string" &&
    "entity_id" in value &&
    (value.entity_id === null || typeof value.entity_id === "string") &&
    "metadata" in value &&
    typeof value.metadata === "object" &&
    value.metadata !== null &&
    "ip" in value &&
    (value.ip === null || typeof value.ip === "string")
  );
}

/**
 * Wiersz z ostatniego łańcucha `audit_log` - odczytany bez rzutowań. Brak
 * łańcucha albo niepełny wiersz MA być błędem testu: „prawie wiersz" w logu
 * audytu jest tak samo bezużyteczny jak brak wiersza.
 */
function auditRow(stub: ReturnType<typeof supabaseFromStub>): AuditRow {
  const chain = stub.lastChain("audit_log");
  if (!chain) throw new Error("test: kod nie tknął tabeli audit_log");
  const row = chain.argsOf("insert")?.[0];
  if (!isAuditRow(row)) {
    throw new Error(`test: wiersz audytu nie ma pełnego kształtu: ${JSON.stringify(row)}`);
  }
  return row;
}

/** Wszystkie komunikaty, jakie moduł oddał do `console.warn`, w jednym tekście. */
function warnings(spy: MockInstance<typeof console.warn>): string {
  return spy.mock.calls.map((call) => call.map((part) => String(part)).join(" ")).join("\n");
}

/**
 * Dopchnięcie kolejki mikrozadań. Purge jest wołany BEZ `await`, więc jego
 * `.catch(...)` biegnie po powrocie z `recordAudit` - bez tego dowód
 * o odporności na odrzucony purge sprawdzałby stan sprzed reakcji.
 */
async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

let warnSpy: MockInstance<typeof console.warn>;

beforeEach(() => {
  h.purge.mockReset();
  h.purge.mockResolvedValue(0);
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("premisa: dowód wykonuje PRAWDZIWY moduł, a purge jest tylko licznikiem", () => {
  it("atrapa purge naprawdę podmieniła import modułu", () => {
    // Moduł produkcyjny importuje `../http/documentCache.server` ścieżką
    // RELATYWNĄ, a atrapa stoi na aliasie `@/lib/...`. Gdyby te dwie ścieżki
    // nie sprowadzały się do tego samego modułu, KAŻDA asercja o purge niżej
    // byłaby prawdziwa bez wykonania czegokolwiek - a to najgorszy rodzaj
    // zielonego testu.
    expect(purgeDocumentCacheForCurrentHost).toBe(h.purge);
  });

  it("`recordAudit` jest prawdziwą funkcją, nie atrapą", () => {
    expect(typeof recordAudit).toBe("function");
  });
});

describe("wpis powstaje z poprawnym aktorem i najemcą", () => {
  it("niesie najemcę, aktora, akcję, typ i identyfikator encji, metadane oraz IP", async () => {
    // To jest CAŁA treść dowodu „kto co zrobił". Zgubiona kolumna nie psuje
    // niczego widocznego w chwili zapisu - psuje odczyt za pół roku.
    const hn = harness();
    await recordAudit(hn.supabase, {
      tenantId: TENANT,
      action: "post.update",
      entityType: "post",
      entityId: ENTITY,
      metadata: { title: "Zmiana tytułu", fields: ["title", "slug"] },
      ip: "203.0.113.7",
      actorId: EXPLICIT_ACTOR,
    });
    expect(auditRow(hn.stub)).toEqual({
      tenant_id: TENANT,
      actor_id: EXPLICIT_ACTOR,
      action: "post.update",
      entity_type: "post",
      entity_id: ENTITY,
      metadata: { title: "Zmiana tytułu", fields: ["title", "slug"] },
      ip: "203.0.113.7",
    });
  });

  it("wiersz idzie do tabeli `audit_log` ogniwem `insert` (jeden zapis, nie upsert)", async () => {
    // Nazwa tabeli i rodzaj ogniwa są kontraktem RLS („audit_log staff insert
    // tenant"): `upsert` albo inna tabela przechodzą przez `tsc` bez słowa.
    const hn = harness();
    await recordAudit(hn.supabase, {
      tenantId: TENANT,
      action: "role.grant",
      entityType: "user_role",
      actorId: EXPLICIT_ACTOR,
    });
    expect(hn.stub.chainsFor("audit_log")).toHaveLength(1);
    const chain = hn.stub.lastChain("audit_log");
    expect(chain?.has("insert")).toBe(true);
    expect(chain?.has("upsert")).toBe(false);
    expect(chain?.has("update")).toBe(false);
  });

  it("pola opcjonalne mają JAWNE wartości domyślne: entity_id=null, metadata={}, ip=null", async () => {
    // `undefined` nie jest tu równoważne `null`: PostgREST po cichu POMIJA
    // klucze o wartości `undefined`, więc wiersz wyszedłby bez tych kolumn
    // i wpis czytałoby się inaczej niż wpisy z tymi samymi danymi podanymi
    // wprost. Jawne `null`/`{}` trzymają jeden kształt wiersza dla wszystkich.
    const hn = harness();
    await recordAudit(hn.supabase, {
      tenantId: TENANT,
      action: "media.upload",
      entityType: "media",
      actorId: EXPLICIT_ACTOR,
    });
    const row = auditRow(hn.stub);
    expect(row.entity_id).toBeNull();
    expect(row.metadata).toEqual({});
    expect(row.ip).toBeNull();
  });

  it("`actorId` podany explicite WYGRYWA i sesja NIE jest w ogóle czytana", async () => {
    // Asercja na LICZBIE wywołań, nie na wyniku. Ścieżki serwerowe znają
    // aktora z własnego kontekstu, a klient bywa service-role - dodatkowy
    // odczyt sesji nie zwróciłby wtedy nikogo i wpis zostałby POMINIĘTY,
    // czyli akcja administratora zniknęłaby z dziennika.
    const hn = harness({ user: null });
    await recordAudit(hn.supabase, {
      tenantId: TENANT,
      action: "role.revoke",
      entityType: "user_role",
      entityId: ENTITY,
      actorId: EXPLICIT_ACTOR,
    });
    expect(hn.getUser).toHaveBeenCalledTimes(0);
    expect(auditRow(hn.stub).actor_id).toBe(EXPLICIT_ACTOR);
  });

  it("bez `actorId` aktor pochodzi z bieżącej sesji (jedno wywołanie `auth.getUser`)", async () => {
    // Odwrotna strona tej samej reguły: RLS wymaga `actor_id = auth.uid()`,
    // więc wołający, który aktora nie zna, MUSI go dostać z sesji.
    const hn = harness();
    await recordAudit(hn.supabase, {
      tenantId: TENANT,
      action: "page.create",
      entityType: "page",
      entityId: ENTITY,
    });
    expect(hn.getUser).toHaveBeenCalledTimes(1);
    expect(auditRow(hn.stub).actor_id).toBe(SESSION_ACTOR);
  });

  it("`actorId: null` liczy się jak brak - aktor idzie z sesji", async () => {
    // Wołający, który ma opcjonalny kontekst, przekazuje `null` zamiast
    // pomijać pole. `??` musi traktować to identycznie, inaczej połowa
    // wywołań w repo cicho gubiłaby aktora.
    const hn = harness();
    await recordAudit(hn.supabase, {
      tenantId: TENANT,
      action: "tag.delete",
      entityType: "tag",
      actorId: null,
    });
    expect(hn.getUser).toHaveBeenCalledTimes(1);
    expect(auditRow(hn.stub).actor_id).toBe(SESSION_ACTOR);
  });
});

describe("brak sesji: insert POMINIĘTY, nie wiersz bez aktora", () => {
  it("nie ma sesji ani `actorId` -> tabela nie jest tknięta i pada ostrzeżenie", async () => {
    // Wpis z `actor_id = null` byłby GORSZY od braku wpisu: wyglądałby jak
    // dowód, nie wskazując nikogo, a i tak odbiłby się od RLS. Dlatego moduł
    // pomija zapis i mówi o tym w logu - z nazwą akcji, żeby dało się
    // odtworzyć, czego brakuje.
    const hn = harness({ user: null });
    await recordAudit(hn.supabase, {
      tenantId: TENANT,
      action: "media.delete",
      entityType: "media",
      entityId: ENTITY,
    });
    expect(hn.stub.chainsFor("audit_log")).toHaveLength(0);
    expect(warnings(warnSpy)).toContain("[audit] skipped");
    expect(warnings(warnSpy)).toContain("media.delete");
  });

  it("pominięcie NIE jest błędem: obietnica rozwiązuje się na `undefined`", async () => {
    // To jest kontrakt „audyt nie wybucha na anon serverFn". Gdyby brak sesji
    // rzucał, każda publiczna ścieżka wołająca audyt zwracałaby błąd zamiast
    // wyniku, choć jej właściwa praca się udała.
    const hn = harness({ user: null });
    await expect(
      recordAudit(hn.supabase, {
        tenantId: TENANT,
        action: "media.delete",
        entityType: "media",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("kontrakt błędu: audyt NIGDY nie wywala operacji nadrzędnej", () => {
  it("błąd insertu NIE rzuca - jest `console.warn` z komunikatem bazy", async () => {
    // Mutacja w tym momencie jest już zatwierdzona. Rzut zamieniłby udany
    // zapis w błąd widoczny dla klienta i sprowokował ponowienie, czyli
    // duplikat treści - koszt wyższy niż brakujący wiersz w logu.
    const hn = harness({ insert: fail("new row violates row-level security policy", "42501") });
    await expect(
      recordAudit(hn.supabase, {
        tenantId: TENANT,
        action: "post.publish",
        entityType: "post",
        entityId: ENTITY,
        actorId: EXPLICIT_ACTOR,
      }),
    ).resolves.toBeUndefined();
    expect(warnings(warnSpy)).toContain("[audit] insert failed");
    expect(warnings(warnSpy)).toContain("new row violates row-level security policy");
  });

  it("wyjątek w środku jest ŁAPANY - `console.warn` „[audit] threw", async () => {
    // Rozłączony klient rzuca zanim powstanie zapytanie, więc gałąź `catch`
    // to jedyne, co dzieli udaną mutację od błędu u klienta.
    const hn = harness({ fromThrows: true, insert: ok(null) });
    await expect(
      recordAudit(hn.supabase, {
        tenantId: TENANT,
        action: "post.delete",
        entityType: "post",
        entityId: ENTITY,
        actorId: EXPLICIT_ACTOR,
      }),
    ).resolves.toBeUndefined();
    expect(warnings(warnSpy)).toContain("[audit] threw");
    expect(warnings(warnSpy)).toContain("klient rozłączony");
  });

  it("awaria odczytu sesji też nie wywala i NIE próbuje zapisu bez aktora", async () => {
    // Wyjątek z `auth.getUser()` (np. zerwana sieć do GoTrue) wypada tą samą
    // gałęzią co rozłączony klient. Sprawdzamy dodatkowo, że po awarii aktora
    // moduł nie „ratuje" wpisu zapisem z pustym `actor_id`.
    const hn = harness({ authThrows: true });
    await expect(
      recordAudit(hn.supabase, {
        tenantId: TENANT,
        action: "revision.restore",
        entityType: "post_revision",
        entityId: ENTITY,
      }),
    ).resolves.toBeUndefined();
    expect(hn.stub.chainsFor("audit_log")).toHaveLength(0);
    expect(warnings(warnSpy)).toContain("[audit] threw");
  });

  it("żadna ze ścieżek awarii nie odrzuca obietnicy - trzy warianty w jednym dowodzie", async () => {
    // Jedno zdanie, o które chodzi w całym tym pliku: WSZYSTKIE trzy tryby
    // awarii (błąd bazy, rzut klienta, brak sesji) kończą się identycznie -
    // rozwiązaniem na `undefined`. Ten test pada, gdy ktokolwiek dołoży
    // `throw` do audytu.
    const cases = [
      harness({ insert: fail("connection reset") }),
      harness({ fromThrows: true }),
      harness({ user: null }),
    ];
    for (const hn of cases) {
      await expect(
        recordAudit(hn.supabase, {
          tenantId: TENANT,
          action: "category.update",
          entityType: "category",
        }),
      ).resolves.toBeUndefined();
    }
  });
});

/**
 * Mapa „akcja -> czy unieważnia publiczny dokument". Zapisana przez
 * `satisfies Record<AuditAction, boolean>`, a nie adnotacją, bo:
 *   * `satisfies` zachowuje literalne klucze, więc iteracja niżej jest
 *     otypowana bez rzutowań,
 *   * BRAK którejkolwiek akcji z unii `AuditAction` jest błędem `tsc`. Nowa
 *     mutacja nie przejdzie więc przeglądu bez rozstrzygnięcia, czy zmienia
 *     publiczny HTML - a to jest dokładnie ta decyzja, którą komentarz
 *     modułu (:44-47) chce wymusić na przyszłych autorach.
 */
const PURGES_DOCUMENT_CACHE = {
  "media.upload": false,
  "media.delete": false,
  "media.update": false,
  "media.bulk_move": false,
  "media.bulk_delete": false,
  "media.duplicate": false,
  "media.folder_create": false,
  "media.folder_rename": false,
  "media.folder_delete": false,
  "role.grant": false,
  "role.revoke": false,
  "wp_import.cancel": false,
  "post.create": true,
  "post.update": true,
  "post.delete": true,
  "post.duplicate": true,
  "post.publish": true,
  "post.schedule": true,
  "post.review.submit": true,
  "page.create": true,
  "page.update": true,
  "page.delete": true,
  "page.publish": true,
  "revision.restore": true,
  "category.create": true,
  "category.update": true,
  "category.delete": true,
  "tag.create": true,
  "tag.delete": true,
  "redirect.create": true,
  "redirect.update": true,
  "redirect.delete": true,
  "redirect.import": true,
} satisfies Record<AuditAction, boolean>;

function auditActions(): AuditAction[] {
  return Object.keys(PURGES_DOCUMENT_CACHE).filter((key): key is AuditAction => key.length > 0);
}

describe("unieważnianie NES Edge Cache: obie strony `DOCUMENT_PURGE_ACTIONS`", () => {
  it("akcja z grupy dokumentów woła purge dokładnie raz - i wpis i tak powstaje", async () => {
    // Audyt jest JEDYNYM punktem unieważnienia cache (komentarz modułu
    // :44-47). Zgubiony purge nie psuje niczego w bazie - podaje CZYTELNIKOM
    // starą treść, więc widać go dopiero po skargach.
    const hn = harness();
    await recordAudit(hn.supabase, {
      tenantId: TENANT,
      action: "post.publish",
      entityType: "post",
      entityId: ENTITY,
      actorId: EXPLICIT_ACTOR,
    });
    expect(h.purge).toHaveBeenCalledTimes(1);
    expect(auditRow(hn.stub).action).toBe("post.publish");
  });

  it("akcja spoza grupy NIE woła purge - `media.upload` i `role.grant`", async () => {
    // Purge zrzuca cały cache hosta, więc rozszerzenie regexu „na wszelki
    // wypadek" na wgrywanie plików i nadawanie ról zamieniłoby każdą operację
    // panelu w globalne unieważnienie. Ta strona regexu jest tak samo treścią
    // jak druga.
    const hn = harness();
    for (const action of ["media.upload", "role.grant"] as const) {
      await recordAudit(hn.supabase, {
        tenantId: TENANT,
        action,
        entityType: "media",
        actorId: EXPLICIT_ACTOR,
      });
    }
    expect(h.purge).toHaveBeenCalledTimes(0);
    expect(hn.stub.chainsFor("audit_log")).toHaveLength(2);
  });

  it("KAŻDA akcja z unii `AuditAction` trafia po właściwej stronie regexu", async () => {
    // Wyczerpująca tabela: 33 akcje, każda z jawnie zadeklarowanym skutkiem
    // dla cache. Regex `^(post|page|category|tag|redirect|revision)\.` jest
    // ZAKOTWICZONY i wymaga kropki, więc prefiks decyduje o wszystkim -
    // i właśnie dlatego przemianowanie akcji (np. `post.*` -> `content.*`)
    // musi się tu zapalić, a nie po cichu wyłączyć unieważnianie.
    const observed: Record<string, boolean> = {};
    for (const action of auditActions()) {
      h.purge.mockClear();
      const hn = harness();
      await recordAudit(hn.supabase, {
        tenantId: TENANT,
        action,
        entityType: "entity",
        actorId: EXPLICIT_ACTOR,
      });
      observed[action] = h.purge.mock.calls.length > 0;
    }
    expect(observed).toEqual(PURGES_DOCUMENT_CACHE);
  });

  it("purge NIE jest awaitowany: audyt kończy się, choć purge wciąż wisi", async () => {
    // `void purgeDocumentCacheForCurrentHost()` bez `await` to decyzja
    // wydajnościowa: unieważnienie chodzi po sieci (L2), a mutacja nie może
    // czekać na jego rundę. Zawieszony purge, na którym da się „zawiesić"
    // audyt, jest dowodem tej różnicy - z `await` ten test nigdy by nie wrócił.
    const hn = harness();
    h.purge.mockReturnValue(new Promise<number>(() => undefined));
    await expect(
      recordAudit(hn.supabase, {
        tenantId: TENANT,
        action: "page.update",
        entityType: "page",
        entityId: ENTITY,
        actorId: EXPLICIT_ACTOR,
      }),
    ).resolves.toBeUndefined();
    expect(auditRow(hn.stub).action).toBe("page.update");
  });

  it("ODRZUCONY purge nie psuje audytu ani nie zostawia nieobsłużonego odrzucenia", async () => {
    // `.catch(() => undefined)` jest tu jedyną rzeczą, która dzieli awarię
    // cache od wywalonego procesu: obietnica bez `await` i bez `catch` kończy
    // się nieobsłużonym odrzuceniem, a to w Node zabija proces serwera.
    const hn = harness();
    h.purge.mockRejectedValue(new Error("edge cache: 502 od L2"));
    await expect(
      recordAudit(hn.supabase, {
        tenantId: TENANT,
        action: "redirect.import",
        entityType: "redirect",
        actorId: EXPLICIT_ACTOR,
      }),
    ).resolves.toBeUndefined();
    await flushMicrotasks();
    expect(auditRow(hn.stub).action).toBe("redirect.import");
    expect(warnings(warnSpy)).not.toContain("[audit] threw");
  });

  it("purge biegnie NIEZALEŻNIE od tego, czy wpis audytu powstał", async () => {
    // Kolejność w kodzie (:62 przed blokiem `try`) jest treścią: czytelnik
    // dostaje świeżą treść nawet wtedy, gdy log nie zapisał, kto ją zmienił.
    // Odwrócenie tej kolejności byłoby cichą regresją „mutacja przeszła,
    // cache został stary" na każdej ścieżce bez sesji.
    const hn = harness({ user: null });
    await recordAudit(hn.supabase, {
      tenantId: TENANT,
      action: "category.delete",
      entityType: "category",
      entityId: ENTITY,
    });
    expect(h.purge).toHaveBeenCalledTimes(1);
    expect(hn.stub.chainsFor("audit_log")).toHaveLength(0);
  });

  it("purge biegnie także wtedy, gdy insert odbił się od RLS", async () => {
    // Ta sama reguła po drugiej stronie: błąd zapisu w logu nie może zostawić
    // czytelnikom nieaktualnego dokumentu.
    const hn = harness({ insert: fail("permission denied for table audit_log", "42501") });
    await recordAudit(hn.supabase, {
      tenantId: TENANT,
      action: "tag.create",
      entityType: "tag",
      actorId: EXPLICIT_ACTOR,
    });
    expect(h.purge).toHaveBeenCalledTimes(1);
    expect(warnings(warnSpy)).toContain("[audit] insert failed");
  });
});
