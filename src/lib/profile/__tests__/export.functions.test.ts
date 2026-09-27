// Server fn eksportu RODO (`export.functions.ts`) - pokrycie RUNTIME'OWE handlera.
//
// PO CO, SKORO SĄ DWIE BRAMKI STATYCZNE. `exportOwnerScope.gate` i
// `exportManifestParity.gate` czytają KOD ŹRÓDŁOWY: łapią sekcję bez filtra
// właściciela i sekcję bez wpisu w rejestrze. Nie widzą niczego, co dzieje się
// dopiero przy wykonaniu - a tam mieszka logika, od której zależy treść pliku
// osoby, której dane dotyczą:
//
//   1. ZAKRES WŁAŚCICIELA W WYWOŁANIU, NIE W TEKŚCIE. Każdy odczyt tabeli jest
//      zawężony WARTOŚCIĄ `userId` z kontekstu uwierzytelnienia, na kolumnie
//      zapisanej niżej - a nie tylko zawiera w tekście `.eq(..., userId)`.
//   2. MODUŁY RPC-ONLY (nabór prelegentów, kluby). Jedno wykonanie RPC na cały
//      moduł, rozbicie na zadeklarowane sekcje, pusta lista zamiast `undefined`
//      przy braku klucza - i, co ważne prawnie, klucz SPOZA rejestru (cudze
//      oceny, notatka komisji) nie trafia do pliku, nawet gdy baza go odda.
//   3. SIEĆ KONTAKTÓW. Sklejanie stron po 50 do sufitu, jawne mapowanie pól,
//      a błąd dowolnej strony oblewa CAŁĄ sekcję zamiast oddać jej połowę.
//   4. AWARIA JEST JAWNA. Odmowa i odrzucenie trafiają do `errors`
//      i `manifest.failed` (kolejnością rejestru), reszta paczki przeżywa.
//   5. UCIĘCIE I ROZJAZD SĄ W PLIKU: sekcja na sufcie ląduje w `truncated`,
//      rozjazd deklaracji z implementacją - w `manifest.drift`.
//
// ATRAPA JEST WIERNA TAM, GDZIE TO MA ZNACZENIE. `rpc()` oddaje LENIWY thenable,
// który wykonuje zapytanie przy KAŻDYM `.then()` - dokładnie jak builder
// PostgREST. Na atrapie gorliwej (`async rpc()`) asercja „jedno RPC na cały
// moduł" byłaby zielona także po usunięciu `Promise.resolve` z produkcji,
// czyli przy ośmiu identycznych zapytaniach o kluby i czterech o nabór.
//
// CZEGO NIE DOWODZI: kto może wywołać eksport (middleware sprawdzamy wyłącznie
// jako deklarację) ani co zwracają ciała funkcji SQL i polityki RLS - to testy
// bazy (`supabase/tests/profile_export_rls_scope_test.sql`, a dla naboru
// `scripts/events-harness/runtime_test.d/42_cfp.sql`).
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  /** Rozjazd, który ma zgłosić bramka `diffExportManifest`; `null` = prawdziwa bramka. */
  drift: null as { missing: string[]; undeclared: string[] } | null,
  /** Identyfikatory sekcji podane bramce rozjazdu - po jednym wpisie na eksport. */
  diffInputs: [] as string[][],
}));

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});

vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { name: "requireSupabaseAuth" },
}));

// Rejestr zostaje PRAWDZIWY - podmieniona jest wyłącznie bramka rozjazdu, i to
// przelotką: bez zaplanowanego rozjazdu woła oryginał. Inaczej rozjazdu nie da
// się wywołać, bo zbiór sekcji jest literałem w ciele server fn.
vi.mock("@/lib/profile/exportManifest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/profile/exportManifest")>();
  return {
    ...actual,
    diffExportManifest: (ids: readonly string[]) => {
      h.diffInputs.push([...ids]);
      return h.drift ?? actual.diffExportManifest(ids);
    },
  };
});

