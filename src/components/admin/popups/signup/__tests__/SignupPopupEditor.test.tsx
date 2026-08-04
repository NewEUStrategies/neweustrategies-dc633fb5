// Regresja edytora popupu rejestracji. Kluczowa rzecz do przybicia: patch
// zapisuje ZAWSZE kompletny obiekt `popup_design`, więc zmiana jednego
// pokrętła nie może gubić pozostałych ustawień ani wywalać do bazy częściowego
// JSON-a. Dodatkowo: paleta jasna i ciemna są edytowane niezależnie, a podgląd
// da się przełączyć bez zmiany ustawień.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

const h = vi.hoisted(() => ({ guard: vi.fn() }));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    // Zwracamy sam klucz - test celuje w klucze, nie w treść tłumaczeń.
    t: (key: string, opts?: Record<string, unknown>) =>
      typeof opts?.index === "number" ? `${key}:${opts.index}` : key,
  }),
}));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => h.guard,
}));
vi.mock("@/lib/auth/bruteforce.functions", () => ({ preAuthGuard: {} }));
vi.mock("@/lib/newsletter.functions", () => ({ subscribeToNewsletter: {} }));
vi.mock("@/lib/newsletter/popupTelemetry", () => ({
  trackNewsletterPopupEvent: vi.fn(),
  newsletterPopupSessionId: () => "test-session",
}));
vi.mock("@/hooks/useAuthSettings", () => ({
  useAuthSettings: () => ({ allow_public_signup: true, logged_in_redirect_url: "/" }),
}));
vi.mock("@/lib/brand/useBrandLogoUrl", () => ({ useBrandLogoUrl: () => null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { signUp: vi.fn(), signInWithOAuth: vi.fn() } },
}));
// ImageSlot ciągnie uploady, media i tenant - w edytorze wystarczy atrapa.
vi.mock("@/components/admin/builder/ui/organisms/widget-properties/ImageSlot", () => ({
  ImageSlot: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
  }) => <input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />,
}));

import { SignupPopupEditor } from "@/components/admin/popups/signup/SignupPopupEditor";
import { defaultNewsletterSettings, type NewsletterSettings } from "@/hooks/useNewsletterSettings";
import { defaultPopupDesign } from "@/lib/newsletter/popupDesign";

function settings(): NewsletterSettings {
  return {
    ...defaultNewsletterSettings(),
    popup_enabled: true,
    popup_layout: "showcase",
  };
}

const clickTab = (id: string) => fireEvent.click(screen.getByText(`adminPopupSignup.tabs.${id}`));

describe("SignupPopupEditor", () => {
  const onChange = vi.fn();
  beforeEach(() => onChange.mockReset());
  afterEach(cleanup);

  it("patch prezentacji zapisuje komplet popup_design (nic nie ginie)", () => {
    render(<SignupPopupEditor value={settings()} onChange={onChange} />);
    clickTab("form");
    fireEvent.click(screen.getByText("adminPopupSignup.form.titleNoWrap"));

    expect(onChange).toHaveBeenCalledTimes(1);
    const patch = onChange.mock.calls[0][0] as Partial<NewsletterSettings>;
    expect(patch.popup_design).toEqual({
      ...defaultPopupDesign(),
      form: { ...defaultPopupDesign().form, titleNoWrap: true },
    });
  });

  it("zakładka prawej strony nie oferuje logowania społecznościowego", () => {
    render(<SignupPopupEditor value={settings()} onChange={onChange} />);
    clickTab("form");
    expect(screen.queryByText(/social/i)).toBeNull();
    expect(screen.queryByText("adminPopupSignup.form.labelStyle")).toBeNull();
  });

  it("paleta jasna jest edytowana niezależnie od kolumn palety ciemnej", () => {
    render(<SignupPopupEditor value={settings()} onChange={onChange} />);
    clickTab("colors");

    const lightInputs = screen.getAllByLabelText("adminPopupSignup.colors.bg");
    // Dwie sekcje: ciemna (kolumny) i jasna (popup_design.light).
    expect(lightInputs).toHaveLength(2);
    fireEvent.change(lightInputs[1], { target: { value: "#f5f5f5" } });

    const patch = onChange.mock.calls[0][0] as Partial<NewsletterSettings>;
    expect(patch.popup_design?.light.bg).toBe("#f5f5f5");
    expect(patch.popup_bg_color).toBeUndefined();
  });

  it("kolory palety ciemnej nadal lecą do kolumn newsletter_settings", () => {
    render(<SignupPopupEditor value={settings()} onChange={onChange} />);
    clickTab("colors");

    const inputs = screen.getAllByLabelText("adminPopupSignup.colors.accent");
    fireEvent.change(inputs[0], { target: { value: "#123456" } });
    expect(onChange.mock.calls[0][0]).toEqual({ popup_accent_color: "#123456" });
  });

  it("etykiety i podpowiedzi pól są edytowalne w PL i EN", () => {
    render(<SignupPopupEditor value={settings()} onChange={onChange} />);
    clickTab("fields");

    fireEvent.change(screen.getByLabelText("adminPopupSignup.fields.labelPl - first_name"), {
      target: { value: "Twoje imię" },
    });
    const patch = onChange.mock.calls[0][0] as Partial<NewsletterSettings>;
    const first = patch.popup_fields?.find((f) => f.key === "first_name");
    expect(first?.label_pl).toBe("Twoje imię");
    expect(first?.label_en).toBe("First name");
    // Zablokowane pola zostają w komplecie, z wymuszonym enabled/required.
    const email = patch.popup_fields?.find((f) => f.key === "email");
    expect(email).toMatchObject({ enabled: true, required: true });
  });

  it("kolejność bloków galerii jest przestawialna", () => {
    render(<SignupPopupEditor value={settings()} onChange={onChange} />);
    clickTab("gallery");

    fireEvent.click(
      screen.getByLabelText("adminPopupSignup.gallery.down: adminPopupSignup.gallery.blocks.brand"),
    );
    const patch = onChange.mock.calls[0][0] as Partial<NewsletterSettings>;
    expect(patch.popup_design?.gallery.order).toEqual([
      "grid",
      "brand",
      "caption",
      "tagline",
      "dots",
    ]);
  });

  it("podgląd przełącza paletę bez dotykania ustawień", () => {
    const s = settings();
    render(<SignupPopupEditor value={s} onChange={onChange} />);
    const panel = () => document.querySelector<HTMLElement>("[style*='--nl-bg']");
    expect(panel()?.style.getPropertyValue("--nl-bg")).toBe(s.popup_bg_color);

    fireEvent.click(screen.getByText("adminPopupSignup.preview.light"));
    expect(panel()?.style.getPropertyValue("--nl-bg")).toBe(s.popup_design.light.bg);
    expect(onChange).not.toHaveBeenCalled();
  });
});
