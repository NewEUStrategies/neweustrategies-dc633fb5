// Retencja plików CV kandydatów - STRONA WYKONAWCZA joba (`runCareerCvRetention`).
//
// PO CO TEN PLIK ISTNIEJE. Ten moduł kasuje DANE OSOBOWE (pliki CV kandydatów),
// czyli realizuje obowiązek RODO, i do 04.09.2026 miał 0/30 linii i 0/4 funkcji.
// Zero pokrycia znaczyło tu dokładnie tyle: odwrócenie warunku, zgubienie
// wywołania `career_cv_gc_done` albo zamiana „ścieżka nieznana magazynowi" na
// „ścieżka do ponowienia" przechodziły przez CI bez śladu - a każda z tych
// pomyłek objawia się albo TRWALE ZALEGAJĄCYMI danymi osobowymi w buckecie,
// albo kolejką, która sama się blokuje i przestaje kasować cokolwiek.
//
// CO JEST PRZEDMIOTEM DOWODU. Nagłówek modułu (:3-7) dzieli odpowiedzialność
// tak: SQL decyduje CO skasować, ten moduł WYKONUJE usunięcie - bo DELETE
// z `storage.objects` zostawia plik w koszu Storage'a i skasować potrafi tylko
// API magazynu. Dowodzimy więc wyłącznie tego, co należy do strony wykonawczej:
//   1. kolejność i argumenty trzech RPC (scan -> claim -> done) oraz to,
//      że wynik przebiegu niesie wszystkie sześć liczników,
//   2. że PUSTA kolejka NIE DOTYKA magazynu (asercja na liczbie wywołań
//      `storage.from().remove`), a zaległość kolejki jest odczytana i tak,
//   3. że awaria magazynu ODDAJE CAŁĄ PARTIĘ kolejce przez `career_cv_gc_fail`
//      per ścieżka - i że `career_cv_gc_done` wtedy NIE leci,
//   4. idempotencję: ścieżka, której magazyn nie zna, jest ZROBIONA (:75-82),
//      inaczej wisiałaby do wyczerpania prób i blokowała partię,
//   5. kontrakt RZUCANIA z :34-36: rzut TYLKO wtedy, gdy nie da się wykonać
//      samego skanu/claimu/done (job zepsuty), nigdy z powodu jednej ścieżki.
//
// JAK ASERTUJEMY. Przez SKUTEK na granicy modułu, nie przez zwrócony obiekt.
// Sam `result` jest zgodny również ze światem, w którym magazyn nie dostał
// żadnego polecenia usunięcia - dlatego każdy dowód patrzy na to, KTÓRE RPC
// poszły, w jakiej kolejności i z jakimi argumentami, oraz ile razy i z jakimi
// ścieżkami zawołano `remove()`.
//
// GRANICA, KTÓRĄ ATRAPUJEMY: WYŁĄCZNIE `@/integrations/supabase/client.server`
// (klient service role: `rpc`, `from`, `storage`). To instrument pomiarowy -
// żaden test nie dotyka prawdziwego magazynu ani bazy. PRAWDZIWE zostają
// `runCareerCvRetention`, `parseCvGcScan`, `parseCvGcClaims`,
// `emptyRetentionResult` i `CV_BUCKET`: to one są przedmiotem dowodu, więc
// atrapowanie ich zamieniłoby plik w test atrapy.
//
// RODO W SAMYM TEŚCIE. Wszystkie ścieżki i identyfikatory są SYNTETYCZNE
// (UUID-y z zerami, nazwy plików bez nazwisk). Test o kasowaniu danych
// osobowych nie ma prawa wnosić danych osobowych do repozytorium.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fail, ok, okCount, supabaseFromStub, type SupabaseResult } from "@/test/supabaseChain";
import { CV_BUCKET } from "@/lib/careers/cvUpload";

// --- atrapa klienta service role --------------------------------------------

/** Jedno wywołanie RPC zapisane przez atrapę (nazwa + payload argumentów). */
interface RpcCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

type RpcResponder = (args: Record<string, unknown>) => SupabaseResult;