import { exportMyData } from "@/lib/profile/export.functions";
import {
  EXPORT_EXCLUSIONS,
  EXPORT_PROFILE_VIEWERS_LIMIT,
  EXPORT_ROW_LIMIT,
  EXPORT_SECTION_GROUPS,
  EXPORT_SECTION_IDS,
  PERSONAL_DATA_EXPORT_FORMAT,
} from "@/lib/profile/exportManifest";
import { asServerFn, callServerFn, serverFnMiddlewareNames } from "@/test/serverFnHarness";
import { fail, ok, supabaseFromStub, supabaseRpcStub, type SupabaseResult } from "@/test/supabase";
import { DZIEN, FIXED_NOW_ISO, freezeClock, relativeIso } from "@/test/time";

freezeClock();

type ExportPayload = Awaited<ReturnType<typeof exportMyData>>;

const USER_ID = "11111111-1111-4111-8111-111111111111";
/** Adres wyłącznie z domeny zarezerwowanej - to plik z danymi osobowymi. */
const EMAIL = "osoba.badana@example.com";

/**
 * Inwentarz odczytów tabel: tabela i kolumna właściciela porównywana z
 * `userId`. `null` = zawężenie RLS-em (lista `RLS_SCOPED` bramki statycznej,
 * dowód w pgTAP). Zmiana tej listy jest decyzją o zakresie danych osobowych,
 * nie poprawką testu. `profile_skill_endorsements` występuje dwa razy - to
 * dwie sekcje na jednej tabeli (poparcia udzielone i otrzymane).
 */
const OWNER_FILTERS: ReadonlyArray<readonly [table: string, ownerColumn: string | null]> = [
  ["user_roles", "user_id"],
  ["profile_badges", "user_id"],
  ["user_consents", "user_id"],
  ["user_consent_events", "user_id"],
  ["profile_experiences", "user_id"],
  ["profile_education", "user_id"],
  ["profile_skills", "user_id"],
  ["profile_awards", "user_id"],
  ["profile_hobbies", "user_id"],
  ["profile_cv_files", "user_id"],
  ["media_mentions", "user_id"],
  ["personality_results", "user_id"],
  ["user_follows", "user_id"],
  ["eu_policy_follows", "user_id"],
  ["user_bookmarks", "user_id"],
  ["user_read_history", "user_id"],
  ["comments", "user_id"],
  ["user_reports", "reporter_id"],
  ["profile_recommendations", "author_id"],
  ["profile_skill_endorsements", "endorser_id"],
  ["profile_skill_endorsements", "recipient_id"],
  ["conversations", null],
  ["conversation_participants", "user_id"],
  ["messages", "sender_id"],
  ["conversation_nicknames", "set_by"],
  ["user_blocks", "blocker_id"],
  ["payment_orders", "user_id"],
  ["user_subscriptions", "user_id"],
  ["user_purchases", "user_id"],
  ["notification_preferences", "user_id"],
  ["notifications", null],
  ["push_subscriptions", "user_id"],
  ["user_invitations", "invited_by"],
];

const TABLES = [...new Set(OWNER_FILTERS.map(([table]) => table))];

const PROFILE_ROW = { id: USER_ID, display_name: "Anna Nowak", tenant_id: "tenant-alfa" };

const from = supabaseFromStub();
const rpc = supabaseRpcStub();

/**
 * Klient user-scoped w zakresie, którego dotyka eksport. `rpc()` jest leniwym
 * thenable'em - każde `.then()` to osobne wykonanie zapisane w `rpc.calls`
 * (patrz nagłówek: bez tego liczenie wykonań niczego by nie dowodziło).
 */
