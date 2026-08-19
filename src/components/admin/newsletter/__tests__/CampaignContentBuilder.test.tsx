// Kreator treści kampanii - lista bloków plus podgląd na żywo.
//
// NAJWAŻNIEJSZA RZECZ, KTÓREJ TU PILNUJEMY: podgląd używa DOKŁADNIE tego samego
// `renderEmailHtml` co wysyłka. Gdyby się rozjechał, redaktor zatwierdzałby
// treść, której odbiorca nie zobaczy - a kampanii nie da się odwołać. Dlatego
// test czyta `srcDoc` ramki podglądu i porównuje z wynikiem prawdziwego
// renderera, a nie tylko sprawdza, czy ramka istnieje.
//
// Pozostałe reguły:
//   * paleta dokłada blok WŁAŚCIWEGO typu i od razu go zaznacza,
//   * duplikat i usunięcie działają na tym bloku, na którym kliknięto,
//   * podgląd pyta serwer o „najnowsze wpisy" TYLKO wtedy, gdy dokument taki
//     blok ma, i rozwiązane wpisy faktycznie trafiają do maila,
//   * podgląd jest OPÓŹNIONY o 300 ms - przepisywanie ramki na każdy klawisz
//     migotałoby; test dowodzi i opóźnienia, i tego, że treść w końcu dochodzi,
//   * dokument bez treści w danym języku mówi to WPROST, zamiast pokazywać
//     puste okno.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const env = vi.hoisted(() => ({
  rowsByBlock: {} as Record<string, unknown[]>,
  resolveCalls: 0,
}));

/**
 * Uchwyt zakończenia przeciągania przechwycony z @dnd-kit. Prawdziwego
 * przeciągania myszą nie da się odtworzyć w happy-dom (dnd-kit liczy geometrię
 * z `getBoundingClientRect`, które zwraca zera), a to kolejność bloków decyduje
 * o układzie wychodzącego maila - więc wołamy uchwyt bezpośrednio, a dalej idzie
 * prawdziwy kod.
 */
const dnd = vi.hoisted(() => ({ onDragEnd: undefined as undefined | ((e: unknown) => void) }));

vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  const { createElement } = await import("react");
  const Real = actual.DndContext;
  return {
    ...actual,
    DndContext: (props: Record<string, unknown>) => {
      dnd.onDragEnd = props.onDragEnd as (e: unknown) => void;
      return createElement(Real, props as never);
    },
  };
});

// Rozwiązywanie bloku „najnowsze wpisy" idzie funkcją serwerową - atrapa.
// Żaden test nie wykonuje realnego żądania.
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => async () => {
    env.resolveCalls += 1;
    return { json: JSON.stringify(env.rowsByBlock) };
  },
}));
vi.mock("@/lib/newsletter-campaigns.functions", () => ({
  resolveCampaignDocPosts: {},
  searchCampaignPosts: {},
}));
vi.mock("@/components/admin/media/MediaPickerDialog", () => ({ MediaPickerDialog: () => null }));

import i18n from "@/lib/i18n";
import { CampaignContentBuilder } from "@/components/admin/newsletter/CampaignContentBuilder";
import { renderEmailHtml } from "@/lib/newsletter/renderEmailHtml";
import { postRefsForLang, type EmailPostRow } from "@/lib/newsletter/emailDocResolve";
import {
  createDefaultEmailDoc,
  createEmailBlock,
  EMAIL_BLOCK_TYPES,
  type EmailBlock,
  type EmailDoc,
  type EmailPostListBlock,
} from "@/lib/newsletter/emailDoc";
import { BLOCK_LABEL_KEYS } from "@/components/admin/newsletter/campaignBlocks";

/** Etykieta bloku ze słownika - test nie zależy od copy. */
const B = (key: string) => i18n.t(`adminNewsletter.blocks.${key}`);
const blockLabel = (type: EmailBlock["type"]) => i18n.t(BLOCK_LABEL_KEYS[type]);