/** Jedno polecenie usunięcia wysłane do magazynu (bucket + ścieżki). */
interface RemoveCall {
  readonly bucket: string;
  readonly paths: readonly string[];
}

const tables = supabaseFromStub();

const state: {
  responders: Map<string, RpcResponder>;
  rpcCalls: RpcCall[];
  storageFromCalls: string[];
  removeCalls: RemoveCall[];
  removeResult: SupabaseResult;
} = {
  responders: new Map(),
  rpcCalls: [],
  storageFromCalls: [],
  removeCalls: [],
  removeResult: ok([]),
};

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      const responder = state.responders.get(name);
      // Brak zaplanowanej odpowiedzi to BŁĄD TESTU, nie ciche `null`: inaczej
      // przebieg „przechodziłby" po RPC, którego nikt nie przewidział.
      return Promise.resolve(
        responder ? responder(args) : fail(`test: brak zaplanowanej odpowiedzi RPC "${name}"`),
      );
    },
    from: tables.from,
    storage: {
      from: (bucket: string) => {
        state.storageFromCalls.push(bucket);
        return {
          remove: (paths: readonly string[]) => {
            state.removeCalls.push({ bucket, paths: [...paths] });
            return Promise.resolve(state.removeResult);
          },
        };
      },
    },
  },
}));

import { runCareerCvRetention } from "@/lib/server/careerCvRetention.server";

// --- dane syntetyczne (RODO: zero prawdziwych nazwisk i identyfikatorów) -----

const CANDIDATE_A = "00000000-0000-4000-8000-000000000001";
const CANDIDATE_B = "00000000-0000-4000-8000-000000000002";
const CANDIDATE_C = "00000000-0000-4000-8000-000000000003";
const PATH_A = `cv/${CANDIDATE_A}/dokument.pdf`;
const PATH_B = `cv/${CANDIDATE_B}/dokument.pdf`;
const PATH_C = `cv/${CANDIDATE_C}/zalacznik.pdf`;

/** Limity partii z modułu (:28-29) - część kontraktu wywołań RPC. */
const SCAN_LIMIT = 200;
const DELETE_LIMIT = 50;

// --- pomoc w planowaniu odpowiedzi ------------------------------------------

function planRpc(name: string, responder: RpcResponder | SupabaseResult): void {
  state.responders.set(name, typeof responder === "function" ? responder : () => responder);
}

function planScan(orphans: number, retention: number): void {
  planRpc("career_cv_gc_scan", ok({ orphans, retention }));
}

/** Kolejka wydaje pozycje w kształcie jsonb, tak jak `career_cv_gc_claim`. */
function planClaims(paths: readonly string[]): void {
  planRpc(
    "career_cv_gc_claim",
    ok(paths.map((path) => ({ path, reason: "retention", attempts: 0 }))),
  );
}

/** Odpowiedź magazynu: lista obiektów FAKTYCZNIE usuniętych. */
function planRemoved(paths: readonly string[]): void {
  state.removeResult = ok(paths.map((path) => ({ name: path })));
}

function planPending(count: number): void {
  tables.setResponse("career_cv_gc_queue", okCount(count));
}

function rpcNames(): string[] {
  return state.rpcCalls.map((call) => call.name);
}

function callsTo(name: string): RpcCall[] {
  return state.rpcCalls.filter((call) => call.name === name);
}

beforeEach(() => {
  tables.reset();
  state.responders.clear();
  state.rpcCalls = [];
  state.storageFromCalls = [];
  state.removeCalls = [];
  state.removeResult = ok([]);
});

