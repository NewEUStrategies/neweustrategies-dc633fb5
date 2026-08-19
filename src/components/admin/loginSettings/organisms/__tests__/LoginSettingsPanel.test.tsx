import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_DEFAULTS, type AuthSettings } from "@/lib/authSettings";
import { LoginSettingsPanel } from "@/components/admin/loginSettings/organisms/LoginSettingsPanel";

const fixture = vi.hoisted(() => ({
  remote: null as unknown as AuthSettings,
  save: { isPending: false, mutateAsync: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/hooks/useAuthSettings", () => ({
  useAuthSettings: () => fixture.remote,
  useSaveAuthSettings: () => fixture.save,
}));
vi.mock("sonner", () => ({ toast: fixture.toast }));
vi.mock("@/lib/adminToasts", () => ({ adminToast: { saved: () => "admin.saved" } }));
vi.mock("@/lib/i18n-admin-login-settings", () => ({ ensureI18n: vi.fn() }));
vi.mock("@/lib/i18n-admin-popup-signup", () => ({ ensureI18n: vi.fn() }));
vi.mock("@/components/admin/auth/RegistrationFieldsSection", () => ({
  RegistrationFieldsSection: () => <div>registration-fields</div>,
}));
vi.mock("@/components/admin/media/MediaPickerDialog", () => ({
  MediaPickerDialog: () => null,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { label?: string }) =>
      values?.label ? `${key}:${values.label}` : key,
  }),
}));

function tab(name: string) {
  const trigger = screen.getByRole("tab", { name });
  fireEvent.mouseDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
}

