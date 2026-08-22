// Sekcja „Pola rejestracji" osadzona w Admin → Strona logowania.
//
// CO TEN PLIK DOWODZI. Ten komponent stał na okrągłym zerze, a edytuje rejestr
// pól, który obowiązuje JEDNOCZEŚNIE na /login, /membership-registration,
// w popupie rejestracji i w widgecie rejestracji. Pomyłka tutaj nie psuje
// jednego ekranu - zamyka albo otwiera rejestrację na czterech powierzchniach
// naraz. Trzy reguły, których złamanie widzi rejestrujący się, nie admin:
//
//   1. WERSJA ROBOCZA JEST LOKALNA I NIE JEST NADPISYWANA W TRAKCIE EDYCJI.
//      `useEffect` przyjmuje świeże dane z serwera tylko przy `!dirty` - bez
//      tego warunku refetch (focus okna, unieważnienie z innej zakładki panelu)
//      wyrzuca administratorowi niezapisane zmiany w połowie pracy.
//   2. ZAPIS JEDNYM PRZYCISKIEM, AKTYWNYM WYŁĄCZNIE PRZY REALNEJ ZMIANIE.
//      Autozapis byłby tu błędem: zmiana wymagalności pola natychmiast blokuje
//      rejestrację każdemu, kto ma otwarty formularz.
//   3. PO UDANYM ZAPISIE STAN „niezapisane" GAŚNIE, po nieudanym ZOSTAJE.
//      Zgaszenie go po błędzie mówi administratorowi, że zapisał - a nie zapisał.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - SAMEJ ZAKŁADKI PÓL: `FieldsTab` (wymagalność, widoczność, etykiety
//   dwujęzyczne) ma testy przy edytorze popupu rejestracji
//   (`components/admin/popups/signup/__tests__/`). Tutaj jest atrapą, która
//   ZAPISUJE PROPSY - przedmiotem dowodu jest przepływ wersji roboczej i zapisu.
// - REGUŁ REJESTRU PÓL: `resolvePopupFields` i jego domyślne mają
//   `src/lib/newsletter/popupFields.test.ts`.
// - WARSTWY DANYCH NEWSLETTERA: `useNewsletterSettings` /
//   `useSaveNewsletterSettings` mają testy przy panelu newslettera.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { NewsletterSettings } from "@/hooks/useNewsletterSettings";

const h = vi.hoisted(() => ({
  /** Ustawienia z serwera (`undefined` = zapytanie w locie). */
  data: undefined as NewsletterSettings | undefined,
  saveError: null as unknown,
  savePending: false,
  savePayloads: [] as NewsletterSettings[],
  /** Wartość, jaką `FieldsTab` widzi w propsach - dowód na wersję roboczą. */
  fieldsTabValue: null as NewsletterSettings | null,
  /** Łatka, jaką atrapa `FieldsTab` zgłasza na żądanie testu. */
  patch: { heading_pl: "Zmienione" } as Partial<NewsletterSettings>,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/i18n-admin-popup-signup", () => ({ ensureI18n: () => undefined }));
vi.mock("@/components/admin/popups/signup/FieldsTab", () => ({
  FieldsTab: ({
    value,
    onChange,
  }: {
    value: NewsletterSettings;
    onChange: (patch: Partial<NewsletterSettings>) => void;
  }) => {
    h.fieldsTabValue = value;
    return (
      <button type="button" data-testid="fields-change" onClick={() => onChange(h.patch)}>
        zmień pole
      </button>
    );
  },
}));
vi.mock("@/hooks/useNewsletterSettings", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useNewsletterSettings")>(
    "@/hooks/useNewsletterSettings",
  );
  return {
    defaultNewsletterSettings: actual.defaultNewsletterSettings,
    useNewsletterSettings: () => ({ data: h.data }),
    useSaveNewsletterSettings: () => ({
      mutateAsync: (value: NewsletterSettings) => {
        h.savePayloads.push(value);
        return h.saveError === null ? Promise.resolve() : Promise.reject(h.saveError);
      },
      isPending: h.savePending,
    }),
  };
});

import { RegistrationFieldsSection } from "@/components/admin/auth/RegistrationFieldsSection";
import { defaultNewsletterSettings } from "@/hooks/useNewsletterSettings";

const saveButton = () => screen.getByText("adminPopupSignup.save").closest("button")!;
const changeField = () => fireEvent.click(screen.getByTestId("fields-change"));

function serverSettings(patch: Partial<NewsletterSettings> = {}): NewsletterSettings {
  return { ...defaultNewsletterSettings(), heading_pl: "Z serwera", ...patch };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.data = serverSettings();
  h.saveError = null;
  h.savePending = false;
  h.savePayloads = [];
  h.fieldsTabValue = null;
  h.patch = { heading_pl: "Zmienione" };
});

afterEach(() => cleanup());

