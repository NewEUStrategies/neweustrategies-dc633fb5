// KONTRAKT MOBILNEGO PASKA DOLNEGO.
//
// Test pilnuje tego, co użytkownik faktycznie dostaje na telefonie i czego nie
// widać w typach:
//   1. pięć pozycji ze STRONĄ GŁÓWNĄ NA ŚRODKU,
//   2. etykiety z i18n - PL i EN, bez surowych kluczy w DOM,
//   3. akcent wystawiony na OBA motywy naraz (light + dark), bo wybór należy
//      do kaskady CSS, a nie do JS - inaczej SSR i klient mogłyby się rozjechać,
//   4. zaokrąglenie 6 px dojeżdżające do zmiennej --mbb-radius,
//   5. brak liczników dla gościa (żadnego zapytania do czatu/sieci).
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

describe("MobileBottomBarView", () => {
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

  it("nie zaznacza nic na trasie spoza paska i chowa marker", () => {
    const { container } = renderBar("/post/jakis-wpis");
    expect(
      screen.queryAllByRole("link").filter((a) => a.getAttribute("aria-current")),
    ).toHaveLength(0);
    expect(container.querySelector(".mbb")).toHaveAttribute("data-has-active", "false");
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

  it("nigdy nie wypuszcza surowego klucza i18n do DOM", () => {
    const { container } = renderBar();
    expect(container.textContent ?? "").not.toContain("mobileBottomBar.");
  });

  it("wystawia akcent na oba motywy i promień 6 px", () => {
    const { container } = renderBar("/");
    const nav = container.querySelector<HTMLElement>(".mbb");
    expect(nav).not.toBeNull();
    const style = nav!.style;
    // Aktywna jest strona główna: brand-ink na jasnym, brand na ciemnym.
    expect(style.getPropertyValue("--mbb-active-light")).toBe("#b85410");
    expect(style.getPropertyValue("--mbb-active-dark")).toBe("#fa9346");
    expect(style.getPropertyValue("--mbb-radius")).toBe("6px");
    expect(style.getPropertyValue("--mbb-bg-light")).toBe("#ffffff");
    expect(style.getPropertyValue("--mbb-bg-dark")).toBe("#111318");
  });

  it("każda pozycja niesie własny akcent dla jasnego i ciemnego tła", () => {
    const { container } = renderBar();
    const tabs = container.querySelectorAll<HTMLElement>(".mbb__item");
    expect(tabs).toHaveLength(5);
    tabs.forEach((tab) => {
      expect(tab.style.getPropertyValue("--mbb-item")).toMatch(/^#[0-9a-f]{6}$/i);
      expect(tab.style.getPropertyValue("--mbb-item-dark")).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });

  it("gość nie dostaje żadnego licznika", () => {
    const { container } = renderBar();
    expect(container.querySelector("[data-unread-badge]")).toBeNull();
  });

  it("z wyłączonymi podpisami etykieta zostaje dla czytników ekranu", () => {
    const { container } = render(
      <MobileBottomBarView
        config={{ ...MOBILE_BOTTOM_BAR_DEFAULTS, show_labels: false }}
        items={items}
        activeIndex={2}
        lang="pl"
      />,
    );
    expect(container.querySelector(".mbb__label")).toBeNull();
    expect(screen.getByRole("link", { name: "Start" })).toBeInTheDocument();
  });
});