describe("LoginSettingsPanel", () => {
  beforeEach(() => {
    fixture.remote = { ...AUTH_DEFAULTS };
    fixture.save = { isPending: false, mutateAsync: vi.fn().mockResolvedValue(undefined) };
    fixture.toast.success.mockReset();
    fixture.toast.error.mockReset();
  });

  afterEach(cleanup);

  it("pokazuje stronę główną panelu jako czysty stan bez zmian", () => {
    render(<LoginSettingsPanel />);

    expect(
      screen.getByRole("heading", { name: "adminLoginSettings.pageTitle" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "adminLoginSettings.saveChanges" })).toBeDisabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "adminLoginSettings.heroTitle (PL)" })).toHaveValue(
      AUTH_DEFAULTS.hero_title_pl,
    );
  });

  it("oznacza zmiany strony jako niezapisane i resetuje je do domyślnych", () => {
    render(<LoginSettingsPanel />);
    const title = screen.getByRole("textbox", { name: "adminLoginSettings.heroTitle (PL)" });

    fireEvent.change(title, { target: { value: "Nowy tytuł" } });
    expect(screen.getByRole("status")).toHaveTextContent("adminLoginSettings.unsavedChanges");
    expect(screen.getByRole("button", { name: "adminLoginSettings.saveChanges" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "adminLoginSettings.reset" }));
    expect(title).toHaveValue(AUTH_DEFAULTS.hero_title_pl);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("wykonuje wszystkie kontrolki zakładki strony", () => {
    render(<LoginSettingsPanel />);

    fireEvent.change(screen.getByRole("textbox", { name: "adminLoginSettings.heroTitle (EN)" }), {
      target: { value: "New title" },
    });
    fireEvent.change(
      screen.getByRole("textbox", { name: "adminLoginSettings.heroSubtitle (PL)" }),
      {
        target: { value: "Nowy opis" },
      },
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "adminLoginSettings.heroSubtitle (EN)" }),
      {
        target: { value: "New description" },
      },
    );

    const lightImages = screen.getAllByRole("textbox", { name: "adminLoginSettings.themeLight" });
    const darkImages = screen.getAllByRole("textbox", { name: "adminLoginSettings.themeDark" });
    lightImages.forEach((input, index) =>
      fireEvent.change(input, { target: { value: `https://example.test/light-${index}.jpg` } }),
    );
    darkImages.forEach((input, index) =>
      fireEvent.change(input, { target: { value: `https://example.test/dark-${index}.jpg` } }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "adminLoginSettings.loginBgLabel" }), {
      target: { value: "https://example.test/bg.jpg" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "adminLoginSettings.bgColorLabel" }), {
      target: { value: "#123456" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "adminLoginSettings.privacyLink" }), {
      target: { value: "/privacy" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "adminLoginSettings.termsLink" }), {
      target: { value: "/terms" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: /^adminLoginSettings\.formPosition/ }), {
      target: { value: "left" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /^adminLoginSettings\.customLoginUrl/ }), {
      target: { value: "/custom-login" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /^adminLoginSettings\.logoutRedirect/ }), {
      target: { value: "/bye" },
    });
    fireEvent.click(screen.getByRole("switch", { name: /^adminLoginSettings\.langSwitchTitle/ }));
    fireEvent.click(screen.getByRole("switch", { name: "adminLoginSettings.backHomeTitle" }));

    expect(lightImages).toHaveLength(2);
    expect(darkImages).toHaveLength(2);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /^adminLoginSettings\.formPosition/ })).toHaveValue(
      "left",
    );
  });

  it("edytuje ustawienia popupu, w tym obie wersje językowe i logotypy", () => {
    render(<LoginSettingsPanel />);
    tab("adminLoginSettings.tabPopup");

    fireEvent.click(screen.getByRole("switch", { name: /^adminLoginSettings\.popupEnableTitle/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "adminLoginSettings.heading (PL)" }), {
      target: { value: "Witaj" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "adminLoginSettings.heading (EN)" }), {
      target: { value: "Welcome" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "adminLoginSettings.description (PL)" }), {
      target: { value: "Opis" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "adminLoginSettings.description (EN)" }), {
      target: { value: "Description" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "adminLoginSettings.formLogoLight" }), {
      target: { value: "https://example.test/logo-light.svg" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "adminLoginSettings.formLogoDark" }), {
      target: { value: "https://example.test/logo-dark.svg" },
    });

    expect(
      screen.getByRole("switch", { name: /^adminLoginSettings\.popupEnableTitle/ }),
    ).not.toBeChecked();
    expect(screen.getByRole("textbox", { name: "adminLoginSettings.heading (EN)" })).toHaveValue(
      "Welcome",
    );
    expect(screen.getByRole("status")).toHaveTextContent("adminLoginSettings.unsavedChanges");
  });

  it("edytuje rejestrację i zachowuje wspólną sekcję pól", () => {
    render(<LoginSettingsPanel />);
    tab("adminLoginSettings.tabSignup");

    fireEvent.click(screen.getByRole("switch", { name: /^adminLoginSettings\.publicSignupTitle/ }));
    for (const [name, value] of [
      ["adminLoginSettings.signinLabel (PL)", "Logowanie"],
      ["adminLoginSettings.signinLabel (EN)", "Login"],
      ["adminLoginSettings.signupLabel (PL)", "Rejestracja"],
      ["adminLoginSettings.signupLabel (EN)", "Registration"],
    ]) {
      fireEvent.change(screen.getByRole("textbox", { name }), { target: { value } });
    }
    fireEvent.change(screen.getByRole("textbox", { name: "adminLoginSettings.themeLight" }), {
      target: { value: "https://example.test/signup-light.jpg" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "adminLoginSettings.themeDark" }), {
      target: { value: "https://example.test/signup-dark.jpg" },
    });

    expect(screen.getByText("registration-fields")).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: /^adminLoginSettings\.publicSignupTitle/ }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("textbox", { name: "adminLoginSettings.signupLabel (EN)" }),
    ).toHaveValue("Registration");
  });

  it("zapisuje bieżący szkic, pokazuje sukces i czyści stan zmian", async () => {
    render(<LoginSettingsPanel />);
    const title = screen.getByRole("textbox", { name: "adminLoginSettings.heroTitle (PL)" });
    fireEvent.change(title, { target: { value: "Do zapisania" } });

    fireEvent.click(screen.getByRole("button", { name: "adminLoginSettings.saveChanges" }));

    await waitFor(() => expect(fixture.save.mutateAsync).toHaveBeenCalledTimes(1));
    expect(fixture.save.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ hero_title_pl: "Do zapisania" }),
    );
    expect(fixture.toast.success).toHaveBeenCalledWith("admin.saved");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "adminLoginSettings.saveChanges" })).toBeDisabled();
  });

  it("po błędzie zachowuje szkic jako niezapisany i pozwala ponowić próbę", async () => {
    fixture.save.mutateAsync.mockRejectedValue(new Error("Zapis testowo odrzucony"));
    render(<LoginSettingsPanel />);
    const title = screen.getByRole("textbox", { name: "adminLoginSettings.heroTitle (PL)" });
    fireEvent.change(title, { target: { value: "Szkic" } });

    fireEvent.click(screen.getByRole("button", { name: "adminLoginSettings.saveChanges" }));

    await waitFor(() =>
      expect(fixture.toast.error).toHaveBeenCalledWith("Zapis testowo odrzucony"),
    );
    expect(title).toHaveValue("Szkic");
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "adminLoginSettings.saveChanges" })).toBeEnabled();
  });

  it("dla nieznanego błędu używa tłumaczenia i18n", async () => {
    fixture.save.mutateAsync.mockRejectedValue("awaria");
    render(<LoginSettingsPanel />);
    fireEvent.change(screen.getByRole("textbox", { name: "adminLoginSettings.heroTitle (PL)" }), {
      target: { value: "Szkic" },
    });

    fireEvent.click(screen.getByRole("button", { name: "adminLoginSettings.saveChanges" }));

    await waitFor(() =>
      expect(fixture.toast.error).toHaveBeenCalledWith("adminLoginSettings.errGeneric"),
    );
    expect(fixture.toast.success).not.toHaveBeenCalled();
  });

  it("pokazuje stan zapisywania i blokuje akcję", () => {
    fixture.remote = { ...AUTH_DEFAULTS, hero_title_pl: "Zdalny" };
    fixture.save.isPending = true;
    render(<LoginSettingsPanel />);

    expect(screen.getByRole("button", { name: "adminLoginSettings.saving" })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "adminLoginSettings.saveChanges" }),
    ).not.toBeInTheDocument();
  });

  it("przyjmuje zdalną zmianę dla czystego formularza, ale nie nadpisuje szkicu", () => {
    const { rerender } = render(<LoginSettingsPanel />);
    const title = screen.getByRole("textbox", { name: "adminLoginSettings.heroTitle (PL)" });
    fixture.remote = { ...AUTH_DEFAULTS, hero_title_pl: "Zdalny" };
    rerender(<LoginSettingsPanel />);
    expect(title).toHaveValue("Zdalny");

    fireEvent.change(title, { target: { value: "Lokalny szkic" } });
    fixture.remote = { ...AUTH_DEFAULTS, hero_title_pl: "Nowszy zdalny" };
    rerender(<LoginSettingsPanel />);

    expect(title).toHaveValue("Lokalny szkic");
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
