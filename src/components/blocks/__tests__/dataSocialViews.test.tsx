// Publiczne widoki bloków danych i dowodu społecznego: `team-grid`,
// `logo-grid`, `feature-grid`, `alert-banner`, `divider-text`
// (`DataSocialViews.tsx`).
//
// CO MA TU DOWÓD
//  * siatki pomijają pozycje bez pola nośnego (imię / adres logo / tytuł),
//    a pusta lista nie zostawia pustej sekcji,
//  * karta członka zespołu z `href` I `social` nie zagnieżdża `<a>` w `<a>`
//    (parser HTML rozcina takie drzewo - DOM z SSR nie pasował do Reacta),
//  * linki zewnętrzne (logo, profil) otwierają się w nowej karcie z
//    `noopener noreferrer`, wewnętrzne idą przez `AppLink`,
//  * baner alertu: rola `alert`, CTA tylko z etykietą i adresem, zamknięcie
//    chowa baner; separator z tekstem ma nazwę i linie po właściwych stronach.
//
// GRANICE. Bez atrap: widoki są czysto prezentacyjne, `AppLink` bez routera
// renderuje zwykłe `<a>`.
// Napisy interfejsu widoków idą przez słownik `i18n-public` - prawdziwe i18n.
import "@/test/i18nReal";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import {
  AlertBannerView,
  DividerTextView,
  FeatureGridView,
  LogoGridView,
  TeamGridView,
} from "@/components/blocks/DataSocialViews";

afterEach(cleanup);

