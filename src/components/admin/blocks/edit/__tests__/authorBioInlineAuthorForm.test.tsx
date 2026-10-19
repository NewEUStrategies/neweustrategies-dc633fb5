// BIO AUTORA (`author-bio`) - ZAPISY FORMULARZA, WYBÓR Z BAZY I PODGLĄDY WARIANTÓW.
//
// PO CO OSOBNY PLIK. `blockEditAuthorBio.test.tsx` obok pilnuje ODCZYTU: stanów
// pustych, odmów i wartości spoza katalogu. Tutaj jest ZAPIS - każda kontrolka
// edytora woła `onChange` z domknięcia, którego render nie wykonuje, a to
// w nich mieszka defekt „zapis pod złym kluczem", „zapis w nie ten link"
// albo „zapis gubi resztę profilu".
//
// CO MA TU DOWÓD (niezmienniki, nie kształt DOM-u)
//  * każde pole autora inline zapisuje WŁASNY klucz `inlineAuthor`, a reszta
//    profilu i reszta danych bloku przechodzą bez zmian; `id` i `type` bloku
//    zostają na każdym zapisie,
//  * edycja i usunięcie własnego linku trafiają w TEN wiersz, który redaktor
//    ruszył - a nie w pierwszy czy ostatni,
//  * plik wybrany w bibliotece mediów ląduje jako zdjęcie autora albo jako
//    ikona TEGO linku, którego przycisk kliknięto,
//  * wybór osoby z bazy wewnętrznej zapisuje jej `id`, a pozycja „brak"
//    wraca do autora bieżącego wpisu (`authorId: ""`),
//  * przełączniki zapisują WYŁĄCZENIE (wszystkie są „domyślnie włączone"),
//  * pozostałe warianty podglądu NIE są montowane, dopóki redaktor nie
//    rozwinie listy - każdy to pełny `AuthorBioView` z własnymi zapytaniami.
//
// GRANICE. Fabryki `vi.mock` niesie moduł wspólny tabeli (import PIERWSZY):
// `sonner`, Radix `Select`/`Switch`, `<Link>` routera, klient Supabase,
// kontekst najemcy, `fetch`. Dokładamy JEDNĄ granicę biblioteki: Radix
// `Popover`, który pod happy-dom nie otwiera warstwy, a bez otwarcia nie da
// się niczego wybrać w `ExpertPicker`. Bazę ekspertów podajemy przez cache
// react-query (granica danych), listę mediów - przez atrapę klienta Supabase.
// i18n PRAWDZIWE (`realT`). Osoby są zmyślone, adresy wskazują `example.com`.
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, screen, within } from "@testing-library/react";

import { renderEditor } from "./blockEditMatrix.shared";
import type { Block, Json } from "@/lib/blocks/types";
import { realT } from "@/test/i18nReal";
import { ok, type SupabaseFromStub } from "@/test/supabaseChain";
import { supabase } from "@/integrations/supabase/client";
import type { InternalExpertBase } from "@/lib/experts/internalBase";
import { PLACEHOLDER_POST_CTX } from "@/lib/content-model/postContext";
import "@/lib/i18n-admin-blocks";
import { AuthorBioBlock } from "../PostContextBlocks";

/**
 * Radix `Popover` sterowany (`open` + `onOpenChange`) - tak go używa `ExpertPicker`.
 * Wyzwalacz w atrapie wyłącznie OTWIERA: przycisk siedzi w `<label>`, a
 * happy-dom - inaczej niż przeglądarka - przekazuje kliknięcie etykiety
 * jeszcze raz do tej samej kontrolki, więc przełącznik zamykałby warstwę
 * tym samym kliknięciem. Zamknięcie robi i tak sam `ExpertPicker` po wyborze.
 */
