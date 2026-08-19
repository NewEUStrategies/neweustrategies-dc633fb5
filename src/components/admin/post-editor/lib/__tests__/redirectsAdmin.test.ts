import { describe, expect, it } from "vitest";
import { supabaseFromStub } from "@/test/supabaseChain";
import { parseRedirectsCsv } from "@/lib/seo/redirects";
import {
  EMPTY_REDIRECT_EDITOR,
  HITS_404_COLUMNS,
  HITS_404_LIMIT,
  REDIRECTS_INVALIDATE_KEYS,
  REDIRECTS_LIST_COLUMNS,
  REDIRECTS_LIST_LIMIT,
  applyHits404Query,
  applyRedirectsListQuery,
  coerceRedirectStatusCode,
  editorStateFromHit,
  editorStateFromRow,
  filterRedirects,
  formatRedirectStamp,
  importSkippedSuffix,
  isGoneCode,
  normalizationHint,
  redirectDraftValidity,
  redirectSourceLabel,
  redirectUpsertInput,
  redirectsCsvDownload,
  redirectsEmptyStateKey,
  showsTargetField,
  statusFilterFromSelect,
  tenantDomainsOf,
  withStatusCode,
  type RedirectEditorState,
  type RedirectRow,
  type RedirectsQueryBuilder,
  type Seo404Row,
} from "../redirectsAdmin";

/** Atrapa łańcucha PostgREST w kształcie, jakiego wymagają zapytania panelu. */
interface StubChain extends RedirectsQueryBuilder<StubChain> {
  select(columns: string): StubChain;
}

function row(over: Partial<RedirectRow> = {}): RedirectRow {
  return {
    id: "r-1",
    source_path: "/stary-wpis",
    target_path: "/nowy-wpis",
    status_code: 301,
    is_enabled: true,
    source: "manual",
    note: null,
    hit_count: 0,
    last_hit_at: null,
    created_at: "2026-08-01T10:00:00.000Z",
    ...over,
  };
}

function hit(over: Partial<Seo404Row> = {}): Seo404Row {
  return {
    path: "/2013/05/stary-wpis/",
    hits: 12,
    first_seen: "2026-08-01T10:00:00.000Z",
    last_seen: "2026-08-17T21:05:31.000Z",
    last_referrer: null,
    ...over,
  };
}

function editor(over: Partial<RedirectEditorState> = {}): RedirectEditorState {
  return { ...EMPTY_REDIRECT_EDITOR, ...over };
}

const OWN_DOMAINS = ["neweuropeanstrategies.com"];

