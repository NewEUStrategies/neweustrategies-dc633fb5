// Profil członka `/people/<slug>` - organizm `MemberProfileView`.
//
// CO TEN PLIK DOWODZI:
//  1. KAŻDA SEKCJA OPCJONALNA ZNIKA RAZEM ZE SWOIMI DANYMI: rola, lokalizacja,
//     „O mnie", specjalizacja i odnośniki nie zostawiają pustych nagłówków.
//  2. BIO IDZIE ZA JĘZYKIEM STRONY (`lang`), a pusty/biały bio w danym języku
//     chowa sekcję zamiast pokazać goły nagłówek.
//  3. ODNOŚNIKI ZEWNĘTRZNE SĄ BEZPIECZNE: tylko http(s), zawsze
//     `noopener noreferrer nofollow` i nowa karta; `javascript:` i śmieci nie
//     trafiają do `href`.
//  4. AKCJE ZALEŻĄ OD RELACJI: własny profil ma „Edytuj profil" (/profile/edit)
//     zamiast przycisku kontaktu, autor ma link do /author/<slug>.
//  5. NAPISY POCHODZĄ ZE SŁOWNIKA (`realT`), w PL i EN.
//
// CZEGO NIE DUBLUJE: `MessageOrConnectButton` ma własne testy - tu jest
// atrapą-markerem i sprawdzamy wyłącznie propsy, które dostaje.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

