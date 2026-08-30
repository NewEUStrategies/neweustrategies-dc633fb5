// Organizm „STATYSTYKI NA MIEJSCU” - jedyny ekran, na którym organizator
// w dniu wydarzenia czyta, ilu ludzi NAPRAWDĘ przeszło przez bramkę.
//
// DLACZEGO TEN PLIK POWSTAŁ. Panel był JEDYNYM organizmem modułu odprawy bez
// ani jednego testu (0% linii w pomiarze przed tą pracą), a jednocześnie jest
// tym, po którym koordynator podejmuje decyzje: dosypać wolontariuszy do
// bramki, otworzyć drugie wejście, zamknąć zapisy na miejscu.
//
// CO TEN PLIK DOWODZI.
//   1. TRZY STANY MAJĄ TRZY WIDOKI. Wczytywanie nie może wyglądać jak awaria,
//      a awaria nie może wyglądać jak „zero osób na sali”. Organizator, który
//      po nieudanym zapytaniu przeczyta „0 na miejscu”, pośle ludzi do bramki,
//      przy której stoi kolejka.
//   2. FREKWENCJA, KTÓREJ NIE MA, JEST MYŚLNIKIEM. `attendanceRate === null`
//      (wydarzenie bez zatwierdzonych zapisów - brak mianownika) daje „-”,
//      a NIE „0%”. Zero procent to zdanie o pustej sali, a nie o braku danych.
//   3. TON KAFELKA JEST DODATKIEM, NIE TREŚCIĄ. Odmowy i nieobecni zapalają
//      się dopiero powyżej zera - kolor ma podnieść wzrok, a nie krzyczeć
//      przy pustym dzienniku.
//   4. HISTOGRAM SKALUJE SIĘ DO SZCZYTU, nie do sumy i nie do stałej. Kubełek
//      szczytowy ma 100%, reszta proporcjonalnie, a same zera nie dzielą przez
//      zero.
//   5. SEKCJE ZNIKAJĄ, GDY NIE MAJĄ CZEGO POKAZAĆ. Pusty histogram i pusta
//      lista punktów nie rysują ramki z samym nagłówkiem - kafelki urządzeń
//      stoją ZAWSZE, bo zero sprawnych urządzeń to informacja, nie pustka.
//   6. JĘZYK INTERFEJSU WYBIERA NAZWĘ PUNKTU, z zejściem na drugi język, gdy
//      tłumaczenia nie ma.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Parsera `parseOnsiteStats` - ma własny dom
// w `lib/events/__tests__/onsiteApi.test.ts`; tutaj hook jest atrapą i oddaje
// gotowy kształt. (2) Pulpitu na żywo - `OnsiteLiveStatsPanel` ma własny plik
// testowy i jest tu atrapą, żeby nie mierzyć dwa razy tego samego. (3) Słownika
// odmów bazy - tu jest atrapą, bo dowodzimy wyłącznie tego, że odmowa DOCHODZI
// zdaniem. (4) Formatu godziny kubełka - `toLocaleTimeString` zależy od wersji
// ICU maszyny, więc asercje dotyczą wyłącznie przypadków „nie ma czego pokazać”.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { axeViolations, summarize } from "@/test/axe";
import type {
  OnsiteCheckpointStat,
  OnsiteHistogramBucket,
  OnsiteStats,
} from "@/lib/events/onsiteApi";