describe("zapytania panelu przekierowań", () => {
  it("lista reguł idzie od NAJNOWSZEJ i ma sufit 2000 wierszy", () => {
    // Panel nie stronicuje: gdyby porządek albo sufit się zmieniły, reguła
    // dodana przed sekundą wypadałaby poza widok i redaktor dodawałby ją
    // drugi raz (a druga próba nadpisuje pierwszą przez `onConflict`).
    const stub = supabaseFromStub();
    applyRedirectsListQuery((stub.from("redirects") as StubChain).select(REDIRECTS_LIST_COLUMNS));
    const chain = stub.lastChain("redirects");
    expect(chain?.argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(chain?.argsOf("limit")).toEqual([REDIRECTS_LIST_LIMIT]);
    expect(REDIRECTS_LIST_LIMIT).toBe(2000);
  });

  it("monitor 404 idzie od NAJCZĘŚCIEJ trafianego adresu i ma sufit 300", () => {
    // Zakładka 404 jest kolejką roboczą „co naprawić najpierw”. Sortowanie po
    // dacie zepchnęłoby adres z tysiącem trafień pod dzisiejsze wejście bota.
    const stub = supabaseFromStub();
    applyHits404Query((stub.from("seo_404_hits") as StubChain).select(HITS_404_COLUMNS));
    const chain = stub.lastChain("seo_404_hits");
    expect(chain?.argsOf("order")).toEqual(["hits", { ascending: false }]);
    expect(chain?.argsOf("limit")).toEqual([HITS_404_LIMIT]);
  });

  it("lista pobiera KAŻDĄ kolumnę, którą czyta tabela i eksport CSV", () => {
    // Brak którejkolwiek nie wywala zapytania - po cichu zeruje kolumnę na
    // ekranie (trafienia, pochodzenie) albo wycina pole z pliku eksportu.
    const columns = REDIRECTS_LIST_COLUMNS.split(",").map((c) => c.trim());
    expect(columns).toEqual([
      "id",
      "source_path",
      "target_path",
      "status_code",
      "is_enabled",
      "source",
      "note",
      "hit_count",
      "last_hit_at",
      "created_at",
    ]);
  });

  it("monitor 404 pobiera ścieżkę, licznik, daty i referrer", () => {
    expect(HITS_404_COLUMNS.split(",").map((c) => c.trim())).toEqual([
      "path",
      "hits",
      "first_seen",
      "last_seen",
      "last_referrer",
    ]);
  });

  it("mutacja unieważnia OBA zapytania panelu, nie tylko listę reguł", () => {
    // `invalidateQueries` dopasowuje po prefiksie TABLICY, więc
    // ["admin-redirects"] nie trafia w ["admin-seo-404"]. Bez drugiego klucza
    // adres, dla którego reguła właśnie powstała, zostaje w zakładce 404
    // i redaktor tworzy tę samą regułę jeszcze raz.
    expect(REDIRECTS_INVALIDATE_KEYS.map((key) => key.join("/"))).toEqual([
      "admin-redirects",
      "admin-seo-404",
    ]);
  });
});

describe("tenantDomainsOf - allowlista hostów dla celu absolutnego", () => {
  it("bierze domeny w kolejności odpowiedzi", () => {
    expect(tenantDomainsOf([{ domain: "a.example" }, { domain: "b.example" }])).toEqual([
      "a.example",
      "b.example",
    ]);
  });

  it("odsiewa wiersze BEZ domeny", () => {
    // Tenant bez zajętej domeny ma `domain = null`. Wpuszczony na allowlistę
    // byłby pozycją, której `normalizeTargetPath` nie ma z czym porównać.
    expect(tenantDomainsOf([{ domain: null }, { domain: "a.example" }, { domain: "" }])).toEqual([
      "a.example",
    ]);
  });

  it("brak odpowiedzi (błąd/ładowanie) daje PUSTĄ allowlistę, nie wyjątek", () => {
    // Pusta allowlista = żaden cel absolutny nie przejdzie. To jest właściwa
    // strona pomyłki: zablokowany zapis zamiast przepuszczonego otwartego
    // przekierowania na czas, w którym domeny się nie wczytały.
    expect(tenantDomainsOf(null)).toEqual([]);
    expect(tenantDomainsOf(undefined)).toEqual([]);
  });
});

describe("kod odpowiedzi", () => {
  it("przepuszcza cały obsługiwany zestaw", () => {
    for (const code of [301, 302, 307, 308, 410]) {
      expect(coerceRedirectStatusCode(code)).toBe(code);
    }
  });

  it("kod spoza zestawu spada na 301, a nie zostaje pusty", () => {
    // Kolumna `status_code` to zwykły int - wiersz z importu może nieść 200
    // albo 404. Wartość spoza listy zostawiłaby Radiksowy Select PUSTY,
    // a pierwszy zapis wysłałby kod, którego walidator serwera odrzuca.
    for (const code of [200, 303, 404, 0, -1, Number.NaN]) {
      expect(coerceRedirectStatusCode(code)).toBe(301);
    }
  });

  it("410 jest rozpoznawane jako „treść usunięta”, reszta jako przeniesienie", () => {
    expect(isGoneCode(410)).toBe(true);
    expect([301, 302, 307, 308].map(isGoneCode)).toEqual([false, false, false, false]);
  });

  it("pole celu znika WYŁĄCZNIE przy 410", () => {
    // Przy 410 cel nie ma znaczenia (serwer zapisuje „/”), a widoczne pole
    // obiecywałoby redaktorowi, że ruch gdzieś poleci.
    expect(showsTargetField(410)).toBe(false);
    expect([301, 302, 307, 308].map(showsTargetField)).toEqual([true, true, true, true]);
  });
});

describe("otwieranie edytora", () => {
  it("wiersz tabeli przenosi wszystkie pola do formularza", () => {
    expect(
      editorStateFromRow(
        row({
          id: "r-9",
          source_path: "/stara-sekcja/*",
          target_path: "/nowa-sekcja/*",
          status_code: 308,
          is_enabled: false,
          note: "po migracji",
        }),
      ),
    ).toEqual({
      id: "r-9",
      source_path: "/stara-sekcja/*",
      target_path: "/nowa-sekcja/*",
      status_code: 308,
      is_enabled: false,
      note: "po migracji",
    });
  });

  it("pusta notatka z bazy (null) staje się pustym polem, nie napisem „null”", () => {
    expect(editorStateFromRow(row({ note: null })).note).toBe("");
  });

  it("wiersz 410 otwiera się jako 410, nie jako 301", () => {
    // Sprowadzenie do 301 zamieniłoby „treść usunięta” w przekierowanie na
    // przypadkowy cel przy pierwszym zapisie z otwartego okna.
    expect(editorStateFromRow(row({ status_code: 410 })).status_code).toBe(410);
  });

  it("wiersz z nieobsługiwanym kodem otwiera się na 301", () => {
    expect(editorStateFromRow(row({ status_code: 418 })).status_code).toBe(301);
  });

  it("„Utwórz przekierowanie” z monitora 404 wstawia adres w ŹRÓDŁO, nie w cel", () => {
    // Odwrotne przypisanie zrobiłoby regułę prowadzącą NA adres, który
    // właśnie zwraca 404 - czyli pętlę zamiast naprawy.
    expect(editorStateFromHit(hit({ path: "/2013/05/stary-wpis/" }))).toEqual({
      id: null,
      source_path: "/2013/05/stary-wpis/",
      target_path: "",
      status_code: 301,
      is_enabled: true,
      note: "",
    });
  });

  it("kolejne otwarcia z monitora 404 nie zanieczyszczają wzorca pustej reguły", () => {
    // Wzorzec jest współdzielonym obiektem modułu: mutacja zamiast kopii
    // przeniosłaby adres z poprzedniego kliknięcia do następnego formularza.
    editorStateFromHit(hit({ path: "/a" }));
    editorStateFromHit(hit({ path: "/b" }));
    expect(EMPTY_REDIRECT_EDITOR.source_path).toBe("");
  });

  it("zmiana kodu w selekcie zachowuje resztę formularza", () => {
    const before = editor({ source_path: "/a", target_path: "/b", note: "x" });
    expect(withStatusCode(before, "410")).toEqual({ ...before, status_code: 410 });
  });

  it("nieliczbowa wartość z selecta nie kasuje kodu, tylko wraca na 301", () => {
    expect(withStatusCode(editor({ status_code: 302 }), "abc").status_code).toBe(301);
  });
});

describe("redirectDraftValidity - bramka przycisku zapisu", () => {
  it("kompletna reguła odblokowuje zapis i pokazuje postać, która trafi do bazy", () => {
    const draft = redirectDraftValidity(
      editor({ source_path: "/Stary-Wpis/", target_path: "/Nowy-Wpis/" }),
      OWN_DOMAINS,
    );
    expect(draft).toEqual({ source: "/stary-wpis", target: "/nowy-wpis", canSave: true });
  });

  it("samo źródło bez celu blokuje zapis przy 301", () => {
    const draft = redirectDraftValidity(editor({ source_path: "/stary" }), OWN_DOMAINS);
    expect(draft.source).toBe("/stary");
    expect(draft.target).toBeNull();
    expect(draft.canSave).toBe(false);
  });

  it("410 zapisuje się BEZ celu", () => {
    // Pole celu jest wtedy schowane, więc wymaganie go zablokowałoby zapis
    // reguły, której nie da się w tym oknie uzupełnić.
    const draft = redirectDraftValidity(
      editor({ source_path: "/usunieta-strona", status_code: 410 }),
      OWN_DOMAINS,
    );
    expect(draft.target).toBeNull();
    expect(draft.canSave).toBe(true);
  });

  it("puste źródło blokuje zapis nawet przy poprawnym celu", () => {
    expect(redirectDraftValidity(editor({ target_path: "/nowy" }), OWN_DOMAINS).canSave).toBe(
      false,
    );
  });

  it("zamknięte okno nie odblokowuje zapisu", () => {
    expect(redirectDraftValidity(null, OWN_DOMAINS)).toEqual({
      source: null,
      target: null,
      canSave: false,
    });
  });

  it("gwiazdka w ŚRODKU adresu jest odrzucana, końcówka /* przechodzi", () => {
    // Wildcard jest wyłącznie sufiksem - „/bad*path” nie ma semantyki
    // dopasowania i jako reguła nigdy by nie trafiła.
    expect(
      redirectDraftValidity(editor({ source_path: "/bad*path", target_path: "/x" }), OWN_DOMAINS)
        .source,
    ).toBeNull();
    expect(
      redirectDraftValidity(
        editor({ source_path: "/stara-sekcja/*", target_path: "/nowa-sekcja/*" }),
        OWN_DOMAINS,
      ).canSave,
    ).toBe(true);
  });

  it("cel absolutny przechodzi TYLKO na własnej domenie (alias www liczy się tak samo)", () => {
    const own = redirectDraftValidity(
      editor({ source_path: "/a", target_path: "https://www.neweuropeanstrategies.com/nowy" }),
      OWN_DOMAINS,
    );
    expect(own.target).toBe("https://www.neweuropeanstrategies.com/nowy");
    expect(own.canSave).toBe(true);
  });

  it("cel na CUDZYM hoście blokuje zapis (otwarte przekierowanie)", () => {
    // Reguła 301 z dowolnym hostem oddaje ruch marki obcej domenie z
    // błogosławieństwem wyszukiwarki - dokładnie to, przed czym stoi
    // allowlista domen tenanta.
    const foreign = redirectDraftValidity(
      editor({ source_path: "/a", target_path: "https://evil.example/phish" }),
      OWN_DOMAINS,
    );
    expect(foreign.target).toBeNull();
    expect(foreign.canSave).toBe(false);
  });

  it("http:// na własnej domenie też nie przechodzi (degradacja do jawnego kanału)", () => {
    expect(
      redirectDraftValidity(
        editor({ source_path: "/a", target_path: "http://neweuropeanstrategies.com/nowy" }),
        OWN_DOMAINS,
      ).canSave,
    ).toBe(false);
  });

  it("javascript: nie jest celem przekierowania", () => {
    expect(
      redirectDraftValidity(
        editor({ source_path: "/a", target_path: "javascript:alert(1)" }),
        OWN_DOMAINS,
      ).target,
    ).toBeNull();
  });

  it("pusta allowlista (domeny jeszcze się nie wczytały) odrzuca KAŻDY cel absolutny", () => {
    // Podgląd pokaże wtedy „nieprawidłowy adres docelowy”, a zapis zostanie
    // zablokowany do czasu, aż lista domen wróci - świadomie ta strona
    // pomyłki, bo druga wpuszczałaby otwarte przekierowanie.
    expect(
      redirectDraftValidity(
        editor({ source_path: "/a", target_path: "https://neweuropeanstrategies.com/nowy" }),
        [],
      ).canSave,
    ).toBe(false);
  });

  it("REGRESJA: cel z ODWRÓCONYM ukośnikiem nie wyprowadza ruchu na cudzy host", () => {
    // „/\evil.example” nie wygląda na adres absolutny, więc omijało kontrolę
    // allowlisty i lądowało w bazie dosłownie. Przeglądarka czyta odwrócony
    // ukośnik jak zwykły (WHATWG URL), więc nagłówek `Location: /\evil.example`
    // wysyłał czytelnika na https://evil.example - otwarte przekierowanie
    // spod domeny marki, z kodem 301 i pełnym zaufaniem wyszukiwarki.
    const draft = redirectDraftValidity(
      editor({ source_path: "/a", target_path: "/\\evil.example" }),
      OWN_DOMAINS,
    );
    expect(draft.target).toBe("/evil.example");
    expect(new URL(draft.target!, "https://neweuropeanstrategies.com/").hostname).toBe(
      "neweuropeanstrategies.com",
    );
  });

  it("REGRESJA: cel protokołowo-względny („//host”) też zostaje na własnej domenie", () => {
    const draft = redirectDraftValidity(
      editor({ source_path: "/a", target_path: "//evil.example/phish" }),
      OWN_DOMAINS,
    );
    expect(new URL(draft.target!, "https://neweuropeanstrategies.com/").hostname).toBe(
      "neweuropeanstrategies.com",
    );
  });
});

describe("normalizationHint - podpowiedź pod polem adresu", () => {
  it("puste pole nie pokazuje NICZEGO", () => {
    // Świeżo otwarte okno nie może krzyczeć „nieprawidłowy adres”.
    expect(normalizationHint("", null)).toEqual({ kind: "none" });
    expect(normalizationHint("   ", null)).toEqual({ kind: "none" });
  });

  it("wypełnione pole pokazuje postać, w której adres trafi do bazy", () => {
    // To jedyne miejsce, w którym redaktor widzi, że „/Stary-Wpis/” zapisze
    // się jako „/stary-wpis” - a od tego zależy, czy reguła kiedykolwiek trafi.
    expect(normalizationHint("/Stary-Wpis/", "/stary-wpis")).toEqual({
      kind: "normalized",
      text: "→ /stary-wpis",
    });
  });

  it("wypełnione pole bez znormalizowanej wartości pokazuje błąd", () => {
    expect(normalizationHint("https://evil.example", null)).toEqual({ kind: "invalid" });
  });
});

describe("redirectUpsertInput - ładunek zapisu", () => {
  it("nowa reguła jedzie BEZ identyfikatora", () => {
    // `id: null` przeszłoby przez walidator jako gałąź UPDATE i zapis
    // padłby na „nie znaleziono reguły” zamiast utworzyć nową.
    expect(
      redirectUpsertInput(editor({ source_path: "/a", target_path: "/b" })).id,
    ).toBeUndefined();
  });

  it("edycja niesie identyfikator wiersza", () => {
    expect(
      redirectUpsertInput(editor({ id: "r-9", source_path: "/a", target_path: "/b" })).id,
    ).toBe("r-9");
  });

  it("pusty cel (formularz 410) jedzie jako „/”, nie jako pusty string", () => {
    // Walidator serwera odrzuca pusty cel, więc bez tej podmiany reguła
    // „treść usunięta” nie dałaby się zapisać z poprawnie wypełnionego okna.
    const input = redirectUpsertInput(editor({ source_path: "/usunieta", status_code: 410 }));
    expect(input.fields.target_path).toBe("/");
    expect(input.fields.status_code).toBe(410);
  });

  it("pusta notatka jedzie jako null, a wypełniona bez zmian", () => {
    // Kolumna jest nullowalna; pusty string rozjeżdża filtr wyszukiwania
    // i eksport CSV z wierszem bez notatki.
    expect(redirectUpsertInput(editor({ note: "" })).fields.note).toBeNull();
    expect(redirectUpsertInput(editor({ note: "po migracji" })).fields.note).toBe("po migracji");
  });

  it("wyłączona reguła zapisuje się jako wyłączona", () => {
    expect(redirectUpsertInput(editor({ is_enabled: false })).fields.is_enabled).toBe(false);
  });

  it("adresy jadą SUROWE - normalizuje serwer, nie formularz", () => {
    // Podgląd normalizacji jest podpowiedzią, a nie zapisem: gdyby formularz
    // wysyłał już znormalizowaną wartość, dwie warstwy normalizacji mogłyby
    // się rozjechać i nikt by tego nie zauważył.
    const input = redirectUpsertInput(editor({ source_path: "/Stary/", target_path: "/Nowy/" }));
    expect(input.fields.source_path).toBe("/Stary/");
    expect(input.fields.target_path).toBe("/Nowy/");
  });
});

describe("filterRedirects - filtr listy", () => {
  const rows = [
    row({ id: "1", source_path: "/stary", target_path: "/o-nas", note: "migracja WP" }),
    row({ id: "2", source_path: "/kontakt-old", target_path: "/kontakt", is_enabled: false }),
    row({ id: "3", source_path: "/blog/2013", target_path: "/aktualnosci", note: null }),
  ];
  const ids = (out: readonly RedirectRow[]) => out.map((r) => r.id);

  it("„wszystkie” nie zawęża i zachowuje kolejność z bazy", () => {
    expect(ids(filterRedirects(rows, { search: "", status: "all" }))).toEqual(["1", "2", "3"]);
  });

  it("„włączone” i „wyłączone” dzielą listę rozłącznie", () => {
    expect(ids(filterRedirects(rows, { search: "", status: "enabled" }))).toEqual(["1", "3"]);
    expect(ids(filterRedirects(rows, { search: "", status: "disabled" }))).toEqual(["2"]);
  });

  it("fraza szuka po adresie DOCELOWYM, nie tylko po źródłowym", () => {
    // Po migracji z WordPressa redaktor pamięta, dokąd reguła miała prowadzić,
    // a nie jak brzmiał stary adres z 2013 roku.
    expect(ids(filterRedirects(rows, { search: "aktualnosci", status: "all" }))).toEqual(["3"]);
  });

  it("fraza szuka też w notatce", () => {
    expect(ids(filterRedirects(rows, { search: "migracja", status: "all" }))).toEqual(["1"]);
  });

  it("wielkość liter i białe znaki wokół frazy nie mają znaczenia", () => {
    expect(ids(filterRedirects(rows, { search: "  KONTAKT  ", status: "all" }))).toEqual(["2"]);
  });

  it("REGRESJA: wiersz BEZ notatki nie wypada z wyszukiwania i nie wywala listy", () => {
    // `note` jest nullowalne; odczyt bez `?? ""` rzuciłby przy pierwszej
    // frazie i cała tabela zniknęłaby z ekranu.
    expect(ids(filterRedirects(rows, { search: "blog", status: "all" }))).toEqual(["3"]);
  });

  it("filtr statusu i fraza działają ŁĄCZNIE", () => {
    expect(ids(filterRedirects(rows, { search: "kontakt", status: "enabled" }))).toEqual([]);
    expect(ids(filterRedirects(rows, { search: "kontakt", status: "disabled" }))).toEqual(["2"]);
  });

  it("brak danych (pierwsze wczytanie) daje pustą listę, nie wyjątek", () => {
    expect(filterRedirects(undefined, { search: "x", status: "all" })).toEqual([]);
    expect(filterRedirects(null, { search: "", status: "enabled" })).toEqual([]);
  });

  it("wybór z selecta statusu mapuje się 1:1, a nieznana wartość znaczy „wszystkie”", () => {
    expect(statusFilterFromSelect("enabled")).toBe("enabled");
    expect(statusFilterFromSelect("disabled")).toBe("disabled");
    expect(statusFilterFromSelect("all")).toBe("all");
    expect(statusFilterFromSelect("cokolwiek")).toBe("all");
  });

  it("pusta tabela po filtrze mówi „brak wyników”, a nie „brak przekierowań”", () => {
    // Przy 2000 reguł odfiltrowanych do zera komunikat „dodaj pierwsze”
    // byłby nieprawdą - redaktor uznałby, że skasował cały zestaw.
    expect(redirectsEmptyStateKey(2000)).toBe("admin.list.noResults");
    expect(redirectsEmptyStateKey(0)).toBe("admin.redirects.empty");
  });
});

describe("etykiety tabeli", () => {
  it("pochodzenie reguły ma wersję PL i EN", () => {
    expect(redirectSourceLabel("slug_change", "pl")).toBe("zmiana sluga");
    expect(redirectSourceLabel("slug_change", "en")).toBe("slug change");
    expect(redirectSourceLabel("csv_import", "en-GB")).toBe("CSV import");
    expect(redirectSourceLabel("quick_404", "pl-PL")).toBe("z monitora 404");
  });

  it("brak języka czyta się jako polski (panel domyślnie PL)", () => {
    expect(redirectSourceLabel("manual", undefined)).toBe("ręczne");
  });

  it("nieznane pochodzenie wraca SUROWE, nie znika i nie zlewa się z „inne”", () => {
    // `source` jest zwykłym tekstem - nowy producent reguł (kolejny importer)
    // ma być widoczny w panelu od razu, a nie dopiero po dopisaniu etykiety.
    expect(redirectSourceLabel("api_bulk", "pl")).toBe("api_bulk");
  });

  it("stempel czasu skraca się do minut, a brak trafienia to myślnik", () => {
    expect(formatRedirectStamp("2026-08-17T21:05:31.482Z")).toBe("2026-08-17 21:05");
    expect(formatRedirectStamp(null)).toBe("-");
  });
});

describe("eksport i import CSV", () => {
  it("plik ma nazwę, typ z UTF-8 i nagłówek zgodny z parserem importu", () => {
    // Bez `charset=utf-8` Excel rozjeżdża polskie slugi na cp1250, a plik
    // wraca z migracji z połamanymi adresami.
    const file = redirectsCsvDownload([row({ source_path: "/stary", target_path: "/nowy" })]);
    expect(file.filename).toBe("redirects.csv");
    expect(file.mimeType).toBe("text/csv;charset=utf-8");
    expect(file.content.split("\n")[0]).toBe("source,target,status,note");
  });

  it("eksport bierze WSZYSTKIE przekazane wiersze, także wyłączone", () => {
    // Plik jest kopią zapasową mapy przekierowań: pominięcie wyłączonych
    // reguł dałoby plik, który po imporcie milcząco gubi część zestawu.
    const rows = [row({ id: "1" }), row({ id: "2", is_enabled: false }), row({ id: "3" })];
    expect(redirectsCsvDownload(rows).content.trim().split("\n")).toHaveLength(4);
  });

  it("notatka z przecinkiem i cudzysłowem nie rozjeżdża kolumn", () => {
    const content = redirectsCsvDownload([row({ note: 'raport, "wersja 2"' })]).content;
    expect(content).toContain('"raport, ""wersja 2"""');
  });

  it("wyeksportowany plik daje się z powrotem zaimportować bez strat", () => {
    // Eksport i import to jedna droga (przenosiny między instalacjami),
    // więc rozjazd między serializacją a parserem oznacza mapę przekierowań,
    // która wraca niekompletna - i stare adresy dalej dają 404.
    const rows = [
      row({ id: "1", source_path: "/Stary", target_path: "/nowy", note: 'a, "b"' }),
      row({ id: "2", source_path: "/usunieta", target_path: "/", status_code: 410, note: null }),
      row({ id: "3", source_path: "/stara-sekcja/*", target_path: "/nowa-sekcja/*" }),
    ];
    const parsed = parseRedirectsCsv(redirectsCsvDownload(rows).content);
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows).toEqual([
      { source_path: "/stary", target_path: "/nowy", status_code: 301, note: 'a, "b"' },
      { source_path: "/usunieta", target_path: "/", status_code: 410, note: null },
      {
        source_path: "/stara-sekcja/*",
        target_path: "/nowa-sekcja/*",
        status_code: 301,
        note: null,
      },
    ]);
  });

  it("komunikat po imporcie milczy, gdy plik wszedł w całości", () => {
    expect(importSkippedSuffix(0, "pl")).toBe("");
    expect(importSkippedSuffix(0, "en")).toBe("");
  });

  it("pominięte wiersze są dopisane do komunikatu w OBU językach", () => {
    // Bez tego dopisku „zaimportowano 812” czyta się jak komplet i nikt nie
    // sprawdza, że 40 starych adresów nadal zwraca 404.
    expect(importSkippedSuffix(40, "pl")).toBe(" (40 pominiętych wierszy)");
    expect(importSkippedSuffix(40, "en-US")).toBe(" (40 rows skipped)");
  });
});
