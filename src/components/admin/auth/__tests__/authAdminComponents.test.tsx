// Atomy, molekuły i organizmy panelu ustawień logowania.
//
// CO TEN PLIK DOWODZI. Cztery komponenty wyprowadzone z 533-linijkowej trasy
// `/admin/login-settings`, gdzie mieszkały jako lokalne funkcje bez ani jednej
// asercji (katalog `components/admin/auth` miał jeden plik i zero testów).
// Każdy z nich odpowiada za coś, czego pomyłka jest widoczna dopiero u operatora:
//
//   1. `AuthSettingsIssueList` - BLOKADA MUSI BYĆ OGŁOSZONA. Zastrzeżenie,
//      które zatrzymuje zapis, jedzie jako `role="alert"`; ostrzeżenie nie.
//      Operator korzystający z czytnika ekranu inaczej klika „Zapisz" i nie
//      dowiaduje się, dlaczego nic się nie stało.
//   2. `ImageUrlField` - TRZY STANY PODGLĄDU MUSZĄ BYĆ ROZRÓŻNIALNE: własny
//      obraz, obraz DOMYŚLNY wbudowany w aplikację, brak obrazu. Zlanie
//      drugiego z pierwszym każe administratorowi wierzyć, że wybrał
//      ilustrację, której nie wybrał - a wyczyszczenie pola niczego nie zmienia.
//   3. `BilingualTextField` - ETYKIETA POWIĄZANA Z POLEM. W zakładce stoi
//      dwadzieścia kilka pól; bez `htmlFor`/`id` czytnik ogłasza „pole edycji".
//   4. `SettingToggleCard` - wiersz bez opisu nie renderuje pustego akapitu.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - REGUŁ SPÓJNOŚCI: skąd biorą się zastrzeżenia i które blokują zapis, ma
//   tabelę przypadków w `src/lib/__tests__/authSettingsRules.test.ts`. Atom
//   tylko POKAZUJE gotowe zastrzeżenie - nie ocenia ustawień.
// - BIBLIOTEKI MEDIÓW: `MediaPickerDialog` ma własne testy przy panelu mediów;
//   tutaj sprawdzamy wyłącznie, że organizm oddaje wybrany adres i zamyka okno.
// - SKLEJENIA PANELU: render trasy, odmowa zapisu i payload są
//   w `src/routes/__tests__/adminLoginSettingsRoute.test.tsx`.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  /** Propsy, z jakimi organizm zawołał bibliotekę mediów. */
  pickerProps: null as null | { open: boolean; onPick: (url: string) => void },
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/components/admin/media/MediaPickerDialog", () => ({
  MediaPickerDialog: (props: {
    open: boolean;
    onPick: (url: string) => void;
    onOpenChange: (open: boolean) => void;
    title: string;
  }) => {
    h.pickerProps = props;
    return (
      <div data-testid="media-picker" data-open={String(props.open)} data-title={props.title} />
    );
  },
}));

import { SettingToggleCard } from "@/components/admin/auth/atoms/SettingToggleCard";
import { AuthSettingsIssueList } from "@/components/admin/auth/atoms/AuthSettingsIssueList";
import { BilingualTextField } from "@/components/admin/auth/molecules/BilingualTextField";
import { ImageUrlField } from "@/components/admin/auth/organisms/ImageUrlField";
import { authSettingsIssues, type AuthSettingsIssue } from "@/lib/authSettingsRules";
import { AUTH_DEFAULTS } from "@/lib/authSettings";
import { axeViolations, summarize } from "@/test/axe";

afterEach(() => {
  cleanup();
  h.pickerProps = null;
});

describe("SettingToggleCard (atom)", () => {
  it("pokazuje nazwę, opis i kontrolkę", () => {
    render(
      <SettingToggleCard title="Popup logowania" description="Modal w headerze">
        <button type="button">przełącz</button>
      </SettingToggleCard>,
    );
    expect(screen.getByText("Popup logowania")).toBeTruthy();
    expect(screen.getByText("Modal w headerze")).toBeTruthy();
    expect(screen.getByRole("button", { name: "przełącz" })).toBeTruthy();
  });

  it("bez opisu nie renderuje pustej drugiej linii", () => {
    // Pusty akapit rozjeżdża wiersz w pionie i czytnik ogłasza puste pole.
    const { container } = render(
      <SettingToggleCard title="Powrót na stronę główną">
        <span>x</span>
      </SettingToggleCard>,
    );
    expect(container.querySelectorAll("div.text-xs")).toHaveLength(0);
  });

  it("pusty ciąg jako opis też nie renderuje drugiej linii", () => {
    const { container } = render(
      <SettingToggleCard title="Powrót" description="">
        <span>x</span>
      </SettingToggleCard>,
    );
    expect(container.querySelectorAll("div.text-xs")).toHaveLength(0);
  });
});