describe("TeamGridView", () => {
  it("pomija osoby bez imienia; imię, rola i biogram jako czysty tekst", () => {
    render(
      <TeamGridView
        title="Zespół"
        items={[
          { name: "Anna Nowak", role: "Analityczka", bio: "<p>Energetyka <b>i</b> klimat</p>" },
          { name: "", role: "Bez imienia" },
          null,
        ]}
      />,
    );
    expect(screen.getByRole("heading", { name: "Zespół" })).toBeInTheDocument();
    const members = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(members).toHaveLength(1);
    expect(within(members[0]).getByText("Analityczka")).toBeInTheDocument();
    expect(within(members[0]).getByText("Energetyka i klimat")).toBeInTheDocument();
    expect(members[0].querySelector("b")).toBeNull();
    expect(screen.queryByText("Bez imienia")).toBeNull();
  });

  it("zdjęcie ma alt z imieniem; bez zdjęcia zostaje dekoracyjny placeholder", () => {
    render(
      <TeamGridView items={[{ name: "Anna", avatar: "https://cdn/a.jpg" }, { name: "Bartek" }]} />,
    );
    expect(screen.getByRole("img", { name: "Anna" })).toHaveAttribute("src", "https://cdn/a.jpg");
    expect(screen.getAllByRole("img")).toHaveLength(1);
  });

  // NAPRAWIONE 2026-10-18: link profilu siedział WEWNĄTRZ linku karty.
  it("karta z adresem i profilem społecznościowym: dwa osobne linki, bez `<a>` w `<a>`", () => {
    const { container } = render(
      <TeamGridView
        items={[{ name: "Anna", href: "/zespol/anna", social: "https://linkedin.com/in/anna" }]}
      />,
    );
    expect(container.querySelector("a a")).toBeNull();
    expect(screen.getByRole("link", { name: /Anna/ })).toHaveAttribute("href", "/zespol/anna");
    const profile = screen.getByRole("link", { name: "Profil" });
    expect(profile).toHaveAttribute("href", "https://linkedin.com/in/anna");
    expect(profile).toHaveAttribute("target", "_blank");
    expect(profile).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("karta bez adresu nie jest linkiem; pusta lista = brak bloku", () => {
    const { container, rerender } = render(<TeamGridView items={[{ name: "Anna" }]} />);
    expect(screen.queryByRole("link")).toBeNull();
    rerender(<TeamGridView title="Zespół" items={[{ role: "bez imienia" }]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("LogoGridView", () => {
  it("pomija logo bez adresu; logo z linkiem otwiera nową kartę bezpiecznie", () => {
    render(
      <LogoGridView
        title="Zaufali nam"
        items={[
          { url: "https://cdn/a.svg", alt: "Firma A", href: "https://a.example" },
          { url: "https://cdn/b.svg", alt: "Firma B" },
          { alt: "Bez adresu" },
        ]}
      />,
    );
    expect(screen.getByRole("heading", { name: "Zaufali nam" })).toBeInTheDocument();
    expect(screen.getAllByRole("img").map((i) => i.getAttribute("alt"))).toEqual([
      "Firma A",
      "Firma B",
    ]);
    const link = screen.getByRole("link", { name: "Firma A" });
    expect(link).toHaveAttribute("href", "https://a.example");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("bez żadnego logo z adresem blok znika", () => {
    const { container } = render(<LogoGridView title="Zaufali nam" items={[{ alt: "x" }]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("FeatureGridView", () => {
  it("nagłówek z tytułem i podtytułem; pozycje bez tytułu pominięte", () => {
    render(
      <FeatureGridView
        title="Dlaczego my"
        subtitle="Trzy powody"
        items={[{ title: "Szybko", description: "W 24 h" }, { description: "bez tytułu" }]}
      />,
    );
    expect(screen.getByRole("heading", { name: "Dlaczego my" })).toBeInTheDocument();
    expect(screen.getByText("Trzy powody")).toBeInTheDocument();
    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("W 24 h")).toBeInTheDocument();
    expect(screen.queryByText("bez tytułu")).toBeNull();
  });

  it("pozycja z adresem jest w całości linkiem z zachętą; bez adresu - zwykła karta", () => {
    const { container } = render(
      <FeatureGridView
        items={[{ title: "Raporty", href: "/raporty", icon: "nieznana" }, { title: "Doradztwo" }]}
      />,
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/raporty");
    expect(within(link).getByText("Raporty")).toBeInTheDocument();
    expect(within(link).getByText("Dowiedz się więcej →")).toBeInTheDocument();
    expect(screen.getAllByText(/Dowiedz się więcej/)).toHaveLength(1);
    // Nieznana ikona z importu - ikona zastępcza zamiast wywrotki renderu.
    expect(container.querySelectorAll("li svg")).toHaveLength(2);
    expect(container.querySelector("header")).toBeNull();
  });

  it("pusta lista = brak bloku", () => {
    expect(render(<FeatureGridView title="X" items={[]} />).container).toBeEmptyDOMElement();
  });
});

describe("AlertBannerView", () => {
  it("rola `alert` z tytułem i treścią; CTA wymaga etykiety I adresu", () => {
    const { rerender } = render(
      <AlertBannerView title="Uwaga" message="Przerwa techniczna" ctaLabel="Szczegóły" />,
    );
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("Uwaga")).toBeInTheDocument();
    expect(within(alert).getByText("Przerwa techniczna")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
    rerender(<AlertBannerView title="Uwaga" ctaLabel="Szczegóły" ctaHref="/status" />);
    expect(screen.getByRole("link", { name: "Szczegóły" })).toHaveAttribute("href", "/status");
  });

  it("zamykany baner znika po kliknięciu; domyślnie nie ma przycisku zamknięcia", () => {
    const { container, rerender } = render(<AlertBannerView title="Info" />);
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<AlertBannerView title="Info" dismissible />);
    fireEvent.click(screen.getByRole("button", { name: "Zamknij alert" }));
    expect(container).toBeEmptyDOMElement();
  });

  it("ikona jest wyłączalna, a nieznany wariant spada na „info” zamiast wywrócić render", () => {
    const { rerender } = render(<AlertBannerView title="Bez ikony" showIcon={false} />);
    expect(screen.getByRole("alert").querySelector("svg")).toBeNull();
    rerender(<AlertBannerView title="Obcy" variant={"obcy" as "info"} />);
    expect(screen.getByRole("alert").querySelector("svg")).not.toBeNull();
  });
});

describe("DividerTextView", () => {
  /** Kolejność dzieci separatora: "line" dla linii, tekst dla etykiety. */
  const layout = () =>
    Array.from(screen.getByRole("separator").children).map((c) =>
      c.getAttribute("aria-hidden") === "true" ? "line" : c.textContent,
    );

  it("bez tekstu zwykła linia pozioma", () => {
    const { container } = render(<DividerTextView lineStyle="dashed" />);
    expect(container.querySelector("hr")).not.toBeNull();
    expect(screen.getByRole("separator")).not.toHaveAttribute("aria-label");
  });

  it("tekst nazywa separator; wyrównanie decyduje, po której stronie są linie", () => {
    const { rerender } = render(<DividerTextView text="lub" />);
    expect(screen.getByRole("separator", { name: "lub" })).toBeInTheDocument();
    expect(layout()).toEqual(["line", "lub", "line"]);
    rerender(<DividerTextView text="lub" align="left" lineStyle="dotted" />);
    expect(layout()).toEqual(["lub", "line"]);
    rerender(<DividerTextView text="lub" align="right" />);
    expect(layout()).toEqual(["line", "lub"]);
  });
});
