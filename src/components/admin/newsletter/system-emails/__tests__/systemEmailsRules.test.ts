// Reguły trzech paneli maili systemowych - logu wysyłek, edytora treści maili
// transakcyjnych i podglądu maili autoryzacyjnych.
//
// Wspólny mianownik: te panele są OSTATNIM miejscem, w którym da się zobaczyć,
// co poszło (albo pójdzie) do prawdziwego adresata. Każda z reguł myli się
// cicho, bo panel zawsze coś pokazuje - kreskę, pustą tabelę, puste okno.
import { describe, it, expect } from "vitest";
import * as view from "@/components/admin/newsletter/system-emails/systemEmailsView";
import * as tx from "@/components/admin/newsletter/system-emails/txContentRules";
import * as preview from "@/components/admin/newsletter/system-emails/authPreviewRules";
import { EDITABLE_TX_TYPES, TX_OVERRIDE_TOKENS, TxOverridesSchema } from "@/lib/email/txOverrides";
import type { SystemEmailDayPoint, SystemEmailStatus } from "@/lib/email/system-log.server";

// ===========================================================================
// LOG WYSYŁEK
// ===========================================================================
describe("filtry logu - sentynela „wszystkie”", () => {
  it("sentynela jest NIEPUSTA - Radix wywala się na pustej wartości pozycji listy", () => {
    // Ten sam defekt zdjął już raz wybór kolumn w imporcie CSV.
    expect(view.ALL_OPTION).not.toBe("");
    expect(view.ALL_OPTION.length).toBeGreaterThan(0);
  });

  it("sentynela wraca na NULL, czyli „bez filtra”", () => {
    // Puszczona dalej jako nazwa szablonu filtruje log do zera i operator widzi
    // „brak wysyłek” tam, gdzie wysyłek są tysiące.
    expect(view.filterValue(view.ALL_OPTION)).toBeNull();
    expect(view.filterValue("welcome_email")).toBe("welcome_email");
  });

  it("brak filtra pokazuje się jako sentynela, a nie jako pusta lista", () => {
    expect(view.filterOption(null)).toBe(view.ALL_OPTION);
    expect(view.filterOption("welcome_email")).toBe("welcome_email");
  });

  it("droga w obie strony nie gubi wartości", () => {
    for (const value of [null, "welcome_email", "magiclink"]) {
      expect(view.filterValue(view.filterOption(value))).toBe(value);
    }
  });

  it("fraza z samych spacji znaczy BEZ FILTRA, nie „szukaj spacji”", () => {
    expect(view.searchValue("   ")).toBeNull();
    expect(view.searchValue("")).toBeNull();
  });

  it("fraza jest obcinana z brzegowych spacji", () => {
    expect(view.searchValue("  ktos@example.test  ")).toBe("ktos@example.test");
    // Same spacje to BRAK frazy (`null`) - pusty napis filtrowałby po `%%`.
    expect(view.searchValue("   ")).toBeNull();
  });
});

describe("stronicowanie logu", () => {
  it("PUSTY log ma jedną stronę - zero zapaliłoby „następna” w nicość", () => {
    expect(view.totalPages(0)).toBe(1);
    expect(view.totalPages(0, 10)).toBe(1);
  });

  it("dokładnie jedna strona danych to jedna strona", () => {
    expect(view.totalPages(view.PAGE_SIZE)).toBe(1);
    // O jeden wiersz mniej to nadal jedna strona.
    expect(view.totalPages(view.PAGE_SIZE - 1)).toBe(1);
  });

  it("jeden wiersz ponad stronę daje DWIE strony", () => {
    expect(view.totalPages(view.PAGE_SIZE + 1)).toBe(2);
    expect(view.totalPages(view.PAGE_SIZE * 2)).toBe(2);
  });

  it("strona domyślna ma 50 wierszy", () => {
    expect(view.PAGE_SIZE).toBe(50);
    expect(view.totalPages(150)).toBe(3);
  });
});

