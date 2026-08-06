// KONTRAKT MOBILNEGO PASKA DOLNEGO.
//
// Test pilnuje dwóch rzeczy naraz: kontraktu produktowego (co widzi użytkownik)
// oraz WIERNOŚCI wobec referencyjnego "animated tab bar" - bo to warstwa czysto
// wizualna, której typy nie chronią, a łatwo ją zgubić przy refaktorze:
//   1. pięć pozycji ze STRONĄ GŁÓWNĄ NA ŚRODKU,
//   2. etykiety z i18n - PL i EN, bez surowych kluczy w DOM,
//   3. garb (.mbb__border) wycięty ścieżką clip-path o UNIKALNYM id,
//   4. aktywna pozycja niesie klasę `active` i kolor w --bgColorItem,
//   5. akcent podany na OBA motywy naraz (light + dark), bo wybór należy do
//      kaskady CSS, a nie do JS - inaczej SSR i klient mogłyby się rozjechać,
//   6. brak liczników dla gościa (żadnego zapytania do czatu/sieci).
import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import i18n from "@/lib/i18n";
import { MobileBottomBarView } from "../MobileBottomBarView";
import {
  MOBILE_BOTTOM_BAR_DEFAULTS,
  activeBottomBarIndex,
  visibleBottomBarItems,
} from "@/lib/mobileBottomBar/config";
import "@/lib/i18n-mobile-bottom-bar";

const items = visibleBottomBarItems(MOBILE_BOTTOM_BAR_DEFAULTS);

function renderBar(pathname = "/", lang = "pl") {
  return render(
    <MobileBottomBarView
      config={MOBILE_BOTTOM_BAR_DEFAULTS}
      items={items}
      activeIndex={activeBottomBarIndex(items, pathname)}
      lang={lang}
    />,
  );
}

beforeAll(async () => {
  await i18n.changeLanguage("pl");
});

afterEach(cleanup);

