// USTAWIENIA LOGOWANIA I REJESTRACJI (/admin/login-settings).
//
// Ten panel decyduje o tym, czy da się wejść na serwis - dlatego DECYZJE nie
// mieszkają już w ciele komponentu. Odczyt z domyślnymi, reguły spójności
// kombinacji, prawo do zapisu i mapowanie błędu bazy na komunikat są czystymi
// funkcjami w `lib/authSettingsRules.ts`; powłoka niżej wyłącznie je woła
// i pokazuje wynik. Pola (para PL/EN, obraz z podglądem, wiersz przełącznika)
// są w `components/admin/auth/{atoms,molecules,organisms}`.
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { useAuthSettingsQuery, useSaveAuthSettings } from "@/hooks/useAuthSettings";
import { AUTH_DEFAULTS, type AuthSettings } from "@/lib/authSettings";
import {
  authSettingsSaveErrorKey,
  decideAuthSettingsSave,
  authSettingsIssues,
  isLoginPosition,
} from "@/lib/authSettingsRules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import defaultLoginLight from "@/assets/login-illustration-light.jpg";
import defaultLoginDark from "@/assets/login-illustration-dark.jpg";
import { adminToast } from "@/lib/adminToasts";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { ensureI18n as ensureAdminLoginSettingsI18n } from "@/lib/i18n-admin-login-settings";
import { RegistrationFieldsSection } from "@/components/admin/auth/RegistrationFieldsSection";
import { SettingToggleCard } from "@/components/admin/auth/atoms/SettingToggleCard";
import { AuthSettingsIssueList } from "@/components/admin/auth/atoms/AuthSettingsIssueList";
import { BilingualTextField } from "@/components/admin/auth/molecules/BilingualTextField";
import { ImageUrlField } from "@/components/admin/auth/organisms/ImageUrlField";
import { ensureI18n as ensureAdminPopupSignupI18n } from "@/lib/i18n-admin-popup-signup";
/** Klucze `AuthSettings` o wartości tekstowej - jedyne, które wiąże `bindText`. */
type TextField = {
  [K in keyof AuthSettings]: AuthSettings[K] extends string ? K : never;
}[keyof AuthSettings];

export const Route = createFileRoute("/admin/login-settings")({
  component: LoginSettingsPage,
});