function client() {
  return {
    from: from.from,
    rpc: (name: string, args?: Record<string, unknown>) => ({
      then: (
        onFulfilled?: (value: SupabaseResult) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => rpc.rpc(name, args).then(onFulfilled, onRejected),
    }),
  };
}

/** Eksport tak, jak woła go framework - z kontekstem od `requireSupabaseAuth`. */
function runExport(claims: Record<string, unknown> = { email: EMAIL }): Promise<ExportPayload> {
  return callServerFn<ExportPayload>(exportMyData, {
    context: { supabase: client(), userId: USER_ID, claims },
  });
}

/** `n` wierszy o rozróżnialnych identyfikatorach (sufity liczymy na długości). */
function rows(n: number, prefix: string): { id: string }[] {
  return Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${i}` }));
}

beforeEach(() => {
  from.reset();
  rpc.reset();
  h.drift = null;
  h.diffInputs = [];
  // Konto, które niczego nie używało: każda tabela i każdy moduł odpowiada
  // pustką, istnieje wyłącznie profil. Brak planu dla nowej tabeli albo RPC
  // oblewa test „komplet sekcji" niżej - nowa sekcja wymaga wpisu w inwentarzu.
  for (const table of TABLES) from.setResponse(table, ok([]));
  rpc.setData("get_own_profile", [PROFILE_ROW]);
  rpc.setData("get_own_author_profile", []);
  rpc.setData("my_connections", []);
  rpc.setData("my_connection_requests", []);
  rpc.setData("my_introduction_requests", []);
  rpc.setData("list_recommendations", []);
  rpc.setData("my_profile_viewers", []);
  rpc.setData("profile_view_stats", [{ views_total: 0, views_30d: 0 }]);
  rpc.setData("list_my_inmails", []);
  rpc.setData("club_export_my_data", {});
  rpc.setData("event_cfp_export_my_data", {});
});

describe("eksport RODO - koperta paczki", () => {
  it("POST za `requireSupabaseAuth` - handler ufa `userId` z kontekstu, więc bez uwierzytelnienia nie ma czego zawężać", () => {
    expect(asServerFn(exportMyData).method).toBe("POST");
    expect(serverFnMiddlewareNames(exportMyData)).toEqual(["requireSupabaseAuth"]);
  });

  it("konto bez aktywności: komplet sekcji z rejestru, bez `errors`, bez rozjazdu i ucięć", async () => {
    const result = await runExport();

    expect(result.format).toBe(PERSONAL_DATA_EXPORT_FORMAT);
    expect(result.exported_at).toBe(FIXED_NOW_ISO);
    expect(result.user_id).toBe(USER_ID);
    expect(result.email).toBe(EMAIL);
    expect(Object.keys(result.sections).sort()).toEqual([...EXPORT_SECTION_IDS].sort());
    // Brak klucza, nie pusty obiekt: `errors` pojawia się wyłącznie przy awarii.
    expect(result).not.toHaveProperty("errors");
    expect(result.manifest).not.toHaveProperty("drift");
    expect(result.manifest.failed).toEqual([]);
    expect(result.manifest.truncated).toEqual([]);
    expect(result.manifest.excluded).toEqual(EXPORT_EXCLUSIONS);
    // Bramka rozjazdu dostała DOKŁADNIE to, co handler zbudował - raz.
    expect(h.diffInputs).toHaveLength(1);
    expect([...(h.diffInputs[0] ?? [])].sort()).toEqual([...EXPORT_SECTION_IDS].sort());
  });

  it("claims bez adresu e-mail: jawne `email: null`, nie brak pola", async () => {
    const result = await runExport({ sub: USER_ID });
    expect(result).toHaveProperty("email", null);
  });
});

describe("eksport RODO - zakres właściciela w wywołaniu", () => {
  it("każda tabela jest czytana z filtrem na kolumnie właściciela o WARTOŚCI `userId` z kontekstu", async () => {
    await runExport();

    const observed = from.chains.map((chain) => {
      const eqs = chain.calls.filter((call) => call.method === "eq");
      // Jeden filtr na odczyt i zawsze z identyfikatorem wołającego - drugi
      // filtr albo cudza wartość to zmiana zakresu, którą trzeba nazwać.
      expect(eqs.length, `${chain.table}: liczba filtrów .eq`).toBeLessThanOrEqual(1);
      for (const eq of eqs)
        expect(eq.args[1], `${chain.table}.${String(eq.args[0])}`).toBe(USER_ID);
      return `${chain.table}.${eqs.length === 0 ? "RLS" : String(eqs[0]?.args[0])}`;
    });
    const expected = OWNER_FILTERS.map(([table, column]) => `${table}.${column ?? "RLS"}`);
    expect(observed.sort()).toEqual(expected.sort());
  });

  it("RPC z adresatem dostaje `userId` z kontekstu, pozostałe - wyłącznie parametry zakresu", async () => {
    await runExport();

    expect(rpc.callsFor("list_recommendations").map((call) => call.args)).toEqual([
      { p_recipient: USER_ID },
    ]);
    // Reszta funkcji ustala osobę z `auth.uid()` - identyfikator w argumentach
    // byłby drugą, niezależną od sesji drogą wskazania osoby.
    const leaked = rpc.calls
      .filter((call) => call.name !== "list_recommendations")
      .filter((call) => Object.values(call.args ?? {}).includes(USER_ID))
      .map((call) => call.name);
    expect(leaked).toEqual([]);
    expect(rpc.lastCall("my_profile_viewers")?.args).toEqual({
      p_limit: EXPORT_PROFILE_VIEWERS_LIMIT,
    });
  });

  it("sekcje-bliźniaki na jednym źródle nie są zamienione (poparcia, skrzynki zapytań)", async () => {
    from.setResponse("profile_skill_endorsements", (chain) =>
      ok([{ id: chain.argsOf("eq")?.[0] === "endorser_id" ? "udzielone" : "otrzymane" }]),
    );
    rpc.setResponse("list_my_inmails", (call) => ok([{ box: call.arg("p_box") }]));

    const { sections } = await runExport();

    expect(sections.skill_endorsements_given).toEqual([{ id: "udzielone" }]);
    expect(sections.skill_endorsements_received).toEqual([{ id: "otrzymane" }]);
    expect(sections.expert_requests_sent).toEqual([{ box: "sent" }]);
    expect(sections.expert_requests_received).toEqual([{ box: "received" }]);
  });
});

describe("eksport RODO - nabór prelegentów (event_cfp_export_my_data)", () => {
  // Kształt dokumentów jak w `event_cfp_export_my_data` (migracja naboru):
  // współprelegent WYŁĄCZNIE imieniem, nazwiskiem i rolą, ocena zbiorcza.
  const submission = {
    event_slug: "forum-energii-2099",
    status: "accepted",
    is_submitter: true,
    my_roles: ["speaker"],
    title_pl: "Sieci przesyłowe po 2030",
    co_speakers: [{ first_name: "Jan", last_name: "Kowalski", role: "co_speaker" }],
    feedback_to_speaker: "Prosimy o skrócenie do 20 minut.",
    review_summary: { reviews_count: 3, overall_avg: 4.3 },
    created_at: relativeIso(-30 * DZIEN),
  };
  const material = {
    event_slug: "forum-energii-2099",
    kind: "slides",
    url: "https://cdn.example/slides.pdf",
    is_published: true,
    created_at: relativeIso(-2 * DZIEN),
  };
  const reviewerRole = { event_slug: "forum-energii-2099", role: "reviewer" };
  const reviewWritten = { submission_title_pl: "Inny temat", overall: 4, comment: "Solidne." };

  it("dokumenty z RPC trafiają do swoich sekcji bez przeróbek", async () => {
    rpc.setData("event_cfp_export_my_data", {
      event_cfp_submissions: [submission],
      event_speaker_materials: [material],
      event_cfp_reviewer_roles: [reviewerRole],
      event_cfp_reviews_written: [reviewWritten],
    });

    const { sections, manifest } = await runExport();

    expect(sections.event_cfp_submissions).toEqual([submission]);
    expect(sections.event_speaker_materials).toEqual([material]);
    expect(sections.event_cfp_reviewer_roles).toEqual([reviewerRole]);
    expect(sections.event_cfp_reviews_written).toEqual([reviewWritten]);
    expect(manifest.groups.event_cfp_submissions).toBe("event_cfp");
  });

  it("cudze oceny i notatka decyzji oddane przez bazę NIE trafiają do pliku (art. 15 ust. 4)", async () => {
    // Regresja po stronie SQL (klucz dopisany do payloadu) nie może przeciec:
    // klient wyjmuje wyłącznie sekcje zadeklarowane w rejestrze.
    rpc.setData("event_cfp_export_my_data", {
      event_cfp_submissions: [submission],
      event_cfp_assessments: [{ reviewer: "Recenzent X", score: 1, note: "NOTATKA-POUFNA" }],
      decision_note: "NOTATKA-POUFNA",
    });

    const result = await runExport();

    expect(result.sections).not.toHaveProperty("event_cfp_assessments");
    expect(result.sections).not.toHaveProperty("decision_note");
    expect(JSON.stringify(result)).not.toContain("NOTATKA-POUFNA");
    expect(result.sections.event_cfp_submissions).toEqual([submission]);
  });

  it("osoba spoza naboru: RPC bez kluczy daje cztery puste listy, nie brak sekcji", async () => {
    const { sections } = await runExport();
    for (const id of EXPORT_SECTION_GROUPS.event_cfp) expect(sections[id], id).toEqual([]);
  });
});

// Kontrakt wspólny dla modułów RPC-only: jeden payload jsonb, rozbity na
// zadeklarowane sekcje. Nabór prelegentów i kluby dzielą wzorzec, więc dzielą
// też dowód - regresja w jednym z nich nie może się schować za drugim.
describe.each([
  {
    label: "nabór prelegentów",
    rpcName: "event_cfp_export_my_data",
    sections: EXPORT_SECTION_GROUPS.event_cfp,
    other: EXPORT_SECTION_GROUPS.clubs,
  },
  {
    label: "kluby dyskusyjne",
    rpcName: "club_export_my_data",
    sections: EXPORT_SECTION_GROUPS.clubs,
    other: EXPORT_SECTION_GROUPS.event_cfp,
  },
])("eksport RODO - moduł RPC-only: $label", ({ rpcName, sections, other }) => {
  const [first, second, ...rest] = sections;

  it("JEDNO wykonanie RPC na cały moduł, z sufitem wierszy z rejestru", async () => {
    await runExport();
    expect(rpc.callsFor(rpcName).map((call) => call.args)).toEqual([{ p_limit: EXPORT_ROW_LIMIT }]);
  });

  it("klucz `null` albo nieobecny w payloadzie: pusta lista, nie `undefined`", async () => {
    rpc.setData(rpcName, { [first]: null, [second]: rows(2, second) });

    const result = await runExport();

    expect(result.sections[first]).toEqual([]);
    expect(result.sections[second]).toEqual(rows(2, second));
    for (const id of rest) expect(result.sections[id], id).toEqual([]);
  });

  it.each([
    { shape: "null", payload: null },
    { shape: "tablica", payload: [{ [first]: rows(1, first) }] },
    { shape: "skalar", payload: "ok" },
  ])(
    "payload nie-obiekt ($shape): wszystkie sekcje modułu puste, bez błędu",
    async ({ payload }) => {
      rpc.setData(rpcName, payload);

      const result = await runExport();

      for (const id of sections) expect(result.sections[id], id).toEqual([]);
      expect(result).not.toHaveProperty("errors");
    },
  );

  it("odmowa RPC: każda sekcja modułu w `errors` i `manifest.failed`, reszta paczki przeżywa", async () => {
    rpc.setError(rpcName, "not_found: profile does not exist", "P0001");

    const result = await runExport();

    expect(result.errors).toEqual(
      Object.fromEntries(sections.map((id) => [id, "not_found: profile does not exist"])),
    );
    expect(result.manifest.failed).toEqual([...sections]);
    for (const id of sections) expect(result.sections, id).not.toHaveProperty(id);
    // Drugi moduł i reszta paczki jadą dalej - awaria jest per moduł.
    for (const id of other) expect(result.sections[id], id).toEqual([]);
    expect(result.sections.profile).toEqual(PROFILE_ROW);
  });

  it("sekcja na sufcie wierszy ląduje w `manifest.truncated`, sekcja o wiersz krótsza - nie", async () => {
    rpc.setData(rpcName, {
      [first]: rows(EXPORT_ROW_LIMIT, first),
      [second]: rows(EXPORT_ROW_LIMIT - 1, second),
    });

    const { manifest } = await runExport();

    expect(manifest.truncated).toEqual([
      { id: first, limit: EXPORT_ROW_LIMIT, returned: EXPORT_ROW_LIMIT },
    ]);
  });
});

describe("eksport RODO - sieć kontaktów (strony po 50 do sufitu)", () => {
  /** Wiersz `my_connections` w pełnym kształcie RPC - eksport bierze z niego trzy pola. */
  function connection(i: number) {
    return {
      connection_id: `conn-${i}`,
      user_id: `peer-${i}`,
      display_name: `Osoba ${i}`,
      connected_at: relativeIso(-i * DZIEN),
      avatar_url: "https://cdn.example/avatar.jpg",
      current_company: "Firma",
      job_title: "Analityk",
      location: "Warszawa",
      slug: `osoba-${i}`,
      specialization: "Energia",
      total_count: 0,
      verified: false,
    };
  }

  /** Odpowiedź stronicowanego RPC dla bazy liczącej `total` wierszy. */
  function pagedConnections(total: number) {
    return (call: { arg(key: string): unknown }): SupabaseResult => {
      const offset = Number(call.arg("p_offset"));
      const count = Math.max(0, Math.min(50, total - offset));
      return ok(Array.from({ length: count }, (_, i) => connection(offset + i)));
    };
  }

  const offsets = (name: string) => rpc.callsFor(name).map((call) => call.arg("p_offset"));

  it("krótka strona kończy sklejanie; wiersz niesie wyłącznie pola kontraktu", async () => {
    rpc.setResponse("my_connections", pagedConnections(53));

    const { sections } = await runExport();

    expect(offsets("my_connections")).toEqual([0, 50]);
    expect(rpc.lastCall("my_connections")?.args).toEqual({
      p_query: "",
      p_limit: 50,
      p_offset: 50,
    });
    const list = sections.network_connections;
    expect(Array.isArray(list) ? list.length : null).toBe(53);
    expect(Array.isArray(list) ? list[52] : null).toEqual({
      user_id: "peer-52",
      display_name: "Osoba 52",
      connected_at: relativeIso(-52 * DZIEN),
    });
  });

  it("pełna strona i pusta następna: dokładnie dwa zapytania", async () => {
    rpc.setResponse("my_connections", pagedConnections(50));

    const { sections } = await runExport();

    expect(offsets("my_connections")).toEqual([0, 50]);
    expect(Array.isArray(sections.network_connections) && sections.network_connections.length).toBe(
      50,
    );
  });

  it("`data: null` kończy sklejanie pustą sekcją, nie błędem", async () => {
    rpc.setData("my_connections", null);

    const result = await runExport();

    expect(offsets("my_connections")).toEqual([0]);
    expect(result.sections.network_connections).toEqual([]);
    expect(result).not.toHaveProperty("errors");
  });

  it("sufit: 40 pełnych stron i ani jednej więcej, a sekcja jest w `manifest.truncated`", async () => {
    rpc.setResponse("my_connections", pagedConnections(10_000));

    const { manifest } = await runExport();

    const calls = offsets("my_connections");
    expect(calls).toHaveLength(EXPORT_ROW_LIMIT / 50);
    expect(calls.at(-1)).toBe(EXPORT_ROW_LIMIT - 50);
    expect(manifest.truncated).toEqual([
      { id: "network_connections", limit: EXPORT_ROW_LIMIT, returned: EXPORT_ROW_LIMIT },
    ]);
  });

  it("błąd strony oblewa CAŁĄ sekcję - bez połowy listy podpisanej jako komplet", async () => {
    const pages = pagedConnections(120);
    rpc.setResponse("my_connections", (call) =>
      call.arg("p_offset") === 50
        ? fail("permission denied for function my_connections")
        : pages(call),
    );

    const result = await runExport();

    expect(offsets("my_connections")).toEqual([0, 50]);
    expect(result.sections).not.toHaveProperty("network_connections");
    expect(result.errors?.network_connections).toContain(
      "permission denied for function my_connections",
    );
    expect(result.manifest.failed).toEqual(["network_connections"]);
    expect(result.sections.network_invitations_sent).toEqual([]);
  });

  it("zaproszenia wysłane i odebrane: kierunek nie jest zamieniony, pola jawnie zmapowane", async () => {
    rpc.setResponse("my_connection_requests", (call) =>
      ok([
        {
          ...connection(1),
          user_id: `peer-${String(call.arg("p_direction"))}`,
          message: `Zaproszenie ${String(call.arg("p_direction"))}`,
          requested_at: relativeIso(-DZIEN),
        },
      ]),
    );

    const { sections } = await runExport();

    const request = (direction: string) => ({
      user_id: `peer-${direction}`,
      display_name: "Osoba 1",
      message: `Zaproszenie ${direction}`,
      requested_at: relativeIso(-DZIEN),
    });
    expect(sections.network_invitations_sent).toEqual([request("out")]);
    expect(sections.network_invitations_received).toEqual([request("in")]);
    expect(rpc.callsFor("my_connection_requests").map((call) => call.arg("p_direction"))).toEqual([
      "out",
      "in",
    ]);
  });
});

// Trzy RPC oddają „jeden rekord albo nic", ale jako `RETURNS TABLE` - czyli
// tablicę. Plik ma nieść obiekt albo `null`, nigdy tablicę o jednym elemencie.
describe.each([
  { section: "profile", rpcName: "get_own_profile" },
  { section: "author_profile", rpcName: "get_own_author_profile" },
  { section: "profile_view_stats", rpcName: "profile_view_stats" },
])("eksport RODO - rekord pojedynczy: $section", ({ section, rpcName }) => {
  const record = { id: `${section}-1`, updated_at: relativeIso(-DZIEN) };

  it.each([
    { shape: "tablica z wierszem", data: [record], expected: record },
    { shape: "pusta tablica", data: [], expected: null },
    { shape: "obiekt", data: record, expected: record },
    { shape: "null", data: null, expected: null },
  ])("$shape -> $expected", async ({ data, expected }) => {
    rpc.setData(rpcName, data);

    const result = await runExport();

    expect(result.sections).toHaveProperty(section, expected);
  });

  it("błąd RPC: sekcja w `errors`, nie `null` udające brak danych", async () => {
    rpc.setError(rpcName, `permission denied for function ${rpcName}`, "42501");

    const result = await runExport();

    expect(result.sections).not.toHaveProperty(section);
    expect(result.errors).toEqual({ [section]: `permission denied for function ${rpcName}` });
  });
});

describe("eksport RODO - awaria jest jawna, sekcja po sekcji", () => {
  it("odmowa tabeli: sekcja znika z `sections`, powód w `errors` i `manifest.failed`", async () => {
    from.setResponse("user_reports", fail("permission denied for table user_reports", "42501"));

    const result = await runExport();

    expect(result.sections).not.toHaveProperty("user_reports_filed");
    expect(result.errors).toEqual({
      user_reports_filed: "permission denied for table user_reports",
    });
    expect(result.manifest.failed).toEqual(["user_reports_filed"]);
    expect(result.sections.comments).toEqual([]);
  });

  it("odrzucenie (wyjątek zamiast odpowiedzi) też jest wpisem w `errors`, nie wywraca eksportu", async () => {
    rpc.setResponse("list_my_inmails", (call) => {
      if (call.arg("p_box") === "received") throw new TypeError("fetch failed");
      return ok([]);
    });

    const result = await runExport();

    expect(result.errors).toEqual({ expert_requests_received: "TypeError: fetch failed" });
    expect(result.sections.expert_requests_sent).toEqual([]);
    expect(result.manifest.failed).toEqual(["expert_requests_received"]);
  });

  it("`manifest.failed` idzie kolejnością rejestru, nie kolejnością awarii", async () => {
    from.setResponse("user_invitations", fail("permission denied for table user_invitations"));
    from.setResponse("user_roles", fail("permission denied for table user_roles"));

    const { manifest } = await runExport();

    expect(manifest.failed).toEqual(["roles", "invitations_sent"]);
  });

  it("`data: null` bez błędu to jawne `null` w pliku, nie brak sekcji", async () => {
    rpc.setData("my_introduction_requests", null);

    const result = await runExport();

    expect(result.sections).toHaveProperty("network_introductions", null);
    expect(result).not.toHaveProperty("errors");
  });
});

describe("eksport RODO - rozjazd deklaracji z implementacją ląduje w pliku", () => {
  it.each([
    {
      label: "sekcja z rejestru nieobecna w eksporcie",
      drift: { missing: ["event_cfp_submissions"], undeclared: [] },
    },
    {
      label: "sekcja eksportu nieobecna w rejestrze",
      drift: { missing: [], undeclared: ["event_cfp_assessments"] },
    },
  ])("$label: `manifest.drift` niesie rozjazd obok pełnego manifestu", async ({ drift }) => {
    h.drift = drift;

    const { manifest } = await runExport();

    expect(manifest).toHaveProperty("drift", drift);
    expect(manifest.sections).toEqual(EXPORT_SECTION_IDS);
    expect(manifest.excluded).toEqual(EXPORT_EXCLUSIONS);
  });
});