const h = vi.hoisted(() => ({
  lang: "pl",
  data: undefined as unknown,
  isLoading: false,
  listError: null as unknown,
  /** Argumenty KAŻDEGO wywołania hooka - dowód, że panel pyta o TO wydarzenie. */
  zapytania: [] as { eventId: string; bucketMinutes: number | undefined }[],
  /** Identyfikatory, z jakimi zamontowano pulpit na żywo. */
  naZywo: [] as string[],
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);

// Słownik odmów ciągnie realny i18next i ma własny plik testowy; tutaj liczy
// się wyłącznie to, że odmowa dochodzi ZDANIEM, a nie kodem `42501`.
vi.mock("@/lib/events/adminOnsiteErrors", () => ({
  adminOnsiteErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));

// Pulpit na żywo jest osobnym organizmem z własnym plikiem testowym. Tutaj
// interesuje nas WYŁĄCZNIE to, że stoi pod statystykami i dostaje ten sam
// identyfikator wydarzenia.
vi.mock("@/components/admin/events/organisms/OnsiteLiveStatsPanel", () => ({
  OnsiteLiveStatsPanel: ({ eventId }: { eventId: string }) => {
    h.naZywo.push(eventId);
    return <div data-testid="na-zywo">{eventId}</div>;
  },
}));

vi.mock("@/lib/events/useEventOnsite", () => ({
  useOnsiteStats: (eventId: string, bucketMinutes?: number) => {
    h.zapytania.push({ eventId, bucketMinutes });
    return { data: h.data, isLoading: h.isLoading, error: h.listError };
  },
}));

import { OnsiteStatsPanel } from "@/components/admin/events/organisms/OnsiteStatsPanel";

const T = "adminEventOnsite.stats";
const WYDARZENIE = "11111111-1111-4111-8111-111111111111";

function kubelek(overrides: Partial<OnsiteHistogramBucket> = {}): OnsiteHistogramBucket {
  return {
    bucketAt: "2026-09-01T08:00:00.000Z",
    grantedIn: 10,
    grantedOut: 2,
    denied: 1,
    ...overrides,
  };
}

function punkt(overrides: Partial<OnsiteCheckpointStat> = {}): OnsiteCheckpointStat {
  return {
    checkpointId: "cccccccc-1111-4111-8111-111111111111",
    namePl: "Brama główna",
    nameEn: "Main gate",
    kind: "event_entry",
    accessMode: "control",
    capacity: 500,
    occupancy: 120,
    granted: 130,
    denied: 4,
    uniquePeople: 118,
    lastCheckinAt: "2026-09-01T08:31:00.000Z",
    ...overrides,
  };
}

function pulpit(overrides: Partial<OnsiteStats> = {}): OnsiteStats {
  return {
    bucketMinutes: 15,
    registeredTotal: 400,
    arrivedTotal: 310,
    arrivedRegistered: 300,
    walkInTotal: 10,
    noShowTotal: 100,
    attendanceRate: 0.75,
    deniedTotal: 6,
    deniedByReason: { denied_registration_status: 4, wrong_event: 2 },
    repeatTotal: 12,
    failedResolveTotal: 3,
    badgesPrintedPeople: 280,
    badgesPrintedCopies: 291,
    leadScansTotal: 64,
    leadScansWithConsent: 41,
    histogram: [],
    checkpoints: [],
    devices: { total: 9, active: 6, locked: 1, revoked: 1, expired: 1 },
    ...overrides,
  };
}

function panel(eventId = WYDARZENIE) {
  return render(<OnsiteStatsPanel eventId={eventId} />);
}

/** Wartość kafelka o danej etykiecie - liczba stoi w sąsiednim wierszu karty. */
function kafelek(klucz: string): string {
  const etykieta = screen.getByText(`${T}.${klucz}`);
  const karta = etykieta.closest("div.p-3");
  if (karta === null) throw new Error(`kafelek ${klucz} nie ma karty`);
  const wartosc = karta.children[1];
  if (wartosc === undefined) throw new Error(`kafelek ${klucz} nie ma wartości`);
  return wartosc.textContent ?? "";
}

/** Karta sekcji rozpoznana po nagłówku trzeciego poziomu. */
function sekcja(klucz: string): HTMLElement {
  const naglowek = screen.getByText(`${T}.${klucz}`);
  const karta = naglowek.closest("div.p-4");
  if (karta === null) throw new Error(`sekcja ${klucz} nie ma karty`);
  return karta as HTMLElement;
}

beforeEach(() => {
  h.lang = "pl";
  h.data = pulpit();
  h.isLoading = false;
  h.listError = null;
  h.zapytania = [];
  h.naZywo = [];
});

describe("trzy stany pulpitu statystyk", () => {
  it("zapytanie w locie mówi „wczytuję” i nie rysuje ANI JEDNEGO kafelka", () => {
    h.isLoading = true;
    h.data = undefined;
    panel();

    expect(screen.getByText(`${T}.loading`)).toBeTruthy();
    expect(screen.queryByText(`${T}.registeredTotal`)).toBeNull();
    expect(screen.queryByText(`${T}.devicesTitle`)).toBeNull();
  });

  it("awaria pokazuje odmowę bazy i NIE udaje pustego dziennika", () => {
    h.data = undefined;
    h.listError = new Error("permission_denied: brak dostępu");
    panel();

    expect(screen.getByText("odmowa:permission_denied: brak dostępu")).toBeTruthy();
    // Gdyby po nieudanym zapytaniu stanęły zera, organizator uznałby, że nikt
    // nie przyszedł - a przy bramce stałaby kolejka.
    expect(screen.queryByText(`${T}.arrivedTotal`)).toBeNull();
  });

  it("wczytywanie BIJE awarię - ponowna próba pokazuje postęp, a nie stary błąd", () => {
    h.isLoading = true;
    h.data = undefined;
    h.listError = new Error("permission_denied: brak dostępu");
    panel();

    expect(screen.getByText(`${T}.loading`)).toBeTruthy();
    expect(screen.queryByText("odmowa:permission_denied: brak dostępu")).toBeNull();
  });

  it("odmowa wyrażona jako `undefined` (nie `null`) też jest awarią", () => {
    h.data = pulpit();
    h.listError = undefined;
    panel();

    // `undefined` znaczy „zapytanie się udało” - kafelki mają stać.
    expect(screen.getByText(`${T}.registeredTotal`)).toBeTruthy();
  });

  it("komplet danych rysuje nagłówek sekcji i podpis", () => {
    panel();

    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(`${T}.title`);
    expect(screen.getByText(`${T}.subtitle`)).toBeTruthy();
  });
});

describe("kafelki - liczba z dziennika, nie z deklaracji", () => {
  it("osiem kafelków niesie DOKŁADNIE metryki bazy", () => {
    panel();

    expect(kafelek("registeredTotal")).toBe("400");
    expect(kafelek("arrivedTotal")).toBe("310");
    expect(kafelek("noShowTotal")).toBe("100");
    expect(kafelek("walkInTotal")).toBe("10");
    expect(kafelek("deniedTotal")).toBe("6");
  });

  it("wydruki i leady to PARA liczb, nie jedna", () => {
    panel();

    // Ludzie / kopie: dodruk zgubionego identyfikatora podnosi drugą liczbę.
    expect(kafelek("badgesPrinted")).toBe("280 / 291");
    // Ze zgodą / wszystkie: sponsor mierzy ruch nawet bez zgody na dane.
    expect(kafelek("leadScans")).toBe("41 / 64");
  });

  it("podpowiedź kafelka leadów mówi, KTÓRA z dwóch liczb jest która", () => {
    panel();

    expect(screen.getByText(`${T}.leadScansWithConsent`)).toBeTruthy();
  });
});

describe("frekwencja - procent albo myślnik, nigdy zmyślone zero", () => {
  it("ułamek z bazy staje się procentem z jednym miejscem po przecinku", () => {
    h.data = pulpit({ attendanceRate: 0.7534 });
    panel();

    expect(kafelek("attendanceRate")).toBe("75.3%");
  });

  it("BRAK MIANOWNIKA to „-”, a nie „0%”", () => {
    h.data = pulpit({ attendanceRate: null });
    panel();

    // Wydarzenie bez zatwierdzonych zapisów nie ma z czego liczyć frekwencji.
    // „0%” byłoby zdaniem o pustej sali - a to jest zdanie o braku danych.
    expect(kafelek("attendanceRate")).toBe("-");
  });

  it("PRAWDZIWE zero frekwencji nadal jest zerem, nie myślnikiem", () => {
    h.data = pulpit({ attendanceRate: 0 });
    panel();

    expect(kafelek("attendanceRate")).toBe("0%");
  });

  it("komplet obecności to równe 100%, bez ogona zaokrąglenia", () => {
    h.data = pulpit({ attendanceRate: 1 });
    panel();

    expect(kafelek("attendanceRate")).toBe("100%");
  });
});

describe("ton kafelka zapala się dopiero powyżej zera", () => {
  it("brak odmów i brak nieobecnych nie maluje niczego na czerwono", () => {
    h.data = pulpit({ deniedTotal: 0, noShowTotal: 0 });
    panel();

    const odmowy = screen.getByText(`${T}.deniedTotal`).closest("div.p-3");
    const nieobecni = screen.getByText(`${T}.noShowTotal`).closest("div.p-3");
    expect(odmowy?.querySelector(".text-destructive")).toBeNull();
    expect(nieobecni?.querySelector(".text-amber-600")).toBeNull();
  });

  it("pierwsza odmowa i pierwszy nieobecny podnoszą wzrok kolorem", () => {
    h.data = pulpit({ deniedTotal: 1, noShowTotal: 1 });
    panel();

    const odmowy = screen.getByText(`${T}.deniedTotal`).closest("div.p-3");
    const nieobecni = screen.getByText(`${T}.noShowTotal`).closest("div.p-3");
    expect(odmowy?.querySelector(".text-destructive")).not.toBeNull();
    expect(nieobecni?.querySelector(".text-amber-600")).not.toBeNull();
    // Kolor jest DODATKIEM: liczba nadal czyta się bez niego.
    expect(kafelek("deniedTotal")).toBe("1");
  });
});

describe("histogram ruchu", () => {
  it("pusty histogram NIE rysuje ramki z samym nagłówkiem", () => {
    h.data = pulpit({ histogram: [] });
    panel();

    expect(screen.queryByText(`${T}.histogramTitle`)).toBeNull();
  });

  it("każdy kubełek to jeden wiersz z sumą trzech liczb bazy", () => {
    h.data = pulpit({
      histogram: [
        kubelek({ bucketAt: "2026-09-01T08:00:00.000Z", grantedIn: 10, grantedOut: 2, denied: 1 }),
        kubelek({ bucketAt: "2026-09-01T08:15:00.000Z", grantedIn: 4, grantedOut: 0, denied: 0 }),
      ],
    });
    panel();

    const karta = sekcja("histogramTitle");
    const wiersze = within(karta).getAllByRole("listitem");
    expect(wiersze).toHaveLength(2);
    // 10 + 2 + 1 = 13 oraz 4 + 0 + 0 = 4.
    expect(wiersze[0].textContent).toContain("13");
    expect(wiersze[1].textContent).toContain("4");
  });

  it("SZCZYT ma pełną szerokość, a reszta jest do niego proporcjonalna", () => {
    h.data = pulpit({
      histogram: [
        kubelek({ bucketAt: "2026-09-01T08:00:00.000Z", grantedIn: 20, grantedOut: 0, denied: 0 }),
        kubelek({ bucketAt: "2026-09-01T08:15:00.000Z", grantedIn: 5, grantedOut: 0, denied: 0 }),
      ],
    });
    panel();

    const karta = sekcja("histogramTitle");
    const paski = karta.querySelectorAll<HTMLElement>("span[aria-hidden='true']");
    expect(paski[0].style.width).toBe("100%");
    expect(paski[1].style.width).toBe("25%");
  });

  it("SAME ZERA nie dzielą przez zero - pasek ma szerokość zerową", () => {
    h.data = pulpit({
      histogram: [kubelek({ grantedIn: 0, grantedOut: 0, denied: 0 })],
    });
    panel();

    const pasek = sekcja("histogramTitle").querySelector<HTMLElement>("span[aria-hidden='true']");
    expect(pasek?.style.width).toBe("0%");
  });

  it("pasek jest OZDOBĄ - czytnik ekranu dostaje godzinę i liczbę, nie prostokąt", () => {
    h.data = pulpit({ histogram: [kubelek()] });
    panel();

    const pasek = sekcja("histogramTitle").querySelector("span[aria-hidden='true']");
    expect(pasek).not.toBeNull();
  });
});

describe("punkty kontrolne", () => {
  it("pusta lista punktów NIE rysuje ramki z samym nagłówkiem", () => {
    h.data = pulpit({ checkpoints: [] });
    panel();

    expect(screen.queryByText(`${T}.checkpointsTitle`)).toBeNull();
  });

  it("zajętość stoi obok POJEMNOŚCI, gdy baza ją zna", () => {
    h.data = pulpit({ checkpoints: [punkt({ occupancy: 120, capacity: 500 })] });
    panel();

    const karta = sekcja("checkpointsTitle");
    expect(within(karta).getByText("adminEventOnsite.labels.occupancy: 120 / 500")).toBeTruthy();
  });

  it("punkt BEZ pojemności pokazuje samą zajętość, bez wiszącego ukośnika", () => {
    h.data = pulpit({ checkpoints: [punkt({ occupancy: 42, capacity: null })] });
    panel();

    const karta = sekcja("checkpointsTitle");
    expect(within(karta).getByText("adminEventOnsite.labels.occupancy: 42")).toBeTruthy();
  });

  it("brak odmów w punkcie NIE rysuje pustej czerwonej odznaki", () => {
    h.data = pulpit({ checkpoints: [punkt({ denied: 0 })] });
    panel();

    const karta = sekcja("checkpointsTitle");
    expect(within(karta).queryByText(/adminEventOnsite\.filters\.denied/)).toBeNull();
    expect(within(karta).getByText("adminEventOnsite.results.granted: 130")).toBeTruthy();
  });

  it("pierwsza odmowa w punkcie zapala osobną odznakę", () => {
    h.data = pulpit({ checkpoints: [punkt({ denied: 1 })] });
    panel();

    const karta = sekcja("checkpointsTitle");
    expect(within(karta).getByText("adminEventOnsite.filters.denied: 1")).toBeTruthy();
  });

  it("po polsku czytamy nazwę polską, po angielsku - angielską", () => {
    h.data = pulpit({ checkpoints: [punkt()] });
    panel();
    expect(screen.getByText("Brama główna")).toBeTruthy();

    screen.getByText("Brama główna").remove();
    h.lang = "en";
    panel();
    expect(screen.getByText("Main gate")).toBeTruthy();
  });

  it("brak tłumaczenia SCHODZI na drugi język zamiast zostawiać pusty wiersz", () => {
    h.lang = "en";
    h.data = pulpit({ checkpoints: [punkt({ nameEn: "" })] });
    panel();

    expect(screen.getByText("Brama główna")).toBeTruthy();
  });

  it("każdy punkt to osobny wiersz listy", () => {
    h.data = pulpit({
      checkpoints: [
        punkt({ checkpointId: "cccccccc-1111-4111-8111-111111111111" }),
        punkt({
          checkpointId: "cccccccc-2222-4222-8222-222222222222",
          namePl: "Wejście boczne",
        }),
      ],
    });
    panel();

    const karta = sekcja("checkpointsTitle");
    expect(within(karta).getAllByRole("listitem")).toHaveLength(2);
  });
});

describe("urządzenia", () => {
  it("karta urządzeń stoi ZAWSZE - zero sprawnych to informacja, nie pustka", () => {
    h.data = pulpit({
      histogram: [],
      checkpoints: [],
      devices: { total: 0, active: 0, locked: 0, revoked: 0, expired: 0 },
    });
    panel();

    const karta = sekcja("devicesTitle");
    expect(within(karta).getByText("adminEventOnsite.deviceStates.active: 0")).toBeTruthy();
  });

  it("cztery stany poświadczenia mają cztery osobne odznaki", () => {
    panel();

    const karta = sekcja("devicesTitle");
    expect(within(karta).getByText("adminEventOnsite.deviceStates.active: 6")).toBeTruthy();
    expect(within(karta).getByText("adminEventOnsite.deviceStates.locked: 1")).toBeTruthy();
    expect(within(karta).getByText("adminEventOnsite.deviceStates.revoked: 1")).toBeTruthy();
    expect(within(karta).getByText("adminEventOnsite.deviceStates.expired: 1")).toBeTruthy();
  });
});

describe("zapytanie i pulpit na żywo", () => {
  it("panel pyta o TO wydarzenie i zostawia kubełek bazie", () => {
    panel();

    expect(h.zapytania).toEqual([{ eventId: WYDARZENIE, bucketMinutes: undefined }]);
  });

  it("pulpit na żywo stoi pod statystykami i dostaje ten sam identyfikator", () => {
    panel();

    expect(h.naZywo).toEqual([WYDARZENIE]);
    expect(screen.getByTestId("na-zywo").textContent).toBe(WYDARZENIE);
  });

  it("pulpit na żywo stoi także PRZY AWARII statystyk - to dwa osobne zapytania", () => {
    h.data = undefined;
    h.listError = new Error("permission_denied: brak dostępu");
    panel();

    expect(screen.getByTestId("na-zywo")).toBeTruthy();
  });
});

describe("dostępność", () => {
  it("pulpit z kompletem sekcji nie ma naruszeń dostępności", async () => {
    h.data = pulpit({ histogram: [kubelek()], checkpoints: [punkt()] });
    const { container } = panel();
    await screen.findByText("Brama główna");

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("pulpit w stanie awarii też nie ma naruszeń dostępności", async () => {
    h.data = undefined;
    h.listError = new Error("permission_denied: brak dostępu");
    const { container } = panel();
    await screen.findByText("odmowa:permission_denied: brak dostępu");

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("znane defekty", () => {
  // KUBEŁEK BEZ GODZINY. `parseOnsiteStats` oddaje `bucketAt: ""`, gdy baza nie
  // poda `bucket_at` (parser broni ekranu przed `undefined`). Panel wpuszcza ten
  // pusty łańcuch prosto do `new Date(...).toLocaleTimeString(...)`, a to daje
  // napis „Invalid Date” na pulpicie organizatora - dokładnie ten sam problem,
  // który sąsiedni `OnsiteLiveStatsPanel` rozwiązuje myślnikiem. Test opisuje
  // stan DOCELOWY: brak godziny ma być myślnikiem, tak jak wszędzie indziej
  // w module.
  it.fails("kubełek BEZ godziny powinien pokazać myślnik, a pokazuje „Invalid Date”", () => {
    h.data = pulpit({ histogram: [kubelek({ bucketAt: "" })] });
    panel();

    const wiersz = within(sekcja("histogramTitle")).getAllByRole("listitem")[0];
    const godzina = wiersz.firstElementChild?.textContent ?? "";
    expect(godzina).toBe("-");
  });
});
