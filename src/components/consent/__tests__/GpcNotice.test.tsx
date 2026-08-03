// Nota o sygnale Global Privacy Control.
//
// Test celowo używa PRAWDZIWEJ instancji i18n (nie mocka react-i18next): jego
// wartością jest dowód, że klucze `consentGpc.*` istnieją w OBU językach. Z
// mockiem `t` zwracającym klucz literówka przeszłaby niezauważona, a użytkownik
// zobaczyłby w banerze surowy identyfikator zamiast informacji, że jego prawny
// sygnał opt-out został uwzględniony (obowiązek przejrzystości, art. 12-13 RODO).
import { describe, expect, it, beforeAll, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import i18n from "@/lib/i18n";
import { ensureI18n } from "@/lib/i18n-consent-gpc";
import { GpcBadge } from "@/components/consent/atoms/GpcBadge";
import { GpcNotice } from "@/components/consent/molecules/GpcNotice";
import {
  GpcCategoryBadgeSlot,
  GpcDeclarationSlot,
  GpcEventBadgeSlot,
  GpcNoticeSlot,
  GpcRegistryNoteSlot,
} from "@/components/consent/GpcSurfaceSlots";

const KEY_PREFIX = "consentGpc.";

beforeAll(() => {
  ensureI18n();
});

/** Żaden klucz i18n nie może wyciekać do UI jako surowy identyfikator. */
function expectNoRawKeys(text: string | null): void {
  expect(text ?? "").not.toContain(KEY_PREFIX);
}

describe("GpcNotice - sygnał honorowany", () => {
  it("po polsku mówi, że sygnał jest respektowany, i nazywa jego zakres", async () => {
    await i18n.changeLanguage("pl");
    render(<GpcNotice source="navigator" />);

    const notice = screen.getByTestId("gpc-notice");
    expect(notice.dataset.gpcState).toBe("honored");
    expect(notice.textContent).toContain("Global Privacy Control");
    expect(notice.textContent).toContain("Respektujemy");
    // Zakres klamry musi być nazwany wprost - inaczej użytkownik nie wie, co
    // właściwie zostało wyłączone.
    expect(notice.textContent).toContain("marketingowa");
    expect(notice.textContent).toContain("personalizacja");
    // Nośnik sygnału jest jawny (audytowalność).
    expect(notice.textContent).toContain("navigator.globalPrivacyControl");
    expectNoRawKeys(notice.textContent);
  });

  it("po angielsku niesie ten sam komunikat", async () => {
    await i18n.changeLanguage("en");
    render(<GpcNotice source="header" />);

    const notice = screen.getByTestId("gpc-notice");
    expect(notice.textContent).toContain("honour");
    expect(notice.textContent).toContain("do not sell or share");
    expect(notice.textContent).toContain("Sec-GPC");
    expectNoRawKeys(notice.textContent);
  });

  it("nie pokazuje przycisku powrotu, gdy nie ma czego przywracać", async () => {
    await i18n.changeLanguage("pl");
    render(<GpcNotice source="cookie" onRestore={() => {}} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("wariant compact skraca notę, ale zachowuje sedno i nośnik", async () => {
    await i18n.changeLanguage("pl");
    render(<GpcNotice source="cookie" variant="compact" />);

    const notice = screen.getByTestId("gpc-notice");
    expect(notice.textContent).toContain("Global Privacy Control");
    // Compact pomija rozwinięcia (zakres / podpowiedź override'u) - w pasku
    // banera liczy się jedno zdanie, nie wykład.
    expect(notice.textContent).not.toContain("Jeśli mimo sygnału");
    expectNoRawKeys(notice.textContent);
  });
});

describe("GpcNotice - sygnał nadpisany", () => {
  it("nazywa stan override'u i daje jednoklikowy powrót", async () => {
    await i18n.changeLanguage("pl");
    const onRestore = vi.fn();
    render(<GpcNotice source="navigator" overridden onRestore={onRestore} />);

    const notice = screen.getByTestId("gpc-notice");
    expect(notice.dataset.gpcState).toBe("overridden");
    expect(notice.textContent).toContain("nadpisany");

    // Wycofanie zgody musi być tak łatwe jak jej udzielenie (art. 7 ust. 3 RODO).
    const restore = screen.getByRole("button", { name: /Przywróć respektowanie sygnału/i });
    restore.click();
    expect(onRestore).toHaveBeenCalledTimes(1);
    expectNoRawKeys(notice.textContent);
  });

  it("po angielsku również oferuje powrót do respektowania sygnału", async () => {
    await i18n.changeLanguage("en");
    render(<GpcNotice source="navigator" overridden onRestore={() => {}} />);
    expect(screen.getByRole("button", { name: /honouring the signal/i })).toBeTruthy();
  });
});

describe("GpcBadge", () => {
  it("tłumaczy etykietę z KLUCZA (nakładka i18n jedzie tym samym chunkiem)", async () => {
    await i18n.changeLanguage("pl");
    render(<GpcBadge labelKey="consentGpc.categoryLocked" />);

    const badge = screen.getByTestId("gpc-badge");
    expect(badge.textContent).toContain("GPC");
    expect(badge.textContent).toContain("Wyłączone sygnałem GPC");
    expect(badge.getAttribute("title")).toContain("Global Privacy Control");
    expectNoRawKeys(badge.textContent);
    expectNoRawKeys(badge.getAttribute("title"));
  });

  it("po angielsku tłumaczy ten sam klucz", async () => {
    await i18n.changeLanguage("en");
    render(<GpcBadge labelKey="consentGpc.registry.active" />);

    const badge = screen.getByTestId("gpc-badge");
    expect(badge.textContent).toContain("GPC signal active");
    expectNoRawKeys(badge.textContent);
  });

  it("bez klucza renderuje sam skrót", async () => {
    await i18n.changeLanguage("pl");
    render(<GpcBadge />);
    expect(screen.getByTestId("gpc-badge").textContent?.trim()).toBe("GPC");
  });
});

describe("GpcSurfaceSlots - warunki renderowania", () => {
  it("nie renderuje noty ani badge'y, dopóki nie ma po co", async () => {
    await i18n.changeLanguage("pl");
    render(
      <>
        <GpcNoticeSlot active={false} source="none" />
        <GpcCategoryBadgeSlot clamped={false} />
        <GpcEventBadgeSlot gpc={false} />
        <GpcRegistryNoteSlot visible={false} />
      </>,
    );
    expect(screen.queryByTestId("gpc-notice")).toBeNull();
    expect(screen.queryByTestId("gpc-badge")).toBeNull();
    expect(screen.queryByTestId("gpc-registry-note")).toBeNull();
  });

  it("dowozi notę z leniwego chunka, gdy sygnał jest aktywny", async () => {
    await i18n.changeLanguage("pl");
    render(<GpcNoticeSlot active source="navigator" />);
    // Leniwy chunk - nota pojawia się po rozwiązaniu importu (klamra działa
    // synchronicznie już wcześniej, patrz lib/consent/gpc.ts).
    const notice = await screen.findByTestId("gpc-notice");
    expect(notice.textContent).toContain("Global Privacy Control");
  });

  it("dowozi deklarację z linkiem do dokumentu maszynowego", async () => {
    await i18n.changeLanguage("pl");
    render(<GpcDeclarationSlot />);
    const declaration = await screen.findByTestId("gpc-declaration");
    expect(declaration.textContent).toContain("/.well-known/gpc.json");
    expectNoRawKeys(declaration.textContent);
  });
});
