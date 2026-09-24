// Encje inline w publicznym rendererze bloków: statyczny znacznik z pre-passu
// (SSR = klient), leniwa nakładka kart i jej obsługa myszą, dotykiem
// i klawiaturą.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toJsonArray } from "@/lib/content-model/json";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { useRef } from "react";
import { BlocksRenderer } from "../BlocksRenderer";
import InlineEntityCards from "../inlineEntities/InlineEntityCards";
import { computeCardPlacement, entityProfileHref } from "../inlineEntities/cardGeometry";
import { InlineEntityCardView } from "../inlineEntities/InlineEntityCardView";
import { expandInlineEntities } from "@/lib/blocks/inlineEntities/expand";
import type { InlineEntity } from "@/lib/blocks/inlineEntities/model";
import {
  company,
  docWith,
  paragraph,
  person,
  token,
} from "@/lib/blocks/inlineEntities/__tests__/fixtures";

function setHoverDevice(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation(() => ({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

beforeEach(() => setHoverDevice(true));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("BlocksRenderer + inline entities", () => {
  const doc = docWith(
    [
      paragraph("p1", `<p>The brief was small. ${token(person())} ruled out a rewrite.</p>`),
      { id: "h1", type: "heading", data: { level: 2, text: `Partner: ${token(company())}` } },
      { id: "l1", type: "list", data: { items: [`with ${token(company())}`] } },
      {
        id: "c1",
        type: "columns",
        data: { left: toJsonArray([paragraph("p2", token(company()))]), right: [] },
      },
    ],
    [person(), company(), company({ id: "ie_unused01", name: "Unused" })],
  );

  it("server-renders the enriched trigger (no client data needed)", () => {
    const html = renderToString(<BlocksRenderer doc={doc} lang="en" />);
    expect(html).toContain('data-nes-ie-trigger="ie_maya0001"');
    expect(html).toContain("Maya Chen");
    expect(html).toContain('aria-expanded="false"');
    // Nagłówek, lista i kolumny też dostają znacznik.
    expect(html.match(/data-nes-ie-trigger="ie_acme0001"/g)?.length).toBe(3);
    // Nieużywany rekord rejestru nie trafia na stronę.
    expect(html).not.toContain("Unused");
  });

  it("produces the same trigger markup on the client (hydration-safe)", () => {
    const server = renderToString(<BlocksRenderer doc={doc} lang="en" />);
    const { container } = render(<BlocksRenderer doc={doc} lang="en" />);
    const clientTrigger = container.querySelector('[data-nes-ie="ie_maya0001"]')?.outerHTML;
    expect(clientTrigger).toBeTruthy();
    expect(server).toContain(clientTrigger!);
  });

  it("opens the card on hover once the lazy overlay has loaded", async () => {
    const { container } = render(<BlocksRenderer doc={doc} lang="en" />);
    const trigger = container.querySelector<HTMLElement>('[data-nes-ie-trigger="ie_maya0001"]')!;
    // Etykiety karty idą za językiem interfejsu (i18n), treść - za `lang`
    // materiału (tu EN: stanowisko po angielsku).
    await waitFor(() => {
      fireEvent.pointerOver(trigger, { pointerType: "mouse" });
      expect(screen.getByRole("dialog", { name: "Karta osoby: Maya Chen" })).toBeTruthy();
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Product Lead")).toBeTruthy();
  });

  it("does not mount the overlay for documents without entities", () => {
    const plain = docWith([paragraph("p1", "<p>No entities</p>")], []);
    const html = renderToString(<BlocksRenderer doc={plain} lang="pl" />);
    expect(html).not.toContain("data-nes-ie");
  });
});

function Harness({ entities, html }: { entities: InlineEntity[]; html: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  return (
    <>
      <div ref={ref} dangerouslySetInnerHTML={{ __html: html }} />
      <a href="#after">after</a>
      <InlineEntityCards entities={entities} lang="pl" containerRef={ref} />
    </>
  );
}

function mount(entities: InlineEntity[] = [company(), person()]) {
  const registry = Object.fromEntries(entities.map((e) => [e.id, e]));
  const html = expandInlineEntities(`<p>${token(company())} i ${token(person())}</p>`, registry);
  const utils = render(<Harness entities={entities} html={html} />);
  const trigger = (id: string) =>
    utils.container.querySelector<HTMLElement>(`[data-nes-ie-trigger="${id}"]`)!;
  return { ...utils, trigger };
}

describe("InlineEntityCards interactions", () => {
  it("renders nothing until a trigger is used", () => {
    mount();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("hover opens, leaving closes after a short delay", () => {
    vi.useFakeTimers();
    const { trigger } = mount();
    fireEvent.pointerOver(trigger("ie_acme0001"), { pointerType: "mouse" });
    const card = screen.getByRole("dialog", { name: "Karta firmy: Acme Energy" });
    expect(card.id).toBe("nes-ie-card-ie_acme0001");
    expect(trigger("ie_acme0001").getAttribute("aria-controls")).toBe(card.id);
    fireEvent.pointerOut(trigger("ie_acme0001"), { pointerType: "mouse" });
    expect(screen.getByRole("dialog")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger("ie_acme0001").getAttribute("aria-expanded")).toBe("false");
  });

  it("hovering the card keeps it open", () => {
    vi.useFakeTimers();
    const { trigger } = mount();
    fireEvent.pointerOver(trigger("ie_acme0001"), { pointerType: "mouse" });
    fireEvent.pointerOut(trigger("ie_acme0001"), { pointerType: "mouse" });
    const wrapper = document.querySelector<HTMLElement>("[data-nes-ie-popover]")!;
    fireEvent.pointerEnter(wrapper, { pointerType: "mouse" });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.pointerLeave(wrapper, { pointerType: "mouse" });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("click pins the card; a second click and an outside tap close it", () => {
    setHoverDevice(false);
    const { trigger } = mount();
    fireEvent.click(trigger("ie_maya0001"));
    expect(screen.getByRole("dialog", { name: "Karta osoby: Maya Chen" })).toBeTruthy();
    fireEvent.click(trigger("ie_maya0001"));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(trigger("ie_maya0001"));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("click after hover pins instead of closing; switching entity swaps the card", () => {
    const { trigger } = mount();
    fireEvent.pointerOver(trigger("ie_acme0001"), { pointerType: "mouse" });
    fireEvent.click(trigger("ie_acme0001"));
    expect(screen.getByRole("dialog", { name: "Karta firmy: Acme Energy" })).toBeTruthy();
    fireEvent.click(trigger("ie_maya0001"));
    expect(screen.getByRole("dialog", { name: "Karta osoby: Maya Chen" })).toBeTruthy();
  });

  it("keyboard focus opens, Tab enters the card, Escape closes and restores focus", () => {
    const { trigger } = mount();
    const acme = trigger("ie_acme0001");
    act(() => acme.focus());
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(acme, { key: "Tab" });
    const links = screen.getByRole("dialog").querySelectorAll("a");
    expect(document.activeElement).toBe(links[0]);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(acme);
  });

  it("Shift+Tab from the first link returns to the trigger; Tab from the last leaves the card", () => {
    const { trigger } = mount();
    const acme = trigger("ie_acme0001");
    act(() => acme.focus());
    fireEvent.keyDown(acme, { key: "Tab" });
    const dialog = screen.getByRole("dialog");
    const links = Array.from(dialog.querySelectorAll("a"));
    fireEvent.keyDown(links[0], { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(acme);
    act(() => links[links.length - 1].focus());
    fireEvent.keyDown(links[links.length - 1], { key: "Tab" });
    // Fokus wraca do tekstu ZA encją - tu to kolejna encja, więc otwiera się
    // jej karta (fokus z klawiatury), a karta firmy znika.
    expect(document.activeElement).toBe(trigger("ie_maya0001"));
    expect(screen.queryByRole("dialog", { name: "Karta firmy: Acme Energy" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Karta osoby: Maya Chen" })).toBeTruthy();
  });

  it("ignores touch hovers and unknown ids", () => {
    const { container } = mount([company()]);
    const maya = container.querySelector<HTMLElement>('[data-nes-entity="ie_maya0001"]');
    // Osoba spoza rejestru została zwykłym tekstem - nie ma czego otwierać.
    expect(maya?.textContent).toBe("Maya Chen");
    const acme = container.querySelector<HTMLElement>('[data-nes-ie-trigger="ie_acme0001"]')!;
    fireEvent.pointerOver(acme, { pointerType: "touch" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("InlineEntityCardView", () => {
  it("shows company fields with icons, links and socials", () => {
    render(<InlineEntityCardView entity={company()} lang="pl" />);
    expect(screen.getByText("Acme Energy")).toBeTruthy();
    expect(screen.getByText("Polska")).toBeTruthy();
    expect(screen.getAllByText("Energetyka").length).toBeGreaterThan(0);
    expect(screen.getByText("Magazyny energii")).toBeTruthy();
    const site = screen.getByRole("link", { name: /acme\.example\.com/ });
    expect(site.getAttribute("target")).toBe("_blank");
    expect(site.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByRole("link", { name: /LinkedIn - Acme Energy/ })).toBeTruthy();
    expect(screen.getByText("Branża")).toBeTruthy();
  });

  it("shows person fields and the internal author profile link", () => {
    const author = person({
      source: { type: "author", id: "u1", slug: "maya-chen", syncedAt: "" },
    });
    render(
      <InlineEntityCardView entity={author} lang="en" profileHref={entityProfileHref(author)} />,
    );
    expect(screen.getByText("Product Lead")).toBeTruthy();
    expect(screen.getByText("Northwind")).toBeTruthy();
    const profile = screen
      .getAllByRole("link")
      .find((a) => a.getAttribute("href") === "/people/maya-chen");
    expect(profile).toBeTruthy();
    expect(screen.getByText("MC")).toBeTruthy();
  });

  it("omits empty sections", () => {
    const bare = company({
      country: null,
      industry: { pl: "", en: "" },
      specialization: { pl: "", en: "" },
      website: "",
      socials: {},
      image: null,
    });
    const { container } = render(<InlineEntityCardView entity={bare} lang="pl" />);
    expect(container.querySelector("dl")).toBeNull();
    expect(container.querySelector("ul")).toBeNull();
  });
});

describe("placement and helpers", () => {
  const viewport = { width: 1000, height: 800 };

  it("places the card below and centred on the trigger", () => {
    const p = computeCardPlacement({ left: 400, right: 500, top: 100, bottom: 120 }, 200, viewport);
    expect(p).toEqual({ left: 306, top: 128, width: 288, flipUp: false });
  });

  it("flips above when there is no room below and clamps to the viewport", () => {
    const p = computeCardPlacement({ left: 0, right: 20, top: 700, bottom: 720 }, 200, viewport);
    expect(p.flipUp).toBe(true);
    expect(p.top).toBe(492);
    expect(p.left).toBe(8);
    const narrow = computeCardPlacement({ left: 0, right: 10, top: 0, bottom: 10 }, 50, {
      width: 200,
      height: 800,
    });
    expect(narrow.width).toBe(184);
  });

  it("keeps a card that fits nowhere inside the viewport (clamped from below)", () => {
    const p = computeCardPlacement({ left: 400, right: 500, top: 150, bottom: 170 }, 250, {
      width: 1000,
      height: 320,
    });
    expect(p.flipUp).toBe(false);
    expect(p.top).toBe(320 - 250 - 8);
    const tall = computeCardPlacement({ left: 0, right: 10, top: 100, bottom: 120 }, 900, {
      width: 1000,
      height: 320,
    });
    expect(tall.top).toBe(8);
  });

  it("builds profile links only for authors with a slug", () => {
    expect(entityProfileHref(person())).toBeNull();
    expect(entityProfileHref(company())).toBeNull();
    expect(
      entityProfileHref(person({ source: { type: "author", id: "u", slug: "a b", syncedAt: "" } })),
    ).toBe("/people/a%20b");
  });
});

describe("InlineEntityCards edge cases", () => {
  it("re-measures on scroll/resize and closes when the trigger leaves the DOM", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const { trigger } = mount();
    const acme = trigger("ie_acme0001");
    fireEvent.click(acme);
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.scroll(window);
    fireEvent.scroll(window);
    expect(frames).toHaveLength(1);
    act(() => frames[0](0));
    expect(screen.getByRole("dialog")).toBeTruthy();
    acme.remove();
    fireEvent(window, new Event("resize"));
    act(() => frames[1](0));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("flips above the trigger near the bottom edge", () => {
    const { trigger } = mount();
    const acme = trigger("ie_acme0001");
    acme.getBoundingClientRect = () =>
      ({
        left: 10,
        right: 60,
        top: window.innerHeight - 20,
        bottom: window.innerHeight - 4,
      }) as DOMRect;
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      value: 180,
    });
    fireEvent.click(acme);
    const wrapper = document.querySelector<HTMLElement>("[data-nes-ie-popover]")!;
    expect(wrapper.querySelector('[role="dialog"]')?.className).toContain("slide-in-from-bottom-1");
    Reflect.deleteProperty(HTMLElement.prototype, "offsetHeight");
  });

  it("focus-opened cards close when focus moves elsewhere; pinned cards stay", () => {
    const { trigger } = mount();
    const acme = trigger("ie_acme0001");
    act(() => acme.focus());
    expect(screen.getByRole("dialog")).toBeTruthy();
    const outside = screen.getByRole("link", { name: "after" });
    act(() => outside.focus());
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(acme);
    act(() => outside.focus());
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("ignores irrelevant events", () => {
    vi.useFakeTimers();
    const { container, trigger } = mount();
    const acme = trigger("ie_acme0001");
    // Klik i najechanie poza wyzwalaczem.
    fireEvent.click(container.querySelector("p")!);
    fireEvent.pointerOver(container.querySelector("p")!, { pointerType: "mouse" });
    fireEvent.pointerOut(container.querySelector("p")!, { pointerType: "mouse" });
    fireEvent.pointerOut(acme, { pointerType: "touch" });
    expect(screen.queryByRole("dialog")).toBeNull();
    // Tab na zamkniętym wyzwalaczu i inne klawisze nic nie robią.
    fireEvent.keyDown(acme, { key: "Tab" });
    fireEvent.keyDown(acme, { key: "Enter" });
    // Karta przypięta kliknięciem nie zamyka się po zjechaniu kursorem.
    fireEvent.pointerOver(acme, { pointerType: "mouse" });
    fireEvent.click(acme);
    fireEvent.pointerOut(acme, { pointerType: "mouse" });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
    const wrapper = document.querySelector<HTMLElement>("[data-nes-ie-popover]")!;
    fireEvent.pointerEnter(wrapper, { pointerType: "touch" });
    fireEvent.pointerLeave(wrapper, { pointerType: "touch" });
    fireEvent.keyDown(wrapper, { key: "Enter" });
    fireEvent.keyDown(document, { key: "a" });
    // Klik wewnątrz karty jej nie zamyka.
    fireEvent.pointerDown(screen.getByRole("dialog"));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("keeps focus on the trigger when the card has nothing focusable", () => {
    const bare = person({ website: "", socials: {} });
    const { trigger } = mount([company(), bare]);
    const maya = trigger("ie_maya0001");
    act(() => maya.focus());
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(maya, { key: "Tab" });
    expect(document.activeElement).toBe(maya);
    fireEvent.keyDown(document.querySelector("[data-nes-ie-popover]")!, { key: "Tab" });
    expect(document.activeElement).toBe(maya);
  });

  it("tolerates a missing matchMedia and triggers of unknown entities", () => {
    vi.stubGlobal("matchMedia", undefined);
    const registry = { [company().id]: company() };
    const html = `${expandInlineEntities(token(company()), registry)}<button data-nes-ie-trigger="ie_ghost001">?</button>`;
    const utils = render(<Harness entities={[company()]} html={html} />);
    fireEvent.click(utils.container.querySelector('[data-nes-ie-trigger="ie_ghost001"]')!);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(utils.container.querySelector('[data-nes-ie-trigger="ie_acme0001"]')!);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("Tab from the last link falls back to the trigger when nothing follows", () => {
    const registry = { [company().id]: company() };
    const html = expandInlineEntities(token(company()), registry);
    function Solo() {
      const ref = useRef<HTMLDivElement | null>(null);
      return (
        <>
          <div ref={ref} dangerouslySetInnerHTML={{ __html: html }} />
          <InlineEntityCards entities={[company()]} lang="en" containerRef={ref} />
        </>
      );
    }
    const { container } = render(<Solo />);
    const acme = container.querySelector<HTMLElement>('[data-nes-ie-trigger="ie_acme0001"]')!;
    act(() => acme.focus());
    fireEvent.keyDown(acme, { key: "Tab" });
    const links = Array.from(screen.getByRole("dialog").querySelectorAll("a"));
    act(() => links[links.length - 1].focus());
    fireEvent.keyDown(links[links.length - 1], { key: "Tab" });
    expect(document.activeElement).toBe(acme);
  });
});
