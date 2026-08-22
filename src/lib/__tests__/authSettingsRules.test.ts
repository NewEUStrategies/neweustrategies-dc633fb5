// Reguły ustawień logowania: odczyt z bazy, spójność kombinacji, prawo zapisu.
//
// CO TEN PLIK DOWODZI. `lib/authSettingsRules.ts` jest jedynym miejscem, które
// odpowiada na cztery pytania panelu `/admin/login-settings`: co znaczy wiersz
// z bazy (odczyt), czy tę kombinację wolno zapisać (spójność), czy TA osoba
// może ją zapisać (uprawnienie) i co powiedzieć, gdy baza odmówi (klucz i18n).
// Do dziś wszystkie cztery mieszkały w ciele komponentu 533-linijkowej trasy
// i miały ZERO wykonanych funkcji - a od tego panelu zależy, czy da się na
// serwis wejść.
//
// DLACZEGO ODCZYT JEST TU OSOBNYM PRZEDMIOTEM DOWODU. `site_settings.value`
// jest kolumną `jsonb`: baza nie zna typu `AuthSettings` i wolno jej zwrócić
// tam wartość spoza enuma, złego typu, wiersz częściowy albo `null`. Zastane
// `{...AUTH_DEFAULTS, ...row}` przepuszczało każdą z tych czterech postaci
// prosto do widoku - `popup_enabled: "yes"` jest prawdą w każdym `if`.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - ZACHOWANIA KONSUMENTÓW: to, co `AuthPortal` robi z `login_position` i
//   `allow_public_signup`, ma własne asercje w
//   `src/components/auth/__tests__/AuthPortal.test.tsx`. Tutaj dowodzimy reguł
//   nad wartościami, nie renderu formularza logowania.
// - SKLEJENIA PANELU: render trasy, przekierowanie bez roli i stan awarii
//   odczytu są w `src/routes/__tests__/adminLoginSettingsRoute.test.tsx`.
// - ZAPISU DO BAZY: `upsert` na `site_settings` i unieważnienia cache mają
//   asercje przy hooku (`src/hooks/__tests__/useAuthSettings.test.tsx`).
// - AUTORYTETU: prawo zapisu do `site_settings` egzekwuje RLS, dowiedzione
//   w pgTAP. `decideAuthSettingsSave` jest zaporą PRZED zapytaniem, nie zamiast
//   polityki - i tylko to sprawdzamy.
import { describe, expect, it } from "vitest";
import { AUTH_DEFAULTS, type AuthSettings } from "@/lib/authSettings";
import {
  LOGIN_POSITIONS,
  authSettingsIssues,
  authSettingsSaveErrorKey,
  decideAuthSettingsSave,
  hasBlockingIssue,
  isAbsoluteHttpUrl,
  isInternalPath,
  readAuthSettings,
} from "@/lib/authSettingsRules";
import { pgError } from "@/test/supabaseChain";

/** Ustawienia domyślne z nałożoną łatką - baza dla każdego przypadku spójności. */
function settings(patch: Partial<AuthSettings> = {}): AuthSettings {
  return { ...AUTH_DEFAULTS, ...patch };
}

/** Identyfikatory zastrzeżeń - asercja na nich, nie na przetłumaczonym napisie. */
function issueIds(value: AuthSettings): string[] {
  return authSettingsIssues(value).map((issue) => issue.id);
}

