// Rozstrzyganie audytorium kampanii i izolacja najemcy w ticku.
//
// Newsletter ma NAJNIŻSZE pokrycie w repo (T/P 0,08, audyt 14.08 §4.1), a te dwie
// rzeczy są w nim najostrzejsze:
//
//   1. `readAudienceFilter` decyduje, KTO dostanie kampanię. Degraduje się
//      FAIL-OPEN: nieparsowalny `jsonb` daje filtr pusty, czyli wysyłkę do
//      całego statusu `subscribed`. To jest udokumentowana decyzja (lepiej
//      wysłać szerzej niż wywalić kampanię w połowie), ale decyzja o takim
//      koszcie musi być zapisana warunkiem, nie tylko komentarzem - bo różnica
//      między „wąski segment" a „cała lista" to różnica między mailingiem
//      a incydentem reputacyjnym.
//
//   2. `tickNewsletterCampaigns` jest jedyną ścieżką CROSS-TENANT w module:
//      `/api/public/jobs-tick` woła ją BEZ tenanta, a pętla przechodzi po
//      kampaniach różnych najemców klientem `service_role` (RLS nie obowiązuje).
//      Cała izolacja stoi na dwóch rzeczach: `if (opts.tenantId)` przy obu
//      zapytaniach o kampanie ORAZ przekazywaniu WŁASNEGO `row.tenant_id` każdej
//      kampanii w dół (a nie tenanta wołającego). Pomyłka w drugim punkcie
//      wysyła listę najemcy A pod treścią najemcy B - i nie widzi tego żadna
//      bramka SQL, bo `service_role` przechodzi wszystkie polityki.
import { beforeEach, describe, expect, it, vi } from "vitest";

// Atrapy modułów SERWEROWYCH wciąganych przez plik kampanii. Bez nich import
// ciągnie dostawcę poczty i klienta service_role do środowiska testowego.
const gate = vi.hoisted(() => ({ allowed: true, calls: [] as string[] }));

vi.mock("@/lib/email/reputationGate.server", () => ({
  evaluateSendGate: async (_client: unknown, tenant: string) => {
    gate.calls.push(tenant);
    return { allowed: gate.allowed, reason: gate.allowed ? null : "complaint_rate" };
  },
}));

vi.mock("@/lib/email/provider.server", () => ({
  sendEmail: async () => ({ ok: true, id: "msg-1" }),
}));

vi.mock("@/lib/email/suppression.server", () => ({
  fetchSuppressedEmails: async () => new Map<string, { reason: string }>(),
}));

import { readAudienceFilter, tickNewsletterCampaigns } from "@/lib/newsletter-campaigns.functions";

/* ------------------------------------------------------------------ */
/* readAudienceFilter                                                  */
/* ------------------------------------------------------------------ */

describe("readAudienceFilter - kształt poprawny", () => {
  it("brak filtra znaczy `bez zawężeń`", () => {
    expect(readAudienceFilter(null)).toEqual({});
    expect(readAudienceFilter(undefined)).toEqual({});
    expect(readAudienceFilter({})).toEqual({});
  });

  it("przepuszcza komplet pól", () => {
    const filter = {
      languages: ["pl", "en"],
      statuses: ["subscribed", "pending"],
      source: "konferencja-2026",
      min_tier_rank: 30,
    };
    expect(readAudienceFilter(filter)).toEqual(filter);
  });

  it('przycina spacje w źródle - `" konferencja "` i `"konferencja"` to jedno źródło', () => {
    expect(readAudienceFilter({ source: "  konferencja  " })).toEqual({ source: "konferencja" });
  });
});

