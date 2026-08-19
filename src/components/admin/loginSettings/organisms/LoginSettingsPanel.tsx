import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BilingualRow } from "@/components/admin/atoms/BilingualRow";
import { SettingToggle } from "@/components/admin/atoms/SettingToggle";
import { RegistrationFieldsSection } from "@/components/admin/auth/RegistrationFieldsSection";
import { ImageField } from "@/components/admin/loginSettings/atoms/ImageField";
import { IllustrationSection } from "@/components/admin/loginSettings/molecules/IllustrationSection";
import { useAuthSettings, useSaveAuthSettings } from "@/hooks/useAuthSettings";
import { AUTH_DEFAULTS, authSettingsEqual, type AuthSettings } from "@/lib/authSettings";
import { adminToast } from "@/lib/adminToasts";
import { ensureI18n as ensureAdminLoginSettingsI18n } from "@/lib/i18n-admin-login-settings";
import { ensureI18n as ensureAdminPopupSignupI18n } from "@/lib/i18n-admin-popup-signup";
import defaultLoginLight from "@/assets/login-illustration-light.jpg";
import defaultLoginDark from "@/assets/login-illustration-dark.jpg";

export function LoginSettingsPanel() {
  ensureAdminPopupSignupI18n();
  ensureAdminLoginSettingsI18n();
  const { t } = useTranslation();
  const remote = useAuthSettings();
  const save = useSaveAuthSettings();
  const [settings, setSettings] = useState<AuthSettings>(remote);
  const [baseline, setBaseline] = useState<AuthSettings>(remote);
  const baselineRef = useRef<AuthSettings>(remote);
  const preserveDraftAfterError = useRef(false);

  useEffect(() => {
    if (save.isPending) return;
    if (preserveDraftAfterError.current) {
      preserveDraftAfterError.current = false;
      baselineRef.current = remote;
      setBaseline(remote);
      return;
    }
    setSettings((current) => (authSettingsEqual(current, baselineRef.current) ? remote : current));
    baselineRef.current = remote;
    setBaseline(remote);
  }, [remote, save.isPending]);

  const update = <K extends keyof AuthSettings>(key: K, value: AuthSettings[K]) =>
    setSettings((current) => ({ ...current, [key]: value }));
  const dirty = !authSettingsEqual(settings, baseline);

  const submit = async () => {
    const draft = settings;
    try {
      await save.mutateAsync(draft);
      baselineRef.current = draft;
      setBaseline(draft);
      toast.success(adminToast.saved());
    } catch (error) {
      preserveDraftAfterError.current = true;
      setSettings(draft);
      toast.error(error instanceof Error ? error.message : t("adminLoginSettings.errGeneric"));
    }
  };

  return (
    <div className="w-full space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">{t("adminLoginSettings.pageTitle")}</h1>
          {dirty ? (
            <p role="status" className="text-xs text-amber-600">
              {t("adminLoginSettings.unsavedChanges")}
            </p>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setSettings({ ...AUTH_DEFAULTS })}>
            {t("adminLoginSettings.reset")}
          </Button>
          <Button onClick={submit} disabled={save.isPending || !dirty}>
            {save.isPending ? t("adminLoginSettings.saving") : t("adminLoginSettings.saveChanges")}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="page" className="w-full">
        <TabsList>
          <TabsTrigger value="page">{t("adminLoginSettings.tabPage")}</TabsTrigger>
          <TabsTrigger value="popup">{t("adminLoginSettings.tabPopup")}</TabsTrigger>
          <TabsTrigger value="signup">{t("adminLoginSettings.tabSignup")}</TabsTrigger>
        </TabsList>

        <TabsContent value="popup" className="mt-4 space-y-4">
          <SettingToggle
            label={t("adminLoginSettings.popupEnableTitle")}
            hint={t("adminLoginSettings.popupEnableDesc")}
            checked={settings.popup_enabled}
            onCheckedChange={(value) => update("popup_enabled", value)}
          />
          <BilingualRow
            label={t("adminLoginSettings.heading")}
            pl={settings.popup_heading_pl}
            en={settings.popup_heading_en}
            onPl={(value) => update("popup_heading_pl", value)}
            onEn={(value) => update("popup_heading_en", value)}
          />
          <BilingualRow
            label={t("adminLoginSettings.description")}
            multiline
            pl={settings.popup_description_pl}
            en={settings.popup_description_en}
            onPl={(value) => update("popup_description_pl", value)}
            onEn={(value) => update("popup_description_en", value)}
          />
          <div className="grid gap-4 md:grid-cols-2">
            <ImageField
              label={t("adminLoginSettings.formLogoLight")}
              icon="light"
              previewBg="light"
              value={settings.form_logo_url}
              onChange={(value) => update("form_logo_url", value)}
              hint={t("adminLoginSettings.formLogoLightHint")}
              aspect="240 / 80"
            />
            <ImageField
              label={t("adminLoginSettings.formLogoDark")}
              icon="dark"
              previewBg="dark"
              value={settings.form_logo_url_dark}
              onChange={(value) => update("form_logo_url_dark", value)}
              hint={t("adminLoginSettings.formLogoDarkHint")}
              aspect="240 / 80"
            />
          </div>
        </TabsContent>

        <TabsContent value="page" className="mt-4 space-y-6">
          <BilingualRow
            label={t("adminLoginSettings.heroTitle")}
            pl={settings.hero_title_pl}
            en={settings.hero_title_en}
            onPl={(value) => update("hero_title_pl", value)}
            onEn={(value) => update("hero_title_en", value)}
          />
          <BilingualRow
            label={t("adminLoginSettings.heroSubtitle")}
            multiline
            pl={settings.hero_subtitle_pl}
            en={settings.hero_subtitle_en}
            onPl={(value) => update("hero_subtitle_pl", value)}
            onEn={(value) => update("hero_subtitle_en", value)}
          />

          <IllustrationSection
            title={t("adminLoginSettings.heroLoginTitle")}
            description={
              <>
                {t("adminLoginSettings.heroLoginDesc1")} <br />
                {t("adminLoginSettings.recDims")}
                <strong>1600 × 1200 px</strong>
                {t("adminLoginSettings.heroLoginDesc2")}
              </>
            }
          >
            <div className="grid gap-4 md:grid-cols-2">
              <ImageField
                label={t("adminLoginSettings.themeLight")}
                icon="light"
                value={settings.hero_image_url_light}
                onChange={(value) => update("hero_image_url_light", value)}
                aspect="4 / 3"
                previewBg="light"
                fallbackUrl={defaultLoginLight}
                hint={t("adminLoginSettings.hintLoginLight")}
              />
              <ImageField
                label={t("adminLoginSettings.themeDark")}
                icon="dark"
                value={settings.hero_image_url_dark}
                onChange={(value) => update("hero_image_url_dark", value)}
                aspect="4 / 3"
                previewBg="dark"
                fallbackUrl={defaultLoginDark}
                hint={t("adminLoginSettings.hintLoginDark")}
              />
            </div>
          </IllustrationSection>

          <IllustrationSection
            title={t("adminLoginSettings.heroResetTitle")}
            description={
              <>
                {t("adminLoginSettings.heroResetDesc1")} <br />
                {t("adminLoginSettings.recDims")}
                <strong>1600 × 1200 px</strong>
                {t("adminLoginSettings.heroResetDesc2")}
              </>
            }
          >
            <div className="grid gap-4 md:grid-cols-2">
              <ImageField
                label={t("adminLoginSettings.themeLight")}
                icon="light"
                value={settings.reset_image_url_light}
                onChange={(value) => update("reset_image_url_light", value)}
                aspect="4 / 3"
                previewBg="light"
                hint={t("adminLoginSettings.hintOptFallback")}
              />
              <ImageField
                label={t("adminLoginSettings.themeDark")}
                icon="dark"
                value={settings.reset_image_url_dark}
                onChange={(value) => update("reset_image_url_dark", value)}
                aspect="4 / 3"
                previewBg="dark"
                hint={t("adminLoginSettings.hintOptFallback")}
              />
            </div>
          </IllustrationSection>

          <IllustrationSection
            title={t("adminLoginSettings.fullscreenTitle")}
            description={
              <>
                {t("adminLoginSettings.fullscreenDesc1")}
                {t("adminLoginSettings.recDims")}
                <strong>1920 × 1080 px</strong>
                {t("adminLoginSettings.fullscreenDesc2")}
              </>
            }
          >
            <ImageField
              label={t("adminLoginSettings.loginBgLabel")}
              value={settings.login_bg_url}
              onChange={(value) => update("login_bg_url", value)}
              aspect="16 / 9"
              hint={t("adminLoginSettings.loginBgHint")}
            />
            <Label className="block">
              <span>{t("adminLoginSettings.bgColorLabel")}</span>
              <Input
                value={settings.login_bg_color}
                onChange={(event) => update("login_bg_color", event.target.value)}
                placeholder="#0a0a0a"
              />
            </Label>
          </IllustrationSection>

          <div className="grid grid-cols-2 gap-3">
            <Label className="block">
              <span>{t("adminLoginSettings.privacyLink")}</span>
              <Input
                value={settings.privacy_url}
                onChange={(event) => update("privacy_url", event.target.value)}
                placeholder="/polityka-prywatnosci"
              />
            </Label>
            <Label className="block">
              <span>{t("adminLoginSettings.termsLink")}</span>
              <Input
                value={settings.terms_url}
                onChange={(event) => update("terms_url", event.target.value)}
                placeholder="/regulamin"
              />
            </Label>
          </div>
          <SettingToggle
            label={t("adminLoginSettings.langSwitchTitle")}
            hint={t("adminLoginSettings.langSwitchDesc")}
            checked={settings.show_language_switcher}
            onCheckedChange={(value) => update("show_language_switcher", value)}
          />
          <Label className="block">
            <span>{t("adminLoginSettings.formPosition")}</span>
            <select
              className="mt-1 w-full rounded border bg-background p-2"
              value={settings.login_position}
              onChange={(event) =>
                update("login_position", event.target.value as AuthSettings["login_position"])
              }
            >
              <option value="left">{t("adminLoginSettings.posLeft")}</option>
              <option value="center">{t("adminLoginSettings.posCenter")}</option>
              <option value="right">{t("adminLoginSettings.posRight")}</option>
            </select>
            <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">
              {t("adminLoginSettings.formPositionHint")}
            </span>
          </Label>
          <SettingToggle
            label={t("adminLoginSettings.backHomeTitle")}
            checked={settings.show_back_to_home}
            onCheckedChange={(value) => update("show_back_to_home", value)}
          />
          <div className="grid grid-cols-2 gap-3">
            <Label className="block">
              <span>{t("adminLoginSettings.customLoginUrl")}</span>
              <Input
                value={settings.custom_login_url}
                onChange={(event) => update("custom_login_url", event.target.value)}
                placeholder="/membership/login"
              />
              <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">
                {t("adminLoginSettings.customLoginUrlHint")}
              </span>
            </Label>
            <Label className="block">
              <span>{t("adminLoginSettings.logoutRedirect")}</span>
              <Input
                value={settings.logout_redirect_url}
                onChange={(event) => update("logout_redirect_url", event.target.value)}
                placeholder="/"
              />
              <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">
                {t("adminLoginSettings.logoutRedirectHint")}
              </span>
            </Label>
          </div>
        </TabsContent>

        <TabsContent value="signup" className="mt-4 space-y-4">
          <SettingToggle
            label={t("adminLoginSettings.publicSignupTitle")}
            hint={t("adminLoginSettings.publicSignupDesc")}
            checked={settings.allow_public_signup}
            onCheckedChange={(value) => update("allow_public_signup", value)}
          />
          <BilingualRow
            label={t("adminLoginSettings.signinLabel")}
            pl={settings.signin_label_pl}
            en={settings.signin_label_en}
            onPl={(value) => update("signin_label_pl", value)}
            onEn={(value) => update("signin_label_en", value)}
          />
          <BilingualRow
            label={t("adminLoginSettings.signupLabel")}
            pl={settings.signup_label_pl}
            en={settings.signup_label_en}
            onPl={(value) => update("signup_label_pl", value)}
            onEn={(value) => update("signup_label_en", value)}
          />

          <IllustrationSection
            title={t("adminLoginSettings.heroSignupTitle")}
            description={
              <>
                {t("adminLoginSettings.heroSignupDesc1")} <br />
                {t("adminLoginSettings.recDims")}
                <strong>1600 × 1200 px</strong>
                {t("adminLoginSettings.heroSignupDesc2")}
              </>
            }
          >
            <div className="grid gap-4 md:grid-cols-2">
              <ImageField
                label={t("adminLoginSettings.themeLight")}
                icon="light"
                value={settings.signup_image_url_light}
                onChange={(value) => update("signup_image_url_light", value)}
                aspect="4 / 3"
                previewBg="light"
                hint={t("adminLoginSettings.hintOptFallback")}
              />
              <ImageField
                label={t("adminLoginSettings.themeDark")}
                icon="dark"
                value={settings.signup_image_url_dark}
                onChange={(value) => update("signup_image_url_dark", value)}
                aspect="4 / 3"
                previewBg="dark"
                hint={t("adminLoginSettings.hintOptFallback")}
              />
            </div>
            <p className="rounded-md border border-dashed border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              {t("adminPopupSignup.shared.imagesFallback")}
            </p>
          </IllustrationSection>

          <RegistrationFieldsSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
