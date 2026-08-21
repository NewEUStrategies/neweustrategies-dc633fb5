// WERSJONOWANIE DOKUMENTÓW PRAWNYCH (`src/lib/legal/versions.ts` - 0%,
// `useLegalDocument.ts` - 0%, `registry.ts` - 0%).
//
// PO CO TO JEST NAJWAŻNIEJSZY PLIK W ETAPIE ZGÓD. Zgoda musi być DOWODLIWA:
// zapis w rejestrze niesie wersję dokumentu, znacznik czasu i zakres, a to ten
// moduł decyduje, NA CO ktoś się zgodził. Bez niego wersja w
// `user_consents.version` jest liczbą bez odniesienia.
//
// Zdanie, które ten plik ma udowodnić: NOWA WERSJA REGULAMINU NIE ZMIENIA
// RETROAKTYWNIE ZAPISANEJ ZGODY. Publikacja tworzy NOWY wiersz i archiwizuje
// stary (RPC `publish_legal_version`); treść, na którą ktoś się zgodził,
// zostaje osiągalna po identyfikatorze wersji. Gdyby publikacja NADPISYWAŁA
// wiersz, historia zgód przestałaby wskazywać na cokolwiek - i to jest ta
// klasa błędu, której nie zobaczy żaden test renderujący stronę regulaminu.
//
// CO DOWODZIMY:
//   1. ODCZYT PUBLICZNY bierze wyłącznie wersję `published` i wyłącznie po
//      kluczu dokumentu; brak wersji albo zły kształt = treść z KODU (baseline).
//      Strona prawna nigdy nie może wyjść pusta.
//   2. ZŁY KSZTAŁT treści w bazie jest ODRZUCANY przez `safeParseLegalContent`,
//      a nie renderowany - dokument prawny z brakującą sekcją to dokument
//      niekompletny, więc lepszy jest baseline niż połowa umowy.
//   3. PANEL: lista wersji sortowana najnowsze-pierwsze, szkic zapisany z
//      autorem, publikacja WYŁĄCZNIE przez RPC (atomowa), archiwizacja
//      i usunięcie - z unieważnieniem OBU kluczy cache (panelu i publicznego).
//   4. REJESTR DOKUMENTÓW: trzy dokumenty, ścieżki publiczne i etykiety PL/EN,
//      a każdy baseline przechodzi walidację treści.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - ATOMOWOŚCI PUBLIKACJI. `publish_legal_version` jest SECURITY DEFINER
//   i to baza gwarantuje, że w danym momencie istnieje dokładnie jedna wersja
//   `published` per klucz. Tu dowodzimy WYŁĄCZNIE, że panel woła tę procedurę,
//   a nie robi dwóch `update`ów po kolei (co przy błędzie zostawiłoby dokument
//   bez żadnej opublikowanej wersji).
// - RLS: zapisy chroni polityka administrator/edytor w obrębie najemcy;
//   odczyt anonimowy jest ograniczony do `published`. To pgTAP.
// - TREŚCI BASELINE: `src/lib/legal/__tests__/legalContent.test.ts` sprawdza
//   kompletność i parytet PL/EN samych tekstów.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RecordedChain, SupabaseFromStub, SupabaseResult } from "@/test/supabaseChain";
import type { LegalDocContent } from "@/lib/legal/types";

const h = vi.hoisted(() => ({
  db: null as SupabaseFromStub | null,
  /** Zapisane wywołania RPC - publikacja MUSI iść tą drogą. */
  rpcCalls: [] as { name: string; args: unknown }[],
  rpcError: null as Error | null,
  /** Sesja czytana przy zapisie szkicu - autor wersji. */
  authUserId: "11111111-1111-4111-8111-111111111111" as string | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (!h.db) throw new Error("test: atrapa bazy nieustawiona");
      return h.db.from(table);
    },
    rpc: (name: string, args?: unknown) => {
      h.rpcCalls.push({ name, args });
      return Promise.resolve({ data: null, error: h.rpcError });
    },
    auth: {
      getUser: async () => ({
        data: { user: h.authUserId ? { id: h.authUserId } : null },
        error: null,
      }),
    },
  },
}));

