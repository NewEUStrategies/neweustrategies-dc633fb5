// Odznaka „Zweryfikowany profil" - atom wspólny dla trzech powierzchni
// (/profile, podgląd gościa, /author/$slug).
//
// Test celowo używa PRAWDZIWEJ instancji i18n zamiast mocka `t`: jego wartością
// jest dowód, że oba klucze istnieją w OBU językach. Do 12.08 komponent miał
// polskie `defaultValue`, więc brak rejestracji słownika (albo literówka
// w kluczu) dawał anglojęzycznemu użytkownikowi po cichu polski tekst - awaria
// niewidoczna dla żadnego testu z mockiem zwracającym klucz.
import { describe, expect, it, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import i18n from "@/lib/i18n";
import { VerifiedProfileBadge } from "@/components/profile/VerifiedProfileBadge";

const KEYS = ["expert.verifiedBadge", "expert.verifiedBadgeTitle"] as const;

beforeAll(() => {
  // Nic tu nie rejestrujemy ręcznie: komponent woła `ensureI18n` sam, a to jest
  // dokładnie zachowanie, które ma być udowodnione.
  i18n.changeLanguage("pl");
});

describe("VerifiedProfileBadge", () => {
  it("po polsku pokazuje etykietę ze słownika, nie surowy klucz", async () => {
    await i18n.changeLanguage("pl");
    const { container } = render(<VerifiedProfileBadge />);
    expect(screen.getByText("Zweryfikowany")).toBeInTheDocument();
    for (const key of KEYS) expect(container.textContent).not.toContain(key);
  });

  it("po angielsku pokazuje angielską etykietę (nie polską zapasową)", async () => {
    await i18n.changeLanguage("en");
    const { container } = render(<VerifiedProfileBadge />);
    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(container.textContent).not.toContain("Zweryfikowany");
  });

  it("w wariancie bez etykiety zostaje dostępna nazwa na ikonie", async () => {
    // Sama ikona bez `aria-label` byłaby dla czytnika ekranu niewidoczna,
    // a to jedyny nośnik informacji „profil zweryfikowany" w tym wariancie.
    await i18n.changeLanguage("pl");
    render(<VerifiedProfileBadge withLabel={false} />);
    expect(screen.getByLabelText("Zweryfikowany")).toBeInTheDocument();
  });

  it("wariant z etykietą ukrywa ikonę przed czytnikiem (tekst jej nie potrzebuje)", async () => {
    await i18n.changeLanguage("pl");
    const { container } = render(<VerifiedProfileBadge />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden");
  });

  it("rozmiar sm zmienia klasy, ale nie treść", async () => {
    await i18n.changeLanguage("pl");
    const { container: md } = render(<VerifiedProfileBadge size="md" />);
    const { container: sm } = render(<VerifiedProfileBadge size="sm" />);
    expect(sm.firstElementChild?.className).not.toBe(md.firstElementChild?.className);
    expect(sm.textContent).toBe(md.textContent);
  });

  it("dokłada własną klasę bez gubienia klas bazowych", async () => {
    await i18n.changeLanguage("pl");
    const { container } = render(<VerifiedProfileBadge className="ml-2" />);
    const root = container.firstElementChild;
    expect(root?.className).toContain("ml-2");
    expect(root?.className).toContain("inline-flex");
  });
});
