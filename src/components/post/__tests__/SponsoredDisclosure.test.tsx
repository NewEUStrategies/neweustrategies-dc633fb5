// Render paska ujawnienia. Testy sprawdzają WYMOGI, nie klasy CSS:
// czy etykieta jest w DOM bez interakcji, czy niesie nazwę reklamodawcy, czy link
// płatny ma rel="sponsored" i czy niepełna deklaracja nie gasi oznaczenia.
// KOLEJNOŚĆ IMPORTÓW MA ZNACZENIE. `i18n-sponsored` celowo importuje NAGI
// singleton i18next (wchodzi w graf komponentów publicznych, których testy
// mockują react-i18next), więc sam z siebie nie inicjalizuje instancji -
// rejestruje się dopiero, gdy ktoś ją zainicjuje. Bez `@/lib/i18n` render
// zobaczyłby gołe klucze zamiast etykiet.
import "@/lib/i18n";
import "@/lib/i18n-sponsored";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SponsoredDisclosure } from "../SponsoredDisclosure";

const paid = {
  is_sponsored: true,
  sponsored_kind: "advertisement",
  sponsored_advertiser_name: "ACME Europe",
  sponsored_advertiser_url: "https://acme.example",
};

describe("SponsoredDisclosure", () => {
  it("materiał bez relacji komercyjnej nie renderuje nic", () => {
    const { container } = render(<SponsoredDisclosure post={{}} lang="pl" />);
    expect(container).toBeEmptyDOMElement();
  });

  // Prawo prasowe art. 36 ust. 3 - oznaczenie musi wprost mówić, że to nie jest
  // materiał redakcyjny. Zdanie jest częścią oświadczenia, nie ozdobą.
  it("reklama: etykieta wersalikami + zdanie „nie jest materiałem redakcyjnym”", () => {
    render(<SponsoredDisclosure post={paid} lang="pl" />);
    expect(screen.getByText("MATERIAŁ REKLAMOWY")).toBeInTheDocument();
    expect(screen.getByText(/nie jest materiałem redakcyjnym/i)).toBeInTheDocument();
    expect(screen.getByText(/ACME Europe/)).toBeInTheDocument();
  });

  // Reguła dwuczęściowa UOKiK w wariancie z zachowaną niezależnością redakcyjną.
  it("materiał sponsorowany mówi, kto sfinansował i kto odpowiada za treść", () => {
    render(<SponsoredDisclosure post={{ ...paid, sponsored_kind: "sponsored" }} lang="pl" />);
    expect(screen.getByText("MATERIAŁ SPONSOROWANY")).toBeInTheDocument();
    expect(screen.getByText(/odpowiada redakcja/i)).toBeInTheDocument();
  });

  // AC-21: polska powierzchnia musi być oznaczona po polsku, angielska po angielsku.
  it("etykieta jest w języku odbiorcy", () => {
    const { unmount } = render(<SponsoredDisclosure post={paid} lang="en" />);
    expect(screen.getByText("ADVERTISEMENT")).toBeInTheDocument();
    unmount();
    render(<SponsoredDisclosure post={paid} lang="pl" />);
    expect(screen.getByText("MATERIAŁ REKLAMOWY")).toBeInTheDocument();
  });

  // FAIL-SAFE: niepełna deklaracja nie może wygasić oznaczenia.
  it("brak nazwy reklamodawcy nadal renderuje etykietę", () => {
    render(
      <SponsoredDisclosure post={{ is_sponsored: true, sponsored_kind: "sponsored" }} lang="pl" />,
    );
    expect(screen.getByText("MATERIAŁ SPONSOROWANY")).toBeInTheDocument();
    expect(screen.getByText(/charakter komercyjny/i)).toBeInTheDocument();
  });

  // Wytyczna Google: link opłacony nie może wyglądać na rekomendację redakcji.
  it('link reklamodawcy ma rel="sponsored nofollow"', () => {
    render(<SponsoredDisclosure post={paid} lang="pl" />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("https://acme.example");
    expect(link.getAttribute("rel")).toContain("sponsored");
    expect(link.getAttribute("rel")).toContain("nofollow");
  });

  // DSA art. 26 ust. 1 lit. c.
  it("płatnik innej niż reklamodawca pojawia się osobnym zdaniem", () => {
    render(
      <SponsoredDisclosure post={{ ...paid, sponsored_payer_name: "Agencja XYZ" }} lang="pl" />,
    );
    expect(screen.getByText(/Agencja XYZ/)).toBeInTheDocument();
  });

  // Rozp. (UE) 2024/900 art. 11 ust. 1.
  it("reklama polityczna dostaje własny blok z procesem i podmiotem kontrolującym", () => {
    render(
      <SponsoredDisclosure
        post={{
          ...paid,
          sponsored_political: true,
          sponsored_political_process: "rewizja REACH",
          sponsored_sponsor_controller: "Grupa ABC",
        }}
        lang="pl"
      />,
    );
    expect(screen.getByText("REKLAMA POLITYCZNA")).toBeInTheDocument();
    expect(screen.getByText(/rewizja REACH/)).toBeInTheDocument();
    expect(screen.getByText(/Grupa ABC/)).toBeInTheDocument();
  });

  // Dyr. 2005/29/WE art. 7 ust. 2 - ujawnienie także bez zapłaty za materiał.
  it("linki afiliacyjne ujawniają się samodzielnie", () => {
    render(<SponsoredDisclosure post={{ sponsored_affiliate: true }} lang="pl" />);
    expect(screen.getByText("LINKI AFILIACYJNE")).toBeInTheDocument();
    expect(screen.getByText(/prowizję/i)).toBeInTheDocument();
  });

  it("dodatkowe wyjaśnienie DOKLEJA się, nie zastępuje kanonicznej etykiety", () => {
    render(
      <SponsoredDisclosure
        post={{ ...paid, sponsored_note_pl: "Redakcja nie autoryzowała tez reklamodawcy." }}
        lang="pl"
      />,
    );
    expect(screen.getByText("MATERIAŁ REKLAMOWY")).toBeInTheDocument();
    expect(screen.getByText(/nie autoryzowała tez/i)).toBeInTheDocument();
  });

  // Oznaczenie musi być czytelne bez interakcji: żadnego <details>, żadnego
  // „pokaż więcej" (UPNPR art. 7 pkt 11 + Rekomendacje UOKiK: bez rozwijania).
  it("nie ukrywa treści w elemencie zwijanym", () => {
    const { container } = render(<SponsoredDisclosure post={paid} lang="pl" />);
    expect(container.querySelector("details")).toBeNull();
    expect(container.querySelector("[hidden]")).toBeNull();
  });

  it("region jest opisany dla czytników ekranu", () => {
    render(<SponsoredDisclosure post={paid} lang="pl" />);
    expect(screen.getByRole("note")).toHaveAttribute("aria-label");
  });
});
