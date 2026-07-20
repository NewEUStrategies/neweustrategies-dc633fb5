// Zasoby i18n dla /admin/login-settings - ustawienia strony logowania,
// popupu i rejestracji.
import i18n from "@/lib/i18n";

const pl = {
  adminLoginSettings: {
    errGeneric: "Błąd",
    pageTitle: "Logowanie i rejestracja",
    reset: "Resetuj",
    saving: "Zapisywanie…",
    saveChanges: "Zapisz zmiany",
    tabPage: "Strona /login",
    tabSignup: "Rejestracja",
    popupEnableTitle: "Włącz popup logowania",
    popupEnableDesc: "Modal logowania w headerze. Wyłączony = przekierowanie do /login.",
    heading: "Nagłówek",
    description: "Opis",
    formLogoLight: "Logo formularza (motyw jasny)",
    formLogoLightHint:
      "PNG / SVG z przezroczystym tłem. Zalecana wysokość 48–80 px, szerokość do 240 px, waga < 100 KB.",
    formLogoDark: "Logo formularza (motyw ciemny)",
    formLogoDarkHint:
      "Opcjonalnie - jasna wersja logo dla ciemnego motywu. Fallback: logo motywu jasnego.",
    heroTitle: "Tytuł hero",
    heroSubtitle: "Podtytuł hero",
    themeLight: "Motyw jasny",
    themeDark: "Motyw ciemny",
    recDims: "Zalecane wymiary: ",
    heroLoginTitle: "Ilustracje hero – Logowanie",
    heroLoginDesc1:
      "Obraz po prawej stronie formularza logowania. Dwie wersje – dla jasnego i ciemnego motywu – zapewniają kontrast i czytelność.",
    heroLoginDesc2:
      " (landscape 4:3, dopasowane do karty hero), minimum 1200 × 900 px. Format WebP/JPG, waga do 400 KB. Focal point centralnie lub po prawej.",
    hintLoginLight:
      "1600×1200 px (4:3) · jasne tło, ciemne akcenty. Domyślnie: wbudowana ilustracja.",
    hintLoginDark:
      "1600×1200 px (4:3) · ciemne tło, jasne akcenty. Domyślnie: wbudowana ilustracja.",
    heroResetTitle: "Ilustracje – Reset hasła",
    heroResetDesc1:
      'Widoczne po kliknięciu „Zapomniałeś hasła?". Jeśli puste – używana jest ilustracja logowania.',
    heroResetDesc2: " (landscape 4:3), format WebP/JPG, waga do 400 KB.",
    hintOptFallback: "1600×1200 px (4:3) · opcjonalnie. Fallback: ilustracja logowania.",
    fullscreenTitle: "Pełnoekranowe tło",
    fullscreenDesc1: "Używane, gdy formularz jest w trybie full-page. ",
    fullscreenDesc2:
      " (16:9), format WebP, waga do 500 KB. Preferuj obrazy z niskim kontrastem centralnym, żeby nie konkurowały z formularzem.",
    loginBgLabel: "Tło strony logowania",
    loginBgHint: "1920×1080 px · WebP, < 500 KB.",
    bgColorLabel: "Kolor tła (hex / oklch / var) – fallback bez zdjęcia",
    privacyLink: "Link do Polityki prywatności",
    termsLink: "Link do Regulaminu",
    langSwitchTitle: "Przełącznik języka PL/EN",
    langSwitchDesc: "Pokazuje przyciski PL/EN w prawym górnym rogu strony /login.",
    formPosition: "Pozycja formularza",
    posLeft: "Lewa",
    posCenter: "Środek",
    posRight: "Prawa",
    formPositionHint:
      "Lewa / Prawa - kolumna formularza względem ilustracji hero. Środek - ukrywa ilustrację i wyśrodkowuje formularz.",
    backHomeTitle: "Pokaż link 'Wróć na stronę główną'",
    customLoginUrl: "Niestandardowy URL strony logowania (opcjonalnie)",
    customLoginUrlHint:
      'Gdy popup jest wyłączony, przyciski logowania prowadzą tutaj zamiast na /login. Ścieżka wewnętrzna ("/...") lub pełny adres https.',
    logoutRedirect: "Przekierowanie po wylogowaniu",
    logoutRedirectHint:
      'Ścieżka wewnętrzna (musi zaczynać się od "/"), na którą trafia użytkownik po wylogowaniu. Domyślnie strona główna.',
    publicSignupTitle: "Pozwól na publiczną rejestrację",
    publicSignupDesc: "Czytelnicy mogą zakładać konta (rola: user).",
    signinLabel: "Etykieta 'Zaloguj'",
    signupLabel: "Etykieta 'Zarejestruj'",
    heroSignupTitle: "Ilustracje hero – Rejestracja",
    heroSignupDesc1:
      "Obraz po prawej stronie formularza rejestracji. Jeśli puste – używana jest ilustracja logowania.",
    heroSignupDesc2:
      " (landscape 4:3, dopasowane do karty hero), minimum 1200 × 900 px. Format WebP/JPG, waga do 400 KB.",
    clear: "Wyczyść",
    defaultBadge: "Domyślna",
    noImage: "Brak obrazu",
    imgUrlPlaceholder: "https://…/obraz.jpg",
    pick: "Wybierz",
    pickImage: "Wybierz obraz: {{label}}",
  },
};

