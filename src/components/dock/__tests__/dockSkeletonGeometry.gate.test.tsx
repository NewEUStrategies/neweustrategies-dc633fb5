// BRAMKA: SZKIELET MA DOKŁADNIE TEN SAM PROSTOKĄT CO PRAWDZIWY PANEL.
//
// PO CO. Szkielet istnieje wyłącznie po to, żeby podmiana „czekam" na „treść"
// NIE RUSZAŁA UKŁADU. Gdy jego wymiary rozjadą się z `DockPanelShell`,
// szkielet przestaje rozwiązywać problem, który miał rozwiązać - i staje się
// drugim przeskokiem, dokładnie w chwili, w której użytkownik patrzy.
//
// Rozjazd jest przy tym NIEWIDOCZNY dla typów, lintu i każdego innego testu:
// obie strony to napisy klas Tailwinda w dwóch różnych plikach. Ta bramka
// czyta jedno i drugie ze ŹRÓDŁA i wymaga zgodności - bo alternatywą jest
// „ktoś zauważy okiem", a nie zauważy.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import "@/test/i18nReal";
import { dockPl } from "@/lib/i18n-dock";
import { DockDrawerSkeleton, DockPanelSkeleton } from "../atoms/DockPanelSkeleton";

const shellSource = readFileSync(
  resolve(process.cwd(), "src/components/dock/DockPanelShell.tsx"),
  "utf8",
);
const drawerSource = readFileSync(
  resolve(process.cwd(), "src/components/dock/organisms/ChatSideDrawer.tsx"),
  "utf8",
);

describe("geometria szkieletu panelu = geometria DockPanelShell", () => {
  // Klasy wymiarujące, nie kolory: te decydują o prostokącie.
  const BOX = ["rounded-[10px]", "h-[70vh]", "max-h-[560px]", "sm:w-[380px]"];

  it.each(BOX)("`%s` jest w OBU plikach", (cls) => {
    expect(shellSource, `DockPanelShell zgubił ${cls}`).toContain(cls);
    const { container } = render(<DockPanelSkeleton />);
    expect(container.firstElementChild?.className, `szkielet zgubił ${cls}`).toContain(cls);
  });

  it("szkielet i panel mają obramowanie z tej samej strony układu", () => {
    const { container } = render(<DockPanelSkeleton />);
    const className = container.firstElementChild?.className ?? "";
    for (const cls of ["border", "border-border", "bg-card", "overflow-hidden"]) {
      expect(className, `szkielet zgubił ${cls}`).toContain(cls);
      expect(shellSource, `DockPanelShell zgubił ${cls}`).toContain(cls);
    }
  });
});

describe("geometria szkieletu skrzynki = geometria ChatSideDrawer", () => {
  it.each(["w-[320px]", "max-w-[85vw]"])("`%s` jest w OBU plikach", (cls) => {
    expect(drawerSource, `ChatSideDrawer zgubił ${cls}`).toContain(cls);
    render(<DockDrawerSkeleton bottomOffset={40} />);
    const node = screen.getAllByRole("status")[0];
    expect(node?.className, `szkielet skrzynki zgubił ${cls}`).toContain(cls);
  });

  it("odsunięcie od dołu jest przekazane, żeby szkielet nie wchodził pod pasek", () => {
    render(<DockDrawerSkeleton bottomOffset={38} />);
    const wrapper = screen.getAllByRole("status")[0]?.parentElement;
    expect(wrapper?.style.bottom).toBe("38px");
  });

  it("ujemne odsunięcie jest przycinane do zera - pasek nie ma negatywnej wysokości", () => {
    render(<DockDrawerSkeleton bottomOffset={-12} />);
    const wrapper = screen.getAllByRole("status")[0]?.parentElement;
    expect(wrapper?.style.bottom).toBe("0px");
  });
});

describe("szkielet mówi czytnikowi ekranu, że coś się dzieje", () => {
  it("panel ma role=status, aria-live i aria-busy oraz zlokalizowany komunikat", () => {
    render(<DockPanelSkeleton />);
    const node = screen.getByRole("status");
    expect(node.getAttribute("aria-live")).toBe("polite");
    expect(node.getAttribute("aria-busy")).toBe("true");
    // Napis idzie ze SŁOWNIKA - zniknięcie klucza musi oblać test, a nie
    // zostawić czytelnika z ciszą.
    expect(node.textContent).toContain(dockPl.dock.loading);
  });

  it("skrzynka ma tę samą umowę", () => {
    render(<DockDrawerSkeleton bottomOffset={40} />);
    const node = screen.getAllByRole("status")[0];
    expect(node?.getAttribute("aria-busy")).toBe("true");
    expect(node?.textContent).toContain(dockPl.dock.loading);
  });
});

describe("opóźnione wejście - rozgrzane otwarcie NIE miga szkieletem", () => {
  it.each([DockPanelSkeleton, DockDrawerSkeleton])(
    "%#: używa klatki `route-skeleton-in` z opóźnieniem 140 ms",
    (Component) => {
      const { container } = render(<Component bottomOffset={40} />);
      const withAnimation = container.querySelector('[class*="route-skeleton-in"]');
      // `140ms` + `both`: do tego czasu element jest przezroczysty, więc
      // otwarcie z rozgrzanej paczki nie pokazuje szkieletu wcale.
      expect(withAnimation?.className).toContain("route-skeleton-in_260ms_ease-out_140ms_both");
    },
  );
});

describe("wiersze szkieletu są DETERMINISTYCZNE", () => {
  it("dwa rendery dają identyczny znacznik", () => {
    // Losowanie szerokości w ciele renderu dałoby inny wynik na serwerze
    // i na kliencie - czyli rozjazd hydratacji w komponencie, którego
    // jedynym zadaniem jest nie rzucać się w oczy.
    const first = render(<DockPanelSkeleton />).container.innerHTML;
    const second = render(<DockPanelSkeleton />).container.innerHTML;
    expect(first).toBe(second);
  });

  it("liczba wierszy jest sterowana propsem", () => {
    const { container } = render(<DockPanelSkeleton rows={3} />);
    const rows = container.querySelectorAll(".skeleton-shimmer");
    // Nagłówek (3) + pasek narzędzi (4) + trzy wiersze po dwa elementy.
    expect(rows.length).toBe(3 + 4 + 3 * 2);
  });
});
