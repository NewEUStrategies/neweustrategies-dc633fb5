// Wspólne reguły filtrów i stronicowania logów.
//
// Log maili systemowych i log webhooka maili autoryzacyjnych mają ten sam układ
// filtrów - celowo, żeby operator nie zmieniał nawyków między ekranami.
// Skopiowane reguły rozjeżdżają się cicho: jeden panel poprawiony, drugi nie.
// Ten test jest dowodem, że rozjazdu nie ma, bo reguła jest JEDNA.
import { describe, it, expect } from "vitest";
import * as f from "@/components/admin/newsletter/logFilters";
import * as sys from "@/components/admin/newsletter/system-emails/systemEmailsView";
import * as auth from "@/components/admin/newsletter/auth-logs/authLogsView";

describe("sentynela „wszystkie”", () => {
  it("jest NIEPUSTA - Radix wywala się na pustej wartości pozycji listy", () => {
    // Ten sam defekt zdjął już raz wybór kolumn w imporcie CSV.
    expect(f.ALL_OPTION).not.toBe("");
    expect(f.ALL_OPTION.trim()).toBe(f.ALL_OPTION);
  });

  it("wraca na NULL, czyli „bez filtra”", () => {
    expect(f.filterValue(f.ALL_OPTION)).toBeNull();
    expect(f.filterValue("magiclink")).toBe("magiclink");
  });

  it("brak filtra pokazuje się jako sentynela", () => {
    expect(f.filterOption(null)).toBe(f.ALL_OPTION);
    expect(f.filterOption("recovery")).toBe("recovery");
  });

  it("droga w obie strony nie gubi wartości", () => {
    for (const value of [null, "signup", "recovery", "pl"]) {
      expect(f.filterValue(f.filterOption(value))).toBe(value);
    }
  });
});

describe("fraza wyszukiwania", () => {
  it("puste i same spacje znaczą BEZ FILTRA", () => {
    expect(f.searchValue("")).toBeNull();
    expect(f.searchValue("   ")).toBeNull();
    expect(f.searchValue("\t\n")).toBeNull();
  });

  it("jest obcinana z brzegowych spacji", () => {
    expect(f.searchValue("  ktos@example.test ")).toBe("ktos@example.test");
    // Same spacje to BRAK frazy (`null`), nie pusty napis - pusty napis
    // poszedłby do zapytania jako `ilike '%%'` i nic by nie filtrował.
    expect(f.searchValue("   ")).toBeNull();
  });
});

describe("liczba stron", () => {
  it("PUSTY log ma jedną stronę - zero zapaliłoby „następna” w nicość", () => {
    expect(f.totalPages(0)).toBe(1);
    expect(f.totalPages(0, 5)).toBe(1);
  });

  it("dokładnie jedna strona danych to jedna strona", () => {
    expect(f.totalPages(f.DEFAULT_PAGE_SIZE)).toBe(1);
    // Jeden wiersz PONAD stronę to już dwie strony.
    expect(f.totalPages(f.DEFAULT_PAGE_SIZE + 1)).toBe(2);
  });

  it("jeden wiersz ponad stronę daje dwie strony", () => {
    expect(f.totalPages(f.DEFAULT_PAGE_SIZE + 1)).toBe(2);
    expect(f.totalPages(101, 50)).toBe(3);
  });
});

describe("znacznik czasu wiersza", () => {
  it("BRAK daty to kreska, nie „Invalid Date”", () => {
    expect(f.rowTimestamp(null, "pl-PL")).toBe("-");
    expect(f.rowTimestamp(undefined, "pl-PL")).toBe("-");
    expect(f.rowTimestamp("", "pl-PL")).toBe("-");
  });

  it("data jest formatowana lokalnie", () => {
    const label = f.rowTimestamp("2026-08-01T10:30:00.000Z", "en-GB");

    expect(label).toMatch(/\d/);
    expect(label).not.toBe("-");
  });

  it("format da się zawęzić - log webhooka pokazuje dzień i godzinę bez roku", () => {
    const label = f.rowTimestamp("2026-08-01T10:30:00.000Z", "en-GB", {
      day: "2-digit",
      month: "2-digit",
    });

    expect(label).not.toMatch(/2026/);
    expect(label).toMatch(/08/);
  });
});

