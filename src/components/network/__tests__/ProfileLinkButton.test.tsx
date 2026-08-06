// ProfileLinkButton: atom nawigacyjny obok akcji Connect / DM na listach osób.
// Kontrakt: prawdziwy adres profilu z parametrem slug, etykieta z nazwą osoby
// dostępna dla czytnika ekranu, dwie wysokości (siatka gęsta / normalna) i
// zatrzymanie propagacji kliknięcia (karta osoby sama jest linkiem).
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PEER_NAME, translateKey as k } from "@/test/network/fixtures";

vi.mock("react-i18next", async () => (await import("@/test/network/fixtures")).reactI18nextStub());
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

import { ProfileLinkButton } from "@/components/network/ProfileLinkButton";

const ARIA = `${k("network.viewProfile")}: ${PEER_NAME}`;

describe("ProfileLinkButton", () => {
  it("prowadzi na profil autora po slugu i opisuje osobę w etykiecie", () => {
    render(<ProfileLinkButton slug="anna-nowak" displayName={PEER_NAME} />);
    const link = screen.getByRole("link", { name: ARIA });
    expect(link).toHaveAttribute("href", "/author/anna-nowak");
    // Etykieta jest też w treści (sr-only), więc nie polega na samym aria.
    expect(link).toHaveTextContent(ARIA);
  });

  it("wariant domyślny ma rozmiar h-9, compact h-8 (gęsta siatka kart)", () => {
    // `Button asChild` - klasy wariantu lądują na samym <a>, nie na wrapperze.
    const { unmount } = render(<ProfileLinkButton slug="s" displayName={PEER_NAME} />);
    expect(screen.getByRole("link", { name: ARIA }).className).toContain("h-9 w-9");
    unmount();

    render(<ProfileLinkButton slug="s" displayName={PEER_NAME} compact />);
    expect(screen.getByRole("link", { name: ARIA }).className).toContain("h-8 w-8");
  });

  it("dokłada className wywołującego bez gubienia klas bazowych", () => {
    render(<ProfileLinkButton slug="s" displayName={PEER_NAME} className="ml-2" />);
    const link = screen.getByRole("link", { name: ARIA });
    expect(link.className).toContain("ml-2");
    expect(link.className).toContain("shrink-0");
  });

  it("klik nie propaguje się do karty osoby (karta bywa linkiem)", () => {
    const onCardClick = vi.fn();
    render(
      <button type="button" onClick={onCardClick}>
        <ProfileLinkButton slug="anna-nowak" displayName={PEER_NAME} />
      </button>,
    );
    fireEvent.click(screen.getByRole("link", { name: ARIA }));
    expect(onCardClick).not.toHaveBeenCalled();
  });
});