describe("wersja robocza", () => {
  it("pokazuje wartości z serwera, dopóki nikt nie edytował", () => {
    render(<RegistrationFieldsSection />);
    expect(h.fieldsTabValue?.heading_pl).toBe("Z serwera");
  });

  it("przed pierwszą odpowiedzią serwera używa wartości domyślnych, nie undefined", () => {
    // `undefined` w propsach `FieldsTab` rozłożyłoby zakładkę na pierwszym
    // `value.popup_fields` - a to jest render, który widzi administrator
    // na zimnym starcie panelu.
    h.data = undefined;
    render(<RegistrationFieldsSection />);
    expect(h.fieldsTabValue).toEqual(defaultNewsletterSettings());
  });

  it("zmiana nakłada się na wersję roboczą i nie tyka serwera", () => {
    render(<RegistrationFieldsSection />);
    changeField();
    expect(h.fieldsTabValue?.heading_pl).toBe("Zmienione");
    expect(h.savePayloads).toEqual([]);
  });

  it("zmiana PRZED odpowiedzią serwera nakłada się na domyślne, nie na undefined", () => {
    // Administrator, który kliknął w zakładkę na zimnym starcie, ma dostać
    // rejestr domyślny z jego łatką - nie `{...undefined, ...patch}`, czyli
    // rejestr bez pól, którym da się zapisać pustą listę pól rejestracji.
    h.data = undefined;
    render(<RegistrationFieldsSection />);
    changeField();
    expect(h.fieldsTabValue).toEqual({ ...defaultNewsletterSettings(), heading_pl: "Zmienione" });
  });

  it("kolejne zmiany kumulują się, nie zastępują", () => {
    render(<RegistrationFieldsSection />);
    changeField();
    h.patch = { heading_en: "Changed" };
    changeField();
    expect(h.fieldsTabValue).toMatchObject({ heading_pl: "Zmienione", heading_en: "Changed" });
  });

  it("świeże dane z serwera NIE nadpisują niezapisanej pracy", async () => {
    // To jest cała treść tego testu: refetch w trakcie edycji (focus okna,
    // unieważnienie z innej zakładki panelu) nie może wyrzucić zmian.
    const view = render(<RegistrationFieldsSection />);
    changeField();
    h.data = serverSettings({ heading_pl: "Nowa wartość z serwera" });
    view.rerender(<RegistrationFieldsSection />);
    await waitFor(() => expect(h.fieldsTabValue?.heading_pl).toBe("Zmienione"));
  });

  it("świeże dane z serwera PRZED edycją zostają przyjęte", async () => {
    h.data = undefined;
    const view = render(<RegistrationFieldsSection />);
    h.data = serverSettings({ heading_pl: "Doszło z opóźnieniem" });
    view.rerender(<RegistrationFieldsSection />);
    await waitFor(() => expect(h.fieldsTabValue?.heading_pl).toBe("Doszło z opóźnieniem"));
  });
});

describe("zapis", () => {
  it("przycisk zapisu jest NIEAKTYWNY, dopóki nic się nie zmieniło", () => {
    render(<RegistrationFieldsSection />);
    expect(saveButton().disabled).toBe(true);
    expect(screen.queryByText("adminPopupSignup.unsaved")).toBeNull();
  });

  it("realna zmiana odblokowuje zapis i zapala znacznik „niezapisane”", async () => {
    render(<RegistrationFieldsSection />);
    changeField();
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    expect(screen.getByText("adminPopupSignup.unsaved")).toBeTruthy();
  });

  it("zapis w locie blokuje przycisk, żeby nie wysłać dwóch razy", async () => {
    h.savePending = true;
    render(<RegistrationFieldsSection />);
    changeField();
    await waitFor(() => expect(saveButton().disabled).toBe(true));
  });

  it("zapisuje CAŁY rejestr, nie samą łatkę", async () => {
    render(<RegistrationFieldsSection />);
    changeField();
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.savePayloads).toHaveLength(1));
    // Zapis częściowy wyzerowałby pola, których administrator nie tknął.
    expect(h.savePayloads[0]).toMatchObject({
      heading_pl: "Zmienione",
      heading_en: serverSettings().heading_en,
    });
  });

  it("po udanym zapisie znacznik „niezapisane” gaśnie i przycisk się blokuje", async () => {
    render(<RegistrationFieldsSection />);
    changeField();
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("adminPopupSignup.saved"));
    await waitFor(() => expect(screen.queryByText("adminPopupSignup.unsaved")).toBeNull());
    expect(saveButton().disabled).toBe(true);
  });

  it("po NIEUDANYM zapisie znacznik „niezapisane” ZOSTAJE - i to jest cała treść testu", async () => {
    // Zgaszenie znacznika po błędzie mówi administratorowi, że zapisał zmianę,
    // której nie zapisał - i praca ginie razem z zamkniętą kartą.
    h.saveError = new Error("odmowa polityki");
    render(<RegistrationFieldsSection />);
    changeField();
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("adminPopupSignup.saveError"));
    expect(screen.getByText("adminPopupSignup.unsaved")).toBeTruthy();
    expect(saveButton().disabled).toBe(false);
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("nieudany zapis zostawia wersję roboczą nietkniętą", async () => {
    h.saveError = new Error("brak sieci");
    render(<RegistrationFieldsSection />);
    changeField();
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.fieldsTabValue?.heading_pl).toBe("Zmienione");
  });
});
