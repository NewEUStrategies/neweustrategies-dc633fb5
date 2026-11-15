// Lista naturalnych rozmiarów logo dla `theme_options.logo.intrinsic`
// (src/lib/admin/logoIntrinsic.ts).
//
// CO TU MA DOWÓD
//  1. Mierzone są wyłącznie warianty renderowane na stronie jako `<img>` bez
//     ramki (sześć pól), każdy adres raz.
//  2. Kluczem pary jest adres DOKŁADNIE w postaci z pola wariantu - tak
//     porównują go renderery (`findIntrinsicSize`).
//  3. Chwilowa porażka pomiaru nie kasuje dobrej wartości zapisanej wcześniej
//     dla tego samego adresu, ale nie pożycza wartości innemu adresowi.
//  4. Lista jest budowana od nowa: wpisy adresów już nieużywanych znikają.
import { beforeEach, describe, expect, it, vi } from "vitest";

const probe = vi.hoisted(() => ({
  /** Wynik pomiaru per adres; brak wpisu = pomiar nieudany (`""`). */
  sizes: {} as Record<string, string>,
  calls: [] as string[],
}));

vi.mock("@/lib/media/measureIntrinsicSize", () => ({
  measureIntrinsicSize: async (url: string) => {
    probe.calls.push(url);
    return probe.sizes[url] ?? "";
  },
}));

import { measureLogoIntrinsic, PUBLIC_LOGO_KEYS } from "@/lib/admin/logoIntrinsic";

const A = "https://neweuropeanstrategies.com/media/theme/logo/a.svg";
const B = "https://neweuropeanstrategies.com/media/theme/logo/b.svg";
const C = "https://neweuropeanstrategies.com/media/theme/logo/c.svg";

beforeEach(() => {
  probe.sizes = {};
  probe.calls = [];
});

describe("measureLogoIntrinsic", () => {
  it("mierzy sześć wariantów publicznych i nic poza nimi", async () => {
    const logo = {
      main: "https://x.example/main.svg",
      main_dark: "https://x.example/main-dark.svg",
      mobile: "https://x.example/mobile.svg",
      mobile_dark: "https://x.example/mobile-dark.svg",
      transparent: "https://x.example/transparent.svg",
      transparent_dark: "https://x.example/transparent-dark.svg",
      organization: "https://x.example/organization.svg",
      organization_dark: "https://x.example/organization-dark.svg",
      sidebar_icon: "https://x.example/sidebar-icon.svg",
      sidebar_icon_dark: "https://x.example/sidebar-icon-dark.svg",
      sidebar_expanded: "https://x.example/sidebar-expanded.svg",
      sidebar_expanded_dark: "https://x.example/sidebar-expanded-dark.svg",
      bookmark_ios: "https://x.example/bookmark-ios.png",
      bookmark_ios_dark: "https://x.example/bookmark-ios-dark.png",
      bookmark_windows: "https://x.example/bookmark-windows.png",
      bookmark_windows_dark: "https://x.example/bookmark-windows-dark.png",
      add_to_home_screen: true,
    };
    for (const key of PUBLIC_LOGO_KEYS) probe.sizes[logo[key]] = "350x150";

    const entries = await measureLogoIntrinsic(logo);

    expect(probe.calls).toEqual(PUBLIC_LOGO_KEYS.map((key) => logo[key]));
    expect(entries).toEqual(PUBLIC_LOGO_KEYS.map((key) => [logo[key], "350x150"]));
  });

  it("ten sam adres w kilku wariantach jest mierzony i zapisany raz", async () => {
    probe.sizes = { [A]: "350x150", [B]: "700x300" };

    const entries = await measureLogoIntrinsic({
      main: A,
      main_dark: B,
      mobile: A,
      mobile_dark: B,
      transparent: A,
    });

    expect(probe.calls).toEqual([A, B]);
    expect(entries).toEqual([
      [A, "350x150"],
      [B, "700x300"],
    ]);
  });

  it("kluczem jest adres dokładnie tak, jak stoi w polu (bez normalizacji)", async () => {
    const withQuery = `${A}?v=3`;
    probe.sizes = { [withQuery]: "350x150" };

    expect(await measureLogoIntrinsic({ main: withQuery })).toEqual([[withQuery, "350x150"]]);
  });

  it("nieudany pomiar zostawia poprzedni poprawny wpis TEGO SAMEGO adresu", async () => {
    probe.sizes = { [B]: "700x300" };

    const entries = await measureLogoIntrinsic({
      main: A,
      main_dark: B,
      intrinsic: [
        [A, "350x150"],
        [B, "1x1"],
      ],
    });

    // A: pomiar padł -> stara wartość; B: świeży pomiar wygrywa ze starą.
    expect(entries).toEqual([
      [A, "350x150"],
      [B, "700x300"],
    ]);
  });

  it("nieudany pomiar bez poprzedniego wpisu (albo z błędnym) pomija adres", async () => {
    const entries = await measureLogoIntrinsic({
      main: A,
      main_dark: B,
      mobile: C,
      intrinsic: [
        [B, "0x0"],
        // Wpis innego adresu nie jest pożyczany.
        ["https://x.example/inne.svg", "350x150"],
      ],
    });

    expect(entries).toEqual([]);
  });

  it("wpisy adresów, których żaden wariant już nie używa, znikają", async () => {
    probe.sizes = { [B]: "700x300" };

    const entries = await measureLogoIntrinsic({
      main: B,
      intrinsic: [
        [A, "350x150"],
        [C, "512x128"],
      ],
    });

    expect(entries).toEqual([[B, "700x300"]]);
  });

  it("uszkodzone `intrinsic` (nie tablica) nie przeszkadza w pomiarze", async () => {
    probe.sizes = { [A]: "350x150" };

    expect(await measureLogoIntrinsic({ main: A, intrinsic: "350x150" })).toEqual([[A, "350x150"]]);
    expect(await measureLogoIntrinsic({ main: A, intrinsic: { [A]: "1x1" } })).toEqual([
      [A, "350x150"],
    ]);
  });

  it("puste pola, wartości innego typu i adresy `data:` nie są mierzone", async () => {
    const entries = await measureLogoIntrinsic({
      main: "",
      main_dark: 42,
      mobile: null,
      mobile_dark: undefined,
      transparent: "data:image/svg+xml;base64,PHN2Zy8+",
    });

    expect(probe.calls).toEqual([]);
    expect(entries).toEqual([]);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["pusty obiekt", {}],
  ])("brak logo (%s) -> pusta lista, bez pomiarów", async (_label, logo) => {
    expect(await measureLogoIntrinsic(logo)).toEqual([]);
    expect(probe.calls).toEqual([]);
  });
});
