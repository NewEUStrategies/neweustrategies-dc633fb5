// Ekran „moduł wyłączony" - ślepy zaułek, który MUSI mieć wyjście.
//
// PO CO TEN PLIK ISTNIEJE. `CommunityDisabled` był na dokładnym zerze pomiaru
// (0/2 linie), a jest jedynym ekranem, jaki widzi odwiedzający, gdy administrator
// zdejmie przełącznik w `site_settings.community_modules`. Renderuje go dziewięć
// tras publicznych (`/qa`, `/qa/$slug`, `/events`, `/events/$slug`, `/contribute`,
// `/messages`, `/network`, `/club`...), zawsze jako CAŁĄ zawartość strony -
// zamiast listy, zamiast wydarzenia, zamiast rozmów.
//
// CO Z TEGO WYNIKA DLA DOWODU. Ekran, który zastępuje treść, ma dokładnie dwa
// obowiązki i oba da się cicho zepsuć:
//
//   1. POWIEDZIEĆ, ŻE TO NIE AWARIA. Wyłączony moduł i zepsuty moduł wyglądają
//      dla odwiedzającego identycznie, dopóki ktoś nie napisze, że to stan
//      przejściowy. Napis idzie przez i18n - a strona ma wersję angielską, więc
//      polski komunikat na `/en/` byłby defektem, którego nie widzi ani
//      `check:i18n-parity`, ani przegląd kodu. Dlatego sprawdzamy OBA języki.
//   2. DAĆ WYJŚCIE. Poza tym przyciskiem na tej stronie nie ma nic: ani
//      nawigacji modułu (bo modułu nie ma), ani listy, ani wyszukiwarki. Jeśli
//      przycisk przestanie prowadzić na stronę główną, jedynym wyjściem
//      zostaje przycisk „wstecz" przeglądarki. Dlatego wyjście jest tu
//      dowodzone SKUTKIEM - kliknięciem w prawdziwym routerze, po którym pod
//      adresem stoi strona główna - a nie samym atrybutem `href`.
//
// CZEGO TEN EKRAN NIE ROBI - USTALENIE, NIE POSTULAT. Komponent nie przyjmuje
// ŻADNYCH właściwości, więc nie może powiedzieć, KTÓRY moduł jest wyłączony ani
// kiedy wróci. Odwiedzający `/events` i odwiedzający `/messages` dostają ten sam
// napis. To jest świadomy koszt jednego wspólnego ekranu dla dziewięciu tras,
// a nie przeoczenie - i test poniżej mierzy właśnie to (brak właściwości), żeby
// zmiana kontraktu wymagała zmiany dowodu.
//
// CO JEST ATRAPOWANE: NIC. Router jest prawdziwy (pamięciowa historia, dwie
// trasy), `react-i18next` prawdziwy, słownik `@/lib/i18n-community` rejestruje
// się efektem importu komponentu. Atrapa `Link` (`@/test/routerLinkStub`)
// byłaby tu utratą całego dowodu z punktu 2: odbijałaby z powrotem `to`, które
// sama dostała, zamiast pokazać, dokąd router naprawdę przechodzi.
import { beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";

import i18n from "@/lib/i18n";
import { realT } from "@/test/i18nReal";
import { axeViolations, summarize } from "@/test/axe";
import { CommunityDisabled } from "@/components/community/CommunityDisabled";

const t = realT("pl");
const tEn = realT("en");

/** Jedna z dziewięciu tras, które renderują ten ekran zamiast swojej treści. */
const ADRES_MODULU = "/qa";

/**
 * Montuje ekran w prawdziwym routerze razem ze stroną główną, żeby kliknięcie
 * w wyjście miało dokąd prowadzić.
 */
async function zamontuj() {
  const root = createRootRoute({ component: () => <Outlet /> });
  const stronaGlowna = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: () => <div data-testid="strona-glowna">STRONA GŁÓWNA</div>,
  });
  const modul = createRoute({
    getParentRoute: () => root,
    path: ADRES_MODULU,
    component: () => <CommunityDisabled />,
  });
  const router = createRouter({
    routeTree: root.addChildren([stronaGlowna, modul]),
    history: createMemoryHistory({ initialEntries: [ADRES_MODULU] }),
  });
  await router.load();
  const widok = render(<RouterProvider router={router} />);
  // Router domyka przejście poza `render()`; bez tego taktu React zasypuje log
  // ostrzeżeniami „update was not wrapped in act".
  await act(async () => {});
  return { ...widok, sciezka: () => router.state.location.pathname };
}

