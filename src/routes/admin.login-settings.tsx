import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useAuthSettings, useSaveAuthSettings } from "@/hooks/useAuthSettings";
import { AUTH_DEFAULTS, type AuthSettings } from "@/lib/authSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MediaPickerDialog } from "@/components/admin/media/MediaPickerDialog";
import { Image as ImageIcon, Upload, X, Sun, Moon } from "@/lib/lucide-shim";
import { toast } from "sonner";
import defaultLoginLight from "@/assets/login-illustration-light.jpg";
import defaultLoginDark from "@/assets/login-illustration-dark.jpg";
import { adminToast } from "@/lib/adminToasts";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-login-settings";

export const Route = createFileRoute("/admin/login-settings")({
  component: LoginSettingsPage,
});

function LoginSettingsPage() {
  const { t } = useTranslation();
  const remote = useAuthSettings();
  const save = useSaveAuthSettings();
  const [s, setS] = useState<AuthSettings>(remote);

  useEffect(() => {
    setS(remote);
  }, [remote]);

  const update = <K extends keyof AuthSettings>(k: K, v: AuthSettings[K]) =>
    setS((prev) => ({ ...prev, [k]: v }));

  const submit = async () => {
    try {
      await save.mutateAsync(s);
      toast.success(adminToast.saved());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("adminLoginSettings.errGeneric"));
    }
  };

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

      <Tabs defaultValue="page" className="w-full">
        <TabsList>
          <TabsTrigger value="page">{t("adminLoginSettings.tabPage")}</TabsTrigger>
          <TabsTrigger value="popup">Popup Sign-In</TabsTrigger>
          <TabsTrigger value="signup">{t("adminLoginSettings.tabSignup")}</TabsTrigger>
        </TabsList>

        <TabsContent value="popup" className="space-y-4 mt-4">
          <Card
            title={t("adminLoginSettings.popupEnableTitle")}
            description={t("adminLoginSettings.popupEnableDesc")}
          >
            <Switch checked={s.popup_enabled} onCheckedChange={(v) => update("popup_enabled", v)} />
          </Card>
          <BiField
            label={t("adminLoginSettings.heading")}
            valPl={s.popup_heading_pl}
            valEn={s.popup_heading_en}
            onPl={(v) => update("popup_heading_pl", v)}
            onEn={(v) => update("popup_heading_en", v)}
          />
          <BiField
            label={t("adminLoginSettings.description")}
            textarea
            valPl={s.popup_description_pl}
            valEn={s.popup_description_en}
            onPl={(v) => update("popup_description_pl", v)}
            onEn={(v) => update("popup_description_en", v)}
          />
          <div className="grid md:grid-cols-2 gap-4">
            <ImageField
              label={t("adminLoginSettings.formLogoLight")}
              icon="light"
              previewBg="light"
              value={s.form_logo_url}
              onChange={(v) => update("form_logo_url", v)}
              hint={t("adminLoginSettings.formLogoLightHint")}
              aspect="240 / 80"
            />
            <ImageField
              label={t("adminLoginSettings.formLogoDark")}
              icon="dark"
              previewBg="dark"
              value={s.form_logo_url_dark}
              onChange={(v) => update("form_logo_url_dark", v)}
              hint={t("adminLoginSettings.formLogoDarkHint")}
              aspect="240 / 80"
            />
          </div>
        </TabsContent>

        <TabsContent value="page" className="space-y-6 mt-4">
          <BiField
            label={t("adminLoginSettings.heroTitle")}
            valPl={s.hero_title_pl}
            valEn={s.hero_title_en}
            onPl={(v) => update("hero_title_pl", v)}
            onEn={(v) => update("hero_title_en", v)}
          />
          <BiField
            label={t("adminLoginSettings.heroSubtitle")}
            textarea
            valPl={s.hero_subtitle_pl}
            valEn={s.hero_subtitle_en}
            onPl={(v) => update("hero_subtitle_pl", v)}
            onEn={(v) => update("hero_subtitle_en", v)}
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
              <ImageField
                label={t("adminLoginSettings.themeLight")}
                icon="light"
                value={s.hero_image_url_light}
                onChange={(v) => update("hero_image_url_light", v)}
                aspect="4 / 3"
                previewBg="light"
                fallbackUrl={defaultLoginLight}
                hint={t("adminLoginSettings.hintLoginLight")}
              />
              <ImageField
                label={t("adminLoginSettings.themeDark")}
                icon="dark"
                value={s.hero_image_url_dark}
                onChange={(v) => update("hero_image_url_dark", v)}
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
              <ImageField
                label={t("adminLoginSettings.themeLight")}
                icon="light"
                value={s.reset_image_url_light}
                onChange={(v) => update("reset_image_url_light", v)}
                aspect="4 / 3"
                previewBg="light"
                hint={t("adminLoginSettings.hintOptFallback")}
              />
              <ImageField
                label={t("adminLoginSettings.themeDark")}
                icon="dark"
                value={s.reset_image_url_dark}
                onChange={(v) => update("reset_image_url_dark", v)}
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
            <ImageField
              label={t("adminLoginSettings.loginBgLabel")}
              value={s.login_bg_url}
              onChange={(v) => update("login_bg_url", v)}
              aspect="16 / 9"
              hint={t("adminLoginSettings.loginBgHint")}
            />
            <div>
              <Label>{t("adminLoginSettings.bgColorLabel")}</Label>
              <Input
                value={s.login_bg_color}
                onChange={(e) => update("login_bg_color", e.target.value)}
                placeholder="#0a0a0a"
              />
            </div>
          </section>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t("adminLoginSettings.privacyLink")}</Label>
              <Input
                value={s.privacy_url}
                onChange={(e) => update("privacy_url", e.target.value)}
                placeholder="/polityka-prywatnosci"
              />
            </div>
            <div>
              <Label>{t("adminLoginSettings.termsLink")}</Label>
              <Input
                value={s.terms_url}
                onChange={(e) => update("terms_url", e.target.value)}
                placeholder="/regulamin"
              />
            </div>
          </div>
          <Card
            title={t("adminLoginSettings.langSwitchTitle")}
            description={t("adminLoginSettings.langSwitchDesc")}
          >
            <Switch
              checked={s.show_language_switcher}
              onCheckedChange={(v) => update("show_language_switcher", v)}
            />
          </Card>
          <div>
            <Label>{t("adminLoginSettings.formPosition")}</Label>
            <select
              className="w-full mt-1 border rounded p-2 bg-background"
              value={s.login_position}
              onChange={(e) =>
                update("login_position", e.target.value as AuthSettings["login_position"])
              }
            >
              <option value="left">{t("adminLoginSettings.posLeft")}</option>
              <option value="center">{t("adminLoginSettings.posCenter")}</option>
              <option value="right">{t("adminLoginSettings.posRight")}</option>
            </select>
            <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
              {t("adminLoginSettings.formPositionHint")}
            </p>
          </div>
          <Card title={t("adminLoginSettings.backHomeTitle")} description="">
            <Switch
              checked={s.show_back_to_home}
              onCheckedChange={(v) => update("show_back_to_home", v)}
            />
          </Card>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t("adminLoginSettings.customLoginUrl")}</Label>
              <Input
                value={s.custom_login_url}
                onChange={(e) => update("custom_login_url", e.target.value)}
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
                onChange={(e) => update("logout_redirect_url", e.target.value)}
                placeholder="/"
              />
              <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                {t("adminLoginSettings.logoutRedirectHint")}
              </p>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="signup" className="space-y-4 mt-4">
          <Card
            title={t("adminLoginSettings.publicSignupTitle")}
            description={t("adminLoginSettings.publicSignupDesc")}
          >
            <Switch
              checked={s.allow_public_signup}
              onCheckedChange={(v) => update("allow_public_signup", v)}
            />
          </Card>
          <BiField
            label={t("adminLoginSettings.signinLabel")}
            valPl={s.signin_label_pl}
            valEn={s.signin_label_en}
            onPl={(v) => update("signin_label_pl", v)}
            onEn={(v) => update("signin_label_en", v)}
          />
          <BiField
            label={t("adminLoginSettings.signupLabel")}
            valPl={s.signup_label_pl}
            valEn={s.signup_label_en}
            onPl={(v) => update("signup_label_pl", v)}
            onEn={(v) => update("signup_label_en", v)}
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
              <ImageField
                label={t("adminLoginSettings.themeLight")}
                icon="light"
                value={s.signup_image_url_light}
                onChange={(v) => update("signup_image_url_light", v)}
                aspect="4 / 3"
                previewBg="light"
                hint={t("adminLoginSettings.hintOptFallback")}
              />
              <ImageField
                label={t("adminLoginSettings.themeDark")}
                icon="dark"
                value={s.signup_image_url_dark}
                onChange={(v) => update("signup_image_url_dark", v)}
                aspect="4 / 3"
                previewBg="dark"
                hint={t("adminLoginSettings.hintOptFallback")}
              />
            </div>
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ImageField({
  label,
  value,
  onChange,
  hint,
  aspect = "16 / 9",
  previewBg,
  icon,
  fallbackUrl,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  aspect?: string;
  previewBg?: "light" | "dark";
  icon?: "light" | "dark";
  fallbackUrl?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const bgClass =
    previewBg === "dark"
      ? "bg-neutral-900 border-neutral-800"
      : previewBg === "light"
        ? "bg-neutral-50 border-neutral-200"
        : "bg-muted border-border";
  const IconEl = icon === "dark" ? Moon : icon === "light" ? Sun : null;
  const displayUrl = value || fallbackUrl || "";
  const isFallback = !value && Boolean(fallbackUrl);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-1.5">
          {IconEl ? <IconEl className="w-3.5 h-3.5" aria-hidden /> : null}
          {label}
        </Label>
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="text-xs text-muted-foreground hover:text-destructive inline-flex items-center gap-1"
          >
            <X className="w-3 h-3" /> {t("adminLoginSettings.clear")}
          </button>
        )}
      </div>
      <div
        className={`relative w-full rounded-lg border overflow-hidden ${bgClass} flex items-center justify-center`}
        style={{ aspectRatio: aspect }}
      >
        {displayUrl ? (
          <>
            <img
              src={displayUrl}
              alt={label}
              className="absolute inset-0 w-full h-full object-cover"
            />
            {isFallback && (
              <span className="absolute top-2 left-2 z-10 rounded-full bg-black/70 text-white text-[10px] px-2 py-0.5 uppercase tracking-wider backdrop-blur">
                {t("adminLoginSettings.defaultBadge")}
              </span>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground text-xs">
            <ImageIcon className="w-6 h-6 opacity-60" />
            <span>{t("adminLoginSettings.noImage")}</span>
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t("adminLoginSettings.imgUrlPlaceholder")}
          className="flex-1"
        />
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Upload className="w-3.5 h-3.5 mr-1.5" /> {t("adminLoginSettings.pick")}
        </Button>
      </div>
      {hint && <p className="text-[11px] text-muted-foreground leading-snug">{hint}</p>}
      <MediaPickerDialog
        open={open}
        onOpenChange={setOpen}
        onPick={(url) => {
          onChange(url);
          setOpen(false);
        }}
        accept="image"
        title={t("adminLoginSettings.pickImage", { label })}
      />
    </div>
  );
}

function Card({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border border-border rounded-lg p-4">
      <div>
        <div className="font-medium">{title}</div>
        {description && <div className="text-xs text-muted-foreground mt-0.5">{description}</div>}
      </div>
      {children}
    </div>
  );
}

function BiField({
  label,
  valPl,
  valEn,
  onPl,
  onEn,
  textarea,
}: {
  label: string;
  valPl: string;
  valEn: string;
  onPl: (v: string) => void;
  onEn: (v: string) => void;
  textarea?: boolean;
}) {
  const C = textarea ? Textarea : Input;
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <Label>{label} (PL)</Label>
        <C
          value={valPl}
          onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
            onPl(e.target.value)
          }
        />
      </div>
      <div>
        <Label>{label} (EN)</Label>
        <C
          value={valEn}
          onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
            onEn(e.target.value)
          }
        />
      </div>
    </div>
  );
}
