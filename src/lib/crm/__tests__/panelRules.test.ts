// REGUŁY PANELI CRM wyprowadzone z komponentów: follow-upy, wybór kolumn,
// zużycie limitu, formularz nowej firmy, karta profilu.
//
// Każda z tych reguł mieszkała wewnątrz komponentu, więc jedyną drogą do niej
// był render panelu z zamockowanym zapytaniem - stąd 0% pokrycia na 19 plikach
// panelu CRM. Funkcje zwracają DANE albo KLUCZ; tłumaczenia zostają w panelach.
import { describe, expect, it, vi } from "vitest";
import {
  defaultDueDate,
  formatDue,
  isOverdue,
  leadLabel,
  sortTasksForPanel,
  splitDueTasks,
  taskLocale,
} from "../tasksView";
import { isColumnActive, requiredColumns, toggleColumn, visibleColumns } from "../columnSelection";
import { runViewAction } from "../viewActions";
import {
  DEFAULT_MONTHLY_LIMIT,
  meteringPeriodStart,
  meteringUsageView,
  usageLevel,
} from "../meteringUsage";
import {
  EMPTY_COMPANY_FORM,
  canSubmitCompanyForm,
  companyFormErrorKey,
  companyFormPayload,
} from "../companyForm";
import { formatBytes, formatYear, formatYearRange, profileDisplayName } from "../profileSyncView";
import { nullIfBlank, shortId } from "../text";
import { LEAD_COLUMNS, type LeadColumnKey } from "../leadViews";

describe("follow-upy: etykieta kontaktu", () => {
  it("imię i nazwisko wygrywa nad e-mailem", () => {
    expect(leadLabel({ first_name: "Anna", last_name: "Kowalska", email: "a@example.test" })).toBe(
      "Anna Kowalska",
    );
  });

  it("samo imię wystarczy", () => {
    expect(leadLabel({ first_name: "Anna", last_name: null, email: "a@example.test" })).toBe(
      "Anna",
    );
  });

  it("bez nazwy zostaje e-mail", () => {
    expect(leadLabel({ first_name: "  ", last_name: null, email: "a@example.test" })).toBe(
      "a@example.test",
    );
  });

  it("zadanie bez wizytówki leada nie ma etykiety", () => {
    expect(leadLabel(null)).toBe("");
    expect(leadLabel(undefined)).toBe("");
    expect(leadLabel({})).toBe("");
  });
});

describe("follow-upy: termin", () => {
  const iso = "2026-08-20T09:30:00.000Z";

  it("termin jest formatowany w locale panelu", () => {
    expect(taskLocale("pl")).toBe("pl-PL");
    expect(taskLocale("en")).toBe("en-GB");
    expect(formatDue(iso, "pl")).not.toBe("");
    expect(formatDue(iso, "en")).not.toBe("");
  });

  it("format „medium” jest dłuższy niż domyślny „short”", () => {
    expect(formatDue(iso, "pl", "medium").length).toBeGreaterThan(formatDue(iso, "pl").length);
  });

  it("brak terminu i data nieparsowalna dają pusty napis, nie „Invalid Date”", () => {
    expect(formatDue(null, "pl")).toBe("");
    expect(formatDue(undefined, "en")).toBe("");
    expect(formatDue("brak-daty", "pl")).toBe("");
  });

  it("po terminie jest tylko to, co minęło", () => {
    const now = Date.parse("2026-08-20T10:00:00.000Z");
    expect(isOverdue("2026-08-20T09:00:00.000Z", now)).toBe(true);
    expect(isOverdue("2026-08-20T11:00:00.000Z", now)).toBe(false);
    expect(isOverdue(null, now)).toBe(false);
    expect(isOverdue("brak-daty", now)).toBe(false);
  });

  it("pasek liczy zaległe i nadchodzące", () => {
    const now = Date.parse("2026-08-20T10:00:00.000Z");
    const tasks = [
      { due_at: "2026-08-19T10:00:00.000Z" },
      { due_at: "2026-08-20T09:00:00.000Z" },
      { due_at: "2026-08-21T10:00:00.000Z" },
    ];
    expect(splitDueTasks(tasks, now)).toEqual({ overdue: 2, upcoming: 1 });
    expect(splitDueTasks([], now)).toEqual({ overdue: 0, upcoming: 0 });
  });

  it("domyślny termin nowego follow-upu to jutro o 9:00", () => {
    const now = new Date("2026-08-20T22:15:00");
    const due = defaultDueDate(now);
    expect(due.getDate()).toBe(21);
    expect(due.getHours()).toBe(9);
    expect(due.getMinutes()).toBe(0);
  });

  it("kolejność zadań: otwarte przed zamkniętymi, potem po terminie", () => {
    const tasks = [
      { id: "done-early", status: "done", due_at: "2026-08-01T10:00:00.000Z" },
      { id: "open-late", status: "open", due_at: "2026-08-30T10:00:00.000Z" },
      { id: "open-early", status: "open", due_at: "2026-08-02T10:00:00.000Z" },
      { id: "open-none", status: "open", due_at: null },
    ];
    expect(sortTasksForPanel(tasks).map((t) => t.id)).toEqual([
      "open-early",
      "open-late",
      "open-none",
      "done-early",
    ]);
  });
});