describe("runCareerCvRetention - ścieżka szczęśliwa", () => {
  it("przechodzi scan -> claim -> remove -> done i raportuje wszystkie liczniki", async () => {
    // Dowód całego łańcucha wykonawczego w jednym przebiegu: skan dopisał
    // 3 osierocone i 2 wygasłe, kolejka wydała dwie ścieżki, magazyn potwierdził
    // oba pliki, a `career_cv_gc_done` zdjął dwa wiersze i zostawił jeden
    // w zaległości. To jest jedyny stan, w którym operator ma prawo uznać
    // przebieg za udany.
    planScan(3, 2);
    planClaims([PATH_A, PATH_B]);
    planRemoved([PATH_A, PATH_B]);
    planRpc("career_cv_gc_done", ok(2));
    planPending(1);

    const result = await runCareerCvRetention();

    expect(result).toEqual({
      scannedOrphans: 3,
      scannedRetention: 2,
      claimed: 2,
      deleted: 2,
      failed: 0,
      pending: 1,
    });
  });

  it("woła RPC w kolejności scan -> claim -> done, z limitami partii z modułu", async () => {
    // KOLEJNOŚĆ JEST KONTRAKTEM, nie stylem: claim przed skanem wydałby partię
    // sprzed dopisania nowych śmieci, a `done` przed `remove` zdjąłby wiersz
    // kolejki dla pliku, który wciąż leży w buckecie - czyli cicho porzucone
    // dane osobowe. Limity partii trzymają tick w budżecie czasu crona.
    planScan(1, 0);
    planClaims([PATH_A]);
    planRemoved([PATH_A]);
    planRpc("career_cv_gc_done", ok(1));
    planPending(0);

    await runCareerCvRetention();

    expect(rpcNames()).toEqual(["career_cv_gc_scan", "career_cv_gc_claim", "career_cv_gc_done"]);
    expect(callsTo("career_cv_gc_scan")[0].args).toEqual({ _limit: SCAN_LIMIT });
    expect(callsTo("career_cv_gc_claim")[0].args).toEqual({ _limit: DELETE_LIMIT });
  });

  it("kasuje z bucketu CV dokładnie te ścieżki, które wydała kolejka", async () => {
    // Bucket i zestaw ścieżek to jedyne, co ten moduł mówi magazynowi. Zła
    // nazwa bucketu albo ścieżka doklejona spoza kolejki oznaczałaby usunięcie
    // pliku, którego SQL nie zakwalifikował do usunięcia.
    planScan(0, 2);
    planClaims([PATH_A, PATH_B]);
    planRemoved([PATH_A, PATH_B]);
    planRpc("career_cv_gc_done", ok(2));
    planPending(0);

    await runCareerCvRetention();

    expect(state.removeCalls).toHaveLength(1);
    expect(state.removeCalls[0].bucket).toBe(CV_BUCKET);
    expect(state.removeCalls[0].paths).toEqual([PATH_A, PATH_B]);
  });

  it("zdejmuje z kolejki dokładnie potwierdzone ścieżki", async () => {
    // `career_cv_gc_done` jest jedynym miejscem, w którym wiersz kolejki znika.
    // Argument `_paths` musi więc nieść ścieżki potwierdzone przez magazyn -
    // nie „wszystko, co wydał claim".
    planScan(0, 1);
    planClaims([PATH_A]);
    planRemoved([PATH_A]);
    planRpc("career_cv_gc_done", ok(1));
    planPending(0);

    await runCareerCvRetention();

    expect(callsTo("career_cv_gc_done")[0].args).toEqual({ _paths: [PATH_A] });
  });

  it("bierze `deleted` z odpowiedzi `career_cv_gc_done`, gdy ta różni się od liczby ścieżek", async () => {
    // Autorytetem dla licznika „ile faktycznie zniknęło" jest baza, a nie
    // długość tablicy w pamięci procesu. Rozjazd jest realny: równoległy tick
    // albo ręczne czyszczenie mogły zdjąć część wierszy wcześniej.
    planScan(0, 3);
    planClaims([PATH_A, PATH_B, PATH_C]);
    planRemoved([PATH_A, PATH_B, PATH_C]);
    planRpc("career_cv_gc_done", ok(1));
    planPending(2);

    const result = await runCareerCvRetention();

    expect(result.deleted).toBe(1);
    expect(result.claimed).toBe(3);
  });

  it("gdy `career_cv_gc_done` nie zwraca liczby, `deleted` liczy zdjęte ścieżki", async () => {
    // Degradacja bez rzutu: brak licznika w odpowiedzi RPC nie może zamienić
    // udanego przebiegu w awarię. Raportujemy wtedy to, co wiemy - liczbę
    // ścieżek oddanych do zdjęcia.
    planScan(0, 2);
    planClaims([PATH_A, PATH_B]);
    planRemoved([PATH_A, PATH_B]);
    planRpc("career_cv_gc_done", ok(null));
    planPending(0);

    const result = await runCareerCvRetention();

    expect(result.deleted).toBe(2);
  });

  it("nie ufa kształtowi odpowiedzi RPC: śmieciowy scan i claim dają zera bez rzutu", async () => {
    // Kontrakt jsonb jest luźny (RPC zwraca jsonb, nie TABLE), więc job musi
    // przeżyć odpowiedź, której nie rozumie. Alternatywą jest wywrócenie całego
    // ticku crona przez jedno pole zmienione w migracji.
    planScan(0, 0);
    planRpc("career_cv_gc_scan", ok("nie-obiekt"));
    planRpc("career_cv_gc_claim", ok({ nie: "tablica" }));
    planPending(0);

    const result = await runCareerCvRetention();

    expect(result).toEqual({
      scannedOrphans: 0,
      scannedRetention: 0,
      claimed: 0,
      deleted: 0,
      failed: 0,
      pending: 0,
    });
    expect(state.removeCalls).toHaveLength(0);
  });
});

