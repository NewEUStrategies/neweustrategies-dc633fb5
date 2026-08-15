// Regresje ZNALEZIONE przez bramkę wierności ustawień (panel ⇄ renderer).
//
// Bramka pokazuje KLASĘ defektu i nie pozwala jej wrócić, ale każdy pojedynczy
// przypadek zasługuje na własny, czytelny test: bramka mówi "klucz X nie jest
// czytany", a te testy mówią "przełącznik Y naprawdę zmienia to, co widzi
// czytelnik". Jedno bez drugiego jest niepełne - bramka bez przypadków jest
// abstrakcyjna, przypadki bez bramki są punktowe.
//
// Znaleziska przypięte tutaj:
//  1. `gallery.lightbox` - komponent lightboxa istniał (PR #141) i miał testy,
//     ale NIKT go nie renderował: przełącznik w panelu nie robił nic.
//  2. `lang-switcher` - etykieta służy wyłącznie jako `aria-label`; na stronie
//     widoczne są wyłącznie flagi PL/EN z animowanym kciukiem.
//  3. Panel karuzeli - `PostListEditor` dostawał domyślny `widgetType`
//     ("post-list"), więc sekcja z autoodtwarzaniem NIE MIAŁA JAK się pokazać
//     dla widgetu `carousel`, choć renderer autoplay honorował.
//  4. `contact-form.successMsg` - formularz czytał `successMsg_${lang}`, a
//     schemat nie miał tego pola: komunikatu po wysłaniu nie dało się zmienić.
//  5. `social-icons` - kluczem kanonicznym platformy jest `x`; panel zapisuje go
//     wprost, a `twitter` czyta jako alias historyczny (`legacyKeys`).
import { describe, it, expect, vi, afterEach } from "vitest";
// Prawdziwe zasoby i18n: bez tego `t()` zwraca GOŁY KLUCZ, a asercje na
// widoczny tekst przechodziły wyłącznie dzięki `defaultValue` wpisanemu przy
// wywołaniu - czyli test sprawdzał kopię napisu z kodu, a nie to, co widzi
// użytkownik. Import wciąga rdzeń słownika (nakładki `i18n-*` dociąga sam
// komponent), więc asercja mierzy teraz wartość ze słownika.
import "@/lib/i18n";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import type { Json, WidgetContent, WidgetNode, WidgetType } from "@/lib/builder/types";
import { WIDGET_SCHEMAS } from "@/lib/builder/schemas";

// Podział kodu (React.lazy) zamieniony na importy statyczne - bez tego pierwszy
// render leniwych widgetów pokazuje fallback Suspense i synchroniczne asercje
// widzą pustkę tam, gdzie w produkcji SSR wypełnia boundary. Lustro eager jest
// kontraktowo identyczne z rejestrem (src/lib/builder/ci/__tests__/eagerWidgetChunks.test.ts).
vi.mock(
  "@/components/builder/organisms/widget-view/lazyWidgets",
  () => import("@/test/eagerWidgetChunks"),
);

vi.mock("@/hooks/useAuth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useAuth")>()),
  useRequiredTenant: () => "tenant-findings",
}));

// BEZ atrapy `react-i18next`: prawdziwy hak na prawdziwym słowniku (import
// `@/lib/i18n` wyżej). Atrapa zwracała `opts.defaultValue ?? key`, czyli test
// czytał kopię napisu wpisaną w kodzie komponentu, a nie wartość ze słownika -
// po zdjęciu zapasowych tekstów nie miała już czego zwracać. Mockować się jej
// nie da: `@/lib/i18n` sam importuje `react-i18next`, więc atrapa sięgająca po
// słownik zamyka cykl importów i test wisi bez komunikatu.

import { renderSimpleWidget } from "@/components/builder/organisms/widget-view/SimpleWidgets";
import { WidgetContentFields } from "../WidgetProperties";

const IMAGES = ["https://example.org/a.jpg", "https://example.org/b.jpg"];

function node(type: WidgetType, content: WidgetContent): WidgetNode {
  return { id: `${type}-1`, kind: "widget", type, content: content as Record<string, Json> };
}

function renderWidget(type: WidgetType, content: WidgetContent, lang: "pl" | "en" = "pl") {
  return render(<>{renderSimpleWidget(node(type, content), lang, "light")}</>);
}