vi.mock("@/components/ui/popover", async () => {
  const react = await import("react");
  const { createPortal } = await import("react-dom");
  const Ctx = react.createContext({ open: false, show: () => undefined as void });
  return {
    Popover: (p: { open?: boolean; onOpenChange?: (o: boolean) => void; children?: ReactNode }) => (
      <Ctx.Provider value={{ open: p.open === true, show: () => p.onOpenChange?.(true) }}>
        {p.children}
      </Ctx.Provider>
    ),
    PopoverTrigger: ({ children }: { children?: ReactNode }) => {
      const ctx = react.useContext(Ctx);
      return react.isValidElement<{ onClick?: () => void }>(children)
        ? react.cloneElement(children, { onClick: ctx.show })
        : null;
    },
    // Jak w Radiksie (`PopoverPrimitive.Portal`): warstwa ląduje w `body`, a nie
    // w `<label>` wyzwalacza - inaczej etykieta „Autor" stawałaby się nazwą
    // każdej pozycji listy.
    PopoverContent: ({ children }: { children?: ReactNode }) =>
      react.useContext(Ctx).open ? createPortal(<div>{children}</div>, document.body) : null,
  };
});

const t = realT("pl");
const pc = (key: string) => t(`blocks.editors.postContextBlocks.${key}`) as string;

const AUTOR: Record<string, Json> = {
  name: "Testowa Redaktorka",
  jobTitle: "Redaktorka prowadząca",
  customSocials: [
    { label: "Biuletyn", url: "https://example.com/biuletyn", iconUrl: "" },
    { label: "Podcast", url: "https://example.com/podcast", iconUrl: "" },
  ],
};

function bio(data: Record<string, Json>): Block {
  return { id: "ab-zapis", type: "author-bio", data: { showSocial: true, ...data } };
}

function inline(extra: Record<string, Json> = {}): Block {
  return bio({ authorSource: "inline", inlineAuthor: { ...AUTOR, ...extra } });
}

function ostatniZapis(changes: Block[]): Block {
  expect(changes.length, "edytor nie zapisał niczego").toBeGreaterThan(0);
  const zapis = changes[changes.length - 1];
  expect(zapis.id).toBe("ab-zapis");
  expect(zapis.type).toBe("author-bio");
  return zapis;
}

const autorZapisu = (b: Block) => b.data.inlineAuthor as Record<string, Json>;

/**
 * Nazwa dostępna listy wyboru w `<label>` to etykieta PLUS wybrana opcja
 * (reguła „kontrolka osadzona w etykiecie"), więc dopasowujemy początek.
 */