describe("runCareerCvRetention - pusta kolejka", () => {
  it("NIE dotyka magazynu, gdy claim nic nie wydał", async () => {
    // TO JEST TREŚĆ TEGO TESTU. `remove([])` na kliencie Supabase to realne
    // żądanie HTTP do Storage'a przy każdym tyknięciu crona (co minutę), a przy
    // pustej kolejce nie ma czego kasować. Asercja jest na LICZBIE WYWOŁAŃ,
    // bo tylko ona odróżnia „nie było czego usuwać" od „usunięto pustą listę".
    planScan(0, 0);
    planClaims([]);
    planPending(0);

    const result = await runCareerCvRetention();

    expect(state.storageFromCalls).toHaveLength(0);
    expect(state.removeCalls).toHaveLength(0);
    expect(result.claimed).toBe(0);
    expect(result.deleted).toBe(0);
    expect(result.failed).toBe(0);
  });

  it("przy pustej kolejce nie woła ani `done`, ani `fail`", async () => {
    // Puste `_paths` w `career_cv_gc_done` byłoby zapytaniem bez znaczenia,
    // ale zaśmiecałoby log RPC i mylnie sugerowało pracę, której nie było.
    planScan(0, 0);
    planClaims([]);
    planPending(0);

    await runCareerCvRetention();

    expect(rpcNames()).toEqual(["career_cv_gc_scan", "career_cv_gc_claim"]);
  });

  it("odczytuje zaległość kolejki NAWET przy pustym claimie", async () => {
    // Zaległość to jedyny sygnał, po którym panel widzi kolejkę, która rośnie
    // szybciej, niż job ją kasuje. Pominięcie odczytu przy pustej partii
    // pokazywałoby operatorowi zero właśnie wtedy, gdy jest problem
    // (np. wszystkie pozycje wyczerpały próby i nie dają się już claimować).
    planScan(0, 0);
    planClaims([]);
    planPending(17);

    const result = await runCareerCvRetention();

    expect(result.pending).toBe(17);
    expect(tables.chainsFor("career_cv_gc_queue")).toHaveLength(1);
    expect(tables.lastChain("career_cv_gc_queue")?.argsOf("select")).toEqual([
      "id",
      { count: "exact", head: true },
    ]);
  });

  it("brak licznika w odpowiedzi bazy czyta się jako zero zaległości", async () => {
    // `count` z PostgREST bywa `null` (np. gdy planner nie policzył wierszy).
    // `pending` jest liczbą w kontrakcie wyniku, więc `null` nie ma prawa
    // wyciec do panelu jako „NaN pozycji".
    planScan(0, 0);
    planClaims([]);
    tables.setResponse("career_cv_gc_queue", { data: null, error: null, count: null });

    const result = await runCareerCvRetention();

    expect(result.pending).toBe(0);
  });
});