const h = vi.hoisted(() => ({
  language: "pl" as "pl" | "en",
  fixedT: null as null | ((lang: "pl" | "en") => unknown),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: h.fixedT?.(h.language),
    i18n: { language: h.language },
    ready: true,
  }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

vi.mock("@/components/network/MessageOrConnectButton", () => ({
  MessageOrConnectButton: ({ userId, displayName }: { userId: string; displayName: string }) => (
    <button type="button" data-testid="contact" data-user-id={userId}>
      {`contact:${displayName}`}
    </button>
  ),
}));

import { realT } from "@/test/i18nReal";
import { memberProfileEn, memberProfilePl } from "@/lib/i18n-member-profile";
import type { MemberProfile } from "@/lib/profile/memberProfile";
import { MemberProfileView } from "../MemberProfileView";

h.fixedT = realT;

const PL = memberProfilePl.memberProfile;
const EN = memberProfileEn.memberProfile;

function profile(over: Partial<MemberProfile> = {}): MemberProfile {
  return {
    id: "user-1",
    slug: "anna-nowak",
    display_name: "Anna Nowak",
    avatar_url: null,
    cover_url: null,
    job_title: null,
    company: null,
    location: null,
    bio_pl: null,
    bio_en: null,
    specialization: null,
    linkedin_url: null,
    website_url: null,
    verified: false,
    is_self: false,
    is_author: false,
    ...over,
  };
}

function mount(p: MemberProfile, lang: "pl" | "en" = "pl") {
  h.language = lang;
  return render(<MemberProfileView profile={p} lang={lang} />);
}

afterEach(() => {
  cleanup();
  h.language = "pl";
});

describe("MemberProfileView - nagłówek", () => {
  it("minimalny profil: imię w h1, inicjały zamiast awatara, żadnych sekcji opcjonalnych", () => {
    const { container } = mount(profile());
    const article = container.querySelector("article");
    expect(article?.getAttribute("data-member-profile")).toBe("anna-nowak");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Anna Nowak");
    expect(container.querySelector("img")).toBeNull();
    const badge = container.querySelector("header span[aria-hidden='true']");
    expect(badge?.textContent).toBe("AN");
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
    expect(container.querySelectorAll("section")).toHaveLength(0);
    expect(screen.queryByLabelText(PL.verified)).toBeNull();
    expect(container.querySelectorAll("header p")).toHaveLength(0);
    expect(container.querySelector("[data-member-author-link]")).toBeNull();
  });

  it("inicjały: jedno słowo daje jedną literę, białe znaki są przycinane, polskie litery wielkie", () => {
    const { container, rerender } = mount(profile({ display_name: "  łukasz  " }));
    expect(container.querySelector("header span[aria-hidden='true']")?.textContent).toBe("Ł");
    rerender(<MemberProfileView profile={profile({ display_name: "jan maria  żak" })} lang="pl" />);
    expect(container.querySelector("header span[aria-hidden='true']")?.textContent).toBe("JŻ");
    rerender(<MemberProfileView profile={profile({ display_name: "   " })} lang="pl" />);
    expect(container.querySelector("header span[aria-hidden='true']")?.textContent).toBe("?");
  });

  it("awatar: dekoracyjny <img> z adresem, bez inicjałów", () => {
    const { container } = mount(profile({ avatar_url: "https://cdn.example.com/a.png" }));
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://cdn.example.com/a.png");
    expect(img?.getAttribute("alt")).toBe("");
    expect(img?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector("header > span[aria-hidden='true']")).toBeNull();
  });

  it("zweryfikowany profil ma odznakę z etykietą ze słownika (PL i EN)", () => {
    mount(profile({ verified: true }));
    expect(screen.getByLabelText(PL.verified)).toBeTruthy();
    cleanup();
    mount(profile({ verified: true }), "en");
    expect(screen.getByLabelText(EN.verified)).toBeTruthy();
  });

  it("rola skleja stanowisko i firmę; każda połowa działa sama", () => {
    const { rerender } = mount(profile({ job_title: "Analityk", company: "NES" }));
    expect(screen.getByText("Analityk - NES")).toBeTruthy();
    rerender(<MemberProfileView profile={profile({ job_title: "Analityk" })} lang="pl" />);
    expect(screen.getByText("Analityk")).toBeTruthy();
    rerender(<MemberProfileView profile={profile({ company: "NES" })} lang="pl" />);
    expect(screen.getByText("NES")).toBeTruthy();
  });

  it("lokalizacja pokazuje się tylko, gdy jest", () => {
    const { container } = mount(profile({ location: "Warszawa" }));
    expect(screen.getByText("Warszawa")).toBeTruthy();
    expect(container.querySelectorAll("header p")).toHaveLength(1);
  });
});

describe("MemberProfileView - akcje", () => {
  it("cudzy profil: przycisk kontaktu z id i imieniem, bez edycji", () => {
    mount(profile());
    const contact = screen.getByTestId("contact");
    expect(contact.getAttribute("data-user-id")).toBe("user-1");
    expect(contact.textContent).toBe("contact:Anna Nowak");
    expect(screen.queryByRole("link", { name: PL.editProfile })).toBeNull();
  });

  it("własny profil: link „Edytuj profil” do /profile/edit zamiast kontaktu (PL i EN)", () => {
    mount(profile({ is_self: true }));
    expect(screen.getByRole("link", { name: PL.editProfile }).getAttribute("href")).toBe(
      "/profile/edit",
    );
    expect(screen.queryByTestId("contact")).toBeNull();
    cleanup();
    mount(profile({ is_self: true }), "en");
    expect(screen.getByRole("link", { name: EN.editProfile }).getAttribute("href")).toBe(
      "/profile/edit",
    );
  });

  it("autor: link do /author/<slug> (PL i EN)", () => {
    const { container } = mount(profile({ is_author: true }));
    const link = screen.getByRole("link", { name: PL.authorProfile });
    expect(link.getAttribute("href")).toBe("/author/anna-nowak");
    expect(link.hasAttribute("data-member-author-link")).toBe(true);
    expect(container.querySelectorAll("[data-member-author-link]")).toHaveLength(1);
    cleanup();
    mount(profile({ is_author: true, is_self: true }), "en");
    expect(screen.getByRole("link", { name: EN.authorProfile }).getAttribute("href")).toBe(
      "/author/anna-nowak",
    );
    expect(screen.getByRole("link", { name: EN.editProfile })).toBeTruthy();
  });
});

describe("MemberProfileView - „O mnie”", () => {
  it("PL czyta bio_pl, EN czyta bio_en", () => {
    const p = profile({ bio_pl: "Polski opis", bio_en: "English bio" });
    mount(p);
    expect(screen.getByRole("heading", { level: 2, name: PL.about })).toBeTruthy();
    expect(screen.getByText("Polski opis")).toBeTruthy();
    expect(screen.queryByText("English bio")).toBeNull();
    cleanup();
    mount(p, "en");
    expect(screen.getByRole("heading", { level: 2, name: EN.about })).toBeTruthy();
    expect(screen.getByText("English bio")).toBeTruthy();
    expect(screen.queryByText("Polski opis")).toBeNull();
  });

  it("brak bio w języku strony chowa sekcję, nawet gdy jest w drugim języku", () => {
    mount(profile({ bio_pl: "Tylko po polsku" }), "en");
    expect(screen.queryByRole("heading", { name: EN.about })).toBeNull();
    expect(screen.queryByText("Tylko po polsku")).toBeNull();
  });

  it("bio z samych białych znaków chowa sekcję", () => {
    const { container } = mount(profile({ bio_pl: "   \n  " }));
    expect(screen.queryByRole("heading", { name: PL.about })).toBeNull();
    expect(container.querySelectorAll("section")).toHaveLength(0);
  });
});

describe("MemberProfileView - specjalizacja i odnośniki", () => {
  it("sama specjalizacja: sekcja bez listy odnośników", () => {
    mount(profile({ specialization: "Energetyka" }));
    expect(screen.getByRole("heading", { level: 2, name: PL.specialization })).toBeTruthy();
    expect(screen.getByText("Energetyka")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: PL.links })).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("LinkedIn i strona: dwa linki zewnętrzne w nowej karcie z bezpiecznym rel (PL)", () => {
    mount(
      profile({
        linkedin_url: "https://www.linkedin.com/in/anna",
        website_url: "http://anna.example.com/o-mnie",
      }),
    );
    expect(screen.getByRole("heading", { level: 2, name: PL.links })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: PL.specialization })).toBeNull();
    const list = screen.getByRole("list");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    const li = within(list).getByRole("link", { name: PL.linkedin });
    const web = within(list).getByRole("link", { name: PL.website });
    expect(li.getAttribute("href")).toBe("https://www.linkedin.com/in/anna");
    expect(web.getAttribute("href")).toBe("http://anna.example.com/o-mnie");
    for (const a of [li, web]) {
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    }
  });

  it("EN: nagłówki i etykiety ze słownika angielskiego", () => {
    mount(
      profile({
        specialization: "Energy",
        linkedin_url: "https://www.linkedin.com/in/anna",
        website_url: "https://anna.example.com",
      }),
      "en",
    );
    expect(screen.getByRole("heading", { level: 2, name: EN.specialization })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: EN.links })).toBeTruthy();
    expect(screen.getByRole("link", { name: EN.linkedin })).toBeTruthy();
    // URL jest normalizowany przez `new URL` (dopisany ukośnik).
    expect(screen.getByRole("link", { name: EN.website }).getAttribute("href")).toBe(
      "https://anna.example.com/",
    );
  });

  it("tylko LinkedIn albo tylko strona - druga pozycja listy znika", () => {
    const { rerender } = mount(profile({ linkedin_url: "https://linkedin.com/in/x" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("link", { name: PL.linkedin })).toBeTruthy();
    expect(screen.queryByRole("link", { name: PL.website })).toBeNull();
    rerender(
      <MemberProfileView profile={profile({ website_url: "https://x.example.com" })} lang="pl" />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("link", { name: PL.website })).toBeTruthy();
    expect(screen.queryByRole("link", { name: PL.linkedin })).toBeNull();
  });

  it("niebezpieczne i zepsute adresy są odrzucane, a pusta sekcja nie powstaje", () => {
    const { container } = mount(
      profile({
        linkedin_url: "javascript:alert(1)",
        website_url: "nie jest adresem",
      }),
    );
    expect(screen.queryByRole("heading", { name: PL.links })).toBeNull();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(container.querySelectorAll("section")).toHaveLength(0);
    expect(container.innerHTML).not.toContain("javascript:");
  });

  it("odrzucony link przy obecnej specjalizacji: sekcja zostaje, bez odnośników", () => {
    mount(profile({ specialization: "Obronność", website_url: "ftp://files.example.com" }));
    expect(screen.getByText("Obronność")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: PL.links })).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
  });
});