function LoginSettingsPage() {
  // Rejestracja słownika w chunku KOMPONENTU trasy (nie w entry) - patrz
  // komentarz przy ensureI18n w lib/i18n-admin-popup-signup.ts.
  ensureAdminPopupSignupI18n();
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureAdminLoginSettingsI18n();
  const { t } = useTranslation();
  // Ukrycie pozycji w nawigacji niczego nie chroni - adres wpisuje się z ręki,
  // więc trasa sama pilnuje roli super_admina.
  const { isSuperAdmin, loading } = useAuth();
  const { settings: remote, isPending, isError } = useAuthSettingsQuery();
  const save = useSaveAuthSettings();
  const [s, setS] = useState<AuthSettings>(remote);

  useEffect(() => {
    setS(remote);
  }, [remote]);

  const update = <K extends keyof AuthSettings>(k: K, v: AuthSettings[K]) =>
    setS((prev) => ({ ...prev, [k]: v }));

  // DWA WIĄZANIA ZAMIAST PIĘĆDZIESIĘCIU DOMKNIĘĆ. Panel ma trzydzieści kilka
  // pól i każde miało własne `(v) => update("klucz", v)` - trzydzieści kilka
  // kopii tego samego kształtu, w których literówka w nazwie klucza jest
  // niewidoczna w review (zapisuje inne pole, nic nie protestuje). Tutaj klucz
  // jest ARGUMENTEM sparametryzowanego typem wiązania, więc pomyłka jest błędem
  // kompilacji, a nie cichym zapisem do sąsiedniego pola.
  const bind =
    <K extends keyof AuthSettings>(k: K) =>
    (v: AuthSettings[K]) =>
      update(k, v);
  const bindText =
    (k: TextField) =>
    (event: React.ChangeEvent<HTMLInputElement>): void =>
      update(k, event.target.value);

  // Zastrzeżenia liczą się z BIEŻĄCEJ wersji roboczej, nie z zapisanej - blokada
  // ma się pokazać w chwili wpisania wartości, a nie po nieudanym zapisie.
  const issues = useMemo(() => authSettingsIssues(s), [s]);

  const submit = async () => {
    // Odmowa PRZED zapytaniem do bazy: bez uprawnienia albo z kombinacją, która
    // zamyka wejście na serwis. Wersja robocza zostaje BEZ ZMIAN - odrzucony
    // zapis nie może wyglądać jak wykonany.
    const decision = decideAuthSettingsSave(s, { isSuperAdmin });
    if (!decision.allowed) {
      toast.error(t(decision.reasonKey));
      return;
    }
    try {
      await save.mutateAsync(s);
      toast.success(adminToast.saved());
    } catch (e) {
      // Surowy komunikat Postgresa wystawiłby nazwy tabel i polityk osobie,
      // która właśnie nie miała do nich prawa - stąd klucz, nie `e.message`.
      toast.error(t(authSettingsSaveErrorKey(e)));
    }
  };

  if (loading) return null;
  if (!isSuperAdmin) return <Navigate to="/admin" />;
  // AWARIA ODCZYTU NIE MOŻE WYGLĄDAĆ JAK „nic nie ustawiono". Panel pokazujący
  // wtedy domyślne zaprasza administratora do zapisania ich na wierzch wartości,
  // których po prostu nie zdołał odczytać - i to jest zapis nieodwracalny.
  if (isError) {
    return (
      <div className="w-full space-y-4">
        <h1 className="font-display text-2xl font-bold">{t("adminLoginSettings.pageTitle")}</h1>
        <p
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive"
        >
          {t("adminLoginSettings.loadFailed")}
        </p>
      </div>
    );
  }
  if (isPending) return null;

  return (
    <div className="w-full space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold">{t("adminLoginSettings.pageTitle")}</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setS(AUTH_DEFAULTS)}>
            {t("adminLoginSettings.reset")}
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            {save.isPending ? t("adminLoginSettings.saving") : t("adminLoginSettings.saveChanges")}
          </Button>
        </div>
      </div>

      <AuthSettingsIssueList issues={issues} />

      <Tabs defaultValue="page" className="w-full">
        <TabsList>
          <TabsTrigger value="page">{t("adminLoginSettings.tabPage")}</TabsTrigger>
          <TabsTrigger value="popup">Popup Sign-In</TabsTrigger>
          <TabsTrigger value="signup">{t("adminLoginSettings.tabSignup")}</TabsTrigger>
        </TabsList>

        <TabsContent value="popup" className="space-y-4 mt-4">
          <SettingToggleCard
            title={t("adminLoginSettings.popupEnableTitle")}
            description={t("adminLoginSettings.popupEnableDesc")}
          >
            <Switch checked={s.popup_enabled} onCheckedChange={bind("popup_enabled")} />
          </SettingToggleCard>
          <BilingualTextField
            label={t("adminLoginSettings.heading")}
            valuePl={s.popup_heading_pl}
            valueEn={s.popup_heading_en}
            onChangePl={bind("popup_heading_pl")}
            onChangeEn={bind("popup_heading_en")}
          />
          <BilingualTextField
            label={t("adminLoginSettings.description")}
            multiline
            valuePl={s.popup_description_pl}
            valueEn={s.popup_description_en}
            onChangePl={bind("popup_description_pl")}
            onChangeEn={bind("popup_description_en")}
          />
          <div className="grid md:grid-cols-2 gap-4">
            <ImageUrlField
              label={t("adminLoginSettings.formLogoLight")}
              icon="light"
              previewBg="light"
              value={s.form_logo_url}
              onChange={bind("form_logo_url")}
              hint={t("adminLoginSettings.formLogoLightHint")}
              aspect="240 / 80"
            />
            <ImageUrlField
              label={t("adminLoginSettings.formLogoDark")}
              icon="dark"
              previewBg="dark"
              value={s.form_logo_url_dark}
              onChange={bind("form_logo_url_dark")}
              hint={t("adminLoginSettings.formLogoDarkHint")}
              aspect="240 / 80"
            />
          </div>
        </TabsContent>

        <TabsContent value="page" className="space-y-6 mt-4">
          <BilingualTextField
            label={t("adminLoginSettings.heroTitle")}
            valuePl={s.hero_title_pl}
            valueEn={s.hero_title_en}
            onChangePl={bind("hero_title_pl")}
            onChangeEn={bind("hero_title_en")}
          />
          <BilingualTextField
            label={t("adminLoginSettings.heroSubtitle")}
            multiline
            valuePl={s.hero_subtitle_pl}
            valueEn={s.hero_subtitle_en}
            onChangePl={bind("hero_subtitle_pl")}
            onChangeEn={bind("hero_subtitle_en")}
          />

          <section className="rounded-lg border border-border bg-card/50 p-5 space-y-4">
            <header className="space-y-1">
              <h2 className="font-semibold text-base">{t("adminLoginSettings.heroLoginTitle")}</h2>
              <p className="text-xs text-muted-foreground">
                {t("adminLoginSettings.heroLoginDesc1")} <br />
                {t("adminLoginSettings.recDims")}
                <strong>1600 × 1200 px</strong>
                {t("adminLoginSettings.heroLoginDesc2")}
              </p>
            </header>
            <div className="grid md:grid-cols-2 gap-4">
              <ImageUrlField
                label={t("adminLoginSettings.themeLight")}
                icon="light"
                value={s.hero_image_url_light}
                onChange={bind("hero_image_url_light")}
                aspect="4 / 3"
                previewBg="light"
                fallbackUrl={defaultLoginLight}
                hint={t("adminLoginSettings.hintLoginLight")}
              />
              <ImageUrlField
                label={t("adminLoginSettings.themeDark")}
                icon="dark"
                value={s.hero_image_url_dark}
                onChange={bind("hero_image_url_dark")}
                aspect="4 / 3"
                previewBg="dark"
                fallbackUrl={defaultLoginDark}
                hint={t("adminLoginSettings.hintLoginDark")}
              />
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card/50 p-5 space-y-4">
            <header className="space-y-1">
              <h2 className="font-semibold text-base">{t("adminLoginSettings.heroResetTitle")}</h2>
              <p className="text-xs text-muted-foreground">
                {t("adminLoginSettings.heroResetDesc1")} <br />
                {t("adminLoginSettings.recDims")}
                <strong>1600 × 1200 px</strong>
                {t("adminLoginSettings.heroResetDesc2")}
              </p>
            </header>
            <div className="grid md:grid-cols-2 gap-4">
              <ImageUrlField
                label={t("adminLoginSettings.themeLight")}
                icon="light"
                value={s.reset_image_url_light}
                onChange={bind("reset_image_url_light")}
                aspect="4 / 3"
                previewBg="light"
                hint={t("adminLoginSettings.hintOptFallback")}
              />
              <ImageUrlField
                label={t("adminLoginSettings.themeDark")}
                icon="dark"
                value={s.reset_image_url_dark}
                onChange={bind("reset_image_url_dark")}
                aspect="4 / 3"
                previewBg="dark"
                hint={t("adminLoginSettings.hintOptFallback")}
              />
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card/50 p-5 space-y-4">
            <header className="space-y-1">
              <h2 className="font-semibold text-base">{t("adminLoginSettings.fullscreenTitle")}</h2>
              <p className="text-xs text-muted-foreground">
                {t("adminLoginSettings.fullscreenDesc1")}
                {t("adminLoginSettings.recDims")}
                <strong>1920 × 1080 px</strong>
                {t("adminLoginSettings.fullscreenDesc2")}
              </p>
            </header>
            <ImageUrlField
              label={t("adminLoginSettings.loginBgLabel")}
              value={s.login_bg_url}
              onChange={bind("login_bg_url")}
              aspect="16 / 9"
              hint={t("adminLoginSettings.loginBgHint")}
            />
            <div>
              <Label>{t("adminLoginSettings.bgColorLabel")}</Label>
              <Input
                value={s.login_bg_color}
                onChange={bindText("login_bg_color")}
                placeholder="#0a0a0a"
              />
            </div>
          </section>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t("adminLoginSettings.privacyLink")}</Label>
              <Input
                value={s.privacy_url}
                onChange={bindText("privacy_url")}
                placeholder="/polityka-prywatnosci"
              />
            </div>
            <div>
              <Label>{t("adminLoginSettings.termsLink")}</Label>
              <Input
                value={s.terms_url}
                onChange={bindText("terms_url")}
                placeholder="/regulamin"
              />
            </div>
          </div>
          <SettingToggleCard
            title={t("adminLoginSettings.langSwitchTitle")}
            description={t("adminLoginSettings.langSwitchDesc")}
          >
            <Switch
              checked={s.show_language_switcher}
              onCheckedChange={bind("show_language_switcher")}
            />
          </SettingToggleCard>
          <div>
            <Label>{t("adminLoginSettings.formPosition")}</Label>
            <select
              className="w-full mt-1 border rounded p-2 bg-background"
              value={s.login_position}
              // Straznik zamiast rzutowania: `e.target.value` jest `string`,
              // a `as` przepuscilby wartosc spoza enuma prosto do zapisu.
              onChange={(event) => {
                if (isLoginPosition(event.target.value))
                  update("login_position", event.target.value);
              }}
            >
              <option value="left">{t("adminLoginSettings.posLeft")}</option>
              <option value="center">{t("adminLoginSettings.posCenter")}</option>
              <option value="right">{t("adminLoginSettings.posRight")}</option>
            </select>
            <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
              {t("adminLoginSettings.formPositionHint")}
            </p>
          </div>
          <SettingToggleCard title={t("adminLoginSettings.backHomeTitle")} description="">
            <Switch checked={s.show_back_to_home} onCheckedChange={bind("show_back_to_home")} />
          </SettingToggleCard>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t("adminLoginSettings.customLoginUrl")}</Label>
              <Input
                value={s.custom_login_url}
                onChange={bindText("custom_login_url")}
                placeholder="/membership/login"
              />
              <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                {t("adminLoginSettings.customLoginUrlHint")}
              </p>
            </div>
            <div>
              <Label>{t("adminLoginSettings.logoutRedirect")}</Label>
              <Input
                value={s.logout_redirect_url}
                onChange={bindText("logout_redirect_url")}
                placeholder="/"
              />
              <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                {t("adminLoginSettings.logoutRedirectHint")}
              </p>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="signup" className="space-y-4 mt-4">
          <SettingToggleCard
            title={t("adminLoginSettings.publicSignupTitle")}
            description={t("adminLoginSettings.publicSignupDesc")}
          >
            <Switch checked={s.allow_public_signup} onCheckedChange={bind("allow_public_signup")} />
          </SettingToggleCard>
          <BilingualTextField
            label={t("adminLoginSettings.signinLabel")}
            valuePl={s.signin_label_pl}
            valueEn={s.signin_label_en}
            onChangePl={bind("signin_label_pl")}
            onChangeEn={bind("signin_label_en")}
          />
          <BilingualTextField
            label={t("adminLoginSettings.signupLabel")}
            valuePl={s.signup_label_pl}
            valueEn={s.signup_label_en}
            onChangePl={bind("signup_label_pl")}
            onChangeEn={bind("signup_label_en")}
          />

          <section className="rounded-lg border border-border bg-card/50 p-5 space-y-4">
            <header className="space-y-1">
              <h2 className="font-semibold text-base">{t("adminLoginSettings.heroSignupTitle")}</h2>
              <p className="text-xs text-muted-foreground">
                {t("adminLoginSettings.heroSignupDesc1")} <br />
                {t("adminLoginSettings.recDims")}
                <strong>1600 × 1200 px</strong>
                {t("adminLoginSettings.heroSignupDesc2")}
              </p>
            </header>
            <div className="grid md:grid-cols-2 gap-4">
              <ImageUrlField
                label={t("adminLoginSettings.themeLight")}
                icon="light"
                value={s.signup_image_url_light}
                onChange={bind("signup_image_url_light")}
                aspect="4 / 3"
                previewBg="light"
                hint={t("adminLoginSettings.hintOptFallback")}
              />
              <ImageUrlField
                label={t("adminLoginSettings.themeDark")}
                icon="dark"
                value={s.signup_image_url_dark}
                onChange={bind("signup_image_url_dark")}
                aspect="4 / 3"
                previewBg="dark"
                hint={t("adminLoginSettings.hintOptFallback")}
              />
            </div>
            <p className="rounded-md border border-dashed border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              {t("adminPopupSignup.shared.imagesFallback")}
            </p>
          </section>

          <RegistrationFieldsSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
