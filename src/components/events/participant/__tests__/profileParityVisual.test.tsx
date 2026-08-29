// BRAMKA REGRESJI WIZUALNEJ: podgląd „Mój profil" kontra profil publiczny.
//
// Karta uczestnika w event builderze i wizytówka z `/profile` składają się
// z TYCH SAMYCH atomów (`ProfileShell`). Bramka pilnuje trzech rzeczy, które
// psuły się po cichu i były widoczne dopiero na zrzucie ekranu:
//
// 1. UCIĘCIA. Blok tożsamości nie może chować tekstu (`truncate`,
//    `text-ellipsis`, `whitespace-nowrap`) - długie nazwisko i długa nazwa
//    organizacji mają się ZAWIJAĆ, nie znikać.
// 2. PARYTET PL/EN i DARK/LIGHT. Ta sama osoba w czterech kombinacjach języka
//    treści i motywu daje ten sam zestaw atomów i tę samą liczbę węzłów
//    tożsamości - różnić się może wyłącznie TREŚĆ.
// 3. PRZEPUSTKA. Etykiety grup z „Grupy i uprawnienia" stoją na karcie
//    właściciela dokładnie tak, jak stoją na cudzych kartach w katalogu.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, render } from "@testing-library/react";

import type { MyEventProfile } from "@/lib/events/myEventProfileApi";
import type { AttendeeGroupTag } from "@/lib/events/publicEventApi";

const themeState = { theme: "light" as "light" | "dark" };
const langState = { language: "pl" };

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: langState.language, exists: () => true },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@/components/ThemeProvider", () => ({
  useTheme: () => ({ theme: themeState.theme, setTheme: () => {} }),
}));

vi.mock("@/lib/useSiteSetting", () => ({
  useSiteSetting: () => ({ logo: { main: "/logo.svg", main_dark: "/logo-dark.svg" } }),
}));

vi.mock("@/lib/crm/useCompanyBrand", () => ({
  useCompanyBrand: () => ({
    data: { logoUrl: "/crm-logo.svg", website: "https://example.org", industry: "Public affairs" },
  }),
}));

import { MyEventPublicPreview } from "@/components/events/participant/molecules/MyEventPublicPreview";

const LONG_LAST_NAME = "Przybyszewska-Wielkopolska-Nowakowska";
const LONG_COMPANY = "Międzynarodowe Stowarzyszenie Współpracy Transgranicznej i Rozwoju Regionów";

const GROUPS: AttendeeGroupTag[] = [
  { id: "g1", namePl: "Uczestnicy", nameEn: "Attendees", color: "#ff8800" },
  { id: "g2", namePl: "Partnerzy", nameEn: "Partners", color: null },
];

const profile: MyEventProfile = {
  personId: "p1",
  firstName: "Katarzyna",
  lastName: LONG_LAST_NAME,
  email: "k@example.org",
  phone: "+48 500 000 000",
  emailVisible: true,
  phoneVisible: false,
  jobTitle: "Dyrektorka ds. współpracy międzynarodowej",
  companyId: "c1",
  companyText: LONG_COMPANY,
  industry: null,
  specialization: "Polityka klimatyczna",
  seekingPl: "Partnerzy projektowi",
  seekingEn: "Project partners",
  offeringPl: "Wiedza ekspercka",
  offeringEn: "Expert knowledge",
  socialProfileUrl: null,
  socialLinks: { linkedin: "https://linkedin.com/in/x" },
  photoUrl: null,
  bioPl: "Opis po polsku",
  bioEn: "Bio in English",
};

const COMBINATIONS = [
  { lang: "pl", theme: "light" as const },
  { lang: "pl", theme: "dark" as const },
  { lang: "en", theme: "light" as const },
  { lang: "en", theme: "dark" as const },
];

function renderPreview() {
  return render(<MyEventPublicPreview profile={profile} groups={GROUPS} />);
}

function identityBlock(container: HTMLElement): HTMLElement {
  const heading = container.querySelector("h1");
  expect(heading).not.toBeNull();
  const block = (heading as HTMLElement).closest("section");
  expect(block).not.toBeNull();
  return block as HTMLElement;
}

beforeEach(() => {
  themeState.theme = "light";
  langState.language = "pl";
  cleanup();
});

describe("podgląd profilu uczestnika = profil publiczny", () => {
  it("blok tożsamości NIGDY nie ucina imienia ani nazwy organizacji", () => {
    for (const combo of COMBINATIONS) {
      langState.language = combo.lang;
      themeState.theme = combo.theme;
      const { container } = renderPreview();
      const block = identityBlock(container);

      const clipped = [...block.querySelectorAll<HTMLElement>("*")].filter((node) =>
        /\b(truncate|text-ellipsis|whitespace-nowrap|line-clamp-\d)\b/.test(node.className || ""),
      );
      expect(clipped.map((node) => node.className)).toEqual([]);

      // Pełna treść jest naprawdę w DOM - „brak ucięcia" nie może znaczyć
      // „brak tekstu".
      expect(block.textContent).toContain(LONG_LAST_NAME);
      expect(block.textContent).toContain(LONG_COMPANY);
      cleanup();
    }
  });

  it("długie nazwy mają włączone zawijanie i płynną skalę", () => {
    const { container } = renderPreview();
    const heading = container.querySelector("h1") as HTMLElement;
    expect(heading.className).toMatch(/\[overflow-wrap:anywhere\]/);
    expect(heading.className).toMatch(/break-words/);
    // Skala płynna zamiast dwóch progów - na 320px nazwisko nie wychodzi poza
    // kolumnę i nie nachodzi na awatar.
    expect(heading.className).toMatch(/text-\[clamp\(/);

    const company = [...container.querySelectorAll<HTMLElement>("span, a")].find(
      (node) => node.childElementCount === 0 && (node.textContent ?? "").trim() === LONG_COMPANY,
    );
    expect(company).toBeDefined();
    expect((company as HTMLElement).className).toMatch(/\[overflow-wrap:anywhere\]/);
  });

  it("awatar leży NAD blokiem tożsamości, więc nic go nie zasłania", () => {
    const { container } = renderPreview();
    const avatarLayer = container.querySelector(".z-30");
    expect(avatarLayer).not.toBeNull();
    // Blok tożsamości rezerwuje miejsce pod nachodzące zdjęcie.
    const block = identityBlock(container);
    expect(block.className).toMatch(/pt-16/);
  });

  it("zestaw atomów tożsamości jest IDENTYCZNY w PL/EN i dark/light", () => {
    const shapes = new Set<string>();
    for (const combo of COMBINATIONS) {
      langState.language = combo.lang;
      themeState.theme = combo.theme;
      const { container } = renderPreview();
      const block = identityBlock(container);
      shapes.add(
        [...block.querySelectorAll<HTMLElement>("*")].map((node) => node.tagName).join(">"),
      );
      cleanup();
    }
    expect(shapes.size).toBe(1);
  });

  it("plakietki grup z sekcji Grupy i uprawnienia stoja na karcie wlasciciela", () => {
    const { container } = renderPreview();
    expect(container.textContent).toContain("Uczestnicy");
    expect(container.textContent).toContain("Partnerzy");

    cleanup();
    langState.language = "en";
    const en = renderPreview();
    expect(en.container.textContent).toContain("Attendees");
    expect(en.container.textContent).toContain("Partners");
  });
});