describe("readAudienceFilter - degradacja fail-open", () => {
  // Każdy z tych ładunków znaczy „nie umiem odczytać segmentu". Wynikiem jest
  // filtr PUSTY, czyli wysyłka do CAŁEGO statusu `subscribed`. Warunek istnieje,
  // żeby ta cena była widoczna przy każdej zmianie schematu - a nie odkrywana
  // po wysłaniu kampanii do dwudziestu tysięcy osób zamiast do trzystu.
  it.each([
    ["nie-obiekt", "cokolwiek"],
    ["liczba", 42],
    ["tablica", []],
    ["nieznany język", { languages: ["de"] }],
    ["nieznany status", { statuses: ["bounced"] }],
    ["za długa lista języków", { languages: ["pl", "en", "pl"] }],
    ["ranga ujemna", { min_tier_rank: -1 }],
    ["ranga poza zakresem", { min_tier_rank: 1001 }],
    ["ranga niecałkowita", { min_tier_rank: 2.5 }],
    ["ranga jako napis", { min_tier_rank: "30" }],
    ["źródło za długie", { source: "x".repeat(121) }],
    ["źródło jako obiekt", { source: { value: "x" } }],
  ])("uszkodzony ładunek (%s) daje filtr PUSTY, nie wyjątek", (_label, raw) => {
    expect(() => readAudienceFilter(raw)).not.toThrow();
    expect(readAudienceFilter(raw)).toEqual({});
  });

  it("uszkodzenie JEDNEGO pola unieważnia CAŁY filtr, nie tylko to pole", () => {
    // To jest najdroższa gałąź całej funkcji i najłatwiejsza do przeoczenia:
    // kampania z poprawnym zawężeniem do `pl` i uszkodzoną rangą warstwy leci
    // do WSZYSTKICH języków, nie tylko do polskiego. Zapisane wprost, bo
    // alternatywa (odsiewanie pojedynczych pól) jest realną pokusą przy
    // następnej zmianie schematu i byłaby cichą zmianą audytorium.
    const partiallyBroken = { languages: ["pl"], min_tier_rank: -5 };
    expect(readAudienceFilter(partiallyBroken)).toEqual({});
  });

  it("PUSTA lista statusów jest odczytana jako brak zawężenia", () => {
    // `statuses: []` przechodzi schemat, a wysyłka czyta go jako
    // `statuses?.length ? statuses : ["subscribed"]`, więc pusta lista NIE
    // znaczy „do nikogo". Zapisane, bo intuicja podpowiada odwrotnie.
    expect(readAudienceFilter({ statuses: [] })).toEqual({ statuses: [] });
  });

  it("wynik nigdy nie niesie `undefined` w kluczach obecnych", () => {
    const filter = readAudienceFilter({ source: "x" });
    for (const [key, value] of Object.entries(filter)) {
      expect(value, key).not.toBeUndefined();
    }
  });
});

/* ------------------------------------------------------------------ */
/* tickNewsletterCampaigns - izolacja najemcy                          */
/* ------------------------------------------------------------------ */

interface RecordedFilter {
  column: string;
  value: unknown;
}

interface RecordedQuery {
  table: string;
  kind: "select" | "update";
  filters: RecordedFilter[];
  or: string[];
  patch?: Record<string, unknown>;
}

interface CampaignStub {
  id: string;
  tenant_id: string;
}

/**
 * Atrapa klienta bazy notująca KAŻDE zawężenie.
 *
 * Badamy jedną rzecz: jakie warunki tick nakłada na zapytania i z jakim
 * tenantem woła zależności. Dlatego atrapa nie udaje bazy - notuje wywołania
 * i oddaje przygotowane wiersze.
 */