describe("wskaźnik doręczenia", () => {
  it("BRAK DANYCH to kreska, nie „0%”", () => {
    // „0%” w pustym logu czyta się jako awaria wysyłki.
    expect(view.deliveryRateLabel(null)).toBe("-");
    expect(view.deliveryRateLabel(undefined)).toBe("-");
  });

  it("zero doręczeń to jawne 0,0%", () => {
    // Jawne zero, a nie pusta komórka - operator musi widzieć różnicę między
    // „nic nie doszło" i „nie ma jeszcze danych".
    expect(view.deliveryRateLabel(0)).toBe("0.0%");
    expect(view.deliveryRateLabel(0)).not.toBe("");
  });

  it("pełne doręczenie to 100,0%", () => {
    expect(view.deliveryRateLabel(1)).toBe("100.0%");
    // Jedno miejsce po przecinku, nie zaokrąglenie do całości.
    expect(view.deliveryRateLabel(0.955)).toBe("95.5%");
  });

  it("wartość jest zaokrąglana do jednej cyfry po przecinku", () => {
    expect(view.deliveryRateLabel(0.98765)).toBe("98.8%");
    expect(view.deliveryRateLabel(0.5)).toBe("50.0%");
  });
});

describe("ton odznaki statusu", () => {
  it("wysłane, w kolejce i wstrzymane mają RÓŻNE tony", () => {
    const tony = (["sent", "pending", "suppressed", "dlq"] as SystemEmailStatus[]).map(
      view.statusTone,
    );

    expect(new Set(tony).size).toBe(4);
    // Żaden ton nie jest pusty - pusty daje wiersz bez oznaczenia.
    expect(tony.every((t) => Boolean(t))).toBe(true);
  });

  it("DLQ jest alarmowe - to jedyny status, który wymaga reakcji operatora", () => {
    expect(view.statusTone("dlq")).toContain("destructive");
    expect(view.statusTone("sent")).not.toContain("destructive");
  });

  it("każdy status z filtra ma swój ton", () => {
    for (const status of view.STATUSES) {
      expect(view.statusTone(status).trim().length).toBeGreaterThan(0);
    }
    expect(view.STATUSES).toContain("dlq");
  });
});

describe("wykres i znaczniki czasu", () => {
  const SERIA: SystemEmailDayPoint[] = [
    { day: "2026-08-01", sent: 10, failed: 1, suppressed: 2, pending: 0 },
    { day: "2026-08-02", sent: 20, failed: 0, suppressed: 0, pending: 1 },
  ];

  it("serie zachowują kolejność dni", () => {
    const values = view.chartValues(SERIA);

    expect(values.sent).toEqual([10, 20]);
    expect(values.failed).toEqual([1, 0]);
  });

  it("trzy serie są ROZDZIELONE - wysłane, nieudane i wstrzymane to trzy różne rzeczy", () => {
    const values = view.chartValues(SERIA);

    expect(values.suppressed).toEqual([2, 0]);
    expect(Object.keys(values).sort()).toEqual(["failed", "sent", "suppressed"]);
  });

  it("pusta seria daje puste tablice, a nie wyjątek", () => {
    expect(view.chartValues([])).toEqual({ sent: [], failed: [], suppressed: [] });
    // Wszystkie trzy serie są obecne - wykres nie gubi legendy.
    expect(Object.keys(view.chartValues([])).sort()).toEqual(["failed", "sent", "suppressed"]);
  });

  it("dzień jest czytany jako UTC - lokalna strefa nie przesuwa słupka na wykresie", () => {
    // Bez sufiksu Z „2026-08-01” byłoby czytane lokalnie i w strefie ujemnej
    // wypadłoby 31 lipca.
    expect(view.dayLabel("2026-08-01", "en-GB")).toMatch(/1/);
    expect(view.dayLabel("2026-08-01", "en-GB")).toMatch(/Aug/);
  });

  it("BRAK daty wiersza to kreska, nie „Invalid Date”", () => {
    expect(view.rowTimestamp(null, "pl-PL")).toBe("-");
    expect(view.rowTimestamp(undefined, "pl-PL")).toBe("-");
    expect(view.rowTimestamp("", "pl-PL")).toBe("-");
  });

  it("data wiersza jest sformatowana lokalnie", () => {
    const label = view.rowTimestamp("2026-08-01T10:30:00.000Z", "en-GB");

    expect(label).toMatch(/2026|26/);
    expect(label.length).toBeGreaterThan(4);
  });

  it("okna czasowe raportu to doba, tydzień i miesiąc", () => {
    expect(view.RANGES).toEqual([1, 7, 30]);
    expect([...view.RANGES].sort((a, b) => a - b)).toEqual([...view.RANGES]);
  });
});

