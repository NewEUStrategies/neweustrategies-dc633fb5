// EDYTORY BLOKÓW: napisy panelu ze słownika (PL/EN), a etykieta nowego
// przycisku - w języku DOKUMENTU.
//
// CO BYŁO ŹLE. Sześć edytorów miało napisy wpisane w kod zamiast kluczy
// `blocks.editors.<blok>.*`: nagłówki „Social Icons", „Latest Posts", „Review
// Box" (angielskie w polskim panelu), „Dodaj", placeholder sluga kategorii,
// „Miniatura"/„Zajawka", WSZYSTKIE komunikaty bloku ankiety i placeholder URL-a
// audio (polskie w angielskim panelu). Redaktor z panelem EN czytał polszczyznę
// akurat tam, gdzie edytor mówi mu, co się stanie na stronie („to szkic",
// „ankieta już nie istnieje").
//
// ETYKIETA NOWEGO PRZYCISKU TO DANE, NIE NAPIS PANELU. „Dodaj" w grupie
// przycisków dopisywał pozycję `{ label: "Button" }` - po angielsku także
// w polskim dokumencie, a strona publiczna (`renderButtons`) rysuje tę etykietę
// czytelnikowi. Wzorzec repo dla treści wstawianej do dokumentu ustalają wzorce
// bloków (`lib/blocks/patterns.ts`): treść powstaje w języku AKTYWNEGO
// DOKUMENTU (`useBlockEditorLang`), nie w języku panelu - dokumenty PL i EN są
// rozdzielone, a redaktor z panelem EN często składa polski wpis. Dlatego
// przypadki niżej krzyżują język panelu z językiem dokumentu.
//
// GRANICE. Fabryki `vi.mock` (Supabase, sonner, router, sesja) niesie moduł
// wspólny tabeli edytorów - import PIERWSZY. i18n PRAWDZIWE: asercje czytają
// napisy, które zobaczy redaktor, więc zniknięcie klucza albo powrót polskiego
// napisu w kod oblewa test.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { renderEditor } from "./blockEditMatrix.shared";
import i18n from "@/lib/i18n";
import "@/lib/i18n-admin-blocks";
import type { Block, BlockType, Json } from "@/lib/blocks/types";
import { supabase } from "@/integrations/supabase/client";
import { fail, ok, type SupabaseFromStub } from "@/test/supabaseChain";
import { BlockEditorProvider } from "../../BlockEditorContext";
import { AudioBlock } from "../Audio";
import { ButtonsBlock } from "../Buttons";
import { LatestPostsBlock } from "../LatestPosts";
import { PollBlockEdit } from "../Poll";
import { ReviewBlock } from "../Review";
import { SocialIconsBlock } from "../SocialIcons";

const stub = supabase as unknown as SupabaseFromStub;

function blok(type: BlockType, data: Record<string, Json>): Block {
  return { id: `blk-${type}`, type, data };
}

function ostatniZapis(changes: Block[]): Block {
  expect(changes.length, "edytor nie zapisał niczego").toBeGreaterThan(0);
  return changes[changes.length - 1];
}

// Najpierw odmontowanie, potem powrót języka: odwrotna kolejność (hooki
// `afterEach` biegną przed automatycznym sprzątaniem RTL) przerysowywała
// jeszcze zamontowany edytor po zmianie języka - ostrzeżenia act().
afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
});

// ---------------------------------------------------------------------------
// Opcje list wyboru (rozmiar, wyrównanie, styl, układ)
// ---------------------------------------------------------------------------