function fakeDb(options: {
  due?: CampaignStub[];
  continuing?: CampaignStub[];
  /** Wynik `claimCampaign` - `null` zatrzymuje tick przed samą wysyłką. */
  claim?: CampaignStub | null;
}) {
  const queries: RecordedQuery[] = [];
  const due = options.due ?? [];
  const continuing = options.continuing ?? [];
  let selectCount = 0;

  function builder(table: string, kind: "select" | "update", patch?: Record<string, unknown>) {
    const record: RecordedQuery = { table, kind, filters: [], or: [], patch };
    queries.push(record);

    /** Wiersze dla tego zapytania: pierwszy `select` to zaległe, drugi kontynuacje. */
    const rowsFor = (): CampaignStub[] => {
      const status = record.filters.find((f) => f.column === "status")?.value;
      if (status === "scheduled") return due;
      if (status === "sending") return continuing;
      return [];
    };

    // Łańcuch jest jednocześnie BUDOWALNY i AWAIT-OWALNY (thenable).
    //
    // Tak działa `PostgrestFilterBuilder` i tak korzysta z niego produkcja:
    // `let q = ...limit(3); if (tenantId) q = q.eq(...); await q;` - czyli
    // zawężenie jest dokładane PO terminatorze. Atrapa, w której `limit()`
    // oddaje gotową obietnicę, wywala się na `q.eq is not a function` i nie
    // sprawdziłaby właśnie tego, o co w tym pliku chodzi: że przypięcie po
    // tenancie realnie ląduje w zapytaniu.
    const chain = {
      select() {
        selectCount += 1;
        return chain;
      },
      eq(column: string, value: unknown) {
        record.filters.push({ column, value });
        return chain;
      },
      lte(column: string, value: unknown) {
        record.filters.push({ column: `${column}<=`, value });
        return chain;
      },
      or(expression: string) {
        record.or.push(expression);
        return chain;
      },
      order() {
        return chain;
      },
      limit() {
        return chain;
      },
      maybeSingle() {
        return Promise.resolve({ data: options.claim ?? null, error: null });
      },
      then(
        resolve: (value: { data: unknown; error: null }) => unknown,
        reject?: (reason: unknown) => unknown,
      ) {
        const payload =
          record.kind === "select" ? { data: rowsFor(), error: null } : { data: null, error: null };
        return Promise.resolve(payload).then(resolve, reject);
      },
    };
    return chain;
  }

  const client = {
    from(table: string) {
      return {
        select: (_columns: string) => builder(table, "select").select(),
        update: (patch: Record<string, unknown>) => builder(table, "update", patch),
        insert: () => Promise.resolve({ error: null }),
        upsert: () => Promise.resolve({ error: null }),
      };
    },
    rpc: async () => ({ data: [], error: null }),
  };

  return {
    /** Rzutowanie na kliencie-atrapie: tick przyjmuje `SupabaseClient<Database>`. */
    client: client as unknown as Parameters<typeof tickNewsletterCampaigns>[0],
    queries,
    get selectCount() {
      return selectCount;
    },
    campaignSelects: () =>
      queries.filter((q) => q.table === "newsletter_campaigns" && q.kind === "select"),
    campaignUpdates: () =>
      queries.filter((q) => q.table === "newsletter_campaigns" && q.kind === "update"),
  };
}

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function tenantFilters(query: RecordedQuery): unknown[] {
  return query.filters.filter((f) => f.column === "tenant_id").map((f) => f.value);
}

beforeEach(() => {
  gate.allowed = true;
  gate.calls = [];
});

describe("tickNewsletterCampaigns - tryb jednego najemcy", () => {
  it("OBA zapytania o kampanie są przypięte do podanego tenanta", async () => {
    // Dwa zapytania, nie jedno: zaległe zaplanowane i kontynuacje. Przypięcie
    // tylko pierwszego zostawiłoby drugą pętlę cross-tenant - a to ona podejmuje
    // kampanie po awarii procesu, czyli działa najczęściej.
    const db = fakeDb({});
    await tickNewsletterCampaigns(db.client, { tenantId: TENANT_A });
    const selects = db.campaignSelects();
    expect(selects).toHaveLength(2);
    for (const query of selects) {
      expect(tenantFilters(query)).toEqual([TENANT_A]);
    }
  });

  it("pierwsze zapytanie bierze zaległe ZAPLANOWANE, drugie KONTYNUACJE", async () => {
    const db = fakeDb({});
    await tickNewsletterCampaigns(db.client, { tenantId: TENANT_A });
    const statuses = db
      .campaignSelects()
      .map((q) => q.filters.find((f) => f.column === "status")?.value);
    expect(statuses).toEqual(["scheduled", "sending"]);
  });

  it("kontynuacja bierze wyłącznie kampanie BEZ aktywnej dzierżawy", async () => {
    // Bez tego warunku tick podejmowałby kampanię, którą właśnie przetwarza
    // inny proces - i ta sama osoba dostałaby wiadomość dwa razy.
    const db = fakeDb({});
    await tickNewsletterCampaigns(db.client, { tenantId: TENANT_A });
    const [, continuation] = db.campaignSelects();
    expect(continuation.or.join(" ")).toContain("lease_until.is.null");
    expect(continuation.or.join(" ")).toContain("lease_until.lt.");
  });
});

