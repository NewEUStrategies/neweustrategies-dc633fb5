import { createElement, forwardRef, type AnchorHTMLAttributes } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PublicSpeakerRow } from "@/lib/builder/speakersQuery";

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});

vi.mock("@/components/atoms/AppLink", () => ({
  AppLink: forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement>>(
    function AppLinkStub(props, ref) {
      return createElement("a", { ...props, ref, "data-app-link": "true" });
    },
  ),
}));

const { SpeakerProfileCard } =
  await import("@/components/events/public/molecules/SpeakerProfileCard");

const PHOTO = "https://proj.supabase.co/storage/v1/object/public/avatars/anna.jpg";
const OPEN = "eventFront.speakers.card.openProfile(lng=pl,name=Anna Kowalska)";

function speaker(overrides: Partial<PublicSpeakerRow> = {}): PublicSpeakerRow {
  return {
    user_id: "u1",
    slug: "anna-kowalska",
    display_name: "Anna Kowalska",
    avatar_url: PHOTO,
    job_title: "Dyrektor",
    company: "NASK",
    headline_pl: "Prezes",
    headline_en: "President",
    bio_pl: null,
    bio_en: null,
    topics_pl: [],
    topics_en: [],
    languages: [],
    talks_count: 0,
    rating: 0,
    reviews_count: 0,
    is_expert: false,
    has_speaker_profile: true,
    sort_order: 0,
    ...overrides,
  };
}

afterEach(() => vi.clearAllMocks());

describe("SpeakerProfileCard - redakcyjny katalog", () => {
  it("pokazuje portret, nazwisko i osobno opisane stanowisko oraz instytucję", () => {
    render(<SpeakerProfileCard speaker={speaker()} lang="pl" />);

    expect(screen.getByText("Anna Kowalska")).toBeTruthy();
    expect(screen.getByText("eventFront.speakers.card.positionLabel(lng=pl)")).toBeTruthy();
    expect(screen.getByText("Prezes").getAttribute("title")).toBe("Prezes");
    expect(screen.getByText("eventFront.speakers.card.organizationLabel(lng=pl)")).toBeTruthy();
    expect(screen.getByText("NASK").getAttribute("title")).toBe("NASK");

    const image = document.querySelector("img") as HTMLImageElement;
    expect(image.getAttribute("src")).toContain("width=480");
    expect(image.getAttribute("src")).toContain("height=480");
    expect(image.className).not.toContain("grayscale");
    expect(image.className).toContain("brightness-95");
  });

  it("otwiera profil kliknięciem całej karty i przekazuje pełny wiersz", () => {
    const row = speaker({ bio_pl: "Pełny biogram" });
    const onSelect = vi.fn();
    render(<SpeakerProfileCard speaker={row} lang="pl" onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: OPEN }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(row);
  });

  it("nie udaje interakcji dla osoby bez konta i dodatkowych danych", () => {
    render(
      <SpeakerProfileCard
        speaker={speaker({ user_id: "", person_id: "p1", bio_pl: null })}
        lang="pl"
        onSelect={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("osoba bez konta z biogramem nadal otwiera pełny profil", () => {
    const onSelect = vi.fn();
    render(
      <SpeakerProfileCard
        speaker={speaker({ user_id: "", person_id: "p1", bio_pl: "Ekspertka energii" })}
        lang="pl"
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: OPEN }));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("brak zdjęcia daje inicjały bez uszkodzonego obrazka", () => {
    render(
      <SpeakerProfileCard
        speaker={speaker({ avatar_url: null, card_photo_url: null })}
        lang="pl"
      />,
    );
    expect(screen.getByText("AK")).toBeTruthy();
    expect(screen.queryByRole("img", { hidden: true })).toBeNull();
  });

  it("błąd zdjęcia przełącza portret na inicjały", () => {
    render(<SpeakerProfileCard speaker={speaker()} lang="pl" />);
    const image = document.querySelector("img");
    expect(image).not.toBeNull();
    if (image !== null) fireEvent.error(image);
    expect(screen.getByText("AK")).toBeTruthy();
  });

  it("deduplikuje organizację powtórzoną w stanowisku", () => {
    render(
      <SpeakerProfileCard
        speaker={speaker({
          headline_pl: "Prezes WiseEuropa",
          company: "WiseEuropa",
        })}
        lang="pl"
      />,
    );
    expect(screen.getByText("Prezes WiseEuropa")).toBeTruthy();
    expect(screen.queryByText("eventFront.speakers.card.organizationLabel(lng=pl)")).toBeNull();
  });

  it("pokazuje ścieżki i oznaczenie eksperta od razu w katalogu", () => {
    render(
      <SpeakerProfileCard
        speaker={speaker({
          is_expert: true,
          tracks: [
            {
              id: "t1",
              key: "energia",
              namePl: "Energetyka",
              nameEn: "Energy",
              accentColor: null,
              sessionsCount: 2,
            },
          ],
        })}
        lang="pl"
      />,
    );
    expect(screen.getByText("Energetyka")).toBeTruthy();
    expect(screen.getByText("eventFront.speakers.expertBadge(lng=pl)")).toBeTruthy();
  });

  it("wybiera treść angielską bez mieszania języków", () => {
    render(<SpeakerProfileCard speaker={speaker()} lang="en" />);
    expect(screen.getByText("President")).toBeTruthy();
    expect(screen.queryByText("Prezes")).toBeNull();
    expect(screen.getByText("eventFront.speakers.card.positionLabel(lng=en)")).toBeTruthy();
  });

  it("zachowuje bezpieczny zewnętrzny odnośnik redakcyjny", () => {
    render(
      <SpeakerProfileCard
        speaker={speaker({
          card_cta_url: "https://example.org/program",
          card_cta_label_pl: "Program wystąpienia",
        })}
        lang="pl"
      />,
    );
    const link = screen.getByRole("link", { name: /Program wystąpienia/ });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("odrzuca niebezpieczny adres", () => {
    const { container } = render(
      <SpeakerProfileCard
        speaker={speaker({ card_cta_url: "javascript:alert(1)" })}
        lang="pl"
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.innerHTML).not.toContain("javascript:");
  });
});