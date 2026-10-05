// Kandydat LCP strony (P1.4) - czysta funkcja dokumentu buildera.
//
// CO TEN PLIK DOWODZI:
//  1. NA STRONIE JEST CO NAJWYŻEJ DWÓCH KANDYDATÓW: największy slot desktopowy
//     i pierwszy obraz w kolejności malowania na telefonie (`order.mobile`) -
//     przy zgodności obu reguł JEDEN.
//  2. KANDYDAT POCHODZI Z PIERWSZEJ SEKCJI Z WIDGETEM OBRAZOWYM w oknie
//     malowanych sekcji (wariant A eksperymentu tak, wariant B nie), a strona
//     bez obrazu w oknie nie ma kandydata (więc ani priorytetu, ani preloadu).
//  3. WYKLUCZENIA SĄ TE SAME, CO W heroImage.ts (logo, para jasny/ciemny,
//     brak źródła, warianty miniaturowe) plus `hideOn.mobile`/`hideOn.desktop`.
//  4. MODUŁ JEST CZYSTY: nie importuje warstwy zapytań (check:entry-purity,
//     krytyka M4a) - lista importów źródła jest zamknięta.
//  5. TE SAME FILTRY DOSTĘPU CO RENDERER (recenzja P1.4, B1): sekcja, kolumna,
//     inner-sekcja, kolumna inner-sekcji i widget z regułą `advanced.access`,
//     której czytelnik nie spełnia, nie dają kandydata - ani nie zajmują okna,
//     ani nie zmieniają podziału slotu rodzeństwa.
//  6. MODUŁ (i heroImage.ts) JEST TYLKO SERWEROWY (recenzja P1.4 runda 3, m3):
//     każde użycie w kodzie klienta stoi w gałęzi `isServerRender()`, a stała
//     `isServer` router-core w buildzie przeglądarki to literał `false` - inaczej
//     bundler nie wytnie gałęzi i moduły po cichu wrócą do chunku wejściowego.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { ABOVE_FOLD_SECTION_COUNT } from "@/lib/builder/prefetch";
import {
  GUEST_ACCESS_CONTEXT,
  evaluateAccess,
  type AccessContext,
} from "@/lib/builder/accessControl";
import {
  LCP_CANDIDATE_LIMIT,
  LCP_SCAN_SECTIONS,
  POST_LIST_LEAD_VARIANTS,
  isPostListLeadVariant,
  lcpCandidateIds as lcpCandidateIdsFor,
  lcpCandidateKind,
  lcpCandidates as lcpCandidatesFor,
  type LcpCandidatesOptions,
} from "@/lib/builder/lcpCandidate";
import type {
  AccessControlSettings,
  BuilderDocument,
  ColumnNode,
  InnerSectionNode,
  SectionChild,
  SectionNode,
  SectionTabsConfig,
  WidgetContent,
  WidgetNode,
} from "@/lib/builder/types";

/** Predykat dostępu z kontekstu czytelnika - dokładnie to, co podaje renderer. */
const accessOf =
  (ctx: AccessContext) =>
  (rule: AccessControlSettings | undefined): boolean =>
    evaluateAccess(rule, ctx);
const GUEST = accessOf(GUEST_ACCESS_CONTEXT);
const USER = accessOf({ isAuthenticated: true, roles: [] });

type Opts = Partial<LcpCandidatesOptions>;
/** Domyślnie czytelnik-gość (jak loader trasy i SSR). */
const lcpCandidates = (doc: BuilderDocument | null | undefined, opts: Opts = {}) =>
  lcpCandidatesFor(doc, { isAccessible: GUEST, ...opts });
const lcpCandidateIds = (doc: BuilderDocument | null | undefined, opts: Opts = {}) =>
  lcpCandidateIdsFor(doc, { isAccessible: GUEST, ...opts });

const COVER = "https://p.supabase.co/storage/v1/object/public/covers/hero.jpg";

let nodeId = 0;
function widget(
  type: string,
  content: WidgetContent = {},
  extra: Partial<WidgetNode> = {},
): WidgetNode {
  return {
    id: `w-${(nodeId += 1)}`,
    kind: "widget",
    type: type as WidgetNode["type"],
    content,
    ...extra,
  };
}

function column(widgets: WidgetNode[], span = 12, extra: Partial<ColumnNode> = {}): ColumnNode {
  return {
    id: `c-${(nodeId += 1)}`,
    kind: "column",
    span: { desktop: span },
    children: widgets,
    ...extra,
  };
}

