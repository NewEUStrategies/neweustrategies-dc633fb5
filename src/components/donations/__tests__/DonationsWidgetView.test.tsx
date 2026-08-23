// Widget darowizn w treści CMS: sześć wariantów wizualnych nad JEDNYM odczytem
// publicznych statystyk. RYZYKIEM jest tu KOMUNIKAT O PIENIĄDZACH - widget
// mówi czytelnikowi, ile zebrała zbiórka, i robi to także wtedy, gdy nic nie
// wie.
//
// CO TEN PLIK DOWODZI.
//   1. `statsQ.data ?? FALLBACK` (jedna linia) sprawia, że AWARIA ODCZYTU
//      renderuje „0 zł zebrane" i pasek 0%. Nie ma gałęzi na `isError` ani
//      `isPending`, więc tsc, recenzja i każdy test renderujący happy path
//      przechodzą obok tego bez drgnienia - widać to wyłącznie wtedy, gdy test
//      ODRZUCI obietnicę server fn.
//   2. Awaria jest BAJT W BAJT nieodróżnialna od zbiórki, której nikt nie
//      wsparł: ten sam DOM z odrzuconej obietnicy i z pustych statystyk.
//   3. Słownik `i18n-donations-widget.ts` ma klucze `donationsWidget.loading`
//      i `donationsWidget.empty` - czyli stan wczytywania i stan pusty zostały
//      ZAPROJEKTOWANE - a komponent nie woła ani jednego z nich.
//   4. `showRecent` przyjmuje każdy z sześciu wariantów, a honoruje wyłącznie
//      `thermometer`. Redakcja włącza w edytorze przełącznik, który w pięciu
//      układach nie robi NIC.
//   5. Pasek postępu bez celu maluje darczyńców × 5 jako procent.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Arytmetyki i normalizacji propsów dowodzi
// `donationsWidgetModel.test.ts`, składu powtarzalnych kawałków DOM -
// `atoms/__tests__/*`. Tu asercje dotyczą wyłącznie tego, CO WIDGET POKAZUJE
// przy danym stanie odczytu i danym wariancie.
//
// PODMIENIONE ATRAPY (i dlaczego inaczej się nie da):
//   * `@tanstack/react-start` - `useServerFn` staje się tożsamością, bo pod
//     happy-dom prawdziwa server fn nie ma runtime'u TanStack Start
//     (patrz `src/test/serverFn.ts`); `createServerFn` bierzemy z harnessu.
//   * `@/lib/billing/donations.functions` - to jest ŹRÓDŁO stanu, którym
//     sterujemy (sukces / odrzucona obietnica / wieczne oczekiwanie).
//   * słowniki `i18n-*` - `t` echuje klucz (`@/test/i18nStub`), więc asercja
//     widzi KLUCZ, a nie tłumaczenie; realny i18next nic by tu nie dowiódł.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import type { DonationsVariant, StatsShape } from "@/components/donations/donationsWidgetModel";

type Tryb = "ok" | "blad" | "wczytywanie";

