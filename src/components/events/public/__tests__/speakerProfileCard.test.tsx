// Karta prelegenta rozwijana kliknieciem w zdjecie (`SpeakerProfileCard`).
//
// SPRAWDZAMY KONTRAKT, KTORY WIDZI UCZESTNIK, NIE KLASY CSS:
// 1. domyslnie karta jest ZWINIETA - miniatura 80 px (kwadrat 2x w magazynie),
//    trzy linie podpisu z pelna wartoscia w `title`, bez pustych linii i BEZ
//    pobierania duzego kadru (800 px) - to jest koszt transferu i LCP;
// 2. karta bez zdjecia nie ma przelacznika - nie ma czego powiekszac;
// 3. klik / Escape przelaczaja stan, a fokus zostaje na tym samym przycisku;
// 4. duzy kadr jest rozgrzewany na ZAMIAR (najazd, fokus, dotyk) i tylko raz;
// 5. FLIP odgrywa ruch przez Web Animations API, a `prefers-reduced-motion`
//    wylacza go calkowicie;
// 6. przycisk akcji: profil, link zewnetrzny (nowa karta, zapowiedziana w
//    nazwie), link wewnetrzny (AppLink), albo NIC, gdy nie ma czego otworzyc.
import { createElement, forwardRef, type AnchorHTMLAttributes, type ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PublicSpeakerRow } from "@/lib/builder/speakersQuery";
import type { SpeakerTrack } from "@/lib/events/speakerCard";

// Fabryka importuje `@/test/i18nStub` - modul BEZ importow z produkcji
// (inaczej cykl inicjalizacji zawiesza plik). `t()` zwraca klucz, a parametry
// dokleja w nawiasie posortowane alfabetycznie.
vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});

// AppLink jako zwykla kotwica z ZNACZNIKIEM - test ma odroznic link wewnetrzny
// (przez router) od zewnetrznego (goly `<a target=_blank>`). Ref przechodzi
// dalej, bo FLIP mierzy przycisk akcji przez ten ref.
vi.mock("@/components/atoms/AppLink", () => ({
  AppLink: forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement>>(
    function AppLinkStub(props, ref) {
      return createElement("a", { ...props, ref, "data-app-link": "true" });
    },
  ),
}));

const { SpeakerProfileCard, SPEAKER_CARD_LARGE_PX } =
  await import("@/components/events/public/molecules/SpeakerProfileCard");
const { buildTransformedImageUrl } = await import("@/lib/cropSizes");
const { PX_BY_SIZE } = await import("@/components/events/speakerAvatarSizes");
const { SPEAKER_CARD_MOTION_MS, SPEAKER_CARD_SPRING, SPEAKER_CARD_SPRING_FALLBACK } =
  await import("@/lib/events/speakerCardMotion");

const AVATAR = "https://proj.supabase.co/storage/v1/object/public/avatars/anna.jpg";
const CARD_PHOTO = "https://proj.supabase.co/storage/v1/object/public/cards/anna-scena.jpg";

const thumbOf = (src: string): string =>
  buildTransformedImageUrl(src, {
    width: PX_BY_SIZE.xl * 2,
    height: PX_BY_SIZE.xl * 2,
    resize: "cover",
  });
const largeOf = (src: string): string =>
  buildTransformedImageUrl(src, {
    width: SPEAKER_CARD_LARGE_PX,
    height: SPEAKER_CARD_LARGE_PX,
    resize: "cover",
  });

const EXPAND = "eventFront.speakers.card.expand(lng=pl,name=Anna Kowalska)";
const COLLAPSE = "eventFront.speakers.card.collapse(lng=pl,name=Anna Kowalska)";
const PROFILE_ACTION =
  "eventFront.speakers.card.actionFor(label=eventFront.speakers.card.profileAction(lng=pl),lng=pl,name=Anna Kowalska)";
const LINK_ACTION =
  "eventFront.speakers.card.actionFor(label=eventFront.speakers.card.linkAction(lng=pl),lng=pl,name=Anna Kowalska)";

function track(over: Partial<SpeakerTrack> = {}): SpeakerTrack {
  return {
    id: "t1",
    key: "energia",
    namePl: "Energetyka",
    nameEn: "Energy",
    accentColor: "#aa3300",
    sessionsCount: 2,
    ...over,
  };
}