describe("wybór kolumn tabeli", () => {
  const active: LeadColumnKey[] = ["name", "email", "company"];

  it("dołożona kolumna trafia na swoje miejsce w kolejności tabeli, nie na koniec", () => {
    const next = toggleColumn(LEAD_COLUMNS, active, "phone", ["name"]);
    expect(next).toEqual(["name", "email", "phone", "company"]);
  });

  it("ponowne kliknięcie usuwa kolumnę", () => {
    const next = toggleColumn(LEAD_COLUMNS, active, "email", ["name"]);
    expect(next).toEqual(["name", "company"]);
  });

  it("kolumny wymaganej nie da się ukryć", () => {
    expect(toggleColumn(LEAD_COLUMNS, active, "name", ["name"])).toEqual(active);
  });

  it("odznaczenie wszystkiego wraca do kolumn wymaganych, a nie do pustej tabeli", () => {
    const next = toggleColumn(LEAD_COLUMNS, ["company"], "company", ["name"]);
    expect(next).toEqual(["name"]);
  });

  it("kolumny wymagane są odczytywane z definicji", () => {
    expect(requiredColumns(LEAD_COLUMNS)).toEqual(["name"]);
  });

  it("stan checkboxa i lista widocznych kolumn wynikają z tego samego zbioru", () => {
    expect(isColumnActive(active, "email")).toBe(true);
    expect(isColumnActive(active, "tags")).toBe(false);
    expect(visibleColumns(LEAD_COLUMNS, active).map((c) => c.key)).toEqual([
      "name",
      "email",
      "company",
    ]);
  });
});

describe("zużycie limitu bezpłatnych artykułów", () => {
  it("liczy pozostałe i wypełnienie paska", () => {
    expect(meteringUsageView(2, 5)).toMatchObject({
      used: 2,
      limit: 5,
      remaining: 3,
      percent: 40,
      level: "ok",
    });
  });

  it("zużycie ponad limit nie wypycha paska poza kartę", () => {
    expect(meteringUsageView(9, 5)).toMatchObject({
      percent: 100,
      remaining: 0,
      level: "exhausted",
    });
  });

  it("limit zero nie daje dzielenia przez zero", () => {
    expect(meteringUsageView(3, 0)).toMatchObject({ percent: 0, remaining: 0, level: "exhausted" });
  });

  it("brak danych to zera, nie NaN", () => {
    expect(meteringUsageView(null, undefined)).toMatchObject({
      used: 0,
      limit: 0,
      remaining: 0,
      percent: 0,
    });
  });

  it("od 80% zużycia karta ostrzega", () => {
    expect(usageLevel(79, 2)).toBe("ok");
    expect(usageLevel(80, 1)).toBe("warning");
    expect(usageLevel(100, 0)).toBe("exhausted");
  });

  it("domyślny limit odpowiada ustawieniom planu Essential", () => {
    expect(DEFAULT_MONTHLY_LIMIT).toBe(5);
  });

  it("okres liczy się od pierwszego dnia miesiąca UTC", () => {
    expect(meteringPeriodStart(new Date("2026-08-18T23:30:00.000Z"))).toBe("2026-08-01");
  });
});