describe("runCareerCvRetention - awaria magazynu", () => {
  it("oddaje CAŁĄ partię kolejce: `career_cv_gc_fail` raz na ścieżkę, z komunikatem", async () => {
    // Magazyn niedostępny to awaria PARTII, nie pojedynczego pliku. Każda
    // ścieżka musi wrócić do kolejki z przyczyną w `last_error`: to `fail`
    // zeruje `claimed_at` (więc następny tick ją powtórzy) i podbija licznik
    // prób, który zamyka pętlę na ścieżce trwale nie do usunięcia. Zgubienie
    // choćby jednego wywołania zostawia wiersz zaclaimowany na zawsze - plik
    // z danymi osobowymi leży w buckecie, a kolejka udaje, że pracuje.
    planScan(0, 3);
    planClaims([PATH_A, PATH_B, PATH_C]);
    state.removeResult = fail("storage unavailable");
    planRpc("career_cv_gc_fail", ok(null));
    planPending(3);

    const result = await runCareerCvRetention();

    const failures = callsTo("career_cv_gc_fail");
    expect(failures).toHaveLength(3);
    expect(failures.map((call) => call.args._path)).toEqual([PATH_A, PATH_B, PATH_C]);
    expect(failures.every((call) => call.args._error === "storage unavailable")).toBe(true);
    expect(result.failed).toBe(3);
  });

  it("po awarii magazynu NIE woła `career_cv_gc_done`", async () => {
    // Najgroźniejsza pomyłka w tym module: zdjęcie wierszy kolejki dla partii,
    // której magazyn nie skasował. Plik zostaje, wiersz znika, a job nigdy już
    // nie wróci do tej ścieżki - dane osobowe zalegają bez żadnego śladu.
    planScan(0, 2);
    planClaims([PATH_A, PATH_B]);
    state.removeResult = fail("storage unavailable");
    planRpc("career_cv_gc_fail", ok(null));
    planPending(2);

    await runCareerCvRetention();

    expect(callsTo("career_cv_gc_done")).toHaveLength(0);
    expect(rpcNames()).toEqual([
      "career_cv_gc_scan",
      "career_cv_gc_claim",
      "career_cv_gc_fail",
      "career_cv_gc_fail",
    ]);
  });

  it("awaria magazynu NIE rzuca i nadal raportuje zaległość", async () => {
    // Kontrakt z :34-36: awaria danych nie jest awarią joba. Rzut tutaj
    // zamieniłby jeden niedostępny bucket w 500 na publicznym endpoincie
    // crona i zabrałby pozostałe kanały ticku.
    planScan(1, 1);
    planClaims([PATH_A]);
    state.removeResult = fail("storage unavailable");
    planRpc("career_cv_gc_fail", ok(null));
    planPending(5);

    const result = await runCareerCvRetention();

    expect(result.failed).toBe(1);
    expect(result.deleted).toBe(0);
    expect(result.pending).toBe(5);
    expect(result.scannedOrphans).toBe(1);
  });

  it("nie rzuca nawet wtedy, gdy samo `career_cv_gc_fail` też padnie", async () => {
    // Zapis przyczyny jest best-effort: gdy baza odrzuci też oznaczenie błędu,
    // pozycja zostaje zaclaimowana i wróci po wygaśnięciu claimu. Rzut w tym
    // miejscu zabrałby raport z całego przebiegu - a to jedyne, co operator
    // dostaje z tego ticku.
    planScan(0, 1);
    planClaims([PATH_A]);
    state.removeResult = fail("storage unavailable");
    planRpc("career_cv_gc_fail", fail("deadlock detected"));
    planPending(1);

    const result = await runCareerCvRetention();

    expect(result.failed).toBe(1);
    expect(callsTo("career_cv_gc_fail")).toHaveLength(1);
  });
});