describe("opcje list wyboru w języku panelu, wartości zapisu bez zmian", () => {
  const opcje = (sel: HTMLSelectElement) =>
    Array.from(sel.options).map((o) => [o.value, o.textContent]);
  const lista = (wartosc: string) =>
    screen
      .getAllByRole<HTMLSelectElement>("combobox")
      .find((s) => Array.from(s.options).some((o) => o.value === wartosc));

  it.each([
    ["pl", ["Mały", "Średni", "Duży"], ["Do lewej", "Do środka", "Do prawej"]],
    ["en", ["Small", "Medium", "Large"], ["Left", "Center", "Right"]],
  ] as const)("%s: ikony społecznościowe - rozmiar i wyrównanie", async (lang, rozm, wyr) => {
    // NAPRAWIONE 2026-10-19: „small/medium/large” i „left/center/right” były
    // wpisane w kod po angielsku także w panelu PL.
    await i18n.changeLanguage(lang);
    renderEditor(SocialIconsBlock, blok("social-icons", {}));
    expect(opcje(lista("sm")!)).toEqual([
      ["sm", rozm[0]],
      ["md", rozm[1]],
      ["lg", rozm[2]],
    ]);
    expect(opcje(lista("left")!)).toEqual([
      ["left", wyr[0]],
      ["center", wyr[1]],
      ["right", wyr[2]],
    ]);
  });

  it.each([
    ["pl", ["Wypełniony", "Obrys", "Przezroczysty"]],
    ["en", ["Solid", "Outline", "Ghost"]],
  ] as const)("%s: przyciski - styl przycisku", async (lang, style) => {
    await i18n.changeLanguage(lang);
    renderEditor(ButtonsBlock, blok("buttons", { items: [{ label: "A", url: "/a" }] }));
    expect(opcje(lista("ghost")!)).toEqual([
      ["default", style[0]],
      ["outline", style[1]],
      ["ghost", style[2]],
    ]);
  });

  it.each([
    ["pl", "Lista", "Siatka"],
    ["en", "List", "Grid"],
  ] as const)("%s: najnowsze wpisy - układ", async (lang, listaTxt, siatka) => {
    await i18n.changeLanguage(lang);
    renderEditor(LatestPostsBlock, blok("latest-posts", {}));
    expect(opcje(lista("grid")!)).toEqual([
      ["list", listaTxt],
      ["grid", siatka],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Ikony społecznościowe
// ---------------------------------------------------------------------------

describe("social-icons - nagłówek i „dodaj” w języku panelu", () => {
  it.each([
    ["pl", "Ikony społecznościowe", "Dodaj"],
    ["en", "Social icons", "Add"],
  ] as const)("%s: nagłówek „%s”, przycisk „%s” dokłada ikonę", async (lang, naglowek, dodaj) => {
    await i18n.changeLanguage(lang);
    const { changes } = renderEditor(SocialIconsBlock, blok("social-icons", { align: "right" }));
    expect(screen.getByText(naglowek)).toBeTruthy();
    expect(changes).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: dodaj }));
    expect(ostatniZapis(changes).data).toEqual({
      align: "right",
      items: [{ platform: "facebook", url: "" }],
    });
  });
});

// ---------------------------------------------------------------------------
// Najnowsze wpisy
// ---------------------------------------------------------------------------

describe("latest-posts - nagłówek, slug kategorii i przełączniki w języku panelu", () => {
  it.each([
    ["pl", "Najnowsze wpisy", "Slug kategorii (opcjonalnie)", "Miniatura", "Zajawka"],
    ["en", "Latest posts", "Category slug (optional)", "Thumbnail", "Excerpt"],
  ] as const)(
    "%s: nagłówek „%s”, pole „%s”, przełączniki „%s”/„%s”",
    async (lang, naglowek, slugPh, miniatura, zajawka) => {
      await i18n.changeLanguage(lang);
      const start = blok("latest-posts", { count: 3 });
      const { changes } = renderEditor(LatestPostsBlock, start);
      expect(screen.getByText(naglowek)).toBeTruthy();
      expect(screen.getByRole<HTMLInputElement>("checkbox", { name: miniatura }).checked).toBe(
        true,
      );
      expect(changes).toEqual([]);

      fireEvent.change(screen.getByPlaceholderText(slugPh), { target: { value: "energia" } });
      expect(ostatniZapis(changes).data).toEqual({ count: 3, category: "energia" });

      fireEvent.click(screen.getByRole("checkbox", { name: zajawka }));
      expect(ostatniZapis(changes).data).toEqual({ count: 3, showExcerpt: true });
    },
  );
});

// ---------------------------------------------------------------------------
// Ankieta
// ---------------------------------------------------------------------------

const ANKIETY = [
  { id: "p-1", question_pl: "Wspólna armia UE?", question_en: "", status: "open" },
  { id: "p-2", question_pl: "", question_en: "Energy union by 2030?", status: "draft" },
  { id: "p-3", question_pl: "", question_en: "", status: "archived" },
  { id: "p-4", question_pl: "Euro w Polsce?", question_en: "", status: "closed" },
];

const ANKIETA = {
  pl: {
    naglowek: "Ankieta",
    opcje: [
      "- wybierz ankietę -",
      "Wspólna armia UE? (otwarta)",
      "Energy union by 2030? (szkic)",
      // Status spoza słownika zostaje surowy - jak przed przeniesieniem.
      "p-3 (archived)",
      "Euro w Polsce? (zamknięta)",
    ],
    wczytywanie: "Wczytywanie ankiet...",
    brak: "Brak ankiet - utwórz je w Społeczność > Ankiety.",
    szkic: "To szkic: publicznie pojawi się dopiero po otwarciu ankiety.",
    blad: "Nie udało się wczytać ankiet - odśwież stronę albo spróbuj ponownie później.",
    usunieta: "Wybrana ankieta już nie istnieje - blok nie wyrenderuje się publicznie.",
  },
  en: {
    naglowek: "Poll",
    opcje: [
      "- choose a poll -",
      "Wspólna armia UE? (open)",
      "Energy union by 2030? (draft)",
      "p-3 (archived)",
      "Euro w Polsce? (closed)",
    ],
    wczytywanie: "Loading polls...",
    brak: "No polls - create them in Community > Polls.",
    szkic: "This is a draft: it will appear publicly only after the poll is opened.",
    blad: "Could not load polls - refresh the page or try again later.",
    usunieta: "The selected poll no longer exists - the block will not render publicly.",
  },
} as const;

describe.each(["pl", "en"] as const)("poll - komunikaty w języku panelu (%s)", (lang) => {
  const k = ANKIETA[lang];

  it("nagłówek, pozycja „bez wyboru” i statusy ankiet na liście; wybór zapisuje `pollId`", async () => {
    await i18n.changeLanguage(lang);
    stub.setResponse("polls", ok(ANKIETY));
    const { changes } = renderEditor(PollBlockEdit, blok("poll", { pollId: "" }));
    await screen.findByRole("option", { name: /armia/ });
    expect(screen.getByText(k.naglowek)).toBeTruthy();
    const opcje = within(screen.getByRole("combobox"))
      .getAllByRole<HTMLOptionElement>("option")
      .map((o) => o.textContent);
    expect(opcje).toEqual(k.opcje);
    expect(changes).toEqual([]);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "p-4" } });
    expect(ostatniZapis(changes).data).toEqual({ pollId: "p-4" });
  });

  it("w trakcie odczytu - „wczytywanie”, po pustej odpowiedzi - gdzie tworzyć ankiety", async () => {
    await i18n.changeLanguage(lang);
    stub.setResponse("polls", ok([]));
    renderEditor(PollBlockEdit, blok("poll", {}));
    expect(screen.getByText(k.wczytywanie)).toBeTruthy();
    expect(await screen.findByText(k.brak)).toBeTruthy();
    expect(screen.queryByText(k.wczytywanie)).toBeNull();
  });

  it("wybrany szkic ostrzega, że publicznie pojawi się dopiero po otwarciu", async () => {
    await i18n.changeLanguage(lang);
    stub.setResponse("polls", ok(ANKIETY));
    renderEditor(PollBlockEdit, blok("poll", { pollId: "p-2" }));
    expect(await screen.findByText(k.szkic)).toBeTruthy();
    expect(screen.queryByText(k.usunieta)).toBeNull();
  });

  it("ankieta spoza listy ostrzega, że blok się nie wyrenderuje", async () => {
    await i18n.changeLanguage(lang);
    stub.setResponse("polls", ok(ANKIETY));
    renderEditor(PollBlockEdit, blok("poll", { pollId: "p-usunieta" }));
    expect(await screen.findByText(k.usunieta)).toBeTruthy();
  });

  it("błąd odczytu ma własny alert, bez ostrzeżenia o usuniętej ankiecie", async () => {
    await i18n.changeLanguage(lang);
    stub.setResponse("polls", fail("permission denied for table polls", "42501"));
    renderEditor(PollBlockEdit, blok("poll", { pollId: "p-1" }));
    expect((await screen.findByRole("alert")).textContent).toBe(k.blad);
    expect(screen.queryByText(k.usunieta)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

describe("audio - placeholder pustego pola URL w języku panelu", () => {
  it.each([
    ["pl", "URL pliku audio (mp3, ogg, wav)…"],
    ["en", "Audio file URL (mp3, ogg, wav)…"],
  ] as const)("%s: „%s”, a wpis zapisuje się pod `url`", async (lang, placeholder) => {
    await i18n.changeLanguage(lang);
    const { changes } = renderEditor(AudioBlock, blok("audio", { url: "" }));
    const pole = screen.getByPlaceholderText(placeholder);
    fireEvent.change(pole, { target: { value: "https://cdn.example.com/a.mp3" } });
    fireEvent.blur(pole);
    expect(ostatniZapis(changes).data).toEqual({ url: "https://cdn.example.com/a.mp3" });
  });
});

// ---------------------------------------------------------------------------
// Recenzja
// ---------------------------------------------------------------------------

describe("review - nagłówek edytora w języku panelu", () => {
  it.each([
    ["pl", "Recenzja"],
    ["en", "Review box"],
  ] as const)("%s: nagłówek „%s” obok oceny łącznej", async (lang, naglowek) => {
    await i18n.changeLanguage(lang);
    const { changes } = renderEditor(
      ReviewBlock,
      blok("review", { scale: 10, criteria: [{ label: "Merytoryka", score: 9 }] }),
    );
    expect(screen.getByText(naglowek)).toBeTruthy();
    expect(screen.getByText("9.0 / 10")).toBeTruthy();
    expect(changes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Grupa przycisków - etykieta nowej pozycji to TREŚĆ dokumentu
// ---------------------------------------------------------------------------

describe("buttons - etykieta nowego przycisku w języku DOKUMENTU, nie panelu", () => {
  it.each([
    ["pl", "pl", "Dodaj", "Przycisk"],
    ["en", "pl", "Add", "Przycisk"],
    ["pl", "en", "Dodaj", "Button"],
    ["en", "en", "Add", "Button"],
  ] as const)(
    "panel %s, dokument %s: „%s” dopisuje przycisk z etykietą „%s”",
    async (panel, dokument, dodaj, etykieta) => {
      await i18n.changeLanguage(panel);
      const start = blok("buttons", {
        align: "center",
        items: [{ label: "Raport", href: "/raport", variant: "outline" }],
      });
      const changes: Block[] = [];
      render(
        <BlockEditorProvider lang={dokument}>
          <ButtonsBlock block={start} onChange={(next) => changes.push(next)} />
        </BlockEditorProvider>,
      );
      expect(changes).toEqual([]);

      fireEvent.click(screen.getByRole("button", { name: dodaj }));
      expect(changes).toEqual([
        {
          ...start,
          data: {
            align: "center",
            items: [
              { label: "Raport", href: "/raport", variant: "outline" },
              { label: etykieta, href: "#", variant: "default" },
            ],
          },
        },
      ]);
    },
  );
});