describe("oba logi używają TEJ SAMEJ reguły", () => {
  it("sentynela jest wspólna", () => {
    expect(sys.ALL_OPTION).toBe(f.ALL_OPTION);
    expect(auth.ALL_OPTION).toBe(f.ALL_OPTION);
  });

  it("rozmiar strony jest wspólny", () => {
    expect(sys.PAGE_SIZE).toBe(f.DEFAULT_PAGE_SIZE);
    expect(auth.PAGE_SIZE).toBe(f.DEFAULT_PAGE_SIZE);
  });

  it("funkcje filtrów to te same referencje - nie ma dwóch kopii do rozjechania", () => {
    expect(sys.filterValue).toBe(f.filterValue);
    expect(auth.filterValue).toBe(f.filterValue);
    expect(sys.totalPages).toBe(auth.totalPages);
  });
});

describe("log webhooka - własne reguły", () => {
  it("„odrzucony” i „nieudany” mają RÓŻNE tony - wymagają różnych reakcji", () => {
    // „odrzucony": webhook zadziałał, ale odmówił (zwykle konfiguracja).
    // „nieudany": webhook się wywalił - użytkownik NIE dostał maila.
    expect(auth.statusTone("rejected")).not.toBe(auth.statusTone("failed"));
    expect(auth.statusTone("failed")).toContain("destructive");
  });

  it("zakolejkowany jest zielony - to stan poprawny", () => {
    expect(auth.statusTone("enqueued")).toContain("emerald");
    expect(auth.statusTone("enqueued")).not.toContain("destructive");
  });

  it("każdy status z filtra ma swój ton, wszystkie różne", () => {
    const tony = auth.STATUSES.map(auth.statusTone);

    expect(new Set(tony).size).toBe(auth.STATUSES.length);
    expect(auth.STATUSES.length).toBe(3);
  });

  it("BRAK języka to kreska - puste pole czyta się jako „polski”", () => {
    // Cała diagnostyka tego panelu jest właśnie o wyborze języka.
    expect(auth.langLabel(null)).toBe("-");
    expect(auth.langLabel(undefined)).toBe("-");
    expect(auth.langLabel("en")).toBe("en");
  });

  it("źródło języka ma klucz tłumaczenia i awaryjny podpis", () => {
    expect(auth.langSourceKey("header")).toEqual({
      key: "authEmailLogs.sources.header",
      fallbackText: "header",
    });
    // Inne źródło daje inny klucz - to nie stała.
    expect(auth.langSourceKey("profile").key).toBe("authEmailLogs.sources.profile");
  });

  it("BRAK źródła schodzi na „unknown”, a podpis na kreskę", () => {
    expect(auth.langSourceKey(null)).toEqual({
      key: "authEmailLogs.sources.unknown",
      fallbackText: "-",
    });
    // `undefined` idzie tą samą drogą co `null`. Pustego napisu tu nie ma:
    // warstwa danych (`str()` w auth-events.server.ts) sprowadza go do `null`
    // jeszcze przed panelem.
    expect(auth.langSourceKey(undefined)).toEqual({
      key: "authEmailLogs.sources.unknown",
      fallbackText: "-",
    });
  });

  it("lista typów maili obejmuje reset hasła i magic link", () => {
    // To one najczęściej są przedmiotem zgłoszenia „nie dostałem maila".
    expect(auth.TYPES).toContain("recovery");
    expect(auth.TYPES).toContain("magiclink");
  });

  it("okna czasowe to doba, tydzień i miesiąc", () => {
    expect(auth.RANGES).toEqual([1, 7, 30]);
    // Rosnąco - kolejność decyduje o układzie przycisków w panelu.
    expect([...auth.RANGES].sort((a, b) => a - b)).toEqual([...auth.RANGES]);
  });
});