describe("runCareerCvRetention - idempotencja wobec magazynu", () => {
  it("gdy magazyn nie potwierdził NICZEGO, cała partia jest uznana za zrobioną", async () => {
    // TO JEST OCHRONA PRZED ZAKLESZCZENIEM KOLEJKI (:75-82). `remove()` zwraca
    // obiekty faktycznie usunięte, więc pusta odpowiedź oznacza najczęściej
    // „tych plików już nie ma" (kandydat usunął zgłoszenie, wcześniejszy tick
    // padł po usunięciu, a przed `done`). Traktowanie tego jako porażki
    // trzymałoby wiersze w kolejce do wyczerpania prób i BLOKOWAŁO partię,
    // czyli wstrzymywało kasowanie danych osobowych, które faktycznie leżą.
    planScan(0, 2);
    planClaims([PATH_A, PATH_B]);
    planRemoved([]);
    planRpc("career_cv_gc_done", ok(2));
    planPending(0);

    const result = await runCareerCvRetention();

    expect(callsTo("career_cv_gc_done")[0].args).toEqual({ _paths: [PATH_A, PATH_B] });
    expect(result.deleted).toBe(2);
    expect(result.failed).toBe(0);
  });

  it("`data: null` z magazynu czyta się tak samo jak pustą listę", async () => {
    // Klient Supabase zwraca `data: null` przy odpowiedzi bez ciała. Bez
    // domknięcia `?? []` byłby to `TypeError` w środku joba retencji, czyli
    // rzut z powodu DANYCH - dokładnie to, czego nagłówek modułu zabrania.
    planScan(0, 1);
    planClaims([PATH_A]);
    state.removeResult = ok(null);
    planRpc("career_cv_gc_done", ok(1));
    planPending(0);

    const result = await runCareerCvRetention();

    expect(callsTo("career_cv_gc_done")[0].args).toEqual({ _paths: [PATH_A] });
    expect(result.deleted).toBe(1);
  });

  it("pomija obiekty bez nazwy w odpowiedzi magazynu", async () => {
    // Kształt `FileObject` nie jest gwarantowany przez ten moduł, a wpis bez
    // `name` nie może udawać potwierdzenia dla ścieżki - inaczej `done`
    // zdejmowałoby wiersze na podstawie śmieci w odpowiedzi.
    planScan(0, 2);
    planClaims([PATH_A, PATH_B]);
    state.removeResult = ok([{ name: PATH_B }, { id: "bez-nazwy" }]);
    planRpc("career_cv_gc_done", ok(1));
    planPending(1);

    await runCareerCvRetention();

    expect(callsTo("career_cv_gc_done")[0].args).toEqual({ _paths: [PATH_B] });
  });

  it("przy CZĘŚCIOWYM potwierdzeniu zdejmuje tylko potwierdzone, resztę zostawia w kolejce", async () => {
    // ASYMETRIA JEST ŚWIADOMA I TUTAJ PRZYPIĘTA. Gdy magazyn potwierdził część
    // partii, ścieżka niepotwierdzona NIE jest uznawana za zrobioną (inaczej
    // niż przy pustej odpowiedzi wyżej): mamy wtedy wiarygodną informację
    // z magazynu i nie zdejmujemy wiersza dla pliku, o którym magazyn milczy.
    // Kosztem jest jeden dodatkowy obrót kolejki, ograniczony licznikiem prób;
    // zyskiem - brak porzuconego pliku z danymi osobowymi. Ten test istnieje,
    // żeby zmiana tej reguły była WIDOCZNA, a nie odkrywana na produkcji.
    planScan(0, 2);
    planClaims([PATH_A, PATH_B]);
    planRemoved([PATH_A]);
    planRpc("career_cv_gc_done", ok(1));
    planPending(1);

    const result = await runCareerCvRetention();

    expect(callsTo("career_cv_gc_done")[0].args).toEqual({ _paths: [PATH_A] });
    expect(result.deleted).toBe(1);
    expect(result.claimed).toBe(2);
    expect(result.pending).toBe(1);
  });

  it("gdy magazyn zwrócił WYŁĄCZNIE obce nazwy, partia i tak jest zamykana", async () => {
    // Odpowiedź, w której nie ma ANI JEDNEJ naszej ścieżki, jest nieinformacyjna
    // dokładnie tak samo jak pusta - i musi kończyć się zamknięciem partii,
    // nie jej zawieszeniem. Inaczej jedna dziwna odpowiedź magazynu potrafiłaby
    // zatrzymać retencję na stałe.
    planScan(0, 1);
    planClaims([PATH_A]);
    planRemoved(["cv/inny-prefix/obcy.pdf"]);
    planRpc("career_cv_gc_done", ok(1));
    planPending(0);

    const result = await runCareerCvRetention();

    expect(callsTo("career_cv_gc_done")[0].args).toEqual({ _paths: [PATH_A] });
    expect(result.failed).toBe(0);
  });
});

