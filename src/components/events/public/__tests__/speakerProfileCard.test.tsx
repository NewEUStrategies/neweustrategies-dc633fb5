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
const { EventDirectoryProvider } =
  await import("@/components/events/public/directory/EventDirectoryContext");
const { buildEventDirectory } = await import("@/lib/events/eventDirectory");

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

/** Karta pod dostawcą okien - tak, jak rysuje ją zakładka publiczna. */
function renderInDirectory(row: PublicSpeakerRow) {
  const directory = buildEventDirectory({ speakers: [row] }, "pl");
  return render(
    <EventDirectoryProvider directory={directory} slug="szczyt" eventId="e1" live={false}>
      <SpeakerProfileCard speaker={row} lang="pl" />
    </EventDirectoryProvider>,
  );
}

describe("SpeakerProfileCard - redakcyjny katalog", () => {
  it("firma to kopia lacznego podpisu - rozdziela stanowisko i instytucje", () => {
    // Realny przypadek danych GGM 2021: pole firmy powtorzylo stanowisko.
    render(
      <SpeakerProfileCard
        speaker={speaker({
          headline_pl: "Prezes Zarządu IPN",
          headline_en: "President of IPN",
          company: "Prezes Zarządu IPN",
          job_title: "Prezes Zarządu IPN",
        })}
        lang="pl"
      />,
    );

    expect(screen.getByText("eventFront.speakers.card.positionLabel(lng=pl)")).toBeTruthy();
    expect(screen.getByText("Prezes Zarządu")).toBeTruthy();
    expect(screen.getByText("eventFront.speakers.card.organizationLabel(lng=pl)")).toBeTruthy();
    expect(screen.getByText("IPN")).toBeTruthy();
  });

  it("etykiety stanowiska i instytucji zostają dla czytnika ekranu, nie na oko", () => {
    render(<SpeakerProfileCard speaker={speaker()} lang="pl" />);
    const position = screen.getByText("eventFront.speakers.card.positionLabel(lng=pl)");
    const organization = screen.getByText("eventFront.speakers.card.organizationLabel(lng=pl)");
    // Para etykieta -> wartość jest listą definicji: czytnik czyta „Stanowisko:
    // Prezes", a wzrok widzi samą hierarchię kroju.
    expect(position.tagName).toBe("DT");
    expect(position.className).toContain("sr-only");
    expect(position.nextElementSibling?.textContent).toBe("Prezes");
    expect(organization.className).toContain("sr-only");
  });

  it("pokazuje portret, nazwisko i osobno opisane stanowisko oraz instytucję", () => {
    render(<SpeakerProfileCard speaker={speaker()} lang="pl" />);

    expect(screen.getByText("Anna Kowalska")).toBeTruthy();
    expect(screen.getByText("eventFront.speakers.card.positionLabel(lng=pl)")).toBeTruthy();
    expect(screen.getByText("Prezes")).toBeTruthy();
    expect(screen.getByText("eventFront.speakers.card.organizationLabel(lng=pl)")).toBeTruthy();
    expect(screen.getByText("NASK")).toBeTruthy();

    // Kadr PIONOWY 4:5 - transformacja i pudło karty mają tę samą proporcję,
    // więc `object-cover` nie przycina twarzy drugi raz.
    const image = document.querySelector("img") as HTMLImageElement;
    expect(image.getAttribute("src")).toContain("width=480");
    expect(image.getAttribute("src")).toContain("height=600");
    expect(image.parentElement?.className).toContain("aspect-[4/5]");
    expect(image.className).not.toContain("grayscale");
    expect(image.className).toContain("brightness-95");
  });

  it("utrzymuje proporcje logo i zostawia szerokie znaki w wydłużonym kadrze", () => {
    render(
      <SpeakerProfileCard
        speaker={speaker({ card_institution_logo_url: "https://example.org/logo.png" })}
        lang="pl"
      />,
    );

    const logo = screen.getByRole("img", { name: "NASK" });
    expect(logo.getAttribute("data-logo-shape")).toBe("compact");
    expect(logo.className).toContain("size-6");
    Object.defineProperties(logo, {
      naturalWidth: { configurable: true, value: 500 },
      naturalHeight: { configurable: true, value: 100 },
    });
    fireEvent.load(logo);
    expect(logo.getAttribute("data-logo-shape")).toBe("elongated");
    expect(logo.className).toContain("h-6");
    expect(logo.className).toContain("w-auto");
  });

  it("poziome logo WiseEuropa prowadzi do kwadratowego kadru", () => {
    render(
      <SpeakerProfileCard
        speaker={speaker({
          company: "WiseEuropa",
          card_institution_logo_url: "https://example.org/wiseeuropa.png",
        })}
        lang="pl"
      />,
    );

    const logo = screen.getByRole("img", { name: "WiseEuropa" });
    Object.defineProperties(logo, {
      naturalWidth: { configurable: true, value: 500 },
      naturalHeight: { configurable: true, value: 100 },
    });
    fireEvent.load(logo);
    expect(logo.getAttribute("data-logo-shape")).toBe("compact");
    expect(logo.className).toContain("size-6");
    expect(logo.className).toContain("object-cover");
  });

  it("otwiera profil kliknięciem całej karty i przekazuje pełny wiersz", () => {
    const row = speaker({ bio_pl: "Pełny biogram" });
    const onSelect = vi.fn();
    render(<SpeakerProfileCard speaker={row} lang="pl" onSelect={onSelect} />);

    const button = screen.getByRole("button", { name: OPEN });
    // Rozciągnięty przycisk: jego `::after` przykrywa CAŁĄ kartę (portret też),
    // a karta-kontener jest punktem odniesienia nakładki.
    expect(button.className).toContain("after:inset-0");
    expect(button.closest("article")?.className).toContain("relative");
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(row);
  });

  it("karta, której nie da się kliknąć, nie drga pod kursorem", () => {
    // Ruch portretu przy najechaniu obiecuje okno - grupa hover stoi wyłącznie
    // na karcie interaktywnej.
    const { container, rerender } = render(<SpeakerProfileCard speaker={speaker()} lang="pl" />);
    expect(container.querySelector("article")?.className).not.toContain("group/speaker");
    rerender(<SpeakerProfileCard speaker={speaker()} lang="pl" onSelect={vi.fn()} />);
    expect(container.querySelector("article")?.className).toContain("group/speaker");
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

  it("rozdziela instytucję powtórzoną w stanowisku", () => {
    render(
      <SpeakerProfileCard
        speaker={speaker({
          headline_pl: "Prezes WiseEuropa",
          company: "WiseEuropa",
        })}
        lang="pl"
      />,
    );
    expect(screen.getByText("eventFront.speakers.card.positionLabel(lng=pl)")).toBeTruthy();
    expect(screen.getByText("Prezes")).toBeTruthy();
    expect(screen.getByText("eventFront.speakers.card.organizationLabel(lng=pl)")).toBeTruthy();
    expect(screen.getByText("WiseEuropa")).toBeTruthy();
  });

  it("zachowuje ścieżki dla czytnika ekranu bez widocznych etykiet na karcie", () => {
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
    expect(screen.getByText("Energetyka").closest(".sr-only")).not.toBeNull();
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

  it("bez dostawcy okien instytucja jest tekstem, a nie martwym przyciskiem", () => {
    render(
      <SpeakerProfileCard speaker={speaker({ bio_pl: "Biogram" })} lang="pl" onSelect={vi.fn()} />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: OPEN })).toBeTruthy();
  });

  it("odrzuca niebezpieczny adres", () => {
    const { container } = render(
      <SpeakerProfileCard speaker={speaker({ card_cta_url: "javascript:alert(1)" })} lang="pl" />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.innerHTML).not.toContain("javascript:");
  });
});

describe("SpeakerProfileCard - pod dostawcą okien profilu", () => {
  it("cała karta otwiera okno osoby, a nazwa przycisku niesie nazwisko", () => {
    renderInDirectory(speaker());
    const person = screen.getByRole("button", { name: OPEN });
    expect(person.getAttribute("aria-haspopup")).toBe("dialog");
    expect(person.className).toContain("after:inset-0");
  });

  it("instytucja to OSOBNY przycisk nad nakładką, bez nazwiska w nazwie", () => {
    renderInDirectory(speaker());
    const company = screen.getByRole("button", {
      name: "eventFront.directory.openCompany(lng=pl,name=NASK)",
    });
    expect(company.getAttribute("aria-haspopup")).toBe("dialog");
    // Nad rozciągniętą nakładką osoby - inaczej klik w firmę otwierałby osobę.
    expect(company.className).toContain("z-10");
    // Bramka bez konta szuka przycisku osoby po NAZWISKU - nazwa firmy nie
    // może go nieść, bo dałaby dwa trafienia.
    expect(screen.getAllByRole("button", { name: /Anna Kowalska/ })).toHaveLength(1);
    // Nigdy przycisk w przycisku.
    expect(company.closest("button")).toBe(company);
    expect(company.parentElement?.closest("button")).toBeNull();
  });

  it("osoba bez konta i bez faktów ponad kartę: bez przycisku osoby, instytucja zostaje", () => {
    renderInDirectory(speaker({ user_id: "", person_id: "p1", speaker_profile_id: "sp1" }));
    expect(screen.queryByRole("button", { name: /Anna Kowalska/ })).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "eventFront.directory.openCompany(lng=pl,name=NASK)" }),
    ).toBeTruthy();
    expect(document.querySelector("article")?.className).not.toContain("group/speaker");
  });

  it("konto bez nazwiska nie daje przycisku bez nazwy, który otwierałby okno „nie ma na liście”", () => {
    // Katalog pomija wiersz bez nazwy, więc przycisk osoby prowadziłby donikąd.
    renderInDirectory(speaker({ display_name: null }));
    expect(screen.queryByRole("button", { name: /openProfile/ })).toBeNull();
    expect(document.querySelectorAll('[aria-haspopup="dialog"]')).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "eventFront.directory.openCompany(lng=pl,name=NASK)" }),
    ).toBeTruthy();
  });

  it("dostawca wygrywa z `onSelect` - jedno okno na zakładkę, nie dwa", () => {
    const onSelect = vi.fn();
    const row = speaker();
    const directory = buildEventDirectory({ speakers: [row] }, "pl");
    render(
      <EventDirectoryProvider directory={directory} slug="szczyt" eventId="e1" live={false}>
        <SpeakerProfileCard speaker={row} lang="pl" onSelect={onSelect} />
      </EventDirectoryProvider>,
    );
    expect(screen.getByRole("button", { name: OPEN }).getAttribute("aria-haspopup")).toBe("dialog");
  });
});