function speaker(overrides: Partial<PublicSpeakerRow> = {}): PublicSpeakerRow {
  return {
    user_id: "u1",
    slug: "anna-kowalska",
    display_name: "Anna Kowalska",
    avatar_url: AVATAR,
    job_title: "Dyrektor",
    company: "NASK",
    headline_pl: "Prezes",
    headline_en: "President",
    bio_pl: null,
    bio_en: null,
    topics_pl: [],
    topics_en: [],
    languages: [],
    talks_count: 0,
    rating: 0,
    reviews_count: 0,
    is_expert: false,
    has_speaker_profile: true,
    sort_order: 0,
    card_photo_url: CARD_PHOTO,
    ...overrides,
  };
}

function renderCard(
  row: PublicSpeakerRow = speaker(),
  props: { lang?: "pl" | "en"; onSelect?: (row: PublicSpeakerRow) => void } = {},
  wrap?: (card: ReactNode) => ReactNode,
) {
  const card = (
    <SpeakerProfileCard speaker={row} lang={props.lang ?? "pl"} onSelect={props.onSelect} />
  );
  const utils = render(<>{wrap ? wrap(card) : card}</>);
  const article = utils.container.querySelector("article") as HTMLElement;
  return { ...utils, article };
}

const images = (root: ParentNode): HTMLImageElement[] => Array.from(root.querySelectorAll("img"));
const srcs = (root: ParentNode): string[] =>
  images(root).map((img) => img.getAttribute("src") ?? "");

describe("SpeakerProfileCard - karta zwinieta (domyslny wyglad)", () => {
  it("domyslnie zwinieta: aria-expanded=false i miniatura 2x80 px, bez duzego kadru", () => {
    const { article } = renderCard();

    const toggle = screen.getByRole("button", { name: EXPAND });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(article.getAttribute("data-state")).toBe("collapsed");
    // Kwadrat 80 px zamawia w magazynie kwadrat 2x - ostry na ekranach HiDPI.
    expect(PX_BY_SIZE.xl).toBe(80);
    expect(srcs(toggle)).toEqual([thumbOf(AVATAR)]);
    // Duzy kadr nie istnieje w DOM, dopoki nikt nie kliknie.
    expect(article.innerHTML).not.toContain(`width=${SPEAKER_CARD_LARGE_PX}`);
  });

  it("nazwisko, rola i organizacja zostawiaja pelna wartosc w title", () => {
    renderCard(
      speaker({
        display_name: "Lech Kurklinski",
        headline_pl: "Profesor nadzwyczajny",
        company: "Szkola Glowna Handlowa w Warszawie",
      }),
    );

    expect(screen.getByText("Lech Kurklinski").getAttribute("title")).toBe("Lech Kurklinski");
    expect(screen.getByText("Profesor nadzwyczajny").getAttribute("title")).toBe(
      "Profesor nadzwyczajny",
    );
    expect(screen.getByText("Szkola Glowna Handlowa w Warszawie").getAttribute("title")).toBe(
      "Szkola Glowna Handlowa w Warszawie",
    );
  });

  it("rola idzie za jezykiem karty, a bez headline spada na stanowisko z profilu", () => {
    const { unmount } = renderCard(speaker(), { lang: "en" });
    expect(screen.getByText("President")).toBeTruthy();
    expect(screen.queryByText("Prezes")).toBeNull();
    unmount();

    renderCard(speaker({ headline_pl: null, headline_en: null, job_title: "Dyrektor" }));
    expect(screen.getByText("Dyrektor").getAttribute("title")).toBe("Dyrektor");
  });

  it("brak roli i organizacji = brak linii, a nie pusty wiersz", () => {
    const { article } = renderCard(
      speaker({ company: null, headline_pl: null, headline_en: null, job_title: null }),
    );

    const titled = Array.from(article.querySelectorAll("span[title]"));
    expect(titled.map((node) => node.getAttribute("title"))).toEqual(["Anna Kowalska"]);
    expect(article.textContent).toBe("Anna Kowalska");
  });

  it("brak nazwiska nie rysuje pustej linii nazwiska", () => {
    const { article } = renderCard(speaker({ display_name: null }));
    expect(article.querySelector('span[title=""]')).toBeNull();
    expect(
      screen.getByRole("button", { name: "eventFront.speakers.card.expand(lng=pl,name=)" }),
    ).toBeTruthy();
  });

  it("bez zadnego zdjecia nie ma przelacznika - zostaja inicjaly", () => {
    const { article } = renderCard(speaker({ avatar_url: null, card_photo_url: null }));

    expect(screen.queryByRole("button")).toBeNull();
    expect(article.querySelector("[aria-expanded]")).toBeNull();
    expect(images(article)).toHaveLength(0);
    expect(screen.getByText("AK")).toBeTruthy();
    expect(article.getAttribute("data-state")).toBe("collapsed");
  });

  it("puste albo biale adresy zdjec licza sie jak brak zdjecia", () => {
    renderCard(speaker({ avatar_url: "   ", card_photo_url: "" }));
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("samo zdjecie karty wystarcza: miniatura i duzy kadr powstaja z niego", () => {
    renderCard(speaker({ avatar_url: null }));

    const toggle = screen.getByRole("button", { name: EXPAND });
    expect(srcs(toggle)).toEqual([thumbOf(CARD_PHOTO)]);
    fireEvent.click(toggle);
    expect(srcs(toggle)).toEqual([thumbOf(CARD_PHOTO), largeOf(CARD_PHOTO)]);
  });

  it("bez zdjecia karty duzy kadr bierze zdjecie osoby", () => {
    renderCard(speaker({ card_photo_url: null }));
    const toggle = screen.getByRole("button", { name: EXPAND });
    fireEvent.click(toggle);
    expect(srcs(toggle)).toEqual([thumbOf(AVATAR), largeOf(AVATAR)]);
  });
});

describe("SpeakerProfileCard - rozwijanie i zwijanie", () => {
  it("klik rozwija: aria-expanded=true, duzy kadr 800 px nad miniatura i gradient", () => {
    const { article } = renderCard();
    const toggle = screen.getByRole("button", { name: EXPAND });

    fireEvent.click(toggle);

    // Ten sam wezel zmienia nazwe - fokus klawiatury nie ginie.
    expect(screen.getByRole("button", { name: COLLAPSE })).toBe(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(article.getAttribute("data-state")).toBe("expanded");

    const [thumb, large] = images(toggle);
    // Miniatura z cache lezy POD duzym kadrem (wczesniej w DOM) i jest ukryta
    // przed czytnikiem - to tylko tlo na czas pobierania.
    expect(thumb?.getAttribute("src")).toBe(thumbOf(AVATAR));
    expect(thumb?.getAttribute("aria-hidden")).toBe("true");
    expect(large?.getAttribute("src")).toBe(largeOf(CARD_PHOTO));
    expect(large?.getAttribute("src")).toContain(`width=${SPEAKER_CARD_LARGE_PX}`);
    expect(large?.getAttribute("src")).toContain(`height=${SPEAKER_CARD_LARGE_PX}`);
    expect(large?.getAttribute("alt")).toBe("");

    const gradient = toggle.querySelector('span[aria-hidden="true"][class*="bg-gradient-to-t"]');
    expect(gradient).not.toBeNull();
    // Podpis zostaje w drzewie (ten sam tekst, teraz na gradiencie).
    expect(screen.getByText("Anna Kowalska").getAttribute("title")).toBe("Anna Kowalska");
  });

  it("drugi klik zwija karte i zdejmuje duzy kadr", () => {
    const { article } = renderCard();
    const toggle = screen.getByRole("button", { name: EXPAND });

    fireEvent.click(toggle);
    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: EXPAND })).toBe(toggle);
    expect(article.getAttribute("data-state")).toBe("collapsed");
    expect(srcs(toggle)).toEqual([thumbOf(AVATAR)]);
    expect(toggle.querySelector('[class*="bg-gradient-to-t"]')).toBeNull();
  });

  it("Escape zwija rozwinieta karte, nie wypuszcza zdarzenia i zostawia fokus na przelaczniku", () => {
    const outer = vi.fn();
    renderCard(speaker(), {}, (card) => <div onKeyDown={outer}>{card}</div>);
    const toggle = screen.getByRole("button", { name: EXPAND });
    toggle.focus();
    fireEvent.click(toggle);

    fireEvent.keyDown(toggle, { key: "Escape" });

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);
    // Escape zamyka karte, a NIE np. dialog, w ktorym karta stoi (podglad w panelu).
    expect(outer).not.toHaveBeenCalled();
  });

  it("Escape z przycisku akcji tez zwija i przenosi fokus na przelacznik", () => {
    const onSelect = vi.fn();
    renderCard(speaker(), { onSelect });
    const toggle = screen.getByRole("button", { name: EXPAND });
    fireEvent.click(toggle);
    const action = screen.getByRole("button", { name: PROFILE_ACTION });
    action.focus();

    fireEvent.keyDown(action, { key: "Escape" });

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("Escape na zwinietej karcie nic nie robi i nie polyka zdarzenia", () => {
    const outer = vi.fn();
    renderCard(speaker(), {}, (card) => <div onKeyDown={outer}>{card}</div>);
    const toggle = screen.getByRole("button", { name: EXPAND });

    fireEvent.keyDown(toggle, { key: "Escape" });

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it("inny klawisz na rozwinietej karcie jej nie zwija", () => {
    const outer = vi.fn();
    renderCard(speaker(), {}, (card) => <div onKeyDown={outer}>{card}</div>);
    const toggle = screen.getByRole("button", { name: EXPAND });
    fireEvent.click(toggle);

    fireEvent.keyDown(toggle, { key: "Tab" });

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it("blad duzego kadru chowa go, a miniatura zostaje", () => {
    renderCard();
    const toggle = screen.getByRole("button", { name: EXPAND });
    fireEvent.click(toggle);
    const large = images(toggle).find((img) => img.getAttribute("src") === largeOf(CARD_PHOTO));
    expect(large).toBeDefined();

    fireEvent.error(large as HTMLImageElement);

    expect(srcs(toggle)).toEqual([thumbOf(AVATAR)]);
    // Karta nadal jest rozwinieta - zepsuty kadr nie zamyka jej pod reka.
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("blad JEDNEGO adresu nie gasi nastepnego - podglad w panelu zmienia adres w locie", () => {
    // Redaktor pisze adres w dialogu karty: posredni napis („https://exa")
    // daje blad obrazka, ale kadr, ktory przyjdzie po nim, ma sie pokazac.
    const NEXT_PHOTO = "https://proj.supabase.co/storage/v1/object/public/cards/anna-druga.jpg";
    const { rerender } = renderCard();
    const toggle = screen.getByRole("button", { name: EXPAND });
    fireEvent.click(toggle);
    const broken = images(toggle).find((img) => img.getAttribute("src") === largeOf(CARD_PHOTO));
    fireEvent.error(broken as HTMLImageElement);
    expect(srcs(toggle)).toEqual([thumbOf(AVATAR)]);

    rerender(<SpeakerProfileCard speaker={speaker({ card_photo_url: NEXT_PHOTO })} lang="pl" />);

    expect(srcs(toggle)).toEqual([thumbOf(AVATAR), largeOf(NEXT_PHOTO)]);
  });

  it("blad miniatury nie chowa duzego kadru", () => {
    // Zdjecie karty bez zdjecia osoby: miniatura = zdjecie karty, wiec obie
    // warstwy istnieja. Ten przypadek pilnuje, ze duzy kadr nie znika po
    // bledzie miniatury (miniatura nie ma obslugi bledu - to tylko tlo).
    renderCard(speaker({ avatar_url: null }));
    const toggle = screen.getByRole("button", { name: EXPAND });
    fireEvent.click(toggle);
    const [thumb] = images(toggle);
    fireEvent.error(thumb as HTMLImageElement);
    expect(srcs(toggle)).toContain(largeOf(CARD_PHOTO));
  });
});

describe("SpeakerProfileCard - duzy kadr rozgrzewany na zamiar", () => {
  const created: Array<{ src: string; decoding: string }> = [];

  class FakeImage {
    decoding = "";
    private value = "";
    constructor() {
      created.push(this as unknown as { src: string; decoding: string });
    }
    get src(): string {
      return this.value;
    }
    set src(next: string) {
      this.value = next;
    }
  }

  beforeEach(() => {
    created.length = 0;
    vi.stubGlobal("Image", FakeImage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("render niczego nie pobiera; najazd rozgrzewa duzy kadr dokladnie raz", () => {
    renderCard();
    const toggle = screen.getByRole("button", { name: EXPAND });
    expect(created).toHaveLength(0);

    fireEvent.pointerEnter(toggle);
    expect(created).toHaveLength(1);
    expect(created[0]?.src).toBe(largeOf(CARD_PHOTO));
    expect(created[0]?.decoding).toBe("async");

    fireEvent.focus(toggle);
    fireEvent.touchStart(toggle);
    fireEvent.pointerEnter(toggle);
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(created).toHaveLength(1);
  });

  it("fokus klawiatury rozgrzewa kadr (bez myszy)", () => {
    renderCard();
    fireEvent.focus(screen.getByRole("button", { name: EXPAND }));
    expect(created.map((image) => image.src)).toEqual([largeOf(CARD_PHOTO)]);
  });

  it("dotyk rozgrzewa kadr przed kliknieciem", () => {
    renderCard();
    fireEvent.touchStart(screen.getByRole("button", { name: EXPAND }), {
      touches: [{ clientX: 1, clientY: 1 }],
    });
    expect(created.map((image) => image.src)).toEqual([largeOf(CARD_PHOTO)]);
  });

  it("klik bez wczesniejszego zamiaru tez rozgrzewa (raz)", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: EXPAND }));
    expect(created.map((image) => image.src)).toEqual([largeOf(CARD_PHOTO)]);
  });
});

describe("SpeakerProfileCard - ruch FLIP", () => {
  interface AnimateCall {
    element: Element;
    keyframes: Keyframe[];
    options: KeyframeAnimationOptions;
    cancelled: boolean;
  }
  let calls: AnimateCall[] = [];
  let reduceMotion = false;
  let supportsLinear = true;

  const box = (top: number, left: number, width: number, height: number): DOMRect =>
    ({
      top,
      left,
      width,
      height,
      x: left,
      y: top,
      right: left + width,
      bottom: top + height,
      toJSON: () => ({}),
    }) as DOMRect;

  // Geometria zalezy od STANU karty (atrybut `data-state` jest juz nowy, gdy
  // `useLayoutEffect` mierzy drugi raz): zwinieta karta 220 px z kwadratem
  // 80 px, rozwinieta 560 px z kwadratem 280 px i napisami nizej.
  // Trwajaca (nieskasowana) animacja wysokosci ZAWYZA pomiar karty o 1000 px -
  // tak jak w przegladarce, gdzie `getBoundingClientRect` widzi stan w trakcie
  // ruchu. Dzieki temu test widzi, czy pomiar „po" stoi na czystym ukladzie.
  const inFlight = (element: Element): boolean =>
    calls.some((call) => call.element === element && !call.cancelled);

  function layout(this: Element): DOMRect {
    const card = this.closest("article");
    const open = card?.getAttribute("data-state") === "expanded";
    if (this.tagName === "ARTICLE") {
      return box(0, 0, 320, (open ? 560 : 220) + (inFlight(this) ? 1000 : 0));
    }
    if (this.hasAttribute("aria-expanded"))
      return open ? box(20, 20, 280, 280) : box(20, 20, 80, 80);
    return open ? box(240, 36, 240, 20) : box(120, 20, 240, 20);
  }

  beforeEach(() => {
    calls = [];
    reduceMotion = false;
    supportsLinear = true;
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      writable: true,
      value: function animate(
        this: Element,
        keyframes: Keyframe[],
        options: KeyframeAnimationOptions,
      ): Animation {
        const call: AnimateCall = { element: this, keyframes, options, cancelled: false };
        calls.push(call);
        return {
          cancel: () => {
            call.cancelled = true;
          },
        } as Animation;
      },
    });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(layout);
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          matches: reduceMotion && query.includes("prefers-reduced-motion: reduce"),
          media: query,
          onchange: null,
          addListener: () => undefined,
          removeListener: () => undefined,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          dispatchEvent: () => false,
        }) as MediaQueryList,
    );
    vi.stubGlobal("CSS", { supports: () => supportsLinear });
  });

  afterEach(() => {
    delete (HTMLElement.prototype as { animate?: unknown }).animate;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const callFor = (element: Element | null): AnimateCall | undefined =>
    calls.find((call) => call.element === element);

  it("rozwiniecie animuje wysokosc karty, skale i promien zdjecia oraz napisy", () => {
    const onSelect = vi.fn();
    const { article } = renderCard(speaker({ is_expert: true, tracks: [track()] }), { onSelect });
    const toggle = screen.getByRole("button", { name: EXPAND });
    // Mount nie animuje niczego - ruch jest wylacznie odpowiedzia na klik.
    expect(calls).toHaveLength(0);

    fireEvent.click(toggle);

    // Karta: sama wysokosc, z poprzedniej do nowej (wiersz siatki nie skacze).
    expect(callFor(article)?.keyframes).toEqual([{ height: "220px" }, { height: "560px" }]);
    expect(callFor(article)?.options).toEqual({
      duration: SPEAKER_CARD_MOTION_MS,
      easing: SPEAKER_CARD_SPRING,
    });

    // Zdjecie: jednorodna skala z kwadratu 80 do 280 i kontr-skalowany promien.
    const media = callFor(toggle);
    const scale = 80 / 280;
    expect(media?.keyframes[0]?.transform).toBe(`translate(0px, 0px) scale(${scale})`);
    expect(media?.keyframes[0]?.borderRadius).toBe(`${6 / scale}px`);
    expect(media?.keyframes[1]).toMatchObject({
      transform: "translate(0px, 0px) scale(1)",
      borderRadius: "6px",
    });

    // Napisy (nazwisko, rola, instytucja, sciezki z plakietka) i przycisk
    // akcji: samo przesuniecie.
    const shift = [{ transform: "translate(-16px, -120px)" }, { transform: "translate(0px, 0px)" }];
    for (const text of ["Anna Kowalska", "Prezes", "NASK"]) {
      expect(callFor(screen.getByText(text))?.keyframes).toEqual(shift);
    }
    const extras = screen.getByTitle("eventFront.speakers.expertBadge").parentElement;
    expect(callFor(extras)?.keyframes).toEqual(shift);
    expect(callFor(screen.getByRole("button", { name: PROFILE_ACTION }))?.keyframes).toEqual(shift);
    expect(calls).toHaveLength(7);
  });

  it("zwiniecie po zakonczonym ruchu odgrywa go w druga strone", () => {
    const { article } = renderCard();
    const toggle = screen.getByRole("button", { name: EXPAND });
    fireEvent.click(toggle);
    // Ruch rozwiniecia dobiegl konca (animacja nie wplywa juz na uklad).
    calls.forEach((call) => {
      call.cancelled = true;
    });
    calls = [];

    fireEvent.click(toggle);

    expect(callFor(article)?.keyframes).toEqual([{ height: "560px" }, { height: "220px" }]);
    expect(callFor(toggle)?.keyframes[0]?.transform).toBe(`translate(0px, 0px) scale(${280 / 80})`);
  });

  it("klik w trakcie ruchu kasuje trwajace animacje PRZED pomiarem nowego ukladu", () => {
    const { article } = renderCard(speaker(), { onSelect: vi.fn() });
    const toggle = screen.getByRole("button", { name: EXPAND });
    fireEvent.click(toggle);
    const firstRun = [...calls];
    expect(firstRun.length).toBeGreaterThan(0);
    expect(firstRun.every((call) => !call.cancelled)).toBe(true);

    fireEvent.click(toggle);

    // Wszystko z pierwszego klikniecia skasowane...
    expect(firstRun.every((call) => call.cancelled)).toBe(true);
    // ...a zwrot rusza z WIDOCZNEJ wysokosci (w trakcie ruchu, 560 + 1000),
    // ale ladowac ma na czystym ukladzie zwinietej karty (220), nie zawyzonym.
    const back = calls.filter((call) => call.element === article).at(-1);
    expect(back?.keyframes).toEqual([{ height: "1560px" }, { height: "220px" }]);
    expect(back?.cancelled).toBe(false);
  });

  it("zwiniecie z ograniczonym ruchem kasuje trwajacy ruch i nie startuje nowego", () => {
    renderCard();
    const toggle = screen.getByRole("button", { name: EXPAND });
    fireEvent.click(toggle);
    const firstRun = [...calls];

    reduceMotion = true;
    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(firstRun.every((call) => call.cancelled)).toBe(true);
    expect(calls).toHaveLength(firstRun.length);
  });

  it("prefers-reduced-motion: stan sie zmienia, ale nic sie nie animuje", () => {
    reduceMotion = true;
    renderCard(speaker(), { onSelect: vi.fn() });
    const toggle = screen.getByRole("button", { name: EXPAND });

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    expect(calls).toHaveLength(0);
    // Bez ruchu nie ma tez po co mierzyc ukladu.
    expect(Element.prototype.getBoundingClientRect).not.toHaveBeenCalled();
  });

  it("animowane sa tylko czesci, ktore istnieja (bez roli, instytucji i akcji)", () => {
    const { article } = renderCard(
      speaker({ company: null, headline_pl: null, headline_en: null, job_title: null }),
    );
    fireEvent.click(screen.getByRole("button", { name: EXPAND }));

    expect(calls.map((call) => call.element)).toEqual([
      article,
      screen.getByRole("button", { name: COLLAPSE }),
      screen.getByText("Anna Kowalska"),
    ]);
  });

  it("silnik bez linear() dostaje krzywa awaryjna", () => {
    supportsLinear = false;
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: EXPAND }));
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((call) => call.options.easing === SPEAKER_CARD_SPRING_FALLBACK)).toBe(true);
  });

  it("zerowe pomiary (element poza ukladem) nie daja zadnej animacji", () => {
    vi.mocked(Element.prototype.getBoundingClientRect).mockImplementation(() => box(0, 0, 0, 0));
    renderCard(speaker(), { onSelect: vi.fn() });
    const toggle = screen.getByRole("button", { name: EXPAND });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(calls).toHaveLength(0);
  });
});

