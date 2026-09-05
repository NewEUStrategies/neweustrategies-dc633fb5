// Panel CMS „Warte przeczytania” (`TrendingTickerPane`) - FORMULARZ KONFIGURACJI.
//
// CO TEN PLIK PRZYPINA I DLACZEGO. Panel nie ma „zapisz i zobacz” - redakcja
// widzi skutek klawisza od razu w podglądzie, bo panel przepycha KAŻDĄ zmianę do
// `<TrendingTicker>` (i do prawdziwego nagłówka przez most draftu). Dlatego
// świadkiem każdego kliknięcia są PROPY PODGLĄDU, a nie klasa CSS zaznaczonego
// przycisku: klasa mówi tylko, co się podświetliło, propy mówią, co naprawdę
// pojedzie na stronę.
//
// Trzy grupy kontraktów:
//   1. WIDOCZNOŚĆ PÓL ZALEŻY OD ŹRÓDŁA I STYLU. Okres trendingu ma sens tylko
//      dla „najczęściej czytane” i miksu, liczniki nie dotyczą przypięcia i
//      wyboru ręcznego, style typu marquee mają WŁASNĄ animację (więc tryb
//      prezentacji jest wtedy chowany razem z wyjaśnieniem), a szybkość
//      przewijania pojawia się wyłącznie dla układów jadących POZIOMO.
//   2. ZACISKI WARTOŚCI LICZBOWYCH. Pola liczbowe przepuszczają wszystko, co
//      wpisze redaktor, więc panel przycina je w miejscu zmiany. Test sprawdza
//      OBA końce (a tam, gdzie zacisku brakuje, stoi `it.fails` opisujący defekt).
//   3. ETYKIETY I PRZEŁĄCZNIKI jadą do podglądu bez normalizacji - to one
//      decydują o napisie i szerokości paska w nagłówku.
//
// GRANICA ATRAP: identyczna jak w `TrendingTickerPane.variants.test.tsx` -
// klient Supabase, toasty, przełącznik Radix, podgląd paska i próbnik kolorów.
// Logika panelu (stan, warianty, historia) jest PRAWDZIWA.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { ok, supabaseFromStub } from "@/test/supabase";
import type { RecordedChain, SupabaseResult } from "@/test/supabase";
import type { TickerPreviewSink } from "@/test/ticker/tickerPaneStubs";
import type { LayoutStyle } from "@/lib/views/tickerVariants";
import type { TickerSettings } from "@/lib/views/tickerVariants";

interface SavedRow {
  key: string;
  value: Record<string, unknown>;
}

const h = vi.hoisted(() => ({
  language: "pl",
  headerValue: {} as Record<string, unknown>,
  saved: [] as SavedRow[],
  toastSuccess: vi.fn<(message: string) => void>(),
  toastInfo: vi.fn<(message: string) => void>(),
  toastErrorToast: vi.fn<(message: string) => void>(),
  toastError: vi.fn<(error: unknown, kind: string) => void>(),
  preview: { renders: [], mounts: 0 } as TickerPreviewSink,
  from: null as ((table: string) => unknown) | null,
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.language),
);

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string): unknown => {
      if (!h.from) throw new Error(`test: atrapa supabase nie ma łańcucha dla "${table}"`);
      return h.from(table);
    },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: h.toastSuccess, info: h.toastInfo, error: h.toastErrorToast },
  Toaster: () => null,
}));

vi.mock("@/lib/toastError", () => ({ toastError: h.toastError }));

vi.mock("@/components/ui/switch", async () =>
  (await import("@/test/reactStubs")).radixSwitchStub(await import("react")),
);

vi.mock("@/components/header/TrendingTicker", async () =>
  (await import("@/test/ticker/tickerPaneStubs")).trendingTickerStub(
    await import("react"),
    h.preview,
  ),
);

vi.mock("@/components/admin/blocks/AdminColorPicker", async () =>
  (await import("@/test/ticker/tickerPaneStubs")).adminColorPickerStub(await import("react")),
);