/** Panel treści podpięty do stanu - dokładnie jak w edytorze. */
function renderPanel(type: WidgetType, content: WidgetContent, lang: "pl" | "en" = "pl") {
  const state: { content: WidgetContent } = { content };
  function Harness() {
    const [widget, setWidget] = useState<WidgetNode>(node(type, content));
    state.content = widget.content;
    return (
      <WidgetContentFields
        widget={widget}
        lang={lang}
        setContent={(key, value) =>
          setWidget((prev) => ({ ...prev, content: { ...prev.content, [key]: value } }))
        }
      />
    );
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
  return state;
}

afterEach(cleanup);

describe("1. galeria: przełącznik lightboxa jest podłączony do renderera", () => {
  it("bez lightboxa kafle NIE są klikalne", () => {
    const { container } = renderWidget("gallery", { images: IMAGES, lightbox: false });
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container.querySelectorAll("img")).toHaveLength(IMAGES.length);
  });

  it("z lightboxem każdy kafel dostaje przycisk otwarcia", () => {
    const { container } = renderWidget("gallery", { images: IMAGES, lightbox: true });
    expect(container.querySelectorAll("button")).toHaveLength(IMAGES.length);
  });

  it('czyta historyczny zapis `"1"` jako włączone', () => {
    const { container } = renderWidget("gallery", { images: IMAGES, lightbox: "1" });
    expect(container.querySelectorAll("button")).toHaveLength(IMAGES.length);
  });

  it("działa w każdym wariancie galerii, nie tylko w siatce", () => {
    for (const variant of ["grid", "masonry", "carousel", "polaroid"]) {
      const { container } = renderWidget("gallery", { images: IMAGES, lightbox: true, variant });
      expect(container.querySelectorAll("button"), variant).toHaveLength(IMAGES.length);
      cleanup();
    }
  });

  it("nie zmienia geometrii siatki po włączeniu (klasy layoutu wędrują na wrapper)", () => {
    const off = renderWidget("gallery", { images: IMAGES, lightbox: false, variant: "carousel" });
    const offClasses = off.container.querySelector("[class*='flex-']")?.className ?? "";
    cleanup();
    const on = renderWidget("gallery", { images: IMAGES, lightbox: true, variant: "carousel" });
    const onClasses = on.container.querySelector("[class*='flex-']")?.className ?? "";
    expect(offClasses).toContain("flex-[0_0_80%]");
    expect(onClasses).toContain("flex-[0_0_80%]");
  });
});

describe("2. przełącznik języka: etykieta jest tylko dla czytnika ekranu", () => {
  it("zachowuje aria-label, ale nie wyświetla tekstu na stronie", () => {
    const { container } = renderWidget("lang-switcher", { label_pl: "Język" });
    expect(container.querySelector("[role='group']")?.getAttribute("aria-label")).toBe("Język");
    expect(container.textContent).not.toContain("Język");
  });

  it("renderuje wyłącznie flagi PL/EN z animowanym kciukiem", () => {
    const { container } = renderWidget("lang-switcher", { label_pl: "Język" });
    expect(container.querySelectorAll("button")).toHaveLength(2);
    expect(container.querySelector(".lang__thumb")).not.toBeNull();
  });
});