describe("formularz nowej firmy", () => {
  it("bez nazwy nie da się wysłać, w trakcie zapisu też nie", () => {
    expect(canSubmitCompanyForm(EMPTY_COMPANY_FORM, false)).toBe(false);
    expect(canSubmitCompanyForm({ ...EMPTY_COMPANY_FORM, name: "   " }, false)).toBe(false);
    expect(canSubmitCompanyForm({ ...EMPTY_COMPANY_FORM, name: "Acme" }, true)).toBe(false);
    expect(canSubmitCompanyForm({ ...EMPTY_COMPANY_FORM, name: "Acme" }, false)).toBe(true);
  });

  it("puste pola są POMIJANE, nie wysyłane jako pusty napis", () => {
    const payload = companyFormPayload({
      ...EMPTY_COMPANY_FORM,
      name: "  Acme  ",
      city: " Bruksela ",
      domain: "   ",
    });
    expect(payload).toEqual({ name: "Acme", city: "Bruksela" });
    expect(Object.keys(payload)).not.toContain("domain");
  });

  it("duplikat nazwy ma własny klucz komunikatu, reszta wspólny", () => {
    expect(companyFormErrorKey(new Error("duplicate_name"))).toBe("duplicate_name");
    expect(companyFormErrorKey(new Error("permission denied"))).toBe("generic");
    expect(companyFormErrorKey("cokolwiek")).toBe("generic");
    expect(companyFormErrorKey(null)).toBe("generic");
  });
});

describe("karta profilu przy kontakcie", () => {
  it("rozmiar pliku CV skaluje jednostkę", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });

  it("brak rozmiaru daje pusty napis, nie „0 B”", () => {
    expect(formatBytes(null)).toBe("");
    expect(formatBytes(0)).toBe("");
    expect(formatBytes(Number.NaN)).toBe("");
  });

  it("rok z daty, pusto dla braku i dla śmieci", () => {
    expect(formatYear("2019-05-01T00:00:00.000Z")).toBe("2019");
    expect(formatYear(null)).toBe("");
    expect(formatYear("brak-daty")).toBe("");
  });

  it("zakres lat kończy się myślnikiem, gdy doświadczenie trwa", () => {
    expect(formatYearRange("2019-01-01", "2023-01-01")).toBe("2019-2023");
    expect(formatYearRange("2019-01-01", null, true)).toBe("2019-");
    expect(formatYearRange("2019-01-01", null)).toBe("2019-");
    expect(formatYearRange(null, null)).toBe("");
  });

  it("nazwa osoby: wyświetlana, potem imię+nazwisko, potem e-mail", () => {
    expect(profileDisplayName({ display_name: "Anna K.", first_name: "Anna" })).toBe("Anna K.");
    expect(profileDisplayName({ first_name: "Anna", last_name: "Kowalska" })).toBe("Anna Kowalska");
    expect(profileDisplayName({ email: "a@example.test" })).toBe("a@example.test");
    expect(profileDisplayName({})).toBe("");
  });
});

describe("drobne reguły tekstowe", () => {
  it("puste pole to brak wartości, nie pusty napis", () => {
    expect(nullIfBlank("  Acme ")).toBe("Acme");
    expect(nullIfBlank("   ")).toBeNull();
    expect(nullIfBlank(null)).toBeNull();
    expect(nullIfBlank(undefined)).toBeNull();
  });

  it("skrót identyfikatora ma stałą długość", () => {
    expect(shortId("11111111-1111-4111-8111-111111111111")).toBe("111111");
    expect(shortId("abc", 6)).toBe("abc");
  });
});

describe("runViewAction", () => {
  it("sprząta po akcji dopiero po jej powodzeniu", async () => {
    const done = vi.fn();
    runViewAction(Promise.resolve("ok"), done);
    await Promise.resolve();
    await Promise.resolve();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("porażka nie sprząta i nie wypuszcza odrzuconego promise'a", async () => {
    const done = vi.fn();
    // Brak `await`/`catch` w handlerze zdarzenia oznaczałby unhandled rejection:
    // komunikat i tak pokazuje warstwa mutacji, a monitoring dostawałby
    // dodatkowy, niewyjaśniony błąd.
    expect(() => runViewAction(Promise.reject(new Error("odrzucone")), done)).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();
  });

  it("działa bez sprzątania", async () => {
    expect(() => runViewAction(Promise.resolve(null))).not.toThrow();
    await Promise.resolve();
  });
});