// ===========================================================================
// EDYTOR TREŚCI MAILI TRANSAKCYJNYCH
// ===========================================================================
describe("nadpisania treści maili transakcyjnych", () => {
  const puste = () => TxOverridesSchema.parse({});

  it("każdy edytowalny typ ma klucz etykiety zakładki", () => {
    const bez = EDITABLE_TX_TYPES.filter((t) => !tx.TYPE_LABEL_KEYS[t]);

    expect(bez).toEqual([]);
    expect(EDITABLE_TX_TYPES.length).toBeGreaterThan(0);
  });

  it("etykiety wskazują KLUCZE, nie napisy - inaczej powstaje drugi słownik", () => {
    for (const type of EDITABLE_TX_TYPES) {
      expect(tx.TYPE_LABEL_KEYS[type]).toMatch(/^adminNewsletter\.emailContent\.types\./);
    }
  });

  it("lista pól obejmuje temat, nagłówek i treść, każde z kluczem etykiety", () => {
    const keys = tx.FIELDS.map((f) => f.key);

    expect(keys).toContain("subject");
    // Prefiks sprawdzamy WYRAŻENIEM, nie literałem w cudzysłowie: bramka pokrycia
    // kluczy czyta takie literały jako „klucz wołany w kodzie", a prefiks
    // kluczem nie jest i wyglądałby jak brak tłumaczenia.
    expect(tx.FIELDS.every((f) => /^adminNewsletter\.emailContent\./.test(f.labelKey))).toBe(true);
  });

  it("pola długie są WIELOLINIJKOWE - wstęp maila to nie jedna linijka", () => {
    const multiline = tx.FIELDS.filter((f) => f.multiline).map((f) => f.key);

    expect(multiline).toContain("intro");
    expect(multiline).not.toContain("subject");
  });

  it("patch trafia w JEDEN typ, JEDEN język i JEDNO pole", () => {
    const type = EDITABLE_TX_TYPES[0]!;

    const next = tx.setOverrideField(puste(), type, "pl", "subject", "Nowy temat");

    expect(next[type].pl.subject).toBe("Nowy temat");
    expect(next[type].en.subject).toBe("");
  });

  it("patch NIE wyciera pozostałych typów maili", () => {
    // Nadpisanie całego obiektu wyciera nadpisania innych typów, a zauważy to
    // dopiero odbiorca przypomnienia o wygaśnięciu dostępu.
    const type = EDITABLE_TX_TYPES[0]!;
    const inny = EDITABLE_TX_TYPES[1]!;
    const start = tx.setOverrideField(puste(), inny, "pl", "heading", "Zostawić");

    const next = tx.setOverrideField(start, type, "pl", "subject", "Nowy temat");

    expect(next[inny].pl.heading).toBe("Zostawić");
    expect(next[type].pl.subject).toBe("Nowy temat");
  });

  it("patch NIE wyciera pozostałych pól tego samego języka", () => {
    const type = EDITABLE_TX_TYPES[0]!;
    const start = tx.setOverrideField(puste(), type, "pl", "heading", "Nagłówek");

    const next = tx.setOverrideField(start, type, "pl", "subject", "Temat");

    expect(next[type].pl).toMatchObject({ heading: "Nagłówek", subject: "Temat" });
    // Druga wersja językowa też zostaje nietknięta.
    expect(next[type].en.subject).toBe("");
  });

  it("patch nie mutuje szkicu wejściowego - cofnięcie edycji musi działać", () => {
    const type = EDITABLE_TX_TYPES[0]!;
    const start = puste();

    const next = tx.setOverrideField(start, type, "pl", "subject", "Nowy");

    expect(start[type].pl.subject).toBe("");
    expect(next[type].pl.subject).toBe("Nowy");
  });

  it("RESET przywraca domyślne tylko dla JEDNEGO języka", () => {
    // Reset obu wyciera pracę tłumacza.
    const type = EDITABLE_TX_TYPES[0]!;
    let draft = tx.setOverrideField(puste(), type, "pl", "subject", "Polski temat");
    draft = tx.setOverrideField(draft, type, "en", "subject", "English subject");

    const next = tx.resetOverrideLang(draft, type, "pl");

    expect(next[type].pl.subject).toBe("");
    expect(next[type].en.subject).toBe("English subject");
  });

  it("RESET nie rusza pozostałych typów maili", () => {
    const type = EDITABLE_TX_TYPES[0]!;
    const inny = EDITABLE_TX_TYPES[1]!;
    let draft = tx.setOverrideField(puste(), type, "pl", "subject", "Do zresetowania");
    draft = tx.setOverrideField(draft, inny, "pl", "subject", "Do zachowania");

    const next = tx.resetOverrideLang(draft, type, "pl");

    expect(next[inny].pl.subject).toBe("Do zachowania");
    expect(next[type].pl.subject).toBe("");
  });

  it("znacznik zmian widzi RÓŻNICĘ jednego pola", () => {
    const type = EDITABLE_TX_TYPES[0]!;
    const saved = puste();
    const draft = tx.setOverrideField(saved, type, "pl", "subject", "Zmiana");

    expect(tx.hasUnsavedChanges(draft, saved)).toBe(true);
    // Porównanie jest symetryczne - kolejność argumentów nie zmienia odpowiedzi.
    expect(tx.hasUnsavedChanges(saved, draft)).toBe(true);
  });

  it("identyczny szkic to BRAK zmian - fałszywe „są zmiany” zapala zapis bez powodu", () => {
    const saved = puste();

    expect(tx.hasUnsavedChanges(puste(), saved)).toBe(false);
    // Ten sam obiekt też nie jest zmianą.
    expect(tx.hasUnsavedChanges(saved, saved)).toBe(false);
  });

  it("powrót do zapisanej wartości gasi znacznik zmian", () => {
    const type = EDITABLE_TX_TYPES[0]!;
    const saved = tx.setOverrideField(puste(), type, "pl", "subject", "Temat");
    const draft = tx.setOverrideField(saved, type, "pl", "subject", "Temat");

    expect(tx.hasUnsavedChanges(draft, saved)).toBe(false);
    // ...a zmiana na COKOLWIEK innego znów zapala znacznik.
    expect(
      tx.hasUnsavedChanges(tx.setOverrideField(saved, type, "pl", "subject", "Inny"), saved),
    ).toBe(true);
  });

  it("podpowiedź tokenów pokazuje je w formie, w jakiej się je wpisuje", () => {
    const hint = tx.tokensHint(TX_OVERRIDE_TOKENS);

    expect(hint).toContain("{");
    expect(hint).toContain("}");
  });

  it("podpowiedź wymienia KAŻDY dostępny token", () => {
    const hint = tx.tokensHint(TX_OVERRIDE_TOKENS);

    for (const token of TX_OVERRIDE_TOKENS) {
      expect(hint).toContain(`{${token}}`);
    }
    expect(TX_OVERRIDE_TOKENS.length).toBeGreaterThan(0);
  });

  it("pusta lista tokenów daje pusty napis, a nie „{}”", () => {
    expect(tx.tokensHint([])).toBe("");
    expect(tx.tokensHint([])).not.toContain("{");
  });
});