describe("readAuthSettings - odczyt wiersza ustawień", () => {
  it("brak wiersza (null) daje komplet domyślnych", () => {
    expect(readAuthSettings(null)).toEqual(AUTH_DEFAULTS);
  });

  it("brak klucza w mapie (undefined) daje komplet domyślnych", () => {
    expect(readAuthSettings(undefined)).toEqual(AUTH_DEFAULTS);
  });

  it("wartość niebędąca obiektem daje domyślne, nie wyjątek", () => {
    // `jsonb` przechowa też skalar i tablicę - odczyt nie ma prawa wysypać
    // strony logowania, bo wtedy zła wartość w bazie zamyka wejście wszystkim.
    for (const raw of ["auth_branding", 42, true, [], [{ popup_enabled: false }]]) {
      expect(readAuthSettings(raw)).toEqual(AUTH_DEFAULTS);
    }
  });

  it("wiersz częściowy nakłada się na domyślne, resztę zostawia", () => {
    const read = readAuthSettings({ popup_enabled: false, hero_title_pl: "Wejdź" });
    expect(read.popup_enabled).toBe(false);
    expect(read.hero_title_pl).toBe("Wejdź");
    expect(read.signin_label_pl).toBe(AUTH_DEFAULTS.signin_label_pl);
    expect(read.logout_redirect_url).toBe(AUTH_DEFAULTS.logout_redirect_url);
  });

  it.each([
    ["left", "left"],
    ["center", "center"],
    ["right", "right"],
    // Wartość spoza enuma NIE przechodzi: `AuthPortal` porównuje ją z „center",
    // więc każda inna zachowuje się jak „right" - odczyt nazywa to wprost.
    ["top", AUTH_DEFAULTS.login_position],
    ["", AUTH_DEFAULTS.login_position],
    ["RIGHT", AUTH_DEFAULTS.login_position],
  ])("login_position %j czyta się jako %j", (raw, expected) => {
    expect(readAuthSettings({ login_position: raw }).login_position).toBe(expected);
  });

  it("login_position złego typu też cofa się do domyślnej", () => {
    expect(readAuthSettings({ login_position: 3 }).login_position).toBe(
      AUTH_DEFAULTS.login_position,
    );
    expect(readAuthSettings({ login_position: null }).login_position).toBe(
      AUTH_DEFAULTS.login_position,
    );
  });

  it("wszystkie dozwolone położenia są odczytywalne - kanarek listy", () => {
    // Bez tego dopisanie czwartego położenia do enuma zostawiłoby je odrzucane
    // przez odczyt, a panel pokazywałby wybór, którego nie da się zapisać.
    for (const position of LOGIN_POSITIONS) {
      expect(readAuthSettings({ login_position: position }).login_position).toBe(position);
    }
  });

  it.each([
    ["popup_enabled", "yes"],
    ["popup_enabled", 1],
    ["allow_public_signup", "false"],
    ["show_back_to_home", 0],
    ["show_language_switcher", null],
  ])("wartość logiczna %s złego typu (%j) cofa się do domyślnej", (key, raw) => {
    const read = readAuthSettings({ [key]: raw });
    expect(read[key as keyof AuthSettings]).toBe(AUTH_DEFAULTS[key as keyof AuthSettings]);
  });

  it.each([
    ["custom_login_url", 7],
    ["logout_redirect_url", false],
    ["hero_title_en", { pl: "x" }],
    ["privacy_url", null],
  ])("wartość tekstowa %s złego typu (%j) cofa się do domyślnej", (key, raw) => {
    const read = readAuthSettings({ [key]: raw });
    expect(read[key as keyof AuthSettings]).toBe(AUTH_DEFAULTS[key as keyof AuthSettings]);
  });

  it("nadmiarowe klucze z bazy nie trafiają do wyniku", () => {
    // Ustawienie usunięte z aplikacji zostaje w `jsonb` na zawsze. Odczyt
    // przepisuje WYŁĄCZNIE znane pola, więc martwe klucze nie wracają do zapisu.
    const read = readAuthSettings({ popup_enabled: false, legacy_sso_only: true });
    expect(Object.keys(read).sort()).toEqual(Object.keys(AUTH_DEFAULTS).sort());
  });

  it("odczyt nie mutuje domyślnych ani wiersza wejściowego", () => {
    const raw = { hero_title_pl: "Wejdź" };
    const read = readAuthSettings(raw);
    read.hero_title_pl = "Zmienione";
    expect(raw.hero_title_pl).toBe("Wejdź");
    expect(AUTH_DEFAULTS.hero_title_pl).not.toBe("Zmienione");
  });
});