beforeEach(() => {
  cleanup();
});

describe("ekran wyłączonego modułu - co mówi odwiedzającemu", () => {
  it("mówi, że moduł jest WYŁĄCZONY CHWILOWO - a nie że coś padło", async () => {
    await zamontuj();

    // Nagłówek pierwszego poziomu: ten ekran jest całą stroną, a nie kartą
    // wewnątrz innej treści.
    expect(
      screen.getByRole("heading", { level: 1, name: t("community.disabled.title") }),
    ).toBeInTheDocument();
    expect(screen.getByText(t("community.disabled.body"))).toBeInTheDocument();
    // Kontrola sensu napisów: brakujący klucz i18next zwraca jako samego
    // siebie, więc bez tego asercje wyżej przechodziłyby na surowym
    // „community.disabled.title" wyświetlonym użytkownikowi.
    for (const klucz of ["title", "body", "cta"] as const) {
      expect(t(`community.disabled.${klucz}`)).not.toContain("community.disabled.");
    }
  });

  it("po angielsku mówi po angielsku - i to jest inny napis, nie ten sam", async () => {
    await i18n.changeLanguage("en");
    try {
      await zamontuj();

      expect(
        screen.getByRole("heading", { level: 1, name: tEn("community.disabled.title") }),
      ).toBeInTheDocument();
      expect(screen.getByText(tEn("community.disabled.body"))).toBeInTheDocument();
      expect(screen.getByRole("link", { name: tEn("community.disabled.cta") })).toBeInTheDocument();
      // Dowód, że porównujemy dwa słowniki, a nie ten sam dwa razy.
      expect(tEn("community.disabled.title")).not.toBe(t("community.disabled.title"));
    } finally {
      // Odmontowanie PRZED powrotem do polskiego: `changeLanguage`
      // przerenderowuje każdy zamontowany komponent, a ten render nie należy
      // już do żadnego testu.
      cleanup();
      await i18n.changeLanguage("pl");
    }
  });

  it("nie przyjmuje właściwości - ten sam napis dla wszystkich modułów", async () => {
    // POMIAR ŚWIADOMEGO KOSZTU, opisanego w nagłówku pliku: jeden ekran obsługuje
    // dziewięć tras, więc nie może nazwać modułu. Gdyby ktoś dołożył tu props
    // (np. nazwę modułu albo termin powrotu), ta asercja zapali się i wymusi
    // opisanie nowego kontraktu zamiast cichej zmiany.
    expect(CommunityDisabled).toHaveLength(0);

    await zamontuj();
    expect(screen.getByText(t("community.disabled.body"))).not.toHaveTextContent(/Q&A|events/i);
  });
});

describe("ekran wyłączonego modułu - wyjście ze ślepego zaułka", () => {
  it("wyjście prowadzi na stronę główną - MIERZONE PRZEJŚCIEM, nie atrybutem", async () => {
    const { sciezka } = await zamontuj();
    expect(sciezka()).toBe(ADRES_MODULU);

    const wyjscie = screen.getByRole("link", { name: t("community.disabled.cta") });
    expect(wyjscie).toHaveAttribute("href", "/");

    await act(async () => {
      fireEvent.click(wyjscie);
    });

    // Skutek, nie markup: router faktycznie stoi na stronie głównej.
    expect(sciezka()).toBe("/");
    expect(screen.getByTestId("strona-glowna")).toBeInTheDocument();
  });

  it("wyjście jest JEDYNYM odnośnikiem na ekranie", async () => {
    // Ekran zastępuje całą treść modułu. Drugi odnośnik znaczyłby, że coś
    // z wyłączonego modułu jednak przecieka na zewnątrz.
    const { container } = await zamontuj();

    expect(container.querySelectorAll("a")).toHaveLength(1);
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});

describe("ekran wyłączonego modułu - dostępność", () => {
  it("nie ma naruszeń axe", async () => {
    const { container } = await zamontuj();

    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });
});