import { fail, ok, supabaseFromStub } from "@/test/supabaseChain";
import { LEGAL_DOCS, LEGAL_DOC_LIST } from "@/lib/legal/registry";
import { LEGAL_DOC_KEYS, safeParseLegalContent } from "@/lib/legal/types";
import {
  fetchPublishedLegalContent,
  legalVersionQueryKey,
  useLegalDocumentCopy,
} from "@/lib/legal/useLegalDocument";
import {
  legalVersionsKey,
  toLegalVersion,
  useLegalVersionActions,
  useLegalVersions,
} from "@/lib/legal/versions";
import { pickLegalCopy } from "@/lib/legal/resolve";

const BASE_ISO = "2026-01-15T10:00:00.000Z";
const OLDER_ISO = "2025-06-01T08:30:00.000Z";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const OLD_VERSION_ID = "33333333-3333-4333-8333-333333333333";

/** Minimalna, POPRAWNA treść dokumentu - obie wersje językowe. */
function content(overrides: Partial<LegalDocContent> = {}): LegalDocContent {
  const copy = (title: string) => ({
    eyebrow: "Dokumenty",
    title,
    lead: "Wstęp",
    updated: "15 stycznia 2026",
    sections: [{ id: "s1", icon: "shield", heading: "Zakres", paragraphs: ["Treść"] }],
  });
  return { pl: copy("Regulamin"), en: copy("Terms"), ...overrides };
}