function docOf(blocks: EmailBlock[]): EmailDoc {
  return { ...createDefaultEmailDoc(), blocks };
}

function block(type: EmailBlock["type"], overrides: Record<string, unknown> = {}): EmailBlock {
  return { ...createEmailBlock(type), ...overrides } as EmailBlock;
}

/**
 * Kreator w kształcie, w jakim żyje w formularzu kampanii: dokument należy do
 * rodzica, więc każda zmiana wraca przez `onChange` i odświeża podgląd.
 * Bez tego test sprawdzałby wywołania handlera, a nie skutek edycji.
 */
function Harness({
  initial,
  onDoc,
  initialLang = "pl",
}: {
  initial: EmailDoc;
  onDoc?: (d: EmailDoc) => void;
  initialLang?: "pl" | "en";
}) {
  const [doc, setDoc] = useState(initial);
  const [lang, setLang] = useState<"pl" | "en">(initialLang);
  return (
    <CampaignContentBuilder
      doc={doc}
      onChange={(next) => {
        setDoc(next);
        onDoc?.(next);
      }}
      previewLang={lang}
      onPreviewLangChange={setLang}
    />
  );
}

function mount(initial: EmailDoc, initialLang: "pl" | "en" = "pl") {
  const onDoc = vi.fn<(d: EmailDoc) => void>();
  const utils = renderWithQueryClient(
    <Harness initial={initial} onDoc={onDoc} initialLang={initialLang} />,
  );
  return { ...utils, onDoc };
}

/**
 * Wiersze listy bloków. Podpis wiersza to ta sama nazwa typu co na przycisku
 * palety, więc szukanie po tekście byłoby niejednoznaczne - zakotwiczamy się na
 * uchwycie przenoszenia, który ma etykietę dostępności.
 */
function rows(): HTMLElement[] {
  return screen.getAllByLabelText(B("drag")).map((handle) => handle.parentElement as HTMLElement);
}

function rowLabel(index: number): string {
  return rows()[index]!.querySelectorAll("button")[1]!.textContent?.trim() ?? "";
}

function clickRow(index: number): void {
  fireEvent.click(rows()[index]!.querySelectorAll("button")[1]!);
}

/** Zawartość ramki podglądu. */
function previewHtml(): string {
  const frame = screen.getByTitle(B("previewFrameTitle")) as HTMLIFrameElement;
  return frame.getAttribute("srcdoc") ?? "";
}

/** Zdarzenie zakończenia przeciągania w kształcie, jaki widzi kreator. */
function dragEnd(activeId: string, overId: string | null) {
  act(() => {
    dnd.onDragEnd!({ active: { id: activeId }, over: overId === null ? null : { id: overId } });
  });
}

/** Ostatni dokument, jaki kreator oddał rodzicowi. */
function lastDoc(onDoc: ReturnType<typeof vi.fn>): EmailDoc {
  return onDoc.mock.calls.at(-1)![0] as EmailDoc;
}

beforeAll(async () => {
  await i18n.changeLanguage("pl");
});