describe("3. panel karuzeli dostaje własny typ widgetu", () => {
  it("carousel: sekcja autoodtwarzania jest w panelu", () => {
    renderPanel("carousel", {});
    expect(screen.getByText("Karuzela")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Autoodtwarzanie" })).toBeInTheDocument();
  });

  it("post-list: tej sekcji NIE MA (lista nie jest karuzelą)", () => {
    renderPanel("post-list", {});
    expect(screen.queryByText("Karuzela")).toBeNull();
    expect(screen.queryByRole("switch", { name: "Autoodtwarzanie" })).toBeNull();
  });

  it("przełącznik zapisuje prawdziwy boolean, a nie string", () => {
    const state = renderPanel("carousel", {});
    fireEvent.click(screen.getByRole("switch", { name: "Autoodtwarzanie" }));
    expect(state.content.autoplay).toBe(true);
  });

  it("czas slajdu pojawia się dopiero po włączeniu autoodtwarzania", () => {
    renderPanel("carousel", { autoplay: false });
    expect(screen.queryByText("Czas slajdu (ms)")).toBeNull();
    cleanup();
    renderPanel("carousel", { autoplay: true });
    expect(screen.getByText("Czas slajdu (ms)")).toBeInTheDocument();
  });
});

describe("4. formularz kontaktowy: komunikat po wysłaniu jest edytowalny", () => {
  const keys = (WIDGET_SCHEMAS["contact-form"] ?? []).map((f) => f.key);

  it("schemat ma pole pod kluczem, który czyta formularz", () => {
    expect(keys).toContain("successMsg");
  });

  it("stary widget `contact` dziedziczy ten sam schemat", () => {
    expect((WIDGET_SCHEMAS.contact ?? []).map((f) => f.key)).toContain("successMsg");
  });

  it("pole jest dwujęzyczne, bo formularz czyta `successMsg_${lang}`", () => {
    const field = (WIDGET_SCHEMAS["contact-form"] ?? []).find((f) => f.key === "successMsg");
    expect(field?.type).toBe("i18nText");
  });
});

describe("5. social-icons: panel zapisuje klucz kanoniczny, czyta alias", () => {
  const field = (WIDGET_SCHEMAS["social-icons"] ?? []).find((f) => f.key === "x");

  it("polem panelu jest `x`, nie historyczne `twitter`", () => {
    expect(field).toBeDefined();
    expect((WIDGET_SCHEMAS["social-icons"] ?? []).some((f) => f.key === "twitter")).toBe(false);
  });

  it("deklaruje `twitter` jako klucz historyczny", () => {
    expect(field?.legacyKeys).toEqual(["twitter"]);
  });

  it("renderer linkuje po nowym kluczu", () => {
    const { container } = renderWidget("social-icons", {
      linksSource: "own",
      x: "https://x.com/nes",
    });
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("https://x.com/nes");
  });

  it("renderer nadal linkuje po kluczu historycznym", () => {
    const { container } = renderWidget("social-icons", {
      linksSource: "own",
      twitter: "https://twitter.com/nes",
    });
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("https://twitter.com/nes");
  });

  it("panel pokazuje wartość zapisaną pod kluczem historycznym (zero pustych pól nad działającym ustawieniem)", () => {
    renderPanel("social-icons", { twitter: "https://twitter.com/nes" });
    const inputs = [...document.querySelectorAll("input")].map((i) => i.getAttribute("value"));
    expect(inputs).toContain("https://twitter.com/nes");
  });

  it("pierwsza edycja migruje treść na klucz kanoniczny", () => {
    const state = renderPanel("social-icons", { twitter: "https://twitter.com/nes" });
    const input = [...document.querySelectorAll("input")].find(
      (i) => i.getAttribute("value") === "https://twitter.com/nes",
    );
    expect(input).toBeDefined();
    fireEvent.change(input as HTMLInputElement, { target: { value: "https://x.com/nes" } });
    expect(state.content.x).toBe("https://x.com/nes");
    // Stary klucz zostaje nietknięty - migracja jest addytywna, nie destrukcyjna.
    expect(state.content.twitter).toBe("https://twitter.com/nes");
  });
});

describe("6. wyszukiwarka i logo: ustawienia renderera trafiły do panelu", () => {
  it("search-button ma tryb i nagłówek", () => {
    const keys = (WIDGET_SCHEMAS["search-button"] ?? []).map((f) => f.key);
    expect(keys).toContain("mode");
    expect(keys).toContain("heading");
  });

  it("tryby pokrywają dokładnie te, które rozumie renderer", () => {
    const mode = (WIDGET_SCHEMAS["search-button"] ?? []).find((f) => f.key === "mode");
    expect(mode?.options?.map((o) => o.value).sort()).toEqual([
      "dropdown",
      "fullscreen",
      "standalone",
    ]);
  });

  it("obrazek ma wybór logo witryny z wariantami, które zna renderer", () => {
    const field = (WIDGET_SCHEMAS.image ?? []).find((f) => f.key === "useSiteLogo");
    expect(field?.options?.map((o) => o.value)).toEqual(["", "main", "mobile", "transparent"]);
  });

  it("odzyskiwanie hasła ma adres z linku e-mail", () => {
    const keys = (WIDGET_SCHEMAS["lost-password-form"] ?? []).map((f) => f.key);
    expect(keys).toContain("redirectTo");
  });

  it("join-us ma rozmiar ikony ✓ i NIE ma martwych pól etykiet", () => {
    const keys = (WIDGET_SCHEMAS["join-us"] ?? []).map((f) => f.key);
    expect(keys).toContain("iconSize");
    // Formularz stoi na pływających etykietach: jedno pole = jeden napis.
    for (const dead of ["firstNameLabel", "emailLabel", "companyLabel", "interestsPlaceholder"]) {
      expect(keys, `${dead} nie ma konsumenta w JoinUsForm`).not.toContain(dead);
    }
  });

  it("contact-form ZACHOWUJE pary etykieta+placeholder (tam oba napisy żyją)", () => {
    const keys = (WIDGET_SCHEMAS["contact-form"] ?? []).map((f) => f.key);
    expect(keys).toContain("firstNameLabel");
    expect(keys).toContain("firstNamePlaceholder");
  });
});