describe("rozpoznawanie adresów - to, co konsumenci realnie honorują", () => {
  it.each([
    ["/login", true],
    ["/membership/login", true],
    ["/", true],
    // Adres protokołowo-relatywny WYGLĄDA jak ścieżka, a prowadzi na obcy host.
    ["//evil.example/login", false],
    ["https://idp.example.org/auth", false],
    ["membership/login", false],
    ["", false],
  ])("isInternalPath(%j) = %s", (value, expected) => {
    expect(isInternalPath(value)).toBe(expected);
  });

  it.each([
    ["https://idp.example.org/auth", true],
    ["http://idp.example.org/auth", true],
    ["//idp.example.org/auth", false],
    ["ftp://idp.example.org", false],
    ["/login", false],
  ])("isAbsoluteHttpUrl(%j) = %s", (value, expected) => {
    expect(isAbsoluteHttpUrl(value)).toBe(expected);
  });
});

describe("authSettingsIssues - kombinacje, które zamykają wejście", () => {
  it("domyślne ustawienia nie mają żadnego zastrzeżenia", () => {
    // Gdyby domyślne coś naruszały, instalacja bez zapisanych ustawień stałaby
    // od pierwszego dnia z blokadą zapisu w panelu.
    expect(issueIds(settings())).toEqual([]);
  });

  it.each([
    ["/login", "wprost strona logowania"],
    ["/login?mode=signup", "ten sam formularz z parametrem trybu"],
    ["/login/", "ten sam formularz z ukośnikiem na końcu"],
    ["/login#top", "ten sam formularz z fragmentem"],
  ])("przekierowanie po zalogowaniu na %j blokuje zapis (%s)", (logged_in_redirect_url: string) => {
    const issues = authSettingsIssues(settings({ logged_in_redirect_url }));
    expect(issues.map((i) => i.id)).toContain("loggedInRedirectLoopsToLogin");
    expect(issues[0]).toMatchObject({
      field: "logged_in_redirect_url",
      severity: "blocking",
      messageKey: "adminLoginSettings.issue.loggedInRedirectLoopsToLogin",
    });
  });

  it("pętla liczy się też wobec WŁASNEGO adresu logowania, nie tylko /login", () => {
    // Administrator, który przeniósł formularz na /membership/login, dostałby
    // dokładnie tę samą pętlę - a reguła patrząca wyłącznie na /login by ją minęła.
    expect(
      issueIds(
        settings({
          custom_login_url: "/membership/login",
          logged_in_redirect_url: "/membership/login",
        }),
      ),
    ).toContain("loggedInRedirectLoopsToLogin");
  });

  it("przekierowanie po zalogowaniu na inną stronę nie jest pętlą", () => {
    expect(issueIds(settings({ logged_in_redirect_url: "/witaj" }))).toEqual([]);
  });

  it("puste przekierowanie po zalogowaniu nie jest pętlą", () => {
    expect(issueIds(settings({ logged_in_redirect_url: "   " }))).toEqual([]);
  });

  it("przekierowanie zewnętrzne po zalogowaniu nie jest pętlą (konsument je zignoruje)", () => {
    expect(issueIds(settings({ logged_in_redirect_url: "https://example.org/witaj" }))).toEqual([]);
  });

  it("wyłączony popup z zewnętrznym adresem logowania blokuje zapis", () => {
    const issues = authSettingsIssues(
      settings({ popup_enabled: false, custom_login_url: "https://idp.example.org/auth" }),
    );
    expect(issues.map((i) => i.id)).toContain("onlyEntryPointIsExternal");
    expect(hasBlockingIssue(issues)).toBe(true);
  });

  it("zewnętrzny adres logowania przy WŁĄCZONYM popupie jest tylko wariantem, nie blokadą", () => {
    // Popup nadal działa w serwisie, więc wejście nie zależy od obcego hosta.
    expect(
      issueIds(settings({ popup_enabled: true, custom_login_url: "https://idp.example.org/auth" })),
    ).toEqual([]);
  });

  it("wyłączony popup bez własnego adresu jest poprawny - konsument idzie na /login", () => {
    expect(issueIds(settings({ popup_enabled: false, custom_login_url: "" }))).toEqual([]);
  });

  it.each(["//evil.example/login", "membership/login", "ftp://idp.example.org"])(
    "własny adres logowania %j jest ostrzeżeniem: konsument go zignoruje",
    (custom_login_url) => {
      const issues = authSettingsIssues(settings({ custom_login_url }));
      const ignored = issues.find((i) => i.id === "customLoginUrlIgnored");
      expect(ignored).toMatchObject({ severity: "warning", field: "custom_login_url" });
      // Ostrzeżenie NIE blokuje zapisu - to ustawienie bez skutku, nie blokada wejścia.
      expect(hasBlockingIssue(issues)).toBe(false);
    },
  );

  it.each(["//evil.example", "witaj", "https://example.org/pa"])(
    "przekierowanie po wylogowaniu %j jest ostrzeżeniem: useAuth cofnie się na /",
    (logout_redirect_url) => {
      const issues = authSettingsIssues(settings({ logout_redirect_url }));
      expect(issues.map((i) => i.id)).toContain("logoutRedirectIgnored");
      expect(hasBlockingIssue(issues)).toBe(false);
    },
  );

  it("puste przekierowanie po wylogowaniu nie jest zastrzeżeniem", () => {
    expect(issueIds(settings({ logout_redirect_url: "" }))).toEqual([]);
  });

  it.each([
    ["signin_label_pl", ""],
    ["signin_label_pl", "   "],
    ["signin_label_en", ""],
  ])("pusta etykieta %s (%j) blokuje zapis", (field, value) => {
    const issues = authSettingsIssues(settings({ [field]: value }));
    expect(issues.map((i) => i.id)).toContain(`signinLabelEmpty:${field}`);
    expect(hasBlockingIssue(issues)).toBe(true);
  });

  it("pusta etykieta w OBU językach daje dwa osobne zastrzeżenia", () => {
    // Jedno zbiorcze zastrzeżenie nie powiedziałoby, którego języka brakuje -
    // a administrator pracujący po polsku nie zauważy braku w EN.
    const issues = authSettingsIssues(settings({ signin_label_pl: "", signin_label_en: "" }));
    expect(
      issues.filter((i) => i.messageKey.endsWith("signinLabelEmpty")).map((i) => i.field),
    ).toEqual(["signin_label_pl", "signin_label_en"]);
  });

  it("wyłączona rejestracja publiczna jest ostrzeżeniem, nie blokadą", () => {
    // Serwis tylko dla zaproszonych to legalny tryb pracy - ale musi być
    // decyzją, nie skutkiem ubocznym kliknięcia w przełącznik.
    const issues = authSettingsIssues(settings({ allow_public_signup: false }));
    expect(issues.map((i) => i.id)).toEqual(["publicSignupClosed"]);
    expect(hasBlockingIssue(issues)).toBe(false);
  });

  it("zastrzeżenia idą od najgroźniejszych - blokady przed ostrzeżeniami", () => {
    const issues = authSettingsIssues(
      settings({
        popup_enabled: false,
        custom_login_url: "https://idp.example.org/auth",
        logged_in_redirect_url: "/login",
        logout_redirect_url: "//evil.example",
        allow_public_signup: false,
      }),
    );
    const severities = issues.map((i) => i.severity);
    expect(severities.indexOf("warning")).toBeGreaterThan(severities.lastIndexOf("blocking"));
  });

  it("każde zastrzeżenie niesie KLUCZ i18n, nigdy gotowy tekst", () => {
    // Asercja na napisie padłaby przy pierwszej poprawionej literówce
    // w tłumaczeniu; asercja na kluczu pilnuje kontraktu, nie redakcji.
    const issues = authSettingsIssues(
      settings({
        logged_in_redirect_url: "/login",
        logout_redirect_url: "witaj",
        allow_public_signup: false,
        signin_label_en: "",
      }),
    );
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) {
      expect(issue.messageKey).toMatch(/^adminLoginSettings\.issue\.[a-zA-Z]+$/);
    }
  });

  it("hasBlockingIssue na pustej liście jest fałszem", () => {
    expect(hasBlockingIssue([])).toBe(false);
  });
});