function innerSection(columns: ColumnNode[], extra: Partial<InnerSectionNode> = {}) {
  return {
    id: `is-${(nodeId += 1)}`,
    kind: "inner-section",
    columns,
    ...extra,
  } satisfies InnerSectionNode;
}

function section(children: SectionChild[], extra: Partial<SectionNode> = {}): SectionNode {
  return { id: `s-${(nodeId += 1)}`, kind: "section", children, ...extra };
}

function docWith(sections: SectionNode[]): BuilderDocument {
  return { version: 1, sections };
}

const image = (src = COVER, extra: WidgetContent = {}) =>
  widget("image", { src, alt_pl: "Zdjęcie", ...extra });
const slider = (content: WidgetContent = { source: "posts" }) => widget("slider", content);
const postList = (content: WidgetContent = {}) => widget("post-list", content);
const heading = () => widget("heading", { text_pl: "Nagłówek" });

/** Kształt sekcji 0 strony głównej fixture (e2e/fixtures/first-visit.json). */
function homeHeroSection(order: { left: number; hero: number; right: number }) {
  const left = column([widget("section-label"), postList({ variant: "card" }), postList()], 3, {
    order: { mobile: order.left },
  });
  const hero = column([slider({ source: "posts", variant: "editorial-hero" })], 6, {
    order: { mobile: order.hero },
  });
  const right = column([widget("section-label"), postList({ variant: "ranked" })], 3, {
    order: { mobile: order.right },
  });
  return { section: section([left, hero, right]), left, hero, right };
}