describe("AuthSettingsIssueList (atom)", () => {
  const blocking: AuthSettingsIssue = {
    id: "loggedInRedirectLoopsToLogin",
    field: "logged_in_redirect_url",
    severity: "blocking",
    messageKey: "adminLoginSettings.issue.loggedInRedirectLoopsToLogin",
  };
  const warning: AuthSettingsIssue = {
    id: "publicSignupClosed",
    field: "allow_public_signup",
    severity: "warning",
    messageKey: "adminLoginSettings.issue.publicSignupClosed",
  };

  it("pusta lista nie renderuje nic - żadnej ramki, żadnego odstępu", () => {
    const { container } = render(<AuthSettingsIssueList issues={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("BLOKADA jedzie jako role=alert, OSTRZEŻENIE nie", () => {
    // To jest cała treść tego testu: czytnik ekranu ma ogłosić powód, dla
    // którego zapis nie przejdzie, bez czekania na kliknięcie „Zapisz".
    render(<AuthSettingsIssueList issues={[blocking, warning]} />);
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].closest("[data-issue-id]")?.getAttribute("data-issue-id")).toBe(
      "loggedInRedirectLoopsToLogin",
    );
  });

  it("pokazuje KLUCZ i18n każdego zastrzeżenia", () => {
    render(<AuthSettingsIssueList issues={[blocking, warning]} />);
    expect(screen.getByText(blocking.messageKey)).toBeTruthy();
    expect(screen.getByText(warning.messageKey)).toBeTruthy();
  });

  it("waga zastrzeżenia jest odczytywalna z DOM, nie tylko z koloru", () => {
    // Kolor nie jest informacją dla wszystkich; `data-issue-severity` jest też
    // tym, po czym asertują testy trasy.
    render(<AuthSettingsIssueList issues={[blocking, warning]} />);
    const severities = [...document.querySelectorAll("[data-issue-severity]")].map((node) =>
      node.getAttribute("data-issue-severity"),
    );
    expect(severities).toEqual(["blocking", "warning"]);
  });

  it("renderuje realny zestaw zastrzeżeń z reguł, nie tylko ręcznie zbudowany", async () => {
    // Sklejenie z modułem reguł: gdyby kształt `AuthSettingsIssue` się rozjechał,
    // atom przestałby cokolwiek pokazywać, a ręczny literał wyżej by to minął.
    const issues = authSettingsIssues({
      ...AUTH_DEFAULTS,
      logged_in_redirect_url: "/login",
      allow_public_signup: false,
    });
    const { container } = render(<AuthSettingsIssueList issues={issues} />);
    expect(container.querySelectorAll("[data-issue-id]")).toHaveLength(issues.length);
    expect(await axeViolations(container).then(summarize)).toBe("");
  });
});

describe("BilingualTextField (molekuła)", () => {
  function mount(props: Partial<React.ComponentProps<typeof BilingualTextField>> = {}) {
    const onChangePl = vi.fn();
    const onChangeEn = vi.fn();
    const utils = render(
      <BilingualTextField
        label="Tytuł hero"
        valuePl="Wejdź"
        valueEn="Enter"
        onChangePl={onChangePl}
        onChangeEn={onChangeEn}
        {...props}
      />,
    );
    return { ...utils, onChangePl, onChangeEn };
  }

  it("etykieta jest POWIĄZANA z polem - obie wersje językowe", () => {
    mount();
    expect((screen.getByLabelText("Tytuł hero (PL)") as HTMLInputElement).value).toBe("Wejdź");
    expect((screen.getByLabelText("Tytuł hero (EN)") as HTMLInputElement).value).toBe("Enter");
  });

  it("zmiana w PL nie rusza EN i odwrotnie", () => {
    const { onChangePl, onChangeEn } = mount();
    fireEvent.change(screen.getByLabelText("Tytuł hero (PL)"), { target: { value: "Zaloguj" } });
    expect(onChangePl).toHaveBeenCalledWith("Zaloguj");
    expect(onChangeEn).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Tytuł hero (EN)"), { target: { value: "Sign in" } });
    expect(onChangeEn).toHaveBeenCalledWith("Sign in");
    expect(onChangePl).toHaveBeenCalledTimes(1);
  });

  it("wariant jednolinijkowy używa <input>, wielolinijkowy <textarea>", () => {
    const single = mount();
    expect(single.container.querySelectorAll("textarea")).toHaveLength(0);
    cleanup();
    const multi = mount({ multiline: true });
    expect(multi.container.querySelectorAll("textarea")).toHaveLength(2);
  });

  it("wariant wielolinijkowy nadal wywołuje właściwy handler", () => {
    const { onChangeEn } = mount({ multiline: true });
    fireEvent.change(screen.getByLabelText("Tytuł hero (EN)"), { target: { value: "Long" } });
    expect(onChangeEn).toHaveBeenCalledWith("Long");
  });

  it("dwie instancje na jednym ekranie nie kolidują identyfikatorami", () => {
    // `useId` zamiast stałego `id`: w zakładce „Strona /login" stoi sześć par.
    render(
      <>
        <BilingualTextField
          label="A"
          valuePl=""
          valueEn=""
          onChangePl={vi.fn()}
          onChangeEn={vi.fn()}
        />
        <BilingualTextField
          label="B"
          valuePl=""
          valueEn=""
          onChangePl={vi.fn()}
          onChangeEn={vi.fn()}
        />
      </>,
    );
    const ids = [...document.querySelectorAll("input")].map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("nie ma naruszeń dostępności", async () => {
    const { container } = mount();
    expect(await axeViolations(container).then(summarize)).toBe("");
  });
});

describe("ImageUrlField (organizm)", () => {
  function mount(props: Partial<React.ComponentProps<typeof ImageUrlField>> = {}) {
    const onChange = vi.fn();
    const utils = render(
      <ImageUrlField label="Ilustracja hero" value="" onChange={onChange} {...props} />,
    );
    return { ...utils, onChange };
  }

  it("BRAK OBRAZU: ikona zastępcza plus tekst, bez <img>", () => {
    const { container } = mount();
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(screen.getByText("adminLoginSettings.noImage")).toBeTruthy();
  });

  it("WŁASNY OBRAZ: <img> z adresem i BEZ plakietki „domyślny”", () => {
    mount({ value: "https://cdn.example.org/hero.webp" });
    const image = screen.getByRole("img", { name: "Ilustracja hero" });
    expect(image.getAttribute("src")).toBe("https://cdn.example.org/hero.webp");
    expect(screen.queryByText("adminLoginSettings.defaultBadge")).toBeNull();
  });

  it("OBRAZ DOMYŚLNY: <img> z fallbacku ORAZ plakietka - i to jest cała treść testu", () => {
    // Bez plakietki administrator widzi ilustrację i sądzi, że sam ją wybrał;
    // wyczyszczenie pola nic wtedy nie zmienia i wygląda na awarię.
    mount({ value: "", fallbackUrl: "/assets/login-light.jpg" });
    expect(screen.getByRole("img", { name: "Ilustracja hero" }).getAttribute("src")).toBe(
      "/assets/login-light.jpg",
    );
    expect(screen.getByText("adminLoginSettings.defaultBadge")).toBeTruthy();
  });

  it("własny obraz WYGRYWA nad domyślnym i gasi plakietkę", () => {
    mount({ value: "https://cdn.example.org/own.webp", fallbackUrl: "/assets/login-light.jpg" });
    expect(screen.getByRole("img", { name: "Ilustracja hero" }).getAttribute("src")).toBe(
      "https://cdn.example.org/own.webp",
    );
    expect(screen.queryByText("adminLoginSettings.defaultBadge")).toBeNull();
  });

  it("przycisk czyszczenia jest WIDOCZNY tylko przy własnym obrazie", () => {
    const withValue = mount({ value: "https://cdn.example.org/hero.webp" });
    expect(screen.getByText("adminLoginSettings.clear")).toBeTruthy();
    fireEvent.click(screen.getByText("adminLoginSettings.clear"));
    expect(withValue.onChange).toHaveBeenCalledWith("");
    cleanup();

    // Przy obrazie domyślnym nie ma czego czyścić - pole JUŻ jest puste.
    mount({ value: "", fallbackUrl: "/assets/login-light.jpg" });
    expect(screen.queryByText("adminLoginSettings.clear")).toBeNull();
  });

  it("wpisany adres jedzie do rodzica", () => {
    const { onChange } = mount();
    fireEvent.change(screen.getByPlaceholderText("adminLoginSettings.imgUrlPlaceholder"), {
      target: { value: "/media/hero.webp" },
    });
    expect(onChange).toHaveBeenCalledWith("/media/hero.webp");
  });

  it("biblioteka mediów startuje ZAMKNIĘTA i otwiera się na żądanie", () => {
    mount();
    expect(document.querySelector('[data-testid="media-picker"]')?.getAttribute("data-open")).toBe(
      "false",
    );
    fireEvent.click(screen.getByText("adminLoginSettings.pick"));
    expect(document.querySelector('[data-testid="media-picker"]')?.getAttribute("data-open")).toBe(
      "true",
    );
  });

  it("wybór z biblioteki oddaje adres i ZAMYKA okno", () => {
    const { onChange } = mount();
    fireEvent.click(screen.getByText("adminLoginSettings.pick"));
    // `onPick` woła DWIE aktualizacje stanu (adres w górę, zamknięcie okna) -
    // bez `act` asercja na zamknięciu ściga się z przetworzeniem drugiej.
    act(() => h.pickerProps?.onPick("/media/wybrany.webp"));
    expect(onChange).toHaveBeenCalledWith("/media/wybrany.webp");
    expect(document.querySelector('[data-testid="media-picker"]')?.getAttribute("data-open")).toBe(
      "false",
    );
  });

  it("tytuł okna wyboru niesie etykietę pola jako PARAMETR klucza", () => {
    // Dwa pola obok siebie (jasny/ciemny) otwierają to samo okno - bez etykiety
    // w tytule nie da się poznać, do którego wróci wybrany obraz.
    mount({ label: "Motyw ciemny" });
    fireEvent.click(screen.getByText("adminLoginSettings.pick"));
    expect(document.querySelector('[data-testid="media-picker"]')?.getAttribute("data-title")).toBe(
      "adminLoginSettings.pickImage(label=Motyw ciemny)",
    );
  });

  it.each([
    ["light", "bg-neutral-50"],
    ["dark", "bg-neutral-900"],
  ])("tło podglądu %s odpowiada motywowi", (previewBg, expectedClass) => {
    // Ilustracja dla motywu ciemnego na białym tle kłamie o kontraście.
    const { container } = render(
      <ImageUrlField
        label="Hero"
        value=""
        onChange={vi.fn()}
        previewBg={previewBg as "light" | "dark"}
      />,
    );
    expect(container.querySelector(`.${expectedClass}`)).toBeTruthy();
  });

  it("bez wskazanego motywu podglądu używa neutralnego tła panelu", () => {
    const { container } = mount();
    expect(container.querySelector(".bg-muted")).toBeTruthy();
  });

  it.each([
    ["light", true],
    ["dark", true],
    [undefined, false],
  ])("ikona motywu %s przy etykiecie: %s", (icon, expected) => {
    const { container } = render(
      <ImageUrlField
        label="Hero"
        value=""
        onChange={vi.fn()}
        icon={icon as "light" | "dark" | undefined}
      />,
    );
    // Ikona jest dekoracją (`aria-hidden`) - nazwę niesie sama etykieta.
    // Zawężenie do ETYKIETY jest konieczne: ikona zastępcza pustego podglądu
    // też jest `aria-hidden`, więc zapytanie po całym drzewie byłoby zawsze prawdą.
    const label = container.querySelector("label");
    expect(label?.querySelector("svg[aria-hidden]") !== null && label !== null).toBe(expected);
  });

  it("podpowiedź renderuje się tylko wtedy, gdy została podana", () => {
    mount({ hint: "1600×1200 px" });
    expect(screen.getByText("1600×1200 px")).toBeTruthy();
    cleanup();
    const without = mount();
    expect(without.container.querySelectorAll("p")).toHaveLength(0);
  });

  it("nie ma naruszeń dostępności w stanie z obrazem", async () => {
    const { container } = mount({ value: "https://cdn.example.org/hero.webp" });
    expect(await axeViolations(container).then(summarize)).toBe("");
  });
});