describe("runCareerCvRetention - kontrakt rzucania", () => {
  it("rzuca z prefiksem `career_cv_gc_scan:`, gdy nie da się wykonać skanu", async () => {
    // Rzut oznacza „JOB jest zepsuty" (brak funkcji, brak uprawnień, baza
    // niedostępna) i musi dotrzeć do dyspozytora, żeby przebieg wylądował
    // w logu z `ok:false`. Prefiks nazwą RPC jest tu treścią: to po nim
    // operator wie, KTÓRY krok padł, bez wchodzenia w logi bazy.
    planRpc("career_cv_gc_scan", fail("function career_cv_gc_scan does not exist"));

    await expect(runCareerCvRetention()).rejects.toThrow(
      /career_cv_gc_scan: function career_cv_gc_scan does not exist/,
    );
  });

  it("awaria skanu zatrzymuje przebieg PRZED claimem i przed magazynem", async () => {
    // Rzut nie może zostawić po sobie połowy pracy: bez skanu nie wiadomo, co
    // jest w kolejce, więc claimowanie i kasowanie plików byłoby działaniem
    // na nieaktualnym stanie.
    planRpc("career_cv_gc_scan", fail("permission denied"));

    await expect(runCareerCvRetention()).rejects.toThrow(/career_cv_gc_scan:/);
    expect(rpcNames()).toEqual(["career_cv_gc_scan"]);
    expect(state.removeCalls).toHaveLength(0);
  });

  it("rzuca z prefiksem `career_cv_gc_claim:`, gdy nie da się pobrać partii", async () => {
    planScan(2, 0);
    planRpc("career_cv_gc_claim", fail("deadlock detected"));

    await expect(runCareerCvRetention()).rejects.toThrow(/career_cv_gc_claim: deadlock detected/);
    expect(state.removeCalls).toHaveLength(0);
  });

  it("rzuca z prefiksem `career_cv_gc_done:`, gdy nie da się domknąć partii", async () => {
    // Pliki już zniknęły z magazynu, ale wiersze kolejki zostały. Rzut jest tu
    // POPRAWNY: przebieg jest niedomknięty, następny tick zobaczy te ścieżki
    // ponownie (idempotencja wyżej to obsłuży), a operator dostaje sygnał.
    planScan(0, 1);
    planClaims([PATH_A]);
    planRemoved([PATH_A]);
    planRpc("career_cv_gc_done", fail("statement timeout"));

    await expect(runCareerCvRetention()).rejects.toThrow(/career_cv_gc_done: statement timeout/);
    expect(state.removeCalls).toHaveLength(1);
  });

  it("NIE rzuca z powodu pojedynczej ścieżki - to jest cała różnica kontraktu", async () => {
    // Podsumowanie kontraktu z nagłówka modułu (:31-37) w jednej asercji:
    // awaria DANYCH kończy się `failed` w raporcie, awaria JOBA kończy się
    // rzutem. Zlanie tych dwóch przypadków w jeden oznacza albo cichą utratę
    // sygnału o zepsutym jobie, albo 500 na crona przy jednym pliku.
    planScan(0, 1);
    planClaims([PATH_A]);
    state.removeResult = fail("object not accessible");
    planRpc("career_cv_gc_fail", ok(null));
    planPending(1);

    await expect(runCareerCvRetention()).resolves.toMatchObject({ failed: 1, deleted: 0 });
  });
});