interface RawVersionRow {
  id: string;
  doc_key: string;
  label: string;
  status: string;
  content: unknown;
  note: string | null;
  effective_from: string | null;
  published_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function rawRow(overrides: Partial<RawVersionRow> = {}): RawVersionRow {
  return {
    id: VERSION_ID,
    doc_key: "terms",
    label: "v2 - 2026",
    status: "published",
    content: content(),
    note: null,
    effective_from: null,
    published_at: BASE_ISO,
    created_by: "11111111-1111-4111-8111-111111111111",
    created_at: BASE_ISO,
    updated_at: BASE_ISO,
    ...overrides,
  };
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

function setLegal(result: SupabaseResult | ((chain: RecordedChain) => SupabaseResult)) {
  h.db?.setResponse("legal_document_versions", result);
}

beforeEach(() => {
  h.db = supabaseFromStub();
  h.rpcCalls = [];
  h.rpcError = null;
  h.authUserId = "11111111-1111-4111-8111-111111111111";
});

// ---------------------------------------------------------------------------
// 1. REJESTR DOKUMENTÓW.
// ---------------------------------------------------------------------------

describe("legal/registry - katalog dokumentów prawnych", () => {
  it("każdy klucz z enumu ma definicję - a definicje nie mają nadwyżek", () => {
    // Domknięcie w obie strony: dokument w bazie bez definicji w kodzie nie ma
    // ścieżki publicznej, a definicja bez klucza jest martwym wpisem w panelu.
    expect(Object.keys(LEGAL_DOCS).sort()).toEqual([...LEGAL_DOC_KEYS].sort());
    expect(LEGAL_DOC_LIST).toHaveLength(LEGAL_DOC_KEYS.length);
  });

  it("każda definicja niesie ścieżkę publiczną i etykiety w OBU językach", () => {
    for (const doc of LEGAL_DOC_LIST) {
      expect(doc.path, `${doc.key}: ścieżka musi być absolutna`).toMatch(/^\//);
      expect(doc.labelPl.length, `${doc.key}: brak etykiety PL`).toBeGreaterThan(0);
      expect(doc.labelEn.length, `${doc.key}: brak etykiety EN`).toBeGreaterThan(0);
      // Etykieta angielska nie może być kopią polskiej - to znaczyłoby, że
      // tłumaczenia nie ma, a bramka parytetu słowników tego nie widzi
      // (te etykiety nie są kluczami i18n).
      expect(doc.labelEn, `${doc.key}: etykieta EN = PL`).not.toBe(doc.labelPl);
    }
  });

  it("ścieżki publiczne są UNIKALNE - dwa dokumenty pod jednym adresem to defekt", () => {
    const paths = LEGAL_DOC_LIST.map((doc) => doc.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("KAŻDY baseline z kodu przechodzi walidację treści", () => {
    // Baseline jest ostatnią linią obrony strony prawnej: gdyby sam nie
    // przechodził schematu, `pickLegalCopy` oddałby treść, której nie da się
    // wyrenderować, a strona regulaminu wyszłaby pusta.
    for (const doc of LEGAL_DOC_LIST) {
      expect(
        safeParseLegalContent(doc.baseline),
        `${doc.key}: baseline nie przechodzi`,
      ).not.toBeNull();
    }
  });

  it("klucz definicji zgadza się z kluczem w mapie", () => {
    for (const [key, doc] of Object.entries(LEGAL_DOCS)) {
      expect(doc.key).toBe(key);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. MAPOWANIE WIERSZA -> WERSJA. Tu mieszka dowodliwość zgody.
// ---------------------------------------------------------------------------

describe("toLegalVersion - wiersz bazy na wersję dokumentu", () => {
  it("przenosi WSZYSTKIE pola audytowe: autora, znaczniki czasu, datę wejścia w życie", () => {
    // Bez `published_at` i `effective_from` nie da się odpowiedzieć na pytanie
    // „która wersja obowiązywała, gdy ta osoba wyraziła zgodę".
    const version = toLegalVersion(rawRow({ effective_from: "2026-02-01", note: "poprawka RODO" }));
    expect(version).toMatchObject({
      id: VERSION_ID,
      doc_key: "terms",
      label: "v2 - 2026",
      status: "published",
      note: "poprawka RODO",
      effective_from: "2026-02-01",
      published_at: BASE_ISO,
      created_by: "11111111-1111-4111-8111-111111111111",
      created_at: BASE_ISO,
      updated_at: BASE_ISO,
    });
  });

  it("wiersz o ZŁYM kształcie treści daje `null` - nie połowę dokumentu", () => {
    // Dokument prawny z brakującą sekcją to dokument niekompletny. Wersja
    // niekompletna musi wypaść z listy, a nie zostać pokazana jako obowiązująca.
    for (const broken of [
      null,
      {},
      { pl: content().pl },
      { pl: content().pl, en: { ...content().en, title: "" } },
      { pl: content().pl, en: { ...content().en, sections: "nie tablica" } },
      "łańcuch",
      42,
    ]) {
      expect(toLegalVersion(rawRow({ content: broken })), JSON.stringify(broken)).toBeNull();
    }
  });

  it("treść z sekcją bez wymaganych pól jest odrzucana", () => {
    const bad = content();
    const broken = {
      ...bad,
      pl: { ...bad.pl, sections: [{ id: "", icon: "shield", heading: "X" }] },
    };
    expect(toLegalVersion(rawRow({ content: broken }))).toBeNull();
  });

  it("stopka jest OPCJONALNA, a sekcje mogą być puste (dokument w budowie)", () => {
    const minimal = content();
    const withoutSections = {
      pl: { ...minimal.pl, sections: [] },
      en: { ...minimal.en, sections: [] },
    };
    expect(toLegalVersion(rawRow({ content: withoutSections }))).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. ODCZYT PUBLICZNY - strona prawna nigdy nie może wyjść pusta.
// ---------------------------------------------------------------------------

describe("fetchPublishedLegalContent - odczyt opublikowanej wersji", () => {
  it("pyta o WERSJĘ OPUBLIKOWANĄ danego dokumentu - dwa warunki, oba są regułą", async () => {
    // Sam `doc_key` wyciągnąłby też szkice (widoczne dla stafu przez RLS),
    // czyli tekst, którego nikt nie zatwierdził, na publicznej stronie umowy.
    setLegal(ok({ content: content() }));
    await fetchPublishedLegalContent("terms");
    const eqArgs = h.db
      ?.lastChain("legal_document_versions")
      ?.calls.filter((call) => call.method === "eq")
      .map((call) => call.args);
    expect(eqArgs).toEqual([
      ["doc_key", "terms"],
      ["status", "published"],
    ]);
  });

  it("brak wiersza daje `null` - wywołujący spadnie na baseline", async () => {
    setLegal(ok(null));
    await expect(fetchPublishedLegalContent("privacy")).resolves.toBeNull();
  });

  it("AWARIA odczytu daje `null`, a nie wyjątek - strona prawna musi się wyrenderować", async () => {
    // Świadoma degradacja: regulamin jest dokumentem, który MUSI być dostępny
    // (obowiązek informacyjny), więc awaria bazy schodzi na treść z kodu.
    setLegal(fail("statement timeout"));
    await expect(fetchPublishedLegalContent("terms")).resolves.toBeNull();
  });

  it("treść o złym kształcie w bazie daje `null` - baseline wygrywa z połową umowy", async () => {
    setLegal(ok({ content: { pl: content().pl } }));
    await expect(fetchPublishedLegalContent("terms")).resolves.toBeNull();
  });

  it("poprawna treść wraca sparsowana", async () => {
    setLegal(ok({ content: content() }));
    const result = await fetchPublishedLegalContent("terms");
    expect(result?.pl.title).toBe("Regulamin");
    expect(result?.en.title).toBe("Terms");
  });

  it("klucz cache odczytu publicznego jest ZAWĘŻONY do dokumentu", () => {
    // Wspólny klucz dla trzech dokumentów pokazywałby regulamin na stronie
    // polityki prywatności - i to po pierwszym wejściu, z cache.
    expect(legalVersionQueryKey("terms")).not.toEqual(legalVersionQueryKey("privacy"));
    expect(legalVersionQueryKey("terms")).toContain("terms");
  });
});

describe("useLegalDocumentCopy - treść dla strony publicznej", () => {
  it("wersja z bazy MA PIERWSZEŃSTWO nad treścią z kodu", async () => {
    setLegal(ok({ content: content({ pl: { ...content().pl, title: "Regulamin v3" } }) }));
    const client = newClient();
    const { result } = renderHook(
      () => useLegalDocumentCopy("terms", LEGAL_DOCS.terms.baseline, "pl"),
      { wrapper: wrapper(client) },
    );
    await waitFor(() => expect(result.current.title).toBe("Regulamin v3"));
  });

  it("brak wersji w bazie schodzi na baseline - w OBU językach", async () => {
    setLegal(ok(null));
    const client = newClient();
    const { result: pl } = renderHook(
      () => useLegalDocumentCopy("terms", LEGAL_DOCS.terms.baseline, "pl"),
      { wrapper: wrapper(client) },
    );
    await waitFor(() => expect(pl.current.title).toBe(LEGAL_DOCS.terms.baseline.pl.title));

    const clientEn = newClient();
    const { result: en } = renderHook(
      () => useLegalDocumentCopy("terms", LEGAL_DOCS.terms.baseline, "en"),
      { wrapper: wrapper(clientEn) },
    );
    await waitFor(() => expect(en.current.title).toBe(LEGAL_DOCS.terms.baseline.en.title));
  });

  it("nazwy ikon z bazy są zamieniane na komponenty - sekcja zawsze ma ikonę", async () => {
    // Treść jest serializowalna (ikona to NAZWA), więc bez rozwiązania nazwy
    // sekcja renderowałaby się bez znaku, a nieznana nazwa nie może wywalić
    // strony.
    setLegal(
      ok({
        content: content({
          pl: {
            ...content().pl,
            sections: [
              { id: "a", icon: "shield", heading: "Znana ikona" },
              { id: "b", icon: "nie-ma-takiej-ikony", heading: "Nieznana ikona" },
            ],
          },
        }),
      }),
    );
    const client = newClient();
    const { result } = renderHook(
      () => useLegalDocumentCopy("terms", LEGAL_DOCS.terms.baseline, "pl"),
      { wrapper: wrapper(client) },
    );
    await waitFor(() => expect(result.current.sections).toHaveLength(2));
    for (const section of result.current.sections) {
      expect(section.Icon, `sekcja ${section.id} bez ikony`).toBeTruthy();
    }
  });
});

describe("pickLegalCopy - wybór wersji językowej", () => {
  it("brak wersji językowej w treści z bazy schodzi na baseline TEGO języka", () => {
    // To jest gałąź `source[lang] ?? fallback[lang]`: dokument opublikowany
    // tylko po polsku nie może dać pustej strony na `/en/`.
    const onlyPolish = { pl: content().pl } as unknown as LegalDocContent;
    const resolved = pickLegalCopy(onlyPolish, LEGAL_DOCS.terms.baseline, "en");
    expect(resolved.title).toBe(LEGAL_DOCS.terms.baseline.en.title);
  });

  it("`null` z bazy oddaje baseline bez zmian", () => {
    const resolved = pickLegalCopy(null, LEGAL_DOCS.privacy.baseline, "pl");
    expect(resolved.title).toBe(LEGAL_DOCS.privacy.baseline.pl.title);
  });

  it("stopka przechodzi, gdy jest, i nie jest wymyślana, gdy jej nie ma", () => {
    const withFootnote = content();
    withFootnote.pl = { ...withFootnote.pl, footnote: "Dokument informacyjny" };
    expect(pickLegalCopy(withFootnote, LEGAL_DOCS.terms.baseline, "pl").footnote).toBe(
      "Dokument informacyjny",
    );
    expect(pickLegalCopy(content(), LEGAL_DOCS.terms.baseline, "pl").footnote).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. PANEL: lista, szkic, publikacja, archiwizacja, usunięcie.
// ---------------------------------------------------------------------------

describe("useLegalVersions - lista wersji w panelu", () => {
  it("sortuje NAJNOWSZE PIERWSZE i pyta o jeden dokument", async () => {
    setLegal(
      ok([rawRow({ id: VERSION_ID }), rawRow({ id: OLD_VERSION_ID, created_at: OLDER_ISO })]),
    );
    const client = newClient();
    const { result } = renderHook(() => useLegalVersions("terms"), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.data).toHaveLength(2));
    const chain = h.db?.lastChain("legal_document_versions");
    expect(chain?.argsOf("eq")).toEqual(["doc_key", "terms"]);
    expect(chain?.argsOf("order")).toEqual(["created_at", { ascending: false }]);
  });

  it("wiersze o ZŁYM kształcie treści są ODSIEWANE, nie wywracają listy", async () => {
    // Jeden zepsuty szkic nie może zabrać panelu - administrator musi móc
    // opublikować którąkolwiek z pozostałych wersji.
    setLegal(ok([rawRow({ id: VERSION_ID }), rawRow({ id: OLD_VERSION_ID, content: { pl: {} } })]));
    const client = newClient();
    const { result } = renderHook(() => useLegalVersions("terms"), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data?.[0].id).toBe(VERSION_ID);
  });

  it("odczyt zwracający `null` daje pustą listę", async () => {
    setLegal(ok(null));
    const client = newClient();
    const { result } = renderHook(() => useLegalVersions("privacy"), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.data).toEqual([]));
  });

  it("awaria odczytu jest BŁĘDEM zapytania - panel musi ją pokazać", async () => {
    // Odwrotnie niż na stronie publicznej: administrator, który widzi pustą
    // listę wersji, może uznać, że dokument nigdy nie był publikowany.
    setLegal(fail("permission denied"));
    const client = newClient();
    const { result } = renderHook(() => useLegalVersions("terms"), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("klucz cache panelu jest ROZŁĄCZNY z kluczem odczytu publicznego", () => {
    // Wspólny klucz oznaczałby, że panel (widzący szkice) i strona publiczna
    // (widząca tylko `published`) czytają z tego samego wpisu cache.
    expect(legalVersionsKey("terms")).not.toEqual(legalVersionQueryKey("terms"));
  });
});

describe("useLegalVersionActions - zapis, publikacja, archiwizacja, usunięcie", () => {
  /** Panel zapisu: wstawienia/aktualizacje przechodzą, odczyt oddaje listę. */
  function panelResponses(writeError?: string): void {
    setLegal((chain) => {
      const isWrite = chain.has("insert") || chain.has("update") || chain.has("delete");
      if (isWrite) return writeError ? fail(writeError) : ok(null);
      return ok([rawRow()]);
    });
  }

  it("szkic zapisuje się z AUTOREM z sesji i pustą notatką jako `null`", async () => {
    panelResponses();
    const client = newClient();
    const { result } = renderHook(() => useLegalVersionActions("terms"), {
      wrapper: wrapper(client),
    });
    await result.current.create.mutateAsync({
      docKey: "terms",
      label: "v3 - luty",
      content: content(),
    });
    const insert = h.db
      ?.chainsFor("legal_document_versions")
      .find((chain) => chain.has("insert"))
      ?.argsOf("insert")?.[0] as Record<string, unknown>;
    expect(insert).toMatchObject({
      doc_key: "terms",
      label: "v3 - luty",
      // Autor wersji jest częścią śladu audytowego dokumentu prawnego.
      created_by: "11111111-1111-4111-8111-111111111111",
      note: null,
    });
    // Szkic NIE powstaje jako `published` - status nadaje dopiero publikacja.
    expect(insert.status).toBeUndefined();
  });

  it("notatka przechodzi, gdy jest podana", async () => {
    panelResponses();
    const client = newClient();
    const { result } = renderHook(() => useLegalVersionActions("terms"), {
      wrapper: wrapper(client),
    });
    await result.current.create.mutateAsync({
      docKey: "terms",
      label: "v3",
      note: "wymóg RODO art. 13",
      content: content(),
    });
    const insert = h.db
      ?.chainsFor("legal_document_versions")
      .find((chain) => chain.has("insert"))
      ?.argsOf("insert")?.[0] as { note: string | null };
    expect(insert.note).toBe("wymóg RODO art. 13");
  });

  it("BRAK sesji zapisuje szkic z autorem `null`, a nie z `undefined`", async () => {
    // `undefined` w kolumnie oznaczałoby „nie podano", a to zostawia wiersz
    // bez autora bez śladu, że autora nie znaliśmy.
    h.authUserId = null;
    panelResponses();
    const client = newClient();
    const { result } = renderHook(() => useLegalVersionActions("terms"), {
      wrapper: wrapper(client),
    });
    await result.current.create.mutateAsync({ docKey: "terms", label: "v3", content: content() });
    const insert = h.db
      ?.chainsFor("legal_document_versions")
      .find((chain) => chain.has("insert"))
      ?.argsOf("insert")?.[0] as { created_by: string | null };
    expect(insert.created_by).toBeNull();
  });

  it("odmowa zapisu szkicu PROPAGUJE błąd - panel nie może udawać sukcesu", async () => {
    panelResponses("permission denied for table legal_document_versions");
    const client = newClient();
    const { result } = renderHook(() => useLegalVersionActions("terms"), {
      wrapper: wrapper(client),
    });
    await expect(
      result.current.create.mutateAsync({ docKey: "terms", label: "v3", content: content() }),
    ).rejects.toThrow(/permission denied/);
  });

  it("PUBLIKACJA idzie WYŁĄCZNIE przez RPC - nie dwoma `update`ami", async () => {
    // To jest cała asercja o dowodliwości: `publish_legal_version` w jednej
    // transakcji archiwizuje dotychczasową wersję i publikuje nową. Dwa
    // osobne `update`y mogłyby zostawić dokument BEZ opublikowanej wersji
    // (albo z dwiema), a wtedy `user_consents.version` wskazuje w pustkę.
    panelResponses();
    const client = newClient();
    const { result } = renderHook(() => useLegalVersionActions("terms"), {
      wrapper: wrapper(client),
    });
    await result.current.publish.mutateAsync(VERSION_ID);
    expect(h.rpcCalls).toEqual([{ name: "publish_legal_version", args: { _id: VERSION_ID } }]);
    // Żadnego zapisu wprost do tabeli - autorytet zostaje przy bazie.
    expect(h.db?.chainsFor("legal_document_versions").some((chain) => chain.has("update"))).toBe(
      false,
    );
  });

  it("odmowa publikacji propaguje błąd RPC", async () => {
    panelResponses();
    h.rpcError = new Error("not_authorized");
    const client = newClient();
    const { result } = renderHook(() => useLegalVersionActions("terms"), {
      wrapper: wrapper(client),
    });
    await expect(result.current.publish.mutateAsync(VERSION_ID)).rejects.toThrow("not_authorized");
  });

  it("ARCHIWIZACJA zmienia status, a NIE usuwa wiersza", async () => {
    // Wersja, na którą ktoś się zgodził, musi zostać osiągalna po
    // identyfikatorze - usunięcie zabrałoby dowód treści zgody.
    panelResponses();
    const client = newClient();
    const { result } = renderHook(() => useLegalVersionActions("terms"), {
      wrapper: wrapper(client),
    });
    await result.current.unpublish.mutateAsync(VERSION_ID);
    const chain = h.db?.chainsFor("legal_document_versions").find((entry) => entry.has("update"));
    expect(chain?.argsOf("update")).toEqual([{ status: "archived" }]);
    expect(chain?.argsOf("eq")).toEqual(["id", VERSION_ID]);
    expect(chain?.has("delete")).toBe(false);
  });

  it("USUNIĘCIE celuje w JEDEN wiersz po identyfikatorze", async () => {
    panelResponses();
    const client = newClient();
    const { result } = renderHook(() => useLegalVersionActions("terms"), {
      wrapper: wrapper(client),
    });
    await result.current.remove.mutateAsync(OLD_VERSION_ID);
    const chain = h.db?.chainsFor("legal_document_versions").find((entry) => entry.has("delete"));
    expect(chain?.argsOf("eq")).toEqual(["id", OLD_VERSION_ID]);
  });

  it("odmowa archiwizacji i odmowa usunięcia propagują błąd", async () => {
    panelResponses("permission denied");
    const client = newClient();
    const { result } = renderHook(() => useLegalVersionActions("terms"), {
      wrapper: wrapper(client),
    });
    await expect(result.current.unpublish.mutateAsync(VERSION_ID)).rejects.toThrow(
      "permission denied",
    );
    await expect(result.current.remove.mutateAsync(VERSION_ID)).rejects.toThrow(
      "permission denied",
    );
  });

  it("KAŻDA z czterech akcji unieważnia OBA klucze cache - panel i stronę publiczną", async () => {
    // Bez unieważnienia klucza publicznego opublikowana zmiana nie dojeżdża na
    // stronę regulaminu do wygaśnięcia `staleTime` (pięć minut) - a to jest
    // dokument, którego treść ma skutek prawny od momentu publikacji.
    panelResponses();
    const client = newClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useLegalVersionActions("privacy"), {
      wrapper: wrapper(client),
    });

    for (const run of [
      () =>
        result.current.create.mutateAsync({ docKey: "privacy", label: "v", content: content() }),
      () => result.current.publish.mutateAsync(VERSION_ID),
      () => result.current.unpublish.mutateAsync(VERSION_ID),
      () => result.current.remove.mutateAsync(VERSION_ID),
    ]) {
      spy.mockClear();
      await run();
      await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
      const keys = spy.mock.calls.map((call) => JSON.stringify(call[0]));
      expect(keys.some((key) => key.includes("legal-versions"))).toBe(true);
      expect(keys.some((key) => key.includes('legal-version"'))).toBe(true);
    }
  });

  it("akcje są zawężone do DOKUMENTU, dla którego hook powstał", async () => {
    // Unieważnienie cudzego klucza nie odświeżyłoby listy, którą administrator
    // ma przed oczami.
    panelResponses();
    const client = newClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useLegalVersionActions("refunds"), {
      wrapper: wrapper(client),
    });
    await result.current.publish.mutateAsync(VERSION_ID);
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const keys = spy.mock.calls.map((call) => JSON.stringify(call[0]));
    expect(keys.every((key) => key.includes("refunds"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. ZDANIE, KTÓRE CAŁY TEN PLIK MA UDOWODNIĆ.
// ---------------------------------------------------------------------------

describe("dowodliwość zgody - nowa wersja NIE działa retroaktywnie", () => {
  it("publikacja nowej wersji NIE RUSZA wiersza starej wersji", async () => {
    // Zgoda zapisana w `user_consents` niesie `version`. Jeśli publikacja
    // NADPISYWAŁABY treść dotychczasowego wiersza, ta sama wartość `version`
    // wskazywałaby po zmianie na INNY tekst - i nikt nie byłby w stanie
    // powiedzieć, na co dana osoba się zgodziła. Dlatego publikacja jest
    // wstawieniem NOWEGO wiersza plus archiwizacją poprzedniego (RPC), a nie
    // aktualizacją treści.
    setLegal((chain) => {
      if (chain.has("insert") || chain.has("update") || chain.has("delete")) return ok(null);
      return ok([rawRow()]);
    });
    const client = newClient();
    const { result } = renderHook(() => useLegalVersionActions("terms"), {
      wrapper: wrapper(client),
    });

    // 1. Nowa wersja to WSTAWIENIE, nie aktualizacja treści.
    await result.current.create.mutateAsync({
      docKey: "terms",
      label: "v3 - marzec",
      content: content({ pl: { ...content().pl, title: "Regulamin v3" } }),
    });
    const writes = h.db?.chainsFor("legal_document_versions") ?? [];
    expect(writes.some((chain) => chain.has("insert"))).toBe(true);
    expect(
      writes.some((chain) => {
        const update = chain.argsOf("update")?.[0];
        return (
          chain.has("update") &&
          typeof update === "object" &&
          update !== null &&
          "content" in update
        );
      }),
      "publikacja NIE MOŻE nadpisywać treści istniejącej wersji",
    ).toBe(false);

    // 2. Publikacja idzie przez RPC - baza rozstrzyga, która wersja obowiązuje.
    await result.current.publish.mutateAsync(VERSION_ID);
    expect(h.rpcCalls.map((call) => call.name)).toEqual(["publish_legal_version"]);

    // 3. Stara wersja zostaje w tabeli jako `archived` (nie `delete`).
    await result.current.unpublish.mutateAsync(OLD_VERSION_ID);
    const archive = h.db?.chainsFor("legal_document_versions").find((chain) => chain.has("update"));
    expect(archive?.argsOf("update")).toEqual([{ status: "archived" }]);
    expect(
      (h.db?.chainsFor("legal_document_versions") ?? []).some((chain) => chain.has("delete")),
      "archiwizacja NIE MOŻE usuwać wiersza - to dowód treści zgody",
    ).toBe(false);
  });

  it("strona publiczna pokazuje wersję OPUBLIKOWANĄ, a archiwalna zostaje osiągalna po `id`", async () => {
    // Odczyt publiczny filtruje `status = 'published'`, więc wersja archiwalna
    // nie pokazuje się nikomu przypadkiem - ale wiersz nadal jest w tabeli
    // i panel widzi go na liście. To jest cała mechanika dowodu.
    setLegal((chain) => {
      const eqArgs = chain.calls.filter((call) => call.method === "eq").map((call) => call.args);
      const wantsPublished = eqArgs.some((args) => args[0] === "status" && args[1] === "published");
      if (wantsPublished) return ok({ content: content({ pl: { ...content().pl, title: "v3" } }) });
      return ok([
        rawRow({ id: VERSION_ID, status: "published" }),
        rawRow({ id: OLD_VERSION_ID, status: "archived", created_at: OLDER_ISO }),
      ]);
    });

    await expect(fetchPublishedLegalContent("terms")).resolves.toMatchObject({
      pl: { title: "v3" },
    });

    const client = newClient();
    const { result } = renderHook(() => useLegalVersions("terms"), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.data).toHaveLength(2));
    const statuses = (result.current.data ?? []).map((version) => version.status);
    expect(statuses).toContain("published");
    expect(statuses).toContain("archived");
  });
});