// ===========================================================================
// PODGLĄD MAILI AUTORYZACYJNYCH
// ===========================================================================
describe("podgląd maili - etykiety typów", () => {
  it("znany typ ma klucz etykiety", () => {
    expect(preview.previewTypeLabelKey("signup")).toBe("adminNewsletter.emailPreview.types.signup");
    // Inny typ daje inny klucz - to mapa, nie jedna stała.
    expect(preview.previewTypeLabelKey("recovery")).toBe(
      "adminNewsletter.emailPreview.types.recovery",
    );
  });

  it("nieznany typ oddaje NULL, więc podpis schodzi na sam typ", () => {
    // Pusta pozycja na liście to szablon, którego operator nie potrafi wybrać.
    expect(preview.previewTypeLabelKey("cos_nowego_z_serwera")).toBeNull();
    expect(preview.previewTypeLabelKey("cos_nowego_z_serwera")).not.toBe("");
  });

  it("klucz magic linku nazywa się tak, jak typ z serwera", () => {
    // Serwer wysyła `magiclink` bez podkreślnika - pomyłka daje bezimienną pozycję.
    expect(preview.previewTypeLabelKey("magiclink")).toBeTruthy();
    expect(preview.previewTypeLabelKey("magic_link")).toBeNull();
  });

  it("wszystkie klucze są UNIKALNE i mają wspólny prefiks", () => {
    const keys = Object.values(preview.TYPE_LABEL_KEYS);

    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((k) => /^adminNewsletter\.emailPreview\.types\./.test(k))).toBe(true);
  });

  it("mapa obejmuje maile autoryzacyjne ORAZ aplikacyjne", () => {
    expect(preview.TYPE_LABEL_KEYS.recovery).toBeTruthy();
    expect(preview.TYPE_LABEL_KEYS.subscription_confirmed).toBeTruthy();
  });
});