describe("tickNewsletterCampaigns - tryb cross-tenant (`/api/public/jobs-tick`)", () => {
  it("BEZ tenanta nie nakłada zawężenia po tenancie - to jest tryb zamierzony", async () => {
    const db = fakeDb({});
    await tickNewsletterCampaigns(db.client, {});
    for (const query of db.campaignSelects()) {
      expect(tenantFilters(query)).toEqual([]);
    }
  });

  it("bramka reputacji jest pytana o tenanta KAŻDEJ kampanii, nie o wołającego", async () => {
    // Rdzeń izolacji w tym trybie. Gdyby tick liczył bramkę raz „dla siebie",
    // najemca z przekroczonym progiem skarg wysyłałby dalej na koszt reputacji
    // najemcy, którego kampania trafiła do pętli pierwsza.
    const db = fakeDb({
      due: [
        { id: "camp-a", tenant_id: TENANT_A },
        { id: "camp-b", tenant_id: TENANT_B },
      ],
      claim: null,
    });
    await tickNewsletterCampaigns(db.client, {});
    expect(gate.calls).toEqual([TENANT_A, TENANT_B]);
  });

  it("bramka jest liczona RAZ na tenanta, nawet przy kilku jego kampaniach", async () => {
    // Zapytanie agregujące; powtarzanie go per kampania tego samego najemcy to
    // czysty koszt. Warunek pilnuje pamięci wyniku, nie samej izolacji.
    const db = fakeDb({
      due: [
        { id: "camp-a1", tenant_id: TENANT_A },
        { id: "camp-a2", tenant_id: TENANT_A },
        { id: "camp-b1", tenant_id: TENANT_B },
      ],
      claim: null,
    });
    await tickNewsletterCampaigns(db.client, {});
    expect(gate.calls).toEqual([TENANT_A, TENANT_B]);
  });

  it("zajęcie kampanii jest przypięte PARĄ (id, tenant_id) tej kampanii", async () => {
    // `claimCampaign` jest atomowym zajęciem przez `service_role`. Sam `id`
    // wystarczałby do trafienia w wiersz, ale para wiąże zajęcie z najemcą
    // WIERSZA - a to ta wartość jedzie potem w dół jako tenant wysyłki.
    const db = fakeDb({ due: [{ id: "camp-b", tenant_id: TENANT_B }], claim: null });
    await tickNewsletterCampaigns(db.client, {});
    const claim = db.campaignUpdates().find((q) => q.patch?.status === "sending");
    expect(claim).toBeDefined();
    expect(claim?.filters).toEqual(
      expect.arrayContaining([
        { column: "id", value: "camp-b" },
        { column: "tenant_id", value: TENANT_B },
      ]),
    );
  });

  it("zajęcie w trybie `due` wymaga statusu `scheduled` i minionego terminu", async () => {
    // Bez tych dwóch warunków dwa równoległe ticki zajęłyby tę samą kampanię,
    // bo `update` bez sprawdzenia stanu wygrywa zawsze.
    const db = fakeDb({ due: [{ id: "camp-a", tenant_id: TENANT_A }], claim: null });
    await tickNewsletterCampaigns(db.client, {});
    const claim = db.campaignUpdates().find((q) => q.patch?.status === "sending");
    expect(claim?.filters.map((f) => f.column)).toContain("scheduled_at<=");
    expect(claim?.filters.filter((f) => f.column === "status").map((f) => f.value)).toEqual([
      "scheduled",
    ]);
  });
});