import { TrendingTickerPane } from "@/components/admin/TrendingTickerPane";

const db = supabaseFromStub();
h.from = db.from;

const HEADER_KEY = ["site_settings", "header"];
const POSTS_KEY = ["ticker_post_options"];

function headerResponder(chain: RecordedChain): SupabaseResult {
  const upsert = chain.argsOf("upsert");
  if (upsert) {
    const row = upsert[0] as SavedRow;
    h.saved.push(row);
    h.headerValue = row.value;
    return ok(null);
  }
  return ok({ value: h.headerValue });
}

async function renderPane() {
  const view = renderWithQueryClient(<TrendingTickerPane />);
  await waitFor(() => {
    expect(view.queryClient.getQueryState(HEADER_KEY)?.status).not.toBe("pending");
    expect(view.queryClient.getQueryState(POSTS_KEY)?.status).not.toBe("pending");
  });
  return view;
}

/**
 * Sekcja formularza wskazana etykietą. Przyciski wyboru (źródło, styl, tryb,
 * kierunek, wypełnienie) nie mają własnej roli grupy, a ich NAPISY się powtarzają
 * („Najczęściej czytane” jest i źródłem, i wypełnieniem miksu), więc każde
 * kliknięcie musi być zawężone do swojej sekcji.
 */
function group(labelText: string): HTMLElement {
  const container = screen.getByText(labelText).parentElement;
  if (!container) throw new Error(`test: etykieta "${labelText}" nie ma kontenera sekcji`);
  return container;
}

function pick(labelText: string, buttonName: string): void {
  fireEvent.click(within(group(labelText)).getByRole("button", { name: buttonName }));
}

/** Ostatnie propy, jakie panel przekazał podglądowi paska. */
function preview() {
  const last = h.preview.renders.at(-1);
  if (!last) throw new Error("test: podgląd paska nie został wyrenderowany");
  return last;
}

function savedConfig(): TickerSettings {
  const row = h.saved.at(-1);
  if (!row) throw new Error("test: nie zapisano żadnego wiersza site_settings");
  return row.value.trending as TickerSettings;
}