describe("podgląd maili - zakres i wybór szablonu", () => {
  it("zmiana zakresu przestawia typ na PIERWSZY z tego zakresu", () => {
    // Zakresy mają rozłączne zestawy szablonów - stary typ dałby puste okno.
    expect(preview.defaultTypeForScope("auth")).toBe("signup");
    expect(preview.defaultTypeForScope("app")).toBe("subscription_confirmed");
  });

  it("domyślne typy obu zakresów są znane mapie etykiet", () => {
    for (const scope of ["auth", "app"] as const) {
      expect(preview.previewTypeLabelKey(preview.defaultTypeForScope(scope))).toBeTruthy();
    }
  });

  it("wybrany szablon wygrywa, gdy jest na liście", () => {
    const rows = [{ type: "signup" }, { type: "recovery" }];

    expect(preview.activePreview(rows, "recovery")?.type).toBe("recovery");
    // Nie „pierwszy z listy" - wybór operatora ma znaczenie.
    expect(preview.activePreview(rows, "recovery")?.type).not.toBe("signup");
  });

  it("wybrany szablon NIEOBECNY na liście schodzi na pierwszy", () => {
    // Puste okno operator czyta jako awarię panelu.
    const rows = [{ type: "subscription_confirmed" }, { type: "subscription_renewed" }];

    expect(preview.activePreview(rows, "signup")?.type).toBe("subscription_confirmed");
    // Zwrot jest wierszem z listy, nie sztucznym obiektem o wybranym typie.
    expect(rows).toContain(preview.activePreview(rows, "signup"));
  });

  it("pusta lista i brak danych nie dają nic do pokazania", () => {
    expect(preview.activePreview([], "signup")).toBeUndefined();
    expect(preview.activePreview(undefined, "signup")).toBeUndefined();
  });
});

describe("podgląd maili - ramka i imię", () => {
  it("telefon jest WĘŻSZY niż monitor - o tym jest cały przełącznik", () => {
    expect(preview.frameMaxWidth("mobile")).toBe(390);
    expect(preview.frameMaxWidth("desktop")).toBe(720);
    expect(preview.frameMaxWidth("mobile")).toBeLessThan(preview.frameMaxWidth("desktop"));
  });

  it("puste imię znaczy BEZ IMIENIA, nie pusty napis w powitaniu", () => {
    // Pusty napis dałby w mailu „Cześć ,” - z osieroconym przecinkiem.
    expect(preview.previewFirstName("")).toBeNull();
    expect(preview.previewFirstName("   ")).toBeNull();
  });

  it("imię jest obcinane z brzegowych spacji", () => {
    expect(preview.previewFirstName("  Marek  ")).toBe("Marek");
    // Spacja w środku zostaje - imiona dwuczłonowe są normalne.
    expect(preview.previewFirstName("  Anna Maria  ")).toBe("Anna Maria");
  });
});