describe("lcpCandidates - reguła wyboru", () => {
  it("okno skanowania jest tym samym oknem, które rozgrzewa prefetch SSR", () => {
    expect(LCP_SCAN_SECTIONS).toBe(ABOVE_FOLD_SECTION_COUNT);
    expect(LCP_CANDIDATE_LIMIT).toBe(2);
  });

  it("strona główna fixture: hero jest i największy, i pierwszy na telefonie - JEDEN kandydat", () => {
    const { section: s0, hero } = homeHeroSection({ left: 2, hero: 1, right: 3 });
    const candidates = lcpCandidates(docWith([s0, section([column([image()])])]));
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      sectionId: s0.id,
      kind: "slider",
      viewports: ["desktop", "mobile"],
    });
    expect(candidates[0].widget.id).toBe(hero.children[0].id);
    // Slot kandydata to slot kolumny hero: 6/12 szerokości desktopu.
    expect(candidates[0].slot.desktop.vw).toBe(50);
  });

  it("inna kolejność kolumn na telefonie daje DRUGIEGO kandydata (pierwszy wg order.mobile)", () => {
    // Werdykt LP-1 (blokujące 2): sam „największy slot desktopowy" zrobiłby
    // obraz pierwszego ekranu telefonu leniwym - regres LCP mobile.
    const { section: s0, hero, left } = homeHeroSection({ left: 1, hero: 2, right: 3 });
    const candidates = lcpCandidates(docWith([s0]));
    expect(candidates.map((c) => c.widget.id)).toEqual([hero.children[0].id, left.children[1].id]);
    expect(candidates.map((c) => c.viewports)).toEqual([["desktop"], ["mobile"]]);
  });

  it("kolumny BEZ order.mobile mają na telefonie kolejność 0 - jak reguła CSS renderera", () => {
    // Renderer pisze `order: ${mobile ?? 0}` tylko kolumnom z obiektem `order`,
    // reszta ma domyślne 0. Kolumna z order.mobile = 1 spada więc ZA kolumnę bez order.
    const first = column([image(`${COVER}?pierwszy=1`)], 4, { order: { mobile: 1 } });
    const plain = column([image(`${COVER}?drugi=1`)], 8);
    const candidates = lcpCandidates(docWith([section([first, plain])]));
    // Desktop: większy slot (8/12) = `plain`; telefon: `plain` (0) przed `first` (1).
    expect(candidates).toHaveLength(1);
    expect(candidates[0].widget.id).toBe(plain.children[0].id);
  });

  it("największy slot desktopowy wygrywa, nawet gdy w DOM stoi dalej", () => {
    const small = column([image(`${COVER}?maly=1`)], 3);
    const big = column([image(`${COVER}?duzy=1`)], 9);
    const candidates = lcpCandidates(docWith([section([small, big])]));
    // Telefon: pierwszy w DOM (mały) - stąd dwóch kandydatów, desktop pierwszy.
    expect(candidates.map((c) => c.widget.id)).toEqual([big.children[0].id, small.children[0].id]);
  });

  it("remis slotu: slider > obraz > dark-featured-card > lead listy, potem kolejność", () => {
    const list = postList();
    const card = widget("dark-featured-card", { image: COVER });
    const img = image();
    const sl = slider();
    const cols = [column([list], 3), column([card], 3), column([img], 3), column([sl], 3)];
    const [desktop] = lcpCandidates(docWith([section(cols)]));
    expect(desktop.widget.id).toBe(sl.id);
    const withoutSlider = lcpCandidates(docWith([section(cols.slice(0, 3))]));
    expect(withoutSlider[0].widget.id).toBe(img.id);
    const twoImages = [column([image(`${COVER}?a=1`)], 6), column([image(`${COVER}?b=1`)], 6)];
    expect(lcpCandidateIds(docWith([section(twoImages)]))).toEqual([twoImages[0].children[0].id]);
  });

  it("remis slotu respektuje kolejność desktopową (order.desktop), nie tylko DOM", () => {
    const a = column([image(`${COVER}?a=1`)], 6, { order: { desktop: 2 } });
    const b = column([image(`${COVER}?b=1`)], 6, { order: { desktop: 1 } });
    const [desktop] = lcpCandidates(docWith([section([a, b])]));
    expect(desktop.widget.id).toBe(b.children[0].id);
  });

  it("udział obrazu w slocie: multi-card i siatka listy dzielą slot na karty", () => {
    // Multi-card z 3 kolumnami w slocie 8/12 maluje karty po ~22% szerokości -
    // mniej niż pojedynczy obraz w slocie 4/12 (33%).
    const multi = slider({ source: "posts", variant: "multi-card", columns: 3 });
    const img = image();
    const [desktop] = lcpCandidates(docWith([section([column([multi], 8), column([img], 4)])]));
    expect(desktop.widget.id).toBe(img.id);
    // Siatka 4 kolumn w slocie 8/12 (17%) też przegrywa z obrazem 4/12.
    const grid = postList({ variant: "card", columns: 4 });
    const img2 = image(`${COVER}?2=1`);
    const [desktop2] = lcpCandidates(docWith([section([column([grid], 8), column([img2], 4)])]));
    expect(desktop2.widget.id).toBe(img2.id);
    // Wariant classic maluje lead na całą szerokość slotu - wygrywa z obrazem 4/12.
    const classic = postList({ variant: "classic", columns: 4 });
    const [desktop3] = lcpCandidates(
      docWith([section([column([classic], 8), column([image(`${COVER}?3=1`)], 4)])]),
    );
    expect(desktop3.widget.id).toBe(classic.id);
  });

  it("w jednej kolumnie pierwszy widget obrazowy wygrywa (kolejność DOM)", () => {
    const first = image(`${COVER}?pierwszy=1`);
    const second = image(`${COVER}?drugi=1`);
    expect(lcpCandidateIds(docWith([section([column([heading(), first, second])])]))).toEqual([
      first.id,
    ]);
  });

  it("nigdy więcej niż dwóch kandydatów i bez duplikatów", () => {
    const cols = [1, 2, 3, 4].map((i) =>
      column([image(`${COVER}?k=${i}`)], i === 4 ? 6 : 2, { order: { mobile: 5 - i } }),
    );
    const ids = lcpCandidateIds(docWith([section(cols)]));
    expect(ids.length).toBeLessThanOrEqual(LCP_CANDIDATE_LIMIT);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("lcpCandidates - sekcje i okno", () => {
  it("strona BEZ obrazu w oknie nie ma kandydata (więc ani priorytetu, ani preloadu)", () => {
    const text = () => section([column([heading()])]);
    expect(lcpCandidates(docWith([text(), text(), text()]))).toEqual([]);
    // Obraz w czwartej sekcji jest poza oknem 3 sekcji.
    expect(lcpCandidates(docWith([text(), text(), text(), section([column([image()])])]))).toEqual(
      [],
    );
  });

  it("cienka sekcja tekstowa nad hero nie odbiera mu kandydatury (werdykt LP-1, blokujące 3)", () => {
    const hero = image();
    const candidates = lcpCandidates(
      docWith([section([column([heading()])]), section([column([hero])])]),
    );
    expect(candidates.map((c) => c.widget.id)).toEqual([hero.id]);
  });

  it("kandydat pochodzi WYŁĄCZNIE z pierwszej sekcji z widgetem obrazowym", () => {
    const first = image(`${COVER}?pierwsza=1`);
    const later = slider();
    const candidates = lcpCandidates(
      docWith([section([column([first], 4)]), section([column([later])])]),
    );
    expect(candidates.map((c) => c.widget.id)).toEqual([first.id]);
  });

  it("okno 0 i okno ujemne wyłączają kandydata; większe niż dokument nie wywraca", () => {
    const doc = docWith([section([column([image()])])]);
    expect(lcpCandidates(doc, { sections: 0 })).toEqual([]);
    expect(lcpCandidates(doc, { sections: -3 })).toEqual([]);
    expect(lcpCandidates(doc, { sections: 99 })).toHaveLength(1);
  });

  it("A/B: wariant B nie jest malowany w SSR, wariant A jest - i bywa kandydatem", () => {
    const b = image(`${COVER}?b=1`);
    const a = image(`${COVER}?a=1`);
    const doc = docWith([
      section([column([b])], { advanced: { abTest: { experimentId: "e1", variant: "b" } } }),
      section([column([a])], { advanced: { abTest: { experimentId: "e1", variant: "a" } } }),
    ]);
    expect(lcpCandidateIds(doc)).toEqual([a.id]);
  });

  it("okno liczy się po sekcjach MALOWANYCH (wariant B nie zabiera miejsca w oknie)", () => {
    const text = () => section([column([heading()])]);
    const img = image();
    const doc = docWith([
      text(),
      section([column([image(`${COVER}?b=1`)])], {
        advanced: { abTest: { experimentId: "e1", variant: "b" } },
      }),
      text(),
      section([column([img])]),
    ]);
    // Malowane: text, text, obraz - obraz jest trzecią malowaną sekcją.
    expect(lcpCandidateIds(doc)).toEqual([img.id]);
  });

  it("zakładki: liczy się tylko zakładka domyślna", () => {
    const tabs: SectionTabsConfig = {
      enabled: true,
      items: [
        { id: "t1", label_pl: "Pierwsza" },
        { id: "t2", label_pl: "Druga" },
      ],
      defaultTabId: "t2",
    };
    const hidden = image(`${COVER}?ukryta=1`);
    const active = image(`${COVER}?aktywna=1`);
    const doc = docWith([
      section([column([hidden], 12, { tabId: "t1" }), column([active], 12, { tabId: "t2" })], {
        tabs,
      }),
    ]);
    expect(lcpCandidateIds(doc)).toEqual([active.id]);
  });

  it("widgety w inner-sekcji są widziane tak samo jak w kolumnie", () => {
    const inside = image();
    const doc = docWith([section([innerSection([column([inside])])])]);
    expect(lcpCandidateIds(doc)).toEqual([inside.id]);
  });

  it("nigdy nie rzuca: null, sekcje null, getter z wyjątkiem", () => {
    expect(lcpCandidates(null)).toEqual([]);
    expect(lcpCandidates(undefined)).toEqual([]);
    expect(lcpCandidates({ version: 1, sections: [null] } as unknown as BuilderDocument)).toEqual(
      [],
    );
    const hostile = {
      version: 1,
      get sections(): SectionNode[] {
        throw new Error("uszkodzony dokument");
      },
    } as unknown as BuilderDocument;
    expect(lcpCandidates(hostile)).toEqual([]);
  });

  it("wynik jest funkcją dokumentu: ten sam po serializacji (parytet SSR/hydratacja)", () => {
    const { section: s0 } = homeHeroSection({ left: 1, hero: 2, right: 3 });
    const doc = docWith([s0]);
    const roundTrip = JSON.parse(JSON.stringify(doc)) as BuilderDocument;
    expect(lcpCandidateIds(roundTrip)).toEqual(lcpCandidateIds(doc));
  });
});

describe("lcpCandidates - reguły dostępu jak w rendererze (recenzja B1)", () => {
  const onlyUsers: AccessControlSettings = { auth: "user" };
  const onlyGuests: AccessControlSettings = { auth: "guest" };

  it("sekcja „tylko dla zalogowanych”: gość dostaje kandydata z następnej sekcji, zalogowany - z niej", () => {
    const gated = image(`${COVER}?zalogowani=1`);
    const open = image(`${COVER}?wszyscy=1`);
    const doc = docWith([
      section([column([gated])], { advanced: { access: onlyUsers } }),
      section([column([open])]),
    ]);
    expect(lcpCandidateIds(doc)).toEqual([open.id]);
    expect(lcpCandidateIds(doc, { isAccessible: USER })).toEqual([gated.id]);
  });

  it("sekcja „tylko dla gości” (promo) nie jest kandydatem zalogowanego i nie zajmuje mu okna", () => {
    const text = () => section([column([heading()])]);
    const promo = image(`${COVER}?promo=1`);
    const hero = image(`${COVER}?hero=1`);
    const doc = docWith([
      section([column([promo])], { advanced: { access: onlyGuests } }),
      text(),
      text(),
      section([column([hero])]),
    ]);
    expect(lcpCandidateIds(doc)).toEqual([promo.id]);
    // Zalogowany: malowane są text, text, hero - hero jest trzecią sekcją okna.
    expect(lcpCandidateIds(doc, { isAccessible: USER })).toEqual([hero.id]);
  });

  it("kolumna z regułą: pomijana, a slot liczy się z rodzeństwa DOSTĘPNEGO (jak `visibleCols`)", () => {
    const gated = column([image(`${COVER}?duza=1`)], 8, { advanced: { access: onlyUsers } });
    const open = column([image(`${COVER}?mala=1`)], 4);
    const [candidate, ...rest] = lcpCandidates(docWith([section([gated, open])]));
    expect(rest).toEqual([]);
    expect(candidate.widget.id).toBe(open.children[0].id);
    // Renderer gościa maluje jedną kolumnę - zajmuje cały wiersz.
    expect(candidate.slot.desktop.vw).toBe(100);
    const [forUser] = lcpCandidates(docWith([section([gated, open])]), { isAccessible: USER });
    expect(forUser.widget.id).toBe(gated.children[0].id);
    expect(forUser.slot.desktop.vw).toBeCloseTo((8 / 12) * 100);
  });

  it("inner-sekcja z regułą i kolumna inner-sekcji z regułą są pomijane jak w `RenderInner`", () => {
    const gatedInner = innerSection([column([image(`${COVER}?inner=1`)])], {
      advanced: { access: onlyUsers },
    });
    const after = image(`${COVER}?po=1`);
    expect(lcpCandidateIds(docWith([section([gatedInner, column([after])])]))).toEqual([after.id]);

    const gatedCol = column([image(`${COVER}?kol=1`)], 6, { advanced: { access: onlyUsers } });
    const openCol = column([image(`${COVER}?otwarta=1`)], 6);
    const [candidate] = lcpCandidates(docWith([section([innerSection([gatedCol, openCol])])]));
    expect(candidate.widget.id).toBe(openCol.children[0].id);
    // Jedyna dostępna kolumna inner-sekcji dostaje cały jej slot.
    expect(candidate.slot.desktop.vw).toBe(100);
  });

  it("widget z regułą nie jest kandydatem - kandydatem zostaje następny malowany widget", () => {
    const gated = image(`${COVER}?ukryty=1`);
    gated.advanced = { access: onlyUsers };
    const next = image(`${COVER}?nastepny=1`);
    const doc = docWith([section([column([gated, next])])]);
    expect(lcpCandidateIds(doc)).toEqual([next.id]);
    expect(lcpCandidateIds(doc, { isAccessible: USER })).toEqual([gated.id]);
  });

  it("nieczytelna reguła (wartość spoza unii) ukrywa węzeł także dla kandydata", () => {
    const broken = image(`${COVER}?zepsuta=1`);
    broken.advanced = { access: { auth: "z-kosmosu" } as unknown as AccessControlSettings };
    const next = image(`${COVER}?nastepny=1`);
    expect(
      lcpCandidateIds(docWith([section([column([broken, next])])]), { isAccessible: USER }),
    ).toEqual([next.id]);
  });
});

describe("lcpCandidateKind - wykluczenia jak w heroImage.ts", () => {
  it.each([
    ["obraz jednoźródłowy", image(), "image"],
    ["srcDark identyczny z src to nie para", image(COVER, { srcDark: COVER }), "image"],
    ["para jasny/ciemny", image(COVER, { srcDark: `${COVER}?dark=1` }), null],
    ["logo w alcie PL", image(COVER, { alt_pl: "Logo serwisu" }), null],
    ["logo w alcie EN", image(COVER, { alt_en: "Company LOGO" }), null],
    ["flaga useSiteLogo", image(COVER, { useSiteLogo: "main" }), null],
    // Całe słowo, nie fragment (altMarksLogo): zwykłe zdjęcie z „logo” w środku wyrazu.
    ["„analogowy” w alcie to nie logo", image(COVER, { alt_pl: "Zegar analogowy" }), "image"],
    ["„logowania” w alcie EN to nie logo", image(COVER, { alt_en: "Ekran logowania" }), "image"],
    ["brak źródła", widget("image", { alt_pl: "Bez źródła" }), null],
    ["źródło o niebezpiecznym schemacie", image("javascript:alert(1)"), null],
    ["slider", slider(), "slider"],
    ["slider z wyłączonym coverem", slider({ showCover: false }), null],
    [
      "dark-featured-card z obrazem",
      widget("dark-featured-card", { image: COVER }),
      "dark-featured-card",
    ],
    ["dark-featured-card bez obrazu", widget("dark-featured-card", {}), null],
    ["post-lista (domyślna siatka)", postList(), "post-list"],
    ["post-lista z wyłączonym coverem", postList({ showCover: "0" }), null],
    ["post-lista miniaturowa (list)", postList({ variant: "list" }), null],
    ["post-lista ranked", postList({ variant: "ranked" }), null],
    ["post-lista spoza katalogu", postList({ variant: "z-kosmosu" }), null],
    [
      "karuzela w wariancie list (maluje siatkę)",
      widget("carousel", { variant: "list" }),
      "post-list",
    ],
    ["nagłówek", heading(), null],
  ] as const)("%s", (_label, node, expected) => {
    expect(lcpCandidateKind(node)).toBe(expected);
  });

  it.each([{ mobile: true }, { desktop: true }])(
    "widget schowany na urządzeniu (%o) nie jest kandydatem - preload obrazu, którego jedno urządzenie nie maluje",
    (hideOn) => {
      const hidden = image(`${COVER}?ukryty=1`, {});
      hidden.advanced = { hideOn };
      const visible = image();
      expect(lcpCandidateKind(hidden)).toBeNull();
      expect(lcpCandidateIds(docWith([section([column([hidden, visible])])]))).toEqual([
        visible.id,
      ]);
    },
  );

  it("identyfikator z białym znakiem nie jest kandydatem - nośnik `data-lcp-ids` dzieli listę po spacji", () => {
    // Serwer zapisuje kandydatów po spacji na korzeniu renderera, hydratacja
    // dzieli atrybut z powrotem (aboveFold.tsx). „w a” rozcięte na „w”, „a”
    // dałoby znacznik tylko w HTML-u serwera (rozjazd hydratacji), więc taki
    // widget ustępuje następnemu - i dla renderera, i dla preloadu.
    const spaced = image(`${COVER}?spacja=1`, {});
    spaced.id = "w z\tspacją";
    const next = image();
    const doc = docWith([section([column([spaced, next])])]);
    expect(lcpCandidateIds(doc)).toEqual([next.id]);
    expect(lcpCandidates(doc).map((c) => c.widget.id)).toEqual([next.id]);
  });

  it("pusty identyfikator nie jest kandydatem - pusty `data-lcp-ids` znaczy „bez kandydatów”", () => {
    // Serwer emituje nośnik także bez kandydatów (`data-lcp-ids=""`, recenzja
    // P1.4 runda 3, M1), a hydratacja czyta pusty atrybut jako pustą listę.
    // Kandydat o id "" dałby ten sam atrybut - znacznik tylko w HTML-u serwera.
    const empty = image(`${COVER}?pusty=1`, {});
    empty.id = "";
    const next = image();
    expect(lcpCandidateIds(docWith([section([column([empty, next])])]))).toEqual([next.id]);
  });

  it("katalog wariantów wiodących post-listy jest strażnikiem typu", () => {
    for (const variant of POST_LIST_LEAD_VARIANTS)
      expect(isPostListLeadVariant(variant)).toBe(true);
    expect(isPostListLeadVariant("numbered")).toBe(false);
  });
});

describe("lcpCandidate.ts - czystość modułu (check:entry-purity)", () => {
  it("importuje WYŁĄCZNIE imageSlot, typy i trzy liście bez własnych importów", () => {
    // BuilderRenderer jest w chunku wejściowym i importuje ten moduł statycznie
    // (gałąź `isServer` wycina go dopiero bundler). Import heroImage.ts albo
    // jakiegokolwiek modułu zapytań ciągnąłby warstwę danych do grafu entry
    // (heroImage.ts:36-47) - dokładnie to, przed czym chroni ten moduł.
    const source = readFileSync(join(process.cwd(), "src/lib/builder/lcpCandidate.ts"), "utf8");
    const specifiers = [...source.matchAll(/^import\s[^;]*?from\s+"([^"]+)";/gms)].map((m) => m[1]);
    expect(specifiers.sort()).toEqual(
      [
        "./imageSlot",
        "./logoAlt",
        "./types",
        "@/lib/content-model/contentValue",
        "@/lib/sanitizePure",
      ].sort(),
    );
    expect(source).toMatch(/^import type \{[^}]*\} from "\.\/types";$/m);
    for (const leaf of [
      "src/lib/content-model/contentValue.ts",
      "src/lib/sanitizePure.ts",
      // Predykat logo dzielony z rendererem (mediaWidgets.tsx): ta sama decyzja „logo czy zdjęcie”.
      "src/lib/builder/logoAlt.ts",
    ]) {
      const leafSource = readFileSync(join(process.cwd(), leaf), "utf8");
      expect(leafSource, leaf).not.toMatch(/^import\s/m);
    }
  });
});

describe("lcpCandidate.ts i heroImage.ts - moduły TYLKO SERWEROWE (recenzja P1.4 runda 3, m3)", () => {
  const ROOT = process.cwd();
  const SERVER_ONLY = ["src/lib/builder/lcpCandidate.ts", "src/lib/builder/heroImage.ts"];

  function sourceFiles(dir: string): string[] {
    return readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" })
      .map((file) => join(dir, file))
      .filter(
        (file) =>
          /\.(ts|tsx)$/.test(file) &&
          !/(^|\/)__tests__\//.test(file) &&
          !/\.(test|spec)\.tsx?$/.test(file) &&
          !file.endsWith(".d.ts"),
      );
  }

  /** Ścieżka modułu tylko-serwerowego, do którego prowadzi specyfikator (albo `null`). */
  function serverOnlyTarget(fromFile: string, specifier: string): string | null {
    const base = specifier.startsWith("@/")
      ? join("src", specifier.slice(2))
      : specifier.startsWith(".")
        ? relative(ROOT, resolve(ROOT, dirname(fromFile), specifier))
        : null;
    if (!base) return null;
    return SERVER_ONLY.find((file) => file === base || file === `${base}.ts`) ?? null;
  }

  /** Warunek POTWIERDZA serwer: `isServerRender()` albo koniunkcja z nim. */
  function assertsServer(expr: ts.Expression): boolean {
    const node = ts.isParenthesizedExpression(expr) ? expr.expression : expr;
    if (ts.isCallExpression(node))
      return (
        ts.isIdentifier(node.expression) &&
        node.expression.text === "isServerRender" &&
        node.arguments.length === 0
      );
    return (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      (assertsServer(node.left) || assertsServer(node.right))
    );
  }

  /** Czy węzeł leży w gałęzi wykonywanej WYŁĄCZNIE na serwerze. */
  function underServerBranch(node: ts.Node): boolean {
    for (let child = node, parent = node.parent; parent; child = parent, parent = parent.parent) {
      if (ts.isConditionalExpression(parent) && child === parent.whenTrue)
        if (assertsServer(parent.condition)) return true;
      if (ts.isIfStatement(parent) && child === parent.thenStatement)
        if (assertsServer(parent.expression)) return true;
      if (
        ts.isBinaryExpression(parent) &&
        parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
        child === parent.right &&
        assertsServer(parent.left)
      )
        return true;
    }
    return false;
  }

  function inTypePosition(node: ts.Node): boolean {
    for (let p = node.parent; p; p = p.parent) if (ts.isTypeNode(p)) return true;
    return false;
  }

  /** Użycia modułów tylko-serwerowych w pliku: importer, nazwa, linia, czy pod `isServerRender()`. */
  function serverOnlyUses(file: string) {
    const text = readFileSync(join(ROOT, file), "utf8");
    const uses: Array<{ file: string; name: string; line: number; guarded: boolean }> = [];
    // Szybkie sito: drzewo składni tylko dla plików, które w ogóle wymieniają moduł.
    if (!/lcpCandidate|heroImage/.test(text)) return uses;
    const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
    const bindings = new Set<string>();
    const record = (node: ts.Node, name: string) =>
      uses.push({
        file,
        name,
        line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        guarded: underServerBranch(node),
      });
    for (const statement of sf.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
        continue;
      if (!serverOnlyTarget(file, statement.moduleSpecifier.text)) continue;
      const clause = statement.importClause;
      if (!clause || clause.isTypeOnly) continue;
      if (clause.name) bindings.add(clause.name.text);
      const named = clause.namedBindings;
      if (named && ts.isNamespaceImport(named)) bindings.add(named.name.text);
      if (named && ts.isNamedImports(named))
        for (const el of named.elements) if (!el.isTypeOnly) bindings.add(el.name.text);
    }
    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node)) return;
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0]) &&
        serverOnlyTarget(file, node.arguments[0].text)
      )
        record(node, `import("${node.arguments[0].text}")`);
      if (
        ts.isIdentifier(node) &&
        bindings.has(node.text) &&
        !inTypePosition(node) &&
        !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) &&
        !(ts.isPropertyAssignment(node.parent) && node.parent.name === node)
      )
        record(node, node.text);
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return uses;
  }

  const uses = sourceFiles("src")
    .filter((file) => !SERVER_ONLY.includes(file))
    .flatMap(serverOnlyUses);

  it("importują je wyłącznie renderer-właściciel i dwie trasy z preloadem", () => {
    // Nowy importer wymaga świadomej decyzji: kod klienta musi wołać te moduły
    // pod `isServerRender()` (test niżej), inaczej wracają do bundla klienta.
    expect([...new Set(uses.map((use) => use.file))].sort()).toEqual(
      [
        "src/components/builder/organisms/BuilderRenderer.tsx",
        "src/routes/$.tsx",
        "src/routes/index.tsx",
      ].sort(),
    );
  });

  it("każde użycie w kodzie klienta stoi w gałęzi `isServerRender()`", () => {
    expect(uses.length).toBeGreaterThanOrEqual(5);
    expect(uses.filter((use) => !use.guarded)).toEqual([]);
  });

  it("KONTROLA NEGATYWNA: detektor widzi wywołanie poza gałęzią i warunek zanegowany", () => {
    const probe = (code: string) => {
      const sf = ts.createSourceFile("probe.ts", code, ts.ScriptTarget.Latest, true);
      let guarded: boolean | undefined;
      const visit = (node: ts.Node) => {
        if (ts.isIdentifier(node) && node.text === "builderHeroPreloads" && !guarded)
          guarded = underServerBranch(node);
        ts.forEachChild(node, visit);
      };
      visit(sf);
      return guarded;
    };
    expect(probe("const a = isServerRender() ? builderHeroPreloads(d) : [];")).toBe(true);
    expect(probe("if (isServerRender() && x) builderHeroPreloads(d);")).toBe(true);
    expect(probe("const a = builderHeroPreloads(d);")).toBe(false);
    expect(probe("const a = !isServerRender() ? builderHeroPreloads(d) : [];")).toBe(false);
    expect(probe("const a = isServerRender() || builderHeroPreloads(d);")).toBe(false);
    expect(probe("const a = isServerRender() ? [] : builderHeroPreloads(d);")).toBe(false);
  });

  it("`isServer` router-core w buildzie przeglądarki to literał `false` (bundler zwija gałąź)", () => {
    // Warunki eksportu klienta Vite w buildzie: browser/module/import/production.
    // Pierwszy pasujący klucz mapy `exports` musi wskazywać plik ze STAŁĄ
    // `false` - `undefined` (warunek `development`) albo wyrażenie
    // przywróciłoby `lcpCandidate.ts` i `heroImage.ts` do chunku wejściowego.
    const pkgDir = join(ROOT, "node_modules/@tanstack/router-core");
    const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")) as {
      exports: Record<string, unknown>;
    };
    const active = new Set(["browser", "module", "import", "production", "default"]);
    let entry: unknown = pkg.exports["./isServer"];
    while (entry && typeof entry === "object") {
      const key = Object.keys(entry).find((k) => active.has(k));
      expect(key, "warunek eksportu klienta dla ./isServer").toBeDefined();
      entry = (entry as Record<string, unknown>)[key as string];
    }
    expect(typeof entry).toBe("string");
    const clientFile = readFileSync(join(pkgDir, entry as string), "utf8");
    expect(clientFile).toMatch(/\bconst isServer = false;/);
  });
});