function setNumber(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

beforeEach(() => {
  db.reset();
  db.setResponse("site_settings", headerResponder);
  db.setResponse("posts", () => ok([{ id: "post-alfa", title_pl: "Alfa", title_en: "Alpha" }]));
  h.language = "pl";
  h.headerValue = {};
  h.saved.length = 0;
  h.preview.renders.length = 0;
  h.preview.mounts = 0;
  vi.clearAllMocks();
});

describe("TrendingTickerPane - źródło wpisów", () => {
  it("źródło „najnowsze” chowa okres trendingu, ale zostawia liczbę wpisów", async () => {
    await renderPane();
    expect(screen.getByLabelText("Okres dla trendingu (dni)")).toBeInTheDocument();

    pick("Źródło wpisów", "Najnowsze");

    expect(preview().source).toBe("latest");
    expect(screen.queryByLabelText("Okres dla trendingu (dni)")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Liczba wpisów")).toBeInTheDocument();
  });

  it("źródło „przypięty wpis” chowa oba liczniki i odsłania blok przypięcia", async () => {
    await renderPane();

    pick("Źródło wpisów", "Przypięty wpis");

    expect(preview().source).toBe("pinned");
    expect(screen.queryByLabelText("Okres dla trendingu (dni)")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Liczba wpisów")).not.toBeInTheDocument();
    expect(screen.getByLabelText("ID przypiętego wpisu (UUID)")).toBeInTheDocument();
    expect(screen.getByText("Wyświetlaj do (data i godzina)")).toBeInTheDocument();
    expect(screen.queryByText("Załączone materiały (max 3)")).not.toBeInTheDocument();
  });

  it("źródło „wybrane materiały” pokazuje pustą listę załączonych", async () => {
    await renderPane();

    pick("Źródło wpisów", "Wybrane materiały");

    expect(preview().source).toBe("selected");
    expect(screen.getByText("Załączone materiały (max 3)")).toBeInTheDocument();
    expect(screen.getByText("Nie wybrano żadnego wpisu.")).toBeInTheDocument();
    expect(screen.queryByLabelText("ID przypiętego wpisu (UUID)")).not.toBeInTheDocument();
  });

  it("miks łączy przypięcie z listą, dokłada wypełnienie i NIE pokazuje daty ważności", async () => {
    await renderPane();

    pick("Źródło wpisów", "Miks (przypięte + wypełnienie)");

    expect(preview().source).toBe("mixed");
    expect(screen.getByLabelText("Okres dla trendingu (dni)")).toBeInTheDocument();
    expect(screen.getByLabelText("Liczba wpisów")).toBeInTheDocument();
    expect(screen.getByLabelText("ID przypiętego wpisu (UUID)")).toBeInTheDocument();
    expect(screen.getByText("Załączone materiały (max 3)")).toBeInTheDocument();
    expect(screen.queryByText("Wyświetlaj do (data i godzina)")).not.toBeInTheDocument();
  });

  it("wypełnienie miksu przełącza się niezależnie od źródła o tej samej nazwie", async () => {
    await renderPane();
    pick("Źródło wpisów", "Miks (przypięte + wypełnienie)");

    pick("Wypełnienie po przypiętych", "Najnowsze");

    expect(preview().source).toBe("mixed");
    expect(preview().mixedFill).toBe("latest");

    pick("Wypełnienie po przypiętych", "Najczęściej czytane");
    expect(preview().mixedFill).toBe("trending");
  });

  it("powrót na „najczęściej czytane” przywraca okres trendingu", async () => {
    await renderPane();
    pick("Źródło wpisów", "Przypięty wpis");

    pick("Źródło wpisów", "Najczęściej czytane");

    expect(preview().source).toBe("trending");
    expect(screen.getByLabelText("Okres dla trendingu (dni)")).toBeInTheDocument();
  });
});

describe("TrendingTickerPane - styl paska", () => {
  const STYLES: ReadonlyArray<[string, LayoutStyle]> = [
    ["Klasyczny (ikona + tekst)", "classic"],
    ["Badge marquee (kolorowy blok)", "badge"],
    ["Marquee szklane (płynny, poziomy)", "glassMarquee"],
    ["Szklane karty (rotacja pionowa)", "glassCards"],
    ["Wstążka gradientowa (poziomy)", "glassRibbon"],
    ["Reflektor (rotacja pionowa)", "glassSpotlight"],
    ["Taśma newsowa (mono, poziomy)", "glassTape"],
    ['Widget "Warte przeczytania" (badge + autor)', "glassLive"],
  ];

  it("każdy z ośmiu stylów trafia do podglądu pod swoim identyfikatorem", async () => {
    await renderPane();

    for (const [label, style] of STYLES) {
      pick("Styl paska", label);
      expect(preview().layoutStyle).toBe(style);
    }
  });

  it("style z własną animacją chowają tryb prezentacji i tłumaczą dlaczego", async () => {
    await renderPane();
    expect(within(group("Tryb animacji")).getAllByRole("button")).toHaveLength(5);

    pick("Styl paska", "Marquee szklane (płynny, poziomy)");

    expect(screen.queryByText("Tryb animacji")).not.toBeInTheDocument();
    expect(
      screen.getByText("Ten styl ma własną animację - tryb prezentacji nie ma tu zastosowania."),
    ).toBeInTheDocument();
  });

  it("badge zostaje przy trybie prezentacji (nie jest układem marquee)", async () => {
    await renderPane();

    pick("Styl paska", "Badge marquee (kolorowy blok)");

    expect(screen.getByText("Tryb animacji")).toBeInTheDocument();
    expect(preview().layoutStyle).toBe("badge");
  });

  it("glassLive dokłada kierunek ruchu, a poziomy odsłania szybkość przewijania", async () => {
    await renderPane();
    expect(screen.queryByLabelText("Szybkość przewijania (px/s)")).not.toBeInTheDocument();

    pick("Styl paska", 'Widget "Warte przeczytania" (badge + autor)');
    expect(screen.getByText("Kierunek ruchu")).toBeInTheDocument();
    // Pionowy slide to wartość domyślna - szybkość marquee jeszcze nie ma sensu.
    expect(screen.queryByLabelText("Szybkość przewijania (px/s)")).not.toBeInTheDocument();

    pick("Kierunek ruchu", "Poziomy marquee");

    expect(preview().liveDirection).toBe("horizontal");
    expect(screen.getByLabelText("Szybkość przewijania (px/s)")).toBeInTheDocument();

    pick("Kierunek ruchu", "Pionowy slide");
    expect(preview().liveDirection).toBe("vertical");
    expect(screen.queryByLabelText("Szybkość przewijania (px/s)")).not.toBeInTheDocument();
  });

  it("układy rotujące pionowo nie dostają szybkości przewijania", async () => {
    await renderPane();

    pick("Styl paska", "Szklane karty (rotacja pionowa)");
    expect(screen.queryByLabelText("Szybkość przewijania (px/s)")).not.toBeInTheDocument();

    pick("Styl paska", "Reflektor (rotacja pionowa)");
    expect(screen.queryByLabelText("Szybkość przewijania (px/s)")).not.toBeInTheDocument();

    pick("Styl paska", "Taśma newsowa (mono, poziomy)");
    expect(screen.getByLabelText("Szybkość przewijania (px/s)")).toBeInTheDocument();
  });
});

describe("TrendingTickerPane - tryb prezentacji", () => {
  it("każdy z pięciu trybów trafia do podglądu", async () => {
    await renderPane();

    const modes: ReadonlyArray<[string, string]> = [
      ["Przenikanie (fade)", "fade"],
      ["Wysuwanie z dołu", "slide"],
      ["Obrót 3D (flip)", "flip"],
      ["Maszyna do pisania", "typewriter"],
      ["Przewijanie w pętli", "scroll"],
    ];

    for (const [label, mode] of modes) {
      pick("Tryb animacji", label);
      expect(preview().mode).toBe(mode);
    }
  });
});

describe("TrendingTickerPane - pola liczbowe", () => {
  it("okres trendingu i liczba wpisów mają dolny zacisk na jedynce", async () => {
    await renderPane();

    setNumber("Okres dla trendingu (dni)", "30");
    setNumber("Liczba wpisów", "12");
    expect(preview().days).toBe(30);
    expect(preview().limit).toBe(12);

    setNumber("Okres dla trendingu (dni)", "0");
    setNumber("Liczba wpisów", "");
    expect(preview().days).toBe(1);
    expect(preview().limit).toBe(1);
  });

  it("liczba widocznych newsów jest przycięta do zakresu 1-5", async () => {
    await renderPane();

    setNumber("Ile newsów widocznych jednocześnie", "3");
    expect(preview().visibleCount).toBe(3);

    setNumber("Ile newsów widocznych jednocześnie", "9");
    expect(preview().visibleCount).toBe(5);

    setNumber("Ile newsów widocznych jednocześnie", "0");
    expect(preview().visibleCount).toBe(1);
  });

  it("interwał rotacji nie schodzi poniżej dwóch sekund", async () => {
    await renderPane();

    setNumber("Co ile sekund zmieniać komunikat", "15");
    expect(preview().intervalSec).toBe(15);

    setNumber("Co ile sekund zmieniać komunikat", "1");
    expect(preview().intervalSec).toBe(2);

    setNumber("Co ile sekund zmieniać komunikat", "");
    expect(preview().intervalSec).toBe(2);
  });

  it("szybkość przewijania jest przycięta do zakresu 10-400", async () => {
    await renderPane();
    pick("Styl paska", "Marquee szklane (płynny, poziomy)");

    setNumber("Szybkość przewijania (px/s)", "200");
    expect(preview().scrollSpeed).toBe(200);

    setNumber("Szybkość przewijania (px/s)", "900");
    expect(preview().scrollSpeed).toBe(400);

    setNumber("Szybkość przewijania (px/s)", "1");
    expect(preview().scrollSpeed).toBe(10);

    setNumber("Szybkość przewijania (px/s)", "");
    expect(preview().scrollSpeed).toBe(60);
  });

  // DEFEKT (rejestr). Pola „ile newsów” i „szybkość przewijania” przycinają
  // wartość Z GÓRY (`Math.min`), a trzy pozostałe pola liczbowe - nie, mimo że
  // deklarują `max` w atrybucie: dni max=90, liczba wpisów max=30, interwał
  // max=120. Skutek nie jest kosmetyczny: do bazy jedzie 999, redaktor widzi w
  // formularzu 999, a `normalizeTickerConfig` po ponownym wczytaniu ścina to po
  // cichu do 90/50/120 - czyli zapisana wartość różni się od działającej.
  it.fails("DEFEKT: dni, liczba wpisów i interwał nie mają górnego zacisku", async () => {
    await renderPane();

    setNumber("Okres dla trendingu (dni)", "999");
    setNumber("Liczba wpisów", "999");
    setNumber("Co ile sekund zmieniać komunikat", "999");

    expect(preview().days).toBeLessThanOrEqual(90);
    expect(preview().limit).toBeLessThanOrEqual(30);
    expect(preview().intervalSec).toBeLessThanOrEqual(120);
  });
});

describe("TrendingTickerPane - etykiety i przełączniki", () => {
  it("obie etykiety paska jadą do podglądu osobno", async () => {
    await renderPane();

    fireEvent.change(screen.getByLabelText("Etykieta (PL)"), {
      target: { value: "Warto przeczytać" },
    });
    fireEvent.change(screen.getByLabelText("Etykieta (EN)"), { target: { value: "Hot now" } });

    expect(preview().labelPl).toBe("Warto przeczytać");
    expect(preview().labelEn).toBe("Hot now");
    expect(screen.getByLabelText("Etykieta (PL)")).toHaveAttribute(
      "placeholder",
      "Warte przeczytania",
    );
  });

  it("pełna szerokość jest domyślnie włączona i da się ją wyłączyć", async () => {
    await renderPane();
    expect(screen.getByLabelText("Pełna szerokość")).toBeChecked();
    expect(preview().fullWidth).toBe(true);

    fireEvent.click(screen.getByLabelText("Pełna szerokość"));

    expect(preview().fullWidth).toBe(false);
    expect(screen.getByLabelText("Pełna szerokość")).not.toBeChecked();
  });

  it("komplet ustawień formularza jedzie do bazy jednym zapisem", async () => {
    await renderPane();

    pick("Źródło wpisów", "Najnowsze");
    pick("Styl paska", "Wstążka gradientowa (poziomy)");
    setNumber("Liczba wpisów", "4");
    setNumber("Ile newsów widocznych jednocześnie", "2");
    fireEvent.change(screen.getByLabelText("Etykieta (EN)"), { target: { value: "Hot now" } });
    fireEvent.click(screen.getByLabelText("Pełna szerokość"));

    fireEvent.click(screen.getByRole("button", { name: /^Zapis/ }));

    await waitFor(() => expect(h.saved).toHaveLength(1));
    const settings = savedConfig();
    expect(settings.variants).toHaveLength(1);
    expect(settings.activeVariantId).toBe(settings.variants[0].id);
    expect(settings.variants[0].config).toMatchObject({
      source: "latest",
      layoutStyle: "glassRibbon",
      limit: 4,
      visibleCount: 2,
      labelEn: "Hot now",
      fullWidth: false,
    });
  });
});