describe("decideAuthSettingsSave - kto i co wolno zapisać", () => {
  it("bez roli super_admina zapis jest odrzucony", () => {
    const decision = decideAuthSettingsSave(settings(), { isSuperAdmin: false });
    expect(decision).toEqual({
      allowed: false,
      reasonKey: "adminLoginSettings.errNoPermission",
      issues: [],
    });
  });

  it("brak uprawnienia sprawdza się PRZED spójnością - odmowa nic nie podpowiada", () => {
    // Odwrotna kolejność mówiłaby osobie bez uprawnień, które kombinacje
    // przechodzą walidację - czyli oddawała informację o konfiguracji serwisu.
    const decision = decideAuthSettingsSave(settings({ logged_in_redirect_url: "/login" }), {
      isSuperAdmin: false,
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error("test: decyzja miała być odmową");
    expect(decision.reasonKey).toBe("adminLoginSettings.errNoPermission");
    expect(decision.issues).toEqual([]);
  });

  it("kombinacja blokująca jest odrzucona mimo uprawnienia", () => {
    const decision = decideAuthSettingsSave(settings({ logged_in_redirect_url: "/login" }), {
      isSuperAdmin: true,
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error("test: decyzja miała być odmową");
    expect(decision.reasonKey).toBe("adminLoginSettings.errInconsistent");
    expect(decision.issues.map((i) => i.id)).toEqual(["loggedInRedirectLoopsToLogin"]);
    // Odmowa niesie WYŁĄCZNIE blokady - ostrzeżenia nie tłumaczą odrzucenia.
    expect(decision.issues.every((i) => i.severity === "blocking")).toBe(true);
  });

  it("kombinacja poprawna przechodzi i przenosi ostrzeżenia dalej", () => {
    const decision = decideAuthSettingsSave(settings({ allow_public_signup: false }), {
      isSuperAdmin: true,
    });
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) throw new Error("test: decyzja miała być zgodą");
    expect(decision.warnings.map((i) => i.id)).toEqual(["publicSignupClosed"]);
  });

  it("ustawienia domyślne przechodzą bez ostrzeżeń", () => {
    const decision = decideAuthSettingsSave(settings(), { isSuperAdmin: true });
    expect(decision).toEqual({ allowed: true, warnings: [] });
  });
});

describe("authSettingsSaveErrorKey - błąd bazy na klucz i18n", () => {
  it.each([
    ["42501", "adminLoginSettings.errNoPermission"],
    ["23505", "adminLoginSettings.errConflict"],
    ["23503", "adminLoginSettings.errGeneric"],
    ["PGRST301", "adminLoginSettings.errGeneric"],
  ])("kod %s daje klucz %s", (code, expected) => {
    expect(authSettingsSaveErrorKey(pgError("cokolwiek", code))).toBe(expected);
  });

  it("błąd bez kodu daje klucz ogólny", () => {
    expect(authSettingsSaveErrorKey(pgError("brak sieci"))).toBe("adminLoginSettings.errGeneric");
  });

  it.each([[null], [undefined], ["tekst"], [42], [{ code: 42501 }]])(
    "wartość %j niebędąca błędem PostgREST daje klucz ogólny",
    (error) => {
      expect(authSettingsSaveErrorKey(error)).toBe("adminLoginSettings.errGeneric");
    },
  );

  it("surowy komunikat Postgresa NIE wycieka do wyniku", () => {
    // To jest właściwa treść tego testu: komunikat „new row violates row-level
    // security policy for table \"site_settings\"" wystawiałby nazwy tabel
    // i polityk osobie, która właśnie nie miała do nich prawa.
    const raw = 'new row violates row-level security policy for table "site_settings"';
    const key = authSettingsSaveErrorKey(pgError(raw, "42501"));
    expect(key).not.toContain("site_settings");
    expect(key).not.toContain("row-level");
  });
});
