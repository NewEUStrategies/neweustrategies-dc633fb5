// Karta oznaczenia komercyjnego. Najważniejszy test w tym pliku to ten pierwszy:
// pilnuje, że włączenie flagi i wybór rodzaju relacji lecą JEDNYM patchem.
// Rozbicie ich na dwa `set()` przywróciłoby stan „materiał komercyjny bez rodzaju
// relacji", który baza odrzuca CHECK-iem - a odrzucenie dotyczy całego wiersza,
// więc autozapis gubiłby razem z deklaracją niezwiązane zmiany treści.
import "@/lib/i18n";
import "@/lib/i18n-admin-post-panes";
import "@/lib/i18n-sponsored";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PostSponsoredCard } from "../PostSponsoredCard";
import type { PostForm } from "../../types";

/** Minimalny formularz - tylko pola, których karta dotyka. */
function form(overrides: Partial<PostForm> = {}): PostForm {
  return {
    is_sponsored: false,
    sponsored_kind: null,
    sponsored_advertiser_name: null,
    sponsored_advertiser_url: null,
    sponsored_payer_name: null,
    sponsored_note_pl: null,
    sponsored_note_en: null,
    sponsored_affiliate: false,
    sponsored_political: false,
    sponsored_political_process: null,
    sponsored_sponsor_controller: null,
    sponsored_order_ref: null,
    sponsored_marked_at: null,
    organization_id: null,
    organization_name: null,
    organization_logo_url: null,
    organization_website: null,
    ...overrides,
  } as PostForm;
}

function renderCard(f: PostForm, onPatch = vi.fn()) {
  render(
    <TooltipProvider>
      <PostSponsoredCard form={f} uiLang="pl" onPatch={onPatch} />
    </TooltipProvider>,
  );
  return onPatch;
}

describe("PostSponsoredCard", () => {
  it("włączenie flagi ustawia rodzaj relacji W TYM SAMYM patchu", () => {
    const onPatch = renderCard(form());
    fireEvent.click(screen.getByRole("switch", { name: /Materiał komercyjny/i }));
    expect(onPatch).toHaveBeenCalledTimes(1);
    const patch = onPatch.mock.calls[0][0];
    expect(patch.is_sponsored).toBe(true);
    expect(patch.sponsored_kind).toBeTruthy();
  });

  it("podpowiada przypisaną organizację jako reklamodawcę", () => {
    const onPatch = renderCard(
      form({ organization_name: "ACME Europe", organization_website: "https://acme.example" }),
    );
    fireEvent.click(screen.getByRole("switch", { name: /Materiał komercyjny/i }));
    const patch = onPatch.mock.calls[0][0];
    expect(patch.sponsored_advertiser_name).toBe("ACME Europe");
    expect(patch.sponsored_advertiser_url).toBe("https://acme.example");
  });

  // Wyłączenie flagi nie może zostawić „reklamy politycznej" bez materiału
  // komercyjnego - CHECK posts_sponsored_political_check odrzuciłby taki wiersz.
  it("wyłączenie flagi zdejmuje też znacznik reklamy politycznej", () => {
    const onPatch = renderCard(
      form({ is_sponsored: true, sponsored_kind: "sponsored", sponsored_political: true }),
    );
    fireEvent.click(screen.getByRole("switch", { name: /Materiał komercyjny/i }));
    const patch = onPatch.mock.calls[0][0];
    expect(patch.is_sponsored).toBe(false);
    expect(patch.sponsored_political).toBe(false);
  });

  // Deklaracja jest kosztowna do odtworzenia; przełączanie flagi w tę i z powrotem
  // nie może czyścić ustalonych danych reklamodawcy.
  it("wyłączenie flagi NIE czyści nazwy reklamodawcy", () => {
    const onPatch = renderCard(
      form({
        is_sponsored: true,
        sponsored_kind: "advertisement",
        sponsored_advertiser_name: "ACME Europe",
      }),
    );
    fireEvent.click(screen.getByRole("switch", { name: /Materiał komercyjny/i }));
    const patch = onPatch.mock.calls[0][0];
    expect(patch).not.toHaveProperty("sponsored_advertiser_name");
  });

  it("pola deklaracji są ukryte, dopóki materiał nie jest komercyjny", () => {
    renderCard(form());
    expect(screen.queryByText(/Reklamodawca \/ sponsor/i)).not.toBeInTheDocument();
  });

  it("oznacza brakujące pola wymagane do publikacji", () => {
    renderCard(form({ is_sponsored: true, sponsored_kind: "sponsored" }));
    // Gwiazdka przy etykiecie - brak reklamodawcy i jego adresu blokuje publikację.
    expect(screen.getAllByText("*").length).toBeGreaterThanOrEqual(2);
  });

  // Afiliacja stoi poza blokiem sponsoringu: prowizja podlega ujawnieniu także
  // w materiale, za który nikt nie zapłacił (dyr. 2005/29/WE art. 7 ust. 2).
  it("przełącznik linków afiliacyjnych działa bez flagi komercyjnej", () => {
    const onPatch = renderCard(form());
    fireEvent.click(screen.getByRole("switch", { name: /linki afiliacyjne/i }));
    expect(onPatch).toHaveBeenCalledWith({ sponsored_affiliate: true });
  });

  it("ostrzega, że stała współpraca to nie barter", () => {
    renderCard(form({ is_sponsored: true, sponsored_kind: "barter" }));
    expect(screen.getByText(/współpracę reklamową, nie barter/i)).toBeInTheDocument();
  });

  // Podgląd renderuje PRAWDZIWY komponent publiczny - makieta rozjechałaby się
  // z produkcją przy pierwszej zmianie brzmienia etykiety.
  it("pokazuje podgląd etykiety widzianej przez czytelnika", () => {
    renderCard(
      form({
        is_sponsored: true,
        sponsored_kind: "advertisement",
        sponsored_advertiser_name: "ACME Europe",
      }),
    );
    expect(screen.getByText("MATERIAŁ REKLAMOWY")).toBeInTheDocument();
  });
});