describe("MobileBottomBarView - kontrakt produktowy", () => {
  it("renderuje pięć pozycji ze stroną główną na środku", () => {
    renderBar();
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(5);
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/network",
      "/messages",
      "/",
      "/reading-list",
      "/profile",
    ]);
    // Środek listy (indeks 2 z pięciu) to strona główna - to jest kontrakt
    // produktowy paska, nie przypadek kolejności w tablicy.
    expect(links[Math.floor(links.length / 2)]).toHaveAttribute("href", "/");
  });

  it("oznacza aktywną pozycję przez aria-current, także pod prefiksem /en", () => {
    renderBar("/en/network");
    const active = screen.getAllByRole("link").filter((a) => a.getAttribute("aria-current"));
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveAttribute("href", "/network");
  });

  it("nie zaznacza nic na trasie spoza paska i chowa garb", () => {
    const { container } = renderBar("/post/jakis-wpis");
    expect(
      screen.queryAllByRole("link").filter((a) => a.getAttribute("aria-current")),
    ).toHaveLength(0);
    expect(container.querySelector(".mbb")).toHaveAttribute("data-has-active", "false");
    expect(container.querySelectorAll(".mbb__item.active")).toHaveLength(0);
  });

  it("pokazuje etykiety PL, a po zmianie języka - EN", async () => {
    renderBar("/", "pl");
    const navPl = screen.getByRole("navigation");
    expect(within(navPl).getByText("Sieć kontaktów")).toBeInTheDocument();
    expect(within(navPl).getByText("Czaty")).toBeInTheDocument();
    expect(within(navPl).getByText("Start")).toBeInTheDocument();
    expect(within(navPl).getByText("Zapisane")).toBeInTheDocument();
    expect(within(navPl).getByText("Profil")).toBeInTheDocument();
    cleanup();

    await i18n.changeLanguage("en");
    renderBar("/", "en");
    const navEn = screen.getByRole("navigation");
    expect(within(navEn).getByText("My network")).toBeInTheDocument();
    expect(within(navEn).getByText("Chats")).toBeInTheDocument();
    expect(within(navEn).getByText("Home")).toBeInTheDocument();
    expect(within(navEn).getByText("Saved")).toBeInTheDocument();
    expect(within(navEn).getByText("Profile")).toBeInTheDocument();
    await i18n.changeLanguage("pl");
  });

  it("bez podpisów etykieta zostaje nazwą dostępną linku", () => {
    const { container } = renderBar();
    // Domyślny wygląd jest referencyjny, czyli bez widocznych podpisów...
    expect(container.querySelector(".mbb__label")).toBeNull();
    // ...ale nazwa pozycji musi zostać dla czytników ekranu.
    expect(screen.getByRole("link", { name: "Start" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Czaty" })).toBeInTheDocument();
  });

  it("z włączonymi podpisami renderuje widoczne etykiety", () => {
    const { container } = render(
      <MobileBottomBarView
        config={{ ...MOBILE_BOTTOM_BAR_DEFAULTS, show_labels: true }}
        items={items}
        activeIndex={2}
        lang="pl"
      />,
    );
    expect(container.querySelectorAll(".mbb__label")).toHaveLength(5);
    expect(container.querySelector(".mbb")).toHaveAttribute("data-labels", "true");
  });

  it("nigdy nie wypuszcza surowego klucza i18n do DOM", () => {
    const { container } = renderBar();
    expect(container.textContent ?? "").not.toContain("mobileBottomBar.");
  });

  it("gość nie dostaje żadnego licznika", () => {
    const { container } = renderBar();
    expect(container.querySelector("[data-unread-badge]")).toBeNull();
  });
});

describe("MobileBottomBarView - wierność referencji", () => {
  it("niesie garb wycięty ścieżką clip-path", () => {
    const { container } = renderBar("/");
    const border = container.querySelector<HTMLElement>(".mbb__border");
    expect(border).not.toBeNull();

    const clipPath = container.querySelector("clipPath");
    expect(clipPath).not.toBeNull();
    // Ścieżka i skala normalizująca viewBox do objectBoundingBox - bez nich
    // garb nie ma kształtu z referencji.
    expect(clipPath!.getAttribute("clipPathUnits")).toBe("objectBoundingBox");
    expect(clipPath!.getAttribute("transform")).toContain("scale(0.0049285362247413");
    expect(container.querySelector("clipPath path")?.getAttribute("d")).toMatch(/^M6\.7,45\.5c/);

    // Garb odwołuje się dokładnie do tej definicji.
    expect(border!.style.clipPath).toBe(`url(#${clipPath!.id})`);
  });

  it("nadaje każdej instancji własny id clip-path", () => {
    // Pasek renderuje się także w podglądzie panelu - dwa te same id w jednym
    // dokumencie zerwałyby odwołanie url(#...) w jednej z instancji.
    const { container } = render(
      <>
        <MobileBottomBarView
          config={MOBILE_BOTTOM_BAR_DEFAULTS}
          items={items}
          activeIndex={0}
          lang="pl"
        />
        <MobileBottomBarView
          config={MOBILE_BOTTOM_BAR_DEFAULTS}
          items={items}
          activeIndex={1}
          lang="pl"
        />
      </>,
    );
    const ids = [...container.querySelectorAll("clipPath")].map((n) => n.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    // Dwukropki z useId nie mogą trafić do fragmentu url(#...).
    ids.forEach((id) => expect(id).not.toContain(":"));
  });

  it("aktywna pozycja dostaje klasę `active` z referencji", () => {
    const { container } = renderBar("/");
    const active = container.querySelectorAll(".mbb__item.active");
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveAttribute("href", "/");
  });

  it("każda pozycja niesie --bgColorItem dla jasnego i ciemnego tła", () => {
    const { container } = renderBar();
    const tabs = container.querySelectorAll<HTMLElement>(".mbb__item");
    expect(tabs).toHaveLength(5);
    tabs.forEach((tab) => {
      expect(tab.style.getPropertyValue("--bgColorItem")).toMatch(/^#[0-9a-f]{6}$/i);
      expect(tab.style.getPropertyValue("--bgColorItem-dark")).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });

  it("wystawia akcent paska na oba motywy i pigułkowy promień", () => {
    const { container } = renderBar("/");
    const nav = container.querySelector<HTMLElement>(".mbb");
    expect(nav).not.toBeNull();
    const style = nav!.style;
    // Aktywna jest strona główna: brand-ink na jasnym, brand na ciemnym.
    expect(style.getPropertyValue("--mbb-active-light")).toBe("#fa9346");
    expect(style.getPropertyValue("--mbb-active-dark")).toBe("#fa9346");
    expect(style.getPropertyValue("--mbb-radius")).toBe("20px");
    expect(style.getPropertyValue("--mbb-bg-light")).toBe("#ffffff");
    expect(style.getPropertyValue("--mbb-bg-dark")).toBe("#111318");
  });

  it("sygnalizuje kaskadzie, czy ikony mają własne kolory", () => {
    const { container: own } = renderBar();
    expect(own.querySelector(".mbb")).toHaveAttribute("data-own-colors", "true");
    cleanup();

    const { container: neutral } = render(
      <MobileBottomBarView
        config={{ ...MOBILE_BOTTOM_BAR_DEFAULTS, use_item_color: false }}
        items={items}
        activeIndex={2}
        lang="pl"
      />,
    );
    const nav = neutral.querySelector<HTMLElement>(".mbb");
    expect(nav).toHaveAttribute("data-own-colors", "false");
    // Bez kolorów pozycji akcent spada na kolor marki w obu motywach.
    expect(nav!.style.getPropertyValue("--mbb-active-light")).toBe("var(--brand)");
    expect(nav!.style.getPropertyValue("--mbb-active-dark")).toBe("var(--brand)");
  });
});