describe("tickNewsletterCampaigns - bramka reputacji zatrzymuje kampanię przy WŁAŚCIWYM najemcy", () => {
  it("zablokowana kampania jest oznaczana jako nieudana z parą (id, tenant_id)", async () => {
    // Regresja domknięta w tej zmianie: `markFailed` przyjmował sam `id`, więc
    // w trybie cross-tenant nic w SYGNATURZE nie wymuszało tenanta na zapisie
    // idącym z pominięciem RLS. Teraz tenant jest argumentem obowiązkowym,
    // a ten warunek pilnuje, że w zapytaniu faktycznie ląduje.
    gate.allowed = false;
    const db = fakeDb({ due: [{ id: "camp-b", tenant_id: TENANT_B }] });
    await tickNewsletterCampaigns(db.client, {});
    const failed = db.campaignUpdates().find((q) => q.patch?.status === "failed");
    expect(failed).toBeDefined();
    expect(failed?.filters).toEqual(
      expect.arrayContaining([
        { column: "id", value: "camp-b" },
        { column: "tenant_id", value: TENANT_B },
      ]),
    );
  });

  it("powód blokady jest zapisany, a nie zgubiony - operator musi go zobaczyć", async () => {
    // Kampania zaplanowana nie ma człowieka przy klawiaturze. Zatrzymanie bez
    // powodu wygląda na liście jak awaria wysyłki, a nie jak decyzja bramki.
    gate.allowed = false;
    const db = fakeDb({ due: [{ id: "camp-a", tenant_id: TENANT_A }] });
    await tickNewsletterCampaigns(db.client, {});
    const failed = db.campaignUpdates().find((q) => q.patch?.status === "failed");
    expect(failed?.patch?.last_error).toBe("reputation_blocked");
  });

  it("zablokowana kampania NIE jest zajmowana - blokada wyprzedza dzierżawę", async () => {
    gate.allowed = false;
    const db = fakeDb({ due: [{ id: "camp-a", tenant_id: TENANT_A }] });
    await tickNewsletterCampaigns(db.client, {});
    expect(db.campaignUpdates().some((q) => q.patch?.status === "sending")).toBe(false);
  });

  it("blokada JEDNEGO najemcy nie zatrzymuje kampanii drugiego", async () => {
    // Tick cross-tenant obsługuje wielu najemców w jednym przebiegu. Przerwanie
    // pętli na pierwszej blokadzie wstrzymałoby wysyłki wszystkim kolejnym.
    gate.allowed = false;
    const db = fakeDb({
      due: [
        { id: "camp-a", tenant_id: TENANT_A },
        { id: "camp-b", tenant_id: TENANT_B },
      ],
    });
    await tickNewsletterCampaigns(db.client, {});
    const failedIds = db
      .campaignUpdates()
      .filter((q) => q.patch?.status === "failed")
      .flatMap((q) => q.filters.filter((f) => f.column === "id").map((f) => f.value));
    expect(failedIds).toEqual(["camp-a", "camp-b"]);
  });
});

describe("tickNewsletterCampaigns - budżet i pusty przebieg", () => {
  it("pusty przebieg nie odpala i nie kontynuuje niczego", async () => {
    const db = fakeDb({});
    await expect(tickNewsletterCampaigns(db.client, { tenantId: TENANT_A })).resolves.toEqual({
      fired: 0,
      continued: 0,
      sent: 0,
    });
    expect(db.campaignUpdates()).toEqual([]);
  });

  it("nieudane zajęcie nie liczy się jako odpalenie", async () => {
    // `claim` na `null` znaczy „ktoś inny był pierwszy". Zliczenie tego jako
    // `fired` zawyżałoby statystykę i maskowało realną liczbę wysyłek.
    const db = fakeDb({ due: [{ id: "camp-a", tenant_id: TENANT_A }], claim: null });
    await expect(tickNewsletterCampaigns(db.client, { tenantId: TENANT_A })).resolves.toEqual({
      fired: 0,
      continued: 0,
      sent: 0,
    });
  });

  it("budżet zerowy albo ujemny jest podnoszony do jednego e-maila", async () => {
    // `Math.max(1, ...)`: budżet 0 zamieniłby tick w pętlę, która nic nie robi
    // i nigdy nie zgłasza problemu - kampanie stałyby w `scheduled` bez śladu.
    const db = fakeDb({ due: [{ id: "camp-a", tenant_id: TENANT_A }], claim: null });
    await expect(
      tickNewsletterCampaigns(db.client, { tenantId: TENANT_A, maxEmails: 0 }),
    ).resolves.toMatchObject({ fired: 0 });
    // Zapytanie o zaległe kampanie MUSIAŁO się wykonać - inaczej budżet 0
    // wychodziłby z funkcji przed jakąkolwiek pracą.
    expect(db.campaignSelects().length).toBeGreaterThan(0);
  });

  it("gasnący budżet nie blokuje drugiej pętli, gdy pierwsza nic nie zużyła", async () => {
    const db = fakeDb({ continuing: [{ id: "camp-a", tenant_id: TENANT_A }], claim: null });
    await tickNewsletterCampaigns(db.client, { tenantId: TENANT_A });
    expect(db.campaignSelects()).toHaveLength(2);
  });
});
