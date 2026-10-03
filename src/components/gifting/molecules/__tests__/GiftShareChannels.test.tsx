// Molekula kanalow udostepniania gotowego linku podarunkowego.
//
// PO CO OSOBNY PLIK. Organizm renderuje te siatke wylacznie wtedy, gdy link
// juz istnieje, wiec przez niego nie da sie zobaczyc przypadku PUSTEJ listy
// kanalow. A to jest stan, ktory molekula musi obsluzyc sama: sam naglowek
// „Udostepnij przez" nad pusta siatka obiecuje akcje, ktorej nie ma - nadawca
// szuka przycisku, ktory nie istnieje.
//
// ATRAPY: i18n (echo klucza) i `BrandIcon` (czyta rejestr ikon przez
// react-query - granica, nie tresc tego testu). Model kanalow i atom
// `GiftChannelLink` biegna prawdziwe.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { buildGiftShareTargets } from "@/lib/gifting/model";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/i18n-gifting", () => ({}));

vi.mock("@/components/atoms/BrandIcon", () => ({
  BrandIcon: ({ alt }: { alt?: string }) => <span data-testid="brand-icon">{alt}</span>,
}));

import { GiftShareChannels } from "../GiftShareChannels";

const LINK = "https://example.org/analizy/wpis?gift=abcDEF123_-xyzABC456pqr";

const KANALY = buildGiftShareTargets({
  url: LINK,
  title: "Tytul wpisu",
  emailSubject: "Artykul dla Ciebie",
  emailBody: `Czytaj: ${LINK}`,
});

describe("GiftShareChannels", () => {
  it("PUSTA lista kanalow nie renderuje niczego - takze naglowka", () => {
    const { container } = render(<GiftShareChannels targets={[]} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("gifting.shareVia")).toBeNull();
  });

  it("kazdy kanal dostaje JEDEN link z przetlumaczona nazwa i adresem z modelu", () => {
    render(<GiftShareChannels targets={KANALY} />);
    expect(screen.getByText("gifting.shareVia")).toBeInTheDocument();
    const linki = screen.getAllByRole("link");
    expect(linki.map((a) => a.getAttribute("data-gift-channel"))).toEqual(KANALY.map((k) => k.id));
    for (const kanal of KANALY) {
      const a = screen.getByRole("link", { name: `gifting.channels.${kanal.id}` });
      expect(a).toHaveAttribute("href", kanal.href);
    }
  });

  it("klient poczty otwiera sie w TEJ karcie, platformy - w nowej, bez `opener`", () => {
    // `mailto:` w nowej karcie zostawia po sobie pusta karte; platformy
    // zewnetrzne w tej samej karcie zabieraja czytelnikowi artykul.
    render(<GiftShareChannels targets={KANALY} />);
    expect(screen.getByRole("link", { name: "gifting.channels.mail" })).toHaveAttribute(
      "target",
      "_self",
    );
    const fb = screen.getByRole("link", { name: "gifting.channels.facebook" });
    expect(fb).toHaveAttribute("target", "_blank");
    expect(fb.getAttribute("rel")).toContain("noopener");
  });
});