beforeEach(() => {
  env.rowsByBlock = {};
  env.resolveCalls = 0;
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
describe("paleta bloków", () => {
  it("ma przycisk dla KAŻDEGO typu bloku - brakujący typ jest nieosiągalny", () => {
    mount(docOf([]));

    for (const type of EMAIL_BLOCK_TYPES) {
      expect(screen.getByText(blockLabel(type)), `brak przycisku dla ${type}`).toBeTruthy();
    }
    expect(EMAIL_BLOCK_TYPES.length).toBeGreaterThan(5);
  });

  it("kliknięcie dokłada blok WŁAŚCIWEGO typu na koniec dokumentu", () => {
    const { onDoc } = mount(docOf([block("heading", { id: "h1" })]));

    fireEvent.click(screen.getByText(blockLabel("quote")));

    expect(lastDoc(onDoc).blocks.map((b) => b.type)).toEqual(["heading", "quote"]);
  });

  it("dołożony blok jest od razu ZAZNACZONY - redaktor wpisuje treść bez szukania", () => {
    mount(docOf([]));

    fireEvent.click(screen.getByText(blockLabel("quote")));

    expect(screen.getByText(`${B("properties")}: ${blockLabel("quote")}`)).toBeTruthy();
    // Panel należy do cytatu: treść jest wielolinijkowa, autor jednolinijkowy.
    const pl = screen.getAllByPlaceholderText("PL");
    expect(pl.map((el) => el.tagName)).toEqual(["TEXTAREA", "INPUT"]);
  });

  it("pusty dokument ZAPRASZA do dodania bloku, zamiast pokazywać nic", () => {
    mount(docOf([]));

    expect(screen.getByText(B("emptyDocument"))).toBeTruthy();
    expect(screen.queryByLabelText(B("drag"))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("lista bloków", () => {
  const trzy = () => [
    block("heading", { id: "h", text: { pl: "Tytuł", en: "Title" } }),
    block("paragraph", { id: "p" }),
    block("divider", { id: "d" }),
  ];

  it("każdy blok ma podpis typu i uchwyt przenoszenia", () => {
    mount(docOf(trzy()));

    expect(rows()).toHaveLength(3);
    expect([rowLabel(0), rowLabel(1), rowLabel(2)]).toEqual([
      blockLabel("heading"),
      blockLabel("paragraph"),
      blockLabel("divider"),
    ]);
  });

  it("PIERWSZY blok jest zaznaczony na wejściu - panel nie startuje pusty", () => {
    mount(docOf(trzy()));

    expect(screen.getByText(`${B("properties")}: ${blockLabel("heading")}`)).toBeTruthy();
  });

  it("kliknięcie podpisu przestawia panel na ten blok", () => {
    mount(docOf(trzy()));

    clickRow(2);

    expect(screen.getByText(`${B("properties")}: ${blockLabel("divider")}`)).toBeTruthy();
    expect(screen.getByText(i18n.t("adminNewsletter.blockProps.dividerHint"))).toBeTruthy();
  });

  it("duplikat dotyczy TEGO bloku, na którym kliknięto", () => {
    const { onDoc } = mount(docOf(trzy()));

    fireEvent.click(screen.getAllByLabelText(B("duplicate"))[2]!);

    const types = lastDoc(onDoc).blocks.map((b) => b.type);
    expect(types).toEqual(["heading", "paragraph", "divider", "divider"]);
  });

  it("kopia ma INNY identyfikator niż oryginał", () => {
    const { onDoc } = mount(docOf(trzy()));

    fireEvent.click(screen.getAllByLabelText(B("duplicate"))[0]!);

    const ids = lastDoc(onDoc).blocks.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[1]).not.toBe("h");
  });

  it("usunięcie wycina jeden blok", () => {
    const { onDoc } = mount(docOf(trzy()));

    fireEvent.click(screen.getAllByLabelText(B("remove"))[1]!);

    expect(lastDoc(onDoc).blocks.map((b) => b.id)).toEqual(["h", "d"]);
  });

  it("usunięcie ZAZNACZONEGO bloku zamyka jego panel", () => {
    // Panel pokazujący blok, którego już nie ma, kończy się patchem w nicość.
    mount(docOf(trzy()));
    expect(screen.getByText(`${B("properties")}: ${blockLabel("heading")}`)).toBeTruthy();

    fireEvent.click(screen.getAllByLabelText(B("remove"))[0]!);

    expect(screen.queryByText(new RegExp(`^${B("properties")}`))).toBeNull();
  });

  it("edycja w panelu właściwości trafia do dokumentu", () => {
    const { onDoc } = mount(docOf(trzy()));

    fireEvent.change(screen.getByDisplayValue("Tytuł"), { target: { value: "Nowy tytuł" } });

    const heading = lastDoc(onDoc).blocks[0] as { text: { pl: string; en: string } };
    expect(heading.text).toEqual({ pl: "Nowy tytuł", en: "Title" });
  });

  it("podpisy bloków idą za językiem interfejsu", async () => {
    await i18n.changeLanguage("en");
    try {
      mount(docOf([block("divider", { id: "d" })]));

      expect(rowLabel(0)).toBe(i18n.t(BLOCK_LABEL_KEYS.divider));
      expect(screen.getByLabelText(i18n.t("adminNewsletter.blocks.remove"))).toBeTruthy();
    } finally {
      await i18n.changeLanguage("pl");
    }
  });
});

// ---------------------------------------------------------------------------
describe("podgląd na żywo", () => {
  const heading = () => [
    block("heading", { id: "h", text: { pl: "Tytuł wydania", en: "Issue title" } }),
  ];

  it("ramka podglądu zawiera DOKŁADNIE to, co wyrenderuje wysyłka", () => {
    // To jest sedno: gdyby podgląd miał własny renderer, redaktor zatwierdzałby
    // treść, której odbiorca nie zobaczy.
    const doc = docOf(heading());
    mount(doc);

    const oczekiwane = renderEmailHtml(doc, "pl", { postsByBlock: {} });
    expect(previewHtml()).toContain(oczekiwane);
    expect(previewHtml()).toContain("Tytuł wydania");
  });

  it("przełącznik języka zmienia treść podglądu, nie tylko przycisk", () => {
    mount(docOf(heading()));
    expect(previewHtml()).toContain("Tytuł wydania");

    fireEvent.click(screen.getByText("EN"));

    expect(previewHtml()).toContain("Issue title");
    expect(previewHtml()).not.toContain("Tytuł wydania");
  });

  it("powrót na polski też przełącza treść", () => {
    mount(docOf(heading()), "en");
    expect(previewHtml()).toContain("Issue title");

    fireEvent.click(screen.getByText("PL"));

    expect(previewHtml()).toContain("Tytuł wydania");
    expect(previewHtml()).not.toContain("Issue title");
  });

  it("ramka jest w PIASKOWNICY - podgląd nie wykonuje niczego z treści maila", () => {
    mount(docOf(heading()));

    const frame = screen.getByTitle(B("previewFrameTitle"));
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.tagName).toBe("IFRAME");
  });

  it("dokument bez treści w TYM języku mówi to wprost", () => {
    // Puste okno podglądu redaktor czyta jako awarię panelu.
    mount(docOf([block("heading", { id: "h", text: { pl: "Tytuł", en: "" } })]), "en");

    expect(screen.getByText(B("noContentInLang"))).toBeTruthy();
    expect(screen.queryByTitle(B("previewFrameTitle"))).toBeNull();
  });

  it("podgląd jest OPÓŹNIONY o 300 ms, a potem dogania treść", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mount(docOf(heading()));

      fireEvent.change(screen.getByDisplayValue("Tytuł wydania"), {
        target: { value: "Zupełnie nowy" },
      });
      // Zaraz po naciśnięciu klawisza ramka pokazuje jeszcze starą treść.
      expect(previewHtml()).toContain("Tytuł wydania");

      await act(async () => {
        vi.advanceTimersByTime(350);
      });

      expect(previewHtml()).toContain("Zupełnie nowy");
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
describe("blok najnowszych wpisów w podglądzie", () => {
  const WPIS: EmailPostRow = {
    id: "p1",
    slug: "analiza-eu",
    title_pl: "Analiza EU",
    title_en: "EU analysis",
    excerpt_pl: "Zajawka polska",
    excerpt_en: "English excerpt",
    cover_image_url: null,
  };

  function withPostList() {
    return docOf([
      {
        ...(createEmailBlock("post-list") as EmailPostListBlock),
        id: "pl1",
        heading: { pl: "Najnowsze", en: "Latest" },
      } as EmailBlock,
    ]);
  }

  it("dokument BEZ takiego bloku nie pyta serwera o wpisy", () => {
    mount(docOf([block("heading", { id: "h", text: { pl: "Tytuł", en: "Title" } })]));

    expect(env.resolveCalls).toBe(0);
    expect(previewHtml()).toContain("Tytuł");
  });

  it("dokument Z takim blokiem pobiera wpisy i WSTAWIA je do maila", async () => {
    env.rowsByBlock = { pl1: [WPIS] };
    mount(withPostList());

    await waitFor(() => expect(previewHtml()).toContain("Analiza EU"));
    expect(env.resolveCalls).toBeGreaterThan(0);
  });

  it("wpisy w podglądzie idą za językiem - razem z linkiem", async () => {
    env.rowsByBlock = { pl1: [WPIS] };
    mount(withPostList(), "en");

    await waitFor(() => expect(previewHtml()).toContain("EU analysis"));
    // Angielski wariant serwisu ma prefiks /en - inny link niż w polskim mailu.
    expect(previewHtml()).toContain("/en/");
  });

  it("podgląd wpisów przechodzi tym samym rozwiązywaniem, co wysyłka", async () => {
    env.rowsByBlock = { pl1: [WPIS] };
    const doc = withPostList();
    mount(doc);
    await waitFor(() => expect(previewHtml()).toContain("Analiza EU"));

    // Adresy w mailu są budowane z ORIGINU panelu - podgląd i wysyłka muszą
    // przejść tym samym `postRefsForLang`, inaczej linki różniłyby się prefiksem.
    const postsByBlock = postRefsForLang({ pl1: [WPIS] }, window.location.origin, "pl");
    expect(previewHtml()).toContain(renderEmailHtml(doc, "pl", { postsByBlock }));
  });

  it("gdy wpisy się nie rozwiążą, panel MÓWI o braku treści, nie pokazuje pustej ramki", async () => {
    // Blok „najnowsze wpisy" bez wpisów nie renderuje się wcale, więc dokument
    // składający się tylko z niego daje pusty mail. Redaktor musi to zobaczyć
    // przed wysyłką, a nie po.
    env.rowsByBlock = {};
    mount(withPostList());

    await waitFor(() => expect(env.resolveCalls).toBeGreaterThan(0));
    expect(screen.getByText(B("noContentInLang"))).toBeTruthy();
    expect(screen.queryByTitle(B("previewFrameTitle"))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("przestawianie bloków przeciąganiem", () => {
  const trzy = () => [
    block("heading", { id: "h" }),
    block("paragraph", { id: "p" }),
    block("divider", { id: "d" }),
  ];

  it("upuszczenie na inny blok zmienia KOLEJNOŚĆ dokumentu", () => {
    // Kolejność bloków to układ wychodzącego maila.
    const { onDoc } = mount(docOf(trzy()));

    dragEnd("h", "d");

    expect(lastDoc(onDoc).blocks.map((b) => b.id)).toEqual(["p", "d", "h"]);
  });

  it("nowa kolejność jest widoczna na LIŚCIE, nie tylko w dokumencie", () => {
    mount(docOf(trzy()));

    dragEnd("d", "h");

    expect([rowLabel(0), rowLabel(1), rowLabel(2)]).toEqual([
      blockLabel("divider"),
      blockLabel("heading"),
      blockLabel("paragraph"),
    ]);
  });

  it("upuszczenie POZA listą nie zapisuje nowego stanu formularza", () => {
    // Zapis bez zmiany zapalałby przycisk „zapisz" bez powodu.
    const { onDoc } = mount(docOf(trzy()));

    dragEnd("h", null);

    expect(onDoc).not.toHaveBeenCalled();
    expect(rowLabel(0)).toBe(blockLabel("heading"));
  });

  it("upuszczenie NA SIEBIE nic nie zmienia", () => {
    const { onDoc } = mount(docOf(trzy()));

    dragEnd("h", "h");

    expect(onDoc).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(3);
  });
});