describe("SpeakerProfileCard - przycisk akcji", () => {
  it("profil: jest tylko z onSelect i kontem, a klik oddaje wiersz", () => {
    const onSelect = vi.fn();
    const row = speaker();
    renderCard(row, { onSelect });

    const action = screen.getByRole("button", { name: PROFILE_ACTION });
    expect(action.textContent).toBe("eventFront.speakers.card.profileAction(lng=pl)");
    fireEvent.click(action);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]).toBe(row);
    // Klik w akcje nie przelacza karty - to osobny przycisk.
    expect(screen.getByRole("button", { name: EXPAND }).getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("bez onSelect i bez adresu redakcji nie ma przycisku akcji", () => {
    renderCard();
    expect(screen.getAllByRole("button").map((node) => node.getAttribute("aria-label"))).toEqual([
      EXPAND,
    ]);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("osoba bez konta i bez tresci profilu nie dostaje przycisku, ktory nic nie pokaze", () => {
    renderCard(speaker({ user_id: "", person_id: "p1" }), { onSelect: vi.fn() });
    expect(screen.queryByRole("button", { name: PROFILE_ACTION })).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("osoba bez konta, ale z biografia - przycisk profilu jest", () => {
    renderCard(speaker({ user_id: "", person_id: "p1", bio_pl: "Ekspertka rynku energii." }), {
      onSelect: vi.fn(),
    });
    expect(screen.getByRole("button", { name: PROFILE_ACTION })).toBeTruthy();
  });

  it("karta bez zdjecia nadal ma przycisk profilu", () => {
    const onSelect = vi.fn();
    renderCard(speaker({ avatar_url: null, card_photo_url: null }), { onSelect });
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((node) => node.getAttribute("aria-label"))).toEqual([PROFILE_ACTION]);
    fireEvent.click(buttons[0] as HTMLElement);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("link zewnetrzny otwiera nowa karte, mowi o tym w nazwie i wygrywa z profilem", () => {
    renderCard(speaker({ card_cta_url: "https://example.org/rejestracja" }), { onSelect: vi.fn() });

    const link = screen.getByRole("link", {
      name: `${LINK_ACTION} eventFront.speakers.card.opensInNewTab(lng=pl)`,
    });
    expect(link.getAttribute("href")).toBe("https://example.org/rejestracja");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.hasAttribute("data-app-link")).toBe(false);
    expect(link.textContent).toBe("eventFront.speakers.card.linkAction(lng=pl)");
    expect(screen.queryByRole("button", { name: PROFILE_ACTION })).toBeNull();
  });

  it("link wewnetrzny idzie przez AppLink w tej samej karcie", () => {
    renderCard(speaker({ card_cta_url: "/events/forum/program" }));

    const link = screen.getByRole("link", { name: LINK_ACTION });
    expect(link.getAttribute("href")).toBe("/events/forum/program");
    expect(link.getAttribute("data-app-link")).toBe("true");
    expect(link.hasAttribute("target")).toBe(false);
  });

  it("adres spoza dozwolonych ksztaltow (javascript:) nie trafia do href", () => {
    const { article } = renderCard(speaker({ card_cta_url: "javascript:alert(1)" }), {
      onSelect: vi.fn(),
    });
    expect(screen.queryByRole("link")).toBeNull();
    expect(article.innerHTML).not.toContain("javascript:");
    // Zostaje przycisk profilu - adres odrzucony, profil nadal jest co pokazac.
    expect(screen.getByRole("button", { name: PROFILE_ACTION })).toBeTruthy();
  });

  it("etykieta redakcji w jezyku karty, a w jego braku z drugiego jezyka", () => {
    const url = "https://example.org/spotkanie";
    const both = {
      card_cta_url: url,
      card_cta_label_pl: "Umow spotkanie",
      card_cta_label_en: "Book a meeting",
    };

    const first = renderCard(speaker(both), { lang: "en" });
    expect(screen.getByRole("link").textContent).toBe("Book a meeting");
    first.unmount();

    const second = renderCard(speaker(both), { lang: "pl" });
    expect(screen.getByRole("link").textContent).toBe("Umow spotkanie");
    expect(screen.getByRole("link").getAttribute("aria-label")).toBe(
      "eventFront.speakers.card.actionFor(label=Umow spotkanie,lng=pl,name=Anna Kowalska) eventFront.speakers.card.opensInNewTab(lng=pl)",
    );
    second.unmount();

    const third = renderCard(speaker({ ...both, card_cta_label_en: "  " }), { lang: "en" });
    expect(screen.getByRole("link").textContent).toBe("Umow spotkanie");
    third.unmount();

    renderCard(speaker({ card_cta_label_en: "Full bio", card_cta_label_pl: null }), {
      lang: "pl",
      onSelect: vi.fn(),
    });
    // Etykieta redakcji dziala tez na przycisku profilu.
    expect(
      screen.getByRole("button", {
        name: "eventFront.speakers.card.actionFor(label=Full bio,lng=pl,name=Anna Kowalska)",
      }).textContent,
    ).toBe("Full bio");
  });

  it("kolor redakcji dziala tylko po rozwinieciu, z czytelnym kolorem napisu", () => {
    renderCard(speaker({ card_cta_color: "#ffcc00" }), { onSelect: vi.fn() });
    const action = screen.getByRole("button", { name: PROFILE_ACTION });
    // Zwinieta karta wyglada jak dotad - napis w kolorze marki, bez tla.
    expect(action.style.backgroundColor).toBe("");
    expect(action.style.color).toBe("");

    fireEvent.click(screen.getByRole("button", { name: EXPAND }));

    expect(action.style.backgroundColor).not.toBe("");
    expect(["#ffcc00", "rgb(255, 204, 0)"]).toContain(action.style.backgroundColor);
    // Jasny zolty -> czarny napis (wiekszy kontrast wg WCAG).
    expect(["#000000", "rgb(0, 0, 0)"]).toContain(action.style.color);
    expect(action.className).not.toContain("bg-brand ");
  });

  it("ciemny kolor redakcji dostaje bialy napis", () => {
    renderCard(speaker({ card_cta_color: "#1a237e", card_cta_url: "/events/forum" }));
    fireEvent.click(screen.getByRole("button", { name: EXPAND }));
    const link = screen.getByRole("link", { name: LINK_ACTION });
    expect(["#1a237e", "rgb(26, 35, 126)"]).toContain(link.style.backgroundColor);
    expect(["#ffffff", "rgb(255, 255, 255)"]).toContain(link.style.color);
  });

  it("bledny kolor redakcji jest pomijany - przycisk bierze kolor marki", () => {
    renderCard(speaker({ card_cta_color: "zolty" }), { onSelect: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: EXPAND }));
    const action = screen.getByRole("button", { name: PROFILE_ACTION });
    expect(action.style.backgroundColor).toBe("");
    expect(action.className).toContain("bg-brand");
  });
});

describe("SpeakerProfileCard - sciezki i ekspert", () => {
  const tracks = [
    track(),
    track({
      id: "t2",
      key: "cyber",
      namePl: "Cyberbezpieczenstwo",
      nameEn: "Cybersecurity",
      accentColor: null,
    }),
  ];

  it("sciezki z obsady sesji rysuja chipy z nazwami w jezyku karty", () => {
    const { article } = renderCard(speaker({ tracks }));

    expect(screen.getByTitle("Energetyka")).toBeTruthy();
    expect(screen.getByTitle("Cyberbezpieczenstwo")).toBeTruthy();
    expect(article.textContent).toContain("eventFront.speakers.card.tracksLabel(lng=pl): ");
    expect(article.textContent).toContain("Energetyka");
    expect(article.textContent).toContain("Cyberbezpieczenstwo");
  });

  it("po angielsku chipy maja angielskie nazwy", () => {
    const { article } = renderCard(speaker({ tracks }), { lang: "en" });
    expect(article.textContent).toContain("Energy");
    expect(article.textContent).toContain("Cybersecurity");
    expect(article.textContent).not.toContain("Energetyka");
  });

  it("chipy zostaja po rozwinieciu karty (napis na zdjeciu)", () => {
    const { article } = renderCard(speaker({ tracks }));
    fireEvent.click(screen.getByRole("button", { name: EXPAND }));
    expect(screen.getByTitle("Energetyka")).toBeTruthy();
    expect(article.textContent).toContain("Cyberbezpieczenstwo");
  });

  it("plakietka eksperta stoi pod podpisem", () => {
    const { article } = renderCard(speaker({ is_expert: true }));
    const badge = screen.getByTitle("eventFront.speakers.expertBadge");
    expect(badge.textContent).toBe("eventFront.speakers.expertBadge");
    expect(article.contains(badge)).toBe(true);
  });

  it("bez sciezek i bez eksperta nie ma pustego wiersza dodatkow", () => {
    const { article } = renderCard(speaker({ tracks: [] }));
    expect(article.textContent).not.toContain("eventFront.speakers.card.tracksLabel");
    expect(screen.queryByTitle("eventFront.speakers.expertBadge")).toBeNull();
    expect(article.textContent).toBe("Anna KowalskaPrezesNASK");
  });
});