const h = vi.hoisted(() => ({
  tryb: "ok" as "ok" | "blad" | "wczytywanie",
  stats: null as unknown,
  jezyk: "pl",
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.jezyk),
);
vi.mock("@/lib/i18n-donations-widget", () => ({}));
vi.mock("@/lib/i18n-donate", () => ({}));
vi.mock("@tanstack/react-start", async () => {
  const modul = await (await import("@/test/serverFn")).serverFnModuleMock();
  return { ...modul, useServerFn: (fn: unknown) => fn };
});
vi.mock("@/lib/billing/donations.functions", () => ({
  getDonationsPublicStats: () => {
    if (h.tryb === "blad") return Promise.reject(new Error("donations: odczyt statystyk padł"));
    if (h.tryb === "wczytywanie") return new Promise(() => {});
    return Promise.resolve(h.stats);
  },
  // Konfiguracja modułu (cel przycisku) - `null` = domyślki, czyli własna kasa.
  getDonationsConfig: async () => null,
  createDonationCheckout: vi.fn(),
}));

import { DonationsWidgetView } from "@/components/donations/DonationsWidgetView";
import type { DonationsWidgetProps } from "@/components/donations/donationsWidgetModel";

const KLUCZ = ["donations", "public-stats"];

const PUSTE: StatsShape = {
  totalCents: 0,
  monthCents: 0,
  count: 0,
  monthCount: 0,
  currency: "PLN",
  recent: [],
};

/** Zbiórka z pieniędzmi. Kwoty są wyliczalne w pamięci - tak mają zostać. */
const ZEBRANE: StatsShape = {
  totalCents: 250_00,
  monthCents: 40_00,
  count: 7,
  monthCount: 2,
  currency: "PLN",
  recent: [
    { amount_cents: 5000, currency: "PLN", created_at: "2026-08-23T11:00:00.000Z" },
    { amount_cents: 2000, currency: "PLN", created_at: "2026-08-22T11:00:00.000Z" },
  ],
};

interface Opcje {
  tryb?: Tryb;
  stats?: StatsShape;
  jezyk?: string;
}

async function renderWidget(props: DonationsWidgetProps = {}, opcje: Opcje = {}) {
  h.tryb = opcje.tryb ?? "ok";
  h.stats = opcje.stats ?? PUSTE;
  h.jezyk = opcje.jezyk ?? "pl";
  const r = renderWithQueryClient(<DonationsWidgetView {...props} />);
  if (h.tryb !== "wczytywanie") {
    const oczekiwany = h.tryb === "blad" ? "error" : "success";
    await waitFor(() => expect(r.queryClient.getQueryState(KLUCZ)?.status).toBe(oczekiwany));
    await waitFor(() => expect(r.container.firstElementChild).not.toBeNull());
  }
  return { ...r, root: r.container.firstElementChild as HTMLElement };
}

/** Tekst całego widgetu ze spacjami nierozdzielającymi zamienionymi na zwykłe. */
function tekst(el: Element | null): string {
  return (el?.textContent ?? "").replace(/\u00a0/g, " ");
}

const wypelnienia = (root: Element) =>
  [...root.querySelectorAll<HTMLElement>(".transition-all")].map(
    (el) => el.style.width || el.style.height,
  );

const WARIANTY: DonationsVariant[] = [
  "hero",
  "progress",
  "stats-strip",
  "compact-card",
  "inline-bar",
  "thermometer",
];

afterEach(cleanup);

// ---------------------------------------------------------------------------
describe("stan odczytu statystyk", () => {
  it.fails("DEFEKT: awaria odczytu NIE POWINNA renderować „0 zł zebrane”", async () => {
    // Oczekiwane: gdy `getDonationsPublicStats` odrzuci obietnicę, widget mówi
    // „nie wiem" (choćby kluczem `donationsWidget.loading`/`empty` albo
    // ukryciem liczb) - nigdy kwoty, której nie potwierdził odczyt.
    const { root } = await renderWidget({ variant: "hero" }, { tryb: "blad" });
    expect(tekst(root)).not.toContain("0 zł");
  });

  it("DEFEKT (przypięty): awaria odczytu jest BAJT W BAJT nieodróżnialna od pustej zbiórki", async () => {
    const awaria = await renderWidget({ variant: "hero", goalCents: 100_00 }, { tryb: "blad" });
    const domAwarii = awaria.root.outerHTML;
    cleanup();
    const pustka = await renderWidget(
      { variant: "hero", goalCents: 100_00 },
      { tryb: "ok", stats: PUSTE },
    );
    expect(pustka.root.outerHTML).toBe(domAwarii);
  });

  it("DEFEKT (przypięty): przy awarii pasek celu stoi na 0%, jakby nikt nie wpłacił", async () => {
    const { root } = await renderWidget(
      { variant: "progress", goalCents: 100_00 },
      { tryb: "blad" },
    );
    expect(wypelnienia(root)).toEqual(["0%"]);
    expect(tekst(root)).toContain("(0%)");
  });

  it("DECYZJA: udany odczyt zastępuje zera kwotami ze zbiórki", async () => {
    const { root } = await renderWidget({ variant: "hero" }, { stats: ZEBRANE });
    expect(tekst(root)).toContain("250 zł");
    expect(tekst(root)).toContain("40 zł");
    expect(tekst(root)).toContain("7");
  });

  it("DEFEKT (przypięty): podczas WCZYTYWANIA widget maluje pełne „0 zł”, nie szkielet", async () => {
    const { root } = await renderWidget({ variant: "compact-card" }, { tryb: "wczytywanie" });
    expect(tekst(root)).toContain("0 zł");
    expect(tekst(root)).not.toContain("donationsWidget.loading");
  });

  it.fails("DEFEKT: podczas wczytywania POWINIEN pójść klucz donationsWidget.loading", async () => {
    // Klucz istnieje w słowniku w obu językach („Wczytywanie..." / „Loading...")
    // - stan wczytywania był zaprojektowany, komponent go gubi.
    const { root } = await renderWidget({ variant: "compact-card" }, { tryb: "wczytywanie" });
    expect(tekst(root)).toContain("donationsWidget.loading");
  });

  it.fails("DEFEKT: zbiórka bez wpłat POWINNA pokazać klucz donationsWidget.empty", async () => {
    // „Bądź pierwszym darczyńcą" / „Be the first to donate" - też zaprojektowane
    // i też nigdy nie renderowane.
    const { root } = await renderWidget({ variant: "hero" }, { stats: PUSTE });
    expect(tekst(root)).toContain("donationsWidget.empty");
  });

  it("MARTWE KLUCZE: słownik ma `loading` i `empty` w pl I en, kod widgetu nie woła żadnego", () => {
    const slownik = readFileSync("src/lib/i18n-donations-widget.ts", "utf8");
    expect(slownik.match(/loading:/g)).toHaveLength(2);
    expect(slownik.match(/empty:/g)).toHaveLength(2);

    const kod = [
      "src/components/donations/DonationsWidgetView.tsx",
      "src/components/donations/donationsWidgetModel.ts",
      "src/components/donations/atoms/DonationStatBox.tsx",
      "src/components/donations/atoms/DonationProgressBar.tsx",
      "src/components/donations/atoms/DonationRecentList.tsx",
    ]
      .map((p) => readFileSync(p, "utf8"))
      .join("\n");
    expect(kod).not.toContain("donationsWidget.loading");
    expect(kod).not.toContain("donationsWidget.empty");
    // Kontrola pozytywna: inne klucze tego samego słownika SĄ wołane, więc
    // powyższe „nie zawiera" nie jest artefaktem złej ścieżki.
    expect(kod).toContain("donationsWidget.total");
    expect(kod).toContain("donationsWidget.cta");
  });
});

// ---------------------------------------------------------------------------
describe("sześć wariantów wizualnych", () => {
  it("DECYZJA: brak `variant` renderuje hero - zapisane strony bez tego pola nie pustoszeją", async () => {
    const { root } = await renderWidget({}, { stats: ZEBRANE });
    expect(root.className).toContain("rounded-2xl");
    expect(tekst(root)).toContain("donationsWidget.defaultTitle(lng=pl)");
    expect(root.querySelector("a")?.getAttribute("href")).toBe("/support");
  });

  it("DECYZJA: nieznany wariant też degraduje do hero, a nie do pustki", async () => {
    // Zapisana strona z wariantem, którego już nie ma w rejestrze widgetu.
    const nieznany = "kosmiczny" as unknown as DonationsVariant;
    const { root } = await renderWidget({ variant: nieznany }, { stats: ZEBRANE });
    expect(root.className).toContain("rounded-2xl");
  });

  it.each(WARIANTY)(
    "DECYZJA: wariant %s renderuje kwotę zbiórki i JEDEN przycisk wsparcia",
    async (variant) => {
      const { root } = await renderWidget({ variant }, { stats: ZEBRANE });
      expect(tekst(root)).toContain("250 zł");
      expect(root.querySelectorAll("a")).toHaveLength(1);
      expect(tekst(root)).toContain("donationsWidget.cta");
    },
  );

  it.each(WARIANTY)(
    "DECYZJA: akcent z edytora jedzie w wariancie %s zmienną --donation-accent",
    async (variant) => {
      const zAkcentem = await renderWidget(
        { variant, accent: " #c0392b ", subtitle: "Wesprzyj nas", goalCents: 100_00 },
        { stats: ZEBRANE },
      );
      expect(zAkcentem.root.getAttribute("style")).toContain("--donation-accent: #c0392b");
      // inline-bar to jedyny wariant BEZ miejsca na podtytuł - osobny test niżej.
      if (variant !== "inline-bar") expect(tekst(zAkcentem.root)).toContain("Wesprzyj nas");
      cleanup();

      const bez = await renderWidget(
        { variant, showMonth: false, showCount: false },
        { stats: ZEBRANE },
      );
      expect(bez.root.getAttribute("style") ?? "").not.toContain("--donation-accent");
      expect(tekst(bez.root)).not.toContain("Wesprzyj nas");
    },
  );

  it("DECYZJA: hero pokazuje pasek celu TYLKO z celem, i podpisuje go procentem", async () => {
    const zCelem = await renderWidget({ variant: "hero", goalCents: 500_00 }, { stats: ZEBRANE });
    expect(wypelnienia(zCelem.root)).toEqual(["50%"]);
    expect(tekst(zCelem.root)).toContain("50% donationsWidget.of 500 zł");
    cleanup();
    const bezCelu = await renderWidget({ variant: "hero" }, { stats: ZEBRANE });
    expect(wypelnienia(bezCelu.root)).toEqual([]);
  });

  it("DECYZJA: inline-bar dokleja licznik darczyńców tylko, gdy ktoś już wpłacił", async () => {
    const zWplatami = await renderWidget({ variant: "inline-bar" }, { stats: ZEBRANE });
    expect(tekst(zWplatami.root)).toContain("7 donationswidget.donors");
    cleanup();
    const bezWplat = await renderWidget({ variant: "inline-bar" }, { stats: PUSTE });
    expect(tekst(bezWplat.root)).not.toContain("donationswidget.donors");
    cleanup();
    const wylaczony = await renderWidget(
      { variant: "inline-bar", showCount: false },
      { stats: ZEBRANE },
    );
    expect(tekst(wylaczony.root)).not.toContain("donationswidget.donors");
  });

  it("DECYZJA: stats-strip ma trzy kafle, a wyłączone przełączniki je USUWAJĄ, nie zerują", async () => {
    const pelny = await renderWidget({ variant: "stats-strip" }, { stats: ZEBRANE });
    expect(pelny.root.querySelectorAll(".bg-background\\/60")).toHaveLength(3);
    cleanup();
    const bezMiesiaca = await renderWidget(
      { variant: "stats-strip", showMonth: false },
      { stats: ZEBRANE },
    );
    expect(bezMiesiaca.root.querySelectorAll(".bg-background\\/60")).toHaveLength(2);
    expect(tekst(bezMiesiaca.root)).not.toContain("donationsWidget.thisMonth");
    cleanup();
    const goly = await renderWidget(
      { variant: "stats-strip", showMonth: false, showCount: false },
      { stats: ZEBRANE },
    );
    expect(goly.root.querySelectorAll(".bg-background\\/60")).toHaveLength(1);
  });

  it("DECYZJA: progress bez celu chowa wiersz „z <kwota>”, ale paska NIE chowa", async () => {
    const { root } = await renderWidget({ variant: "progress" }, { stats: ZEBRANE });
    expect(tekst(root)).not.toContain("donationsWidget.of");
    expect(wypelnienia(root)).toHaveLength(1);
  });

  it("DEFEKT (przypięty): bez celu pasek pokazuje LICZBĘ DARCZYŃCÓW × 5 jako procent", async () => {
    const siedmiu = await renderWidget({ variant: "progress" }, { stats: ZEBRANE });
    expect(wypelnienia(siedmiu.root)).toEqual(["35%"]); // 7 darczyńców
    cleanup();
    const dwudziestu = await renderWidget(
      { variant: "thermometer" },
      { stats: { ...ZEBRANE, count: 20 } },
    );
    // 20 wpłat po złotówce „wypełnia" termometr w 100%, choć celu nie ma wcale.
    expect(wypelnienia(dwudziestu.root)).toEqual(["100%"]);
    expect(tekst(dwudziestu.root)).not.toContain("100%");
  });

  it.fails("DEFEKT: bez celu pasek POWINIEN być pusty - liczba wpłat to nie postęp", async () => {
    const { root } = await renderWidget({ variant: "progress" }, { stats: ZEBRANE });
    expect(wypelnienia(root)).toEqual(["0%"]);
  });

  it("DECYZJA: progress chowa CAŁY wiersz statystyk, gdy oba przełączniki są wyłączone", async () => {
    const { root } = await renderWidget(
      { variant: "progress", showMonth: false, showCount: false },
      { stats: ZEBRANE },
    );
    expect(tekst(root)).not.toContain("donationsWidget.thisMonth");
    expect(tekst(root)).not.toContain("donationsWidget.donors");
    cleanup();
    const tylkoMiesiac = await renderWidget(
      { variant: "progress", showCount: false },
      { stats: ZEBRANE },
    );
    expect(tekst(tylkoMiesiac.root)).toContain("donationsWidget.thisMonth");
    expect(tekst(tylkoMiesiac.root)).not.toContain("donationsWidget.donors");
  });

  it("DECYZJA: termometr podpisuje procent tylko z celem; bez celu etykieta jest pusta", async () => {
    const zCelem = await renderWidget(
      { variant: "thermometer", goalCents: 1000_00 },
      { stats: ZEBRANE },
    );
    expect(tekst(zCelem.root)).toContain("25%");
    expect(tekst(zCelem.root)).toContain("donationsWidget.of 1000 zł");
    cleanup();
    const bezCelu = await renderWidget({ variant: "thermometer" }, { stats: ZEBRANE });
    expect(tekst(bezCelu.root)).not.toContain("%");
  });

  it("DEFEKT (przypięty): wariant inline-bar POŁYKA podtytuł wpisany w edytorze", async () => {
    // Podtytuł renderuje pięć wariantów na sześć. Panel widgetu pokazuje to
    // pole zawsze, więc w jednosliniowym pasku tekst znika bez ostrzeżenia.
    const { root } = await renderWidget(
      { variant: "inline-bar", subtitle: "Bez reklam, bez śledzenia" },
      { stats: ZEBRANE },
    );
    expect(tekst(root)).not.toContain("Bez reklam");
    cleanup();
    const compact = await renderWidget(
      { variant: "compact-card", subtitle: "Bez reklam, bez śledzenia" },
      { stats: ZEBRANE },
    );
    expect(tekst(compact.root)).toContain("Bez reklam");
  });

  it("DECYZJA: compact-card chowa wiersz miesiąca na `showMonth=false`", async () => {
    const { root } = await renderWidget(
      { variant: "compact-card", showMonth: false },
      { stats: ZEBRANE },
    );
    expect(tekst(root)).toContain("250 zł");
    expect(tekst(root)).not.toContain("donationsWidget.thisMonth");
  });
});

// ---------------------------------------------------------------------------
describe("konfiguracja z edytora CMS", () => {
  it("DECYZJA: `showRecent` renderuje listę wpłat w termometrze", async () => {
    const { root } = await renderWidget(
      { variant: "thermometer", showRecent: true },
      { stats: ZEBRANE },
    );
    expect(root.querySelectorAll("li")).toHaveLength(2);
    expect(tekst(root)).toContain("50 zł");
  });

  it("DECYZJA: bez `showRecent` termometr nie pokazuje listy wpłat", async () => {
    const { root } = await renderWidget({ variant: "thermometer" }, { stats: ZEBRANE });
    expect(root.querySelectorAll("li")).toHaveLength(0);
  });

  it("DECYZJA: `showRecent` z pustą listą wpłat nie zostawia pustego <ul>", async () => {
    const { root } = await renderWidget(
      { variant: "thermometer", showRecent: true },
      { stats: { ...ZEBRANE, recent: [] } },
    );
    expect(root.querySelectorAll("ul")).toHaveLength(0);
  });

  it("DEFEKT (przypięty): `showRecent` jest przyjmowane przez wszystkie warianty, honorowane przez JEDEN", async () => {
    for (const variant of WARIANTY.filter((v) => v !== "thermometer")) {
      const { root } = await renderWidget({ variant, showRecent: true }, { stats: ZEBRANE });
      expect(root.querySelectorAll("li")).toHaveLength(0);
      cleanup();
    }
  });

  it.fails(
    "DEFEKT: `showRecent` w wariancie hero POWINNO pokazać listę ostatnich wpłat",
    async () => {
      // Przełącznik jest w panelu widgetu dla każdego układu; w pięciu z sześciu
      // nie robi NIC, a redakcja nie ma jak tego zobaczyć poza podglądem.
      const { root } = await renderWidget(
        { variant: "hero", showRecent: true },
        { stats: ZEBRANE },
      );
      expect(root.querySelectorAll("li")).toHaveLength(2);
    },
  );

  it("DECYZJA: waluta z edytora BIJE walutę zbiórki - euro dostaje etykietę zł", async () => {
    const { root } = await renderWidget(
      { variant: "compact-card", currency: "PLN" },
      { stats: { ...ZEBRANE, currency: "EUR" } },
    );
    expect(tekst(root)).toContain("250 zł");
    expect(tekst(root)).not.toContain("€");
  });

  it("DECYZJA: bez propu waluty widget etykietuje kwoty walutą zbiórki", async () => {
    const { root } = await renderWidget(
      { variant: "compact-card" },
      { stats: { ...ZEBRANE, currency: "EUR" } },
    );
    expect(tekst(root)).toContain("250 €");
  });

  it("DECYZJA: własny tytuł, podtytuł i CTA z edytora wypierają domyślki", async () => {
    const { root } = await renderWidget(
      {
        variant: "hero",
        title: "  Zbiórka na redakcję  ",
        subtitle: "  Bez reklam  ",
        cta: "  Wpłacam  ",
      },
      { stats: ZEBRANE },
    );
    expect(tekst(root)).toContain("Zbiórka na redakcję");
    expect(tekst(root)).toContain("Bez reklam");
    expect(tekst(root)).toContain("Wpłacam");
    expect(tekst(root)).not.toContain("donationsWidget.defaultTitle");
    expect(tekst(root)).not.toContain("donationsWidget.cta");
  });

  it("DECYZJA: `quickDonate` z zapisanych stron nadal prowadzi do kasy, nie w martwy punkt", async () => {
    const { root } = await renderWidget(
      { variant: "inline-bar", quickDonate: true },
      { stats: ZEBRANE },
    );
    await waitFor(() => expect(root.querySelector("a")?.getAttribute("href")).toBe("/donate"));
  });

  it("DECYZJA: `mode=link` bije `quickDonate` i zostaje pod adresem z propa", async () => {
    const { root } = await renderWidget(
      { variant: "inline-bar", quickDonate: true, mode: "link", href: " /wspieraj " },
      { stats: ZEBRANE },
    );
    expect(root.querySelector("a")?.getAttribute("href")).toBe("/wspieraj");
  });

  it("DECYZJA: język interfejsu przełącza domyślny tytuł na angielski", async () => {
    const { root } = await renderWidget({ variant: "hero" }, { stats: ZEBRANE, jezyk: "en" });
    expect(tekst(root)).toContain("donationsWidget.defaultTitle(lng=en)");
  });

  it("DEFEKT (przypięty): interfejs „en-US” dostaje POLSKI tytuł zbiórki", async () => {
    const { root } = await renderWidget({ variant: "hero" }, { stats: ZEBRANE, jezyk: "en-US" });
    // Klucz jedzie z `lng=pl`, czyli anglojęzyczny czytelnik dostanie POLSKI
    // napis. Defekt jest w wyborze języka, nie w słowniku.
    expect(tekst(root)).toContain("donationsWidget.defaultTitle(lng=pl)");
  });

  it("DECYZJA: prop `lang` bije język interfejsu (osadzenie EN na stronie PL)", async () => {
    const { root } = await renderWidget(
      { variant: "hero", lang: "en" },
      { stats: ZEBRANE, jezyk: "pl" },
    );
    expect(tekst(root)).toContain("donationsWidget.defaultTitle(lng=en)");
  });
});