const en = {
  adminLoginSettings: {
    errGeneric: "Error",
    pageTitle: "Login and registration",
    reset: "Reset",
    saving: "Saving…",
    saveChanges: "Save changes",
    tabPage: "/login page",
    tabSignup: "Registration",
    popupEnableTitle: "Enable login popup",
    popupEnableDesc: "Login modal in the header. Disabled = redirect to /login.",
    heading: "Heading",
    description: "Description",
    formLogoLight: "Form logo (light theme)",
    formLogoLightHint:
      "PNG / SVG with a transparent background. Recommended height 48–80 px, width up to 240 px, weight < 100 KB.",
    formLogoDark: "Form logo (dark theme)",
    formLogoDarkHint:
      "Optional - a light logo version for the dark theme. Fallback: light-theme logo.",
    heroTitle: "Hero title",
    heroSubtitle: "Hero subtitle",
    themeLight: "Light theme",
    themeDark: "Dark theme",
    recDims: "Recommended dimensions: ",
    heroLoginTitle: "Hero illustrations – Login",
    heroLoginDesc1:
      "Image on the right side of the login form. Two versions – for light and dark theme – ensure contrast and readability.",
    heroLoginDesc2:
      " (landscape 4:3, matched to the hero card), minimum 1200 × 900 px. WebP/JPG format, weight up to 400 KB. Focal point centered or to the right.",
    hintLoginLight:
      "1600×1200 px (4:3) · light background, dark accents. Default: built-in illustration.",
    hintLoginDark:
      "1600×1200 px (4:3) · dark background, light accents. Default: built-in illustration.",
    heroResetTitle: "Illustrations – Password reset",
    heroResetDesc1:
      'Shown after clicking "Forgot your password?". If empty – the login illustration is used.',
    heroResetDesc2: " (landscape 4:3), WebP/JPG format, weight up to 400 KB.",
    hintOptFallback: "1600×1200 px (4:3) · optional. Fallback: login illustration.",
    fullscreenTitle: "Full-screen background",
    fullscreenDesc1: "Used when the form is in full-page mode. ",
    fullscreenDesc2:
      " (16:9), WebP format, weight up to 500 KB. Prefer images with low central contrast so they don't compete with the form.",
    loginBgLabel: "Login page background",
    loginBgHint: "1920×1080 px · WebP, < 500 KB.",
    bgColorLabel: "Background color (hex / oklch / var) – fallback without an image",
    privacyLink: "Privacy Policy link",
    termsLink: "Terms of Service link",
    langSwitchTitle: "PL/EN language switcher",
    langSwitchDesc: "Shows PL/EN buttons in the top-right corner of the /login page.",
    formPosition: "Form position",
    posLeft: "Left",
    posCenter: "Center",
    posRight: "Right",
    formPositionHint:
      "Left / Right - the form column relative to the hero illustration. Center - hides the illustration and centers the form.",
    backHomeTitle: "Show the 'Back to homepage' link",
    customLoginUrl: "Custom login page URL (optional)",
    customLoginUrlHint:
      'When the popup is disabled, login buttons lead here instead of /login. Internal path ("/...") or a full https address.',
    logoutRedirect: "Redirect after logout",
    logoutRedirectHint:
      'Internal path (must start with "/") the user lands on after logging out. Defaults to the homepage.',
    publicSignupTitle: "Allow public registration",
    publicSignupDesc: "Readers can create accounts (role: user).",
    signinLabel: "'Sign in' label",
    signupLabel: "'Sign up' label",
    heroSignupTitle: "Hero illustrations – Registration",
    heroSignupDesc1:
      "Image on the right side of the registration form. If empty – the login illustration is used.",
    heroSignupDesc2:
      " (landscape 4:3, matched to the hero card), minimum 1200 × 900 px. WebP/JPG format, weight up to 400 KB.",
    clear: "Clear",
    defaultBadge: "Default",
    noImage: "No image",
    imgUrlPlaceholder: "https://…/image.jpg",
    pick: "Pick",
    pickImage: "Pick an image: {{label}}",
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

/**
 * No-op wołany w komponencie trasy zamiast side-effectowego importu modułu.
 * Nazwane wiązanie pozwala splitterowi TanStacka przenieść cały bundle
 * tłumaczeń do chunka trasy - side-effectowy import w pliku trasy lądował
 * w eager-owym grafie wejściowym każdej strony. Rejestracja dzieje się przy
 * ewaluacji modułu (przed renderem komponentu), dokładnie jak wcześniej.
 */
export function ensureI18n(): void {}