const poczatek = (etykieta: string) =>
  new RegExp(`^${etykieta.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);

describe("autor inline - każde pole zapisuje WŁASNY klucz", () => {
  it.each([
    [pc("fName"), "name", "Anna Zmyślona"],
    [pc("fJobTitle"), "jobTitle", "Analityczka"],
    [pc("fCompany"), "company", "Fundacja Przykładowa"],
    [pc("fSlug"), "slug", "anna-zmyslona"],
    [pc("fContactEmail"), "contactEmail", "anna@example.com"],
    [pc("fPhone"), "phone", "+48 500 600 700"],
    ["X (x.com)", "xUrl", "https://x.com/przyklad"],
    ["LinkedIn", "linkedinUrl", "https://linkedin.com/in/przyklad"],
    ["Facebook", "facebookUrl", "https://facebook.com/przyklad"],
    ["Instagram", "instagramUrl", "https://instagram.com/przyklad"],
    ["Spotify", "spotifyUrl", "https://open.spotify.com/show/przyklad"],
    [pc("fWebsite"), "websiteUrl", "https://example.com"],
  ])("„%s” zapisuje `%s` i nie rusza reszty profilu", (etykieta, klucz, wartosc) => {
    const { changes } = renderEditor(AuthorBioBlock, inline());
    fireEvent.change(screen.getByRole("textbox", { name: etykieta }), {
      target: { value: wartosc },
    });
    const zapis = ostatniZapis(changes);
    expect(autorZapisu(zapis)).toEqual({ ...AUTOR, [klucz]: wartosc });
    expect(zapis.data.authorSource).toBe("inline");
    expect(zapis.data.showSocial).toBe(true);
  });

  it("bio PL i EN zapisują się w osobnych kluczach", () => {
    const { changes } = renderEditor(AuthorBioBlock, inline());
    fireEvent.change(screen.getByRole("textbox", { name: "Bio (PL)" }), {
      target: { value: "Pisze o Europie." },
    });
    expect(autorZapisu(ostatniZapis(changes)).bio_pl).toBe("Pisze o Europie.");
    fireEvent.change(screen.getByRole("textbox", { name: "Bio (EN)" }), {
      target: { value: "Writes about Europe." },
    });
    const autor = autorZapisu(ostatniZapis(changes));
    expect(autor.bio_en).toBe("Writes about Europe.");
    expect(autor).not.toHaveProperty("bio_pl");
  });
});

describe("autor inline - własne linki", () => {
  const nazwy = () => screen.getAllByPlaceholderText(pc("linkName"));
  const adresy = () => screen.getAllByPlaceholderText("https://...");

  it("zmiana nazwy DRUGIEGO linku zmienia tylko drugi link", () => {
    const { changes } = renderEditor(AuthorBioBlock, inline());
    fireEvent.change(nazwy()[1], { target: { value: "Podcast tygodniowy" } });
    expect(autorZapisu(ostatniZapis(changes)).customSocials).toEqual([
      { label: "Biuletyn", url: "https://example.com/biuletyn", iconUrl: "" },
      { label: "Podcast tygodniowy", url: "https://example.com/podcast", iconUrl: "" },
    ]);
  });

  it("zmiana adresu PIERWSZEGO linku zmienia tylko pierwszy link", () => {
    const { changes } = renderEditor(AuthorBioBlock, inline());
    // `getAllByPlaceholderText("https://...")` łapie też pole „Strona www" -
    // adresy linków własnych to te z typem `url` w wierszach listy.
    const wiersze = adresy().filter((el) => el.closest("label") === null);
    fireEvent.change(wiersze[0], { target: { value: "https://example.com/nowy" } });
    expect(autorZapisu(ostatniZapis(changes)).customSocials).toEqual([
      { label: "Biuletyn", url: "https://example.com/nowy", iconUrl: "" },
      { label: "Podcast", url: "https://example.com/podcast", iconUrl: "" },
    ]);
  });

  it("usunięcie PIERWSZEGO linku zostawia drugi nietknięty", () => {
    const { changes } = renderEditor(AuthorBioBlock, inline());
    fireEvent.click(screen.getAllByRole("button", { name: pc("removeLink") })[0]);
    expect(autorZapisu(ostatniZapis(changes)).customSocials).toEqual([
      { label: "Podcast", url: "https://example.com/podcast", iconUrl: "" },
    ]);
  });
});

describe("autor inline - biblioteka mediów", () => {
  const PLIK = {
    id: "m-1",
    public_url: "https://cdn.example.com/portret.png",
    filename: "portret.png",
    mime_type: "image/png",
    folder_path: "",
    created_at: "2026-10-01T10:00:00Z",
    alt_text: null,
  };

  function zMediami() {
    (supabase as unknown as SupabaseFromStub).setResponse("media", ok([PLIK]));
  }

  it("plik wybrany jako zdjęcie trafia do `avatarUrl` autora", async () => {
    zMediami();
    const { changes } = renderEditor(AuthorBioBlock, inline());
    fireEvent.click(screen.getByRole("button", { name: pc("uploadPhoto") }));
    const okno = screen.getByRole("dialog");
    fireEvent.doubleClick(await within(okno).findByRole("button", { name: PLIK.filename }));
    expect(autorZapisu(ostatniZapis(changes))).toEqual({ ...AUTOR, avatarUrl: PLIK.public_url });
  });

  it("plik wybrany jako ikona trafia do `iconUrl` TEGO linku, którego przycisk kliknięto", async () => {
    zMediami();
    const { changes } = renderEditor(AuthorBioBlock, inline());
    fireEvent.click(screen.getAllByTitle(pc("uploadIcon"))[1]);
    const okno = screen.getByRole("dialog");
    fireEvent.doubleClick(await within(okno).findByRole("button", { name: PLIK.filename }));
    expect(autorZapisu(ostatniZapis(changes)).customSocials).toEqual([
      { label: "Biuletyn", url: "https://example.com/biuletyn", iconUrl: "" },
      { label: "Podcast", url: "https://example.com/podcast", iconUrl: PLIK.public_url },
    ]);
  });

  it("autor ze zdjęciem pokazuje „zmień” i usuwa zdjęcie pustym napisem", () => {
    // Pusty napis, a nie usunięcie klucza: `toJson` przenosi go do dokumentu,
    // a podgląd czyta pusty adres jako brak zdjęcia.
    const { changes } = renderEditor(
      AuthorBioBlock,
      inline({ avatarUrl: "https://cdn.example.com/stary.png" }),
    );
    expect(screen.getByRole("button", { name: pc("changePhoto") })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: t("blocks.editors.common.remove") }));
    expect(autorZapisu(ostatniZapis(changes)).avatarUrl).toBe("");
  });
});

describe("źródło autora i wybór z bazy wewnętrznej", () => {
  const BAZA: InternalExpertBase = {
    entries: [
      {
        id: "u-zofia",
        name: "Zofia Przykładowa",
        slug: "zofia-przykladowa",
        avatarUrl: null,
        jobTitle: "Ekspertka",
        company: null,
        isExpert: true,
        isPublic: true,
      },
    ],
    total: 1,
    expertCount: 1,
    publicCount: 1,
    restricted: false,
  };

  it("przyciski źródła zapisują `authorSource` i niczego więcej", () => {
    const { changes } = renderEditor(AuthorBioBlock, bio({ variant: "split" }));
    fireEvent.click(screen.getByRole("button", { name: pc("newInlineAuthor") }));
    expect(ostatniZapis(changes).data).toEqual({
      showSocial: true,
      variant: "split",
      authorSource: "inline",
    });
    fireEvent.click(screen.getByRole("button", { name: pc("existingAuthor") }));
    expect(ostatniZapis(changes).data.authorSource).toBe("existing");
  });

  it("wybrana osoba zapisuje swoje `id`, a „brak” wraca do autora wpisu", async () => {
    const view = renderEditor(AuthorBioBlock, bio({ authorSource: "existing" }));
    view.queryClient.setQueryData(["admin", "internal-expert-base"], BAZA);
    // Wyzwalacz siedzi w `<label>` „Autor" - to ta etykieta jest jego nazwą
    // dostępną, a napis „Autor bieżącego wpisu" jest jego TREŚCIĄ.
    const wyzwalacz = () => screen.getByRole("button", { name: pc("authorLabel") });
    expect(wyzwalacz().textContent).toContain(pc("currentPostAuthor"));

    fireEvent.click(wyzwalacz());
    // Obserwatory react-query dostają nowe dane asynchronicznie - czekamy na
    // pozycję, zamiast zakładać synchroniczny przerys.
    fireEvent.click(await screen.findByRole("option", { name: /Zofia Przykładowa/ }));
    expect(ostatniZapis(view.changes).data.authorId).toBe("u-zofia");

    fireEvent.click(wyzwalacz());
    fireEvent.click(screen.getByRole("option", { name: pc("currentPostAuthor") }));
    expect(ostatniZapis(view.changes).data.authorId).toBe("");
  });
});

describe("przełączniki i wariant", () => {
  it.each([
    [pc("toggleAvatar"), "showAvatar"],
    [pc("toggleSocial"), "showSocial"],
    [pc("togglePostsCount"), "showPostsCount"],
  ])("„%s” jest domyślnie włączony i zapisuje `%s: false`", (etykieta, klucz) => {
    const { changes } = renderEditor(AuthorBioBlock, {
      id: "ab-zapis",
      type: "author-bio",
      data: {},
    });
    const przelacznik = screen.getByRole("checkbox", { name: etykieta });
    expect((przelacznik as HTMLInputElement).checked).toBe(true);
    fireEvent.click(przelacznik);
    expect(ostatniZapis(changes).data).toEqual({ [klucz]: false });
  });

  it("wybór wariantu zapisuje go, a „Karta profilu” odsłania ustawienia karty", () => {
    const pierwszy = renderEditor(AuthorBioBlock, bio({}));
    expect(screen.queryByText(pc("profileStyleTitle"))).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: poczatek(pc("variant")) }), {
      target: { value: "profile" },
    });
    const zapis = ostatniZapis(pierwszy.changes);
    expect(zapis.data).toEqual({ showSocial: true, variant: "profile" });
    pierwszy.unmount();
    renderEditor(AuthorBioBlock, zapis);
    expect(screen.getByText(pc("profileStyleTitle"))).toBeTruthy();
  });

  it.each([
    [pc("fShadow"), "shadow", "sm"],
    [pc("fSocialStyle"), "socialStyle", "outline"],
    [pc("fMobileAlign"), "mobileAlign", "left"],
  ])("lista „%s” karty profilu zapisuje `%s`", (etykieta, klucz, wartosc) => {
    const { changes } = renderEditor(AuthorBioBlock, bio({ variant: "profile" }));
    fireEvent.change(screen.getByRole("combobox", { name: poczatek(etykieta) }), {
      target: { value: wartosc },
    });
    expect(ostatniZapis(changes).data[klucz]).toBe(wartosc);
  });
});

describe("pozostałe warianty podglądu - montowane dopiero po rozwinięciu", () => {
  const NAZWY = [
    "variantNameCard",
    "variantNameSplit",
    "variantNameInline",
    "variantNameMinimal",
    "variantNameProfile",
  ].map(pc);
  const PRZYKLADOWY_AUTOR = PLACEHOLDER_POST_CTX.author?.name as string;

  function lista(container: HTMLElement): HTMLDetailsElement {
    return container.querySelector("details") as HTMLDetailsElement;
  }

  /** Podpisy wariantów pod `<details>` - w kolejności, w jakiej je widać. */
  function podpisy(details: HTMLElement): string[] {
    return Array.from(details.querySelectorAll("div"), (el) =>
      (el.textContent ?? "").trim(),
    ).filter((txt) => NAZWY.includes(txt));
  }

  function przelacz(details: HTMLDetailsElement, otwarta: boolean) {
    details.open = otwarta;
    fireEvent(details, new Event("toggle"));
  }

  it("zwinięta lista nie montuje żadnego dodatkowego podglądu", () => {
    const { container } = renderEditor(AuthorBioBlock, bio({ variant: "card" }));
    expect(podpisy(lista(container))).toEqual([]);
    expect(within(lista(container)).queryAllByText(PRZYKLADOWY_AUTOR)).toHaveLength(0);
  });

  it("rozwinięcie pokazuje WSZYSTKIE warianty poza bieżącym, w kolejności katalogu", () => {
    const { container } = renderEditor(AuthorBioBlock, bio({ variant: "split" }));
    przelacz(lista(container), true);
    expect(podpisy(lista(container))).toEqual([
      pc("variantNameCard"),
      pc("variantNameInline"),
      pc("variantNameMinimal"),
      pc("variantNameProfile"),
    ]);
    // Zwinięcie zdejmuje podglądy z powrotem - nie przerysowują się w tle.
    przelacz(lista(container), false);
    expect(podpisy(lista(container))).toEqual([]);
  });

  it("rozwinięte warianty pokazują autora INLINE - te same dane, co podgląd główny", () => {
    // Każdy dodatkowy podgląd dostaje to samo `authorOverride`; gdyby sięgał
    // po przykładowego autora, redaktor porównywałby warianty na cudzych danych.
    const { container } = renderEditor(AuthorBioBlock, inline({ variant: "card" }));
    przelacz(lista(container), true);
    const rozwinieta = within(lista(container));
    expect(rozwinieta.getAllByText(AUTOR.name as string).length).toBeGreaterThanOrEqual(4);
    expect(rozwinieta.queryAllByText(PRZYKLADOWY_AUTOR)).toHaveLength(0);
  });
});
