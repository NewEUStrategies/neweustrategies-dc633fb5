import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSettings, useDraft } from "@/lib/admin/useSettings";
import { Field, Text, Select, SaveBar } from "@/components/admin/settings/fields";
import { LinkedSourceHeader, LinkedImagePreview } from "@/components/admin/settings/LinkedSource";
import { setIconPack, type IconPack } from "@/lib/iconPack";

type ThemeLogo = {
  main?: string;
  main_dark?: string;
  bookmark_ios?: string;
  organization?: string;
};
type ThemeOptionsShape = { logo?: ThemeLogo };
const THEME_OPTIONS_DEFAULTS: ThemeOptionsShape = { logo: {} };

type General = {
  site_name: string;
  tagline: string;
  site_url: string;
  site_icon_url: string;
  site_logo_url: string;
  default_language: "pl" | "en";
  timezone: string;
  date_format: string;
  time_format: string;
  week_starts_on: number;
  icon_pack: IconPack;
};

type ContactPrivate = {
  admin_email: string;
};

const DEFAULTS: General = {
  site_name: "",
  tagline: "",
  site_url: "",
  site_icon_url: "",
  site_logo_url: "",
  default_language: "pl",
  timezone: "Europe/Warsaw",
  date_format: "d.m.Y",
  time_format: "H:i",
  week_starts_on: 1,
  icon_pack: "lucide",
};

const CONTACT_DEFAULTS: ContactPrivate = { admin_email: "" };

export const Route = createFileRoute("/admin/settings/general")({
  component: GeneralSettings,
});

function GeneralSettings() {
  const { t } = useTranslation();
  const { query, save } = useSettings<General>("general", DEFAULTS);
  const contact = useSettings<ContactPrivate>("contact_private", CONTACT_DEFAULTS);
  const themeOptions = useSettings<ThemeOptionsShape>("theme_options", THEME_OPTIONS_DEFAULTS);
  const themeLogo = themeOptions.query.data?.logo ?? {};
  const [draft, setDraft] = useDraft(query.data);
  const [contactDraft, setContactDraft] = useDraft(contact.query.data);

  useEffect(() => {
    if (draft?.icon_pack) setIconPack(draft.icon_pack);
  }, [draft?.icon_pack]);

  if (!draft) return <p className="text-sm text-muted-foreground">{t("admin.loading")}</p>;

  const set = <K extends keyof General>(k: K, v: General[K]) => setDraft({ ...draft, [k]: v });
  const setContact = <K extends keyof ContactPrivate>(k: K, v: ContactPrivate[K]) =>
    setContactDraft({ ...(contactDraft ?? CONTACT_DEFAULTS), [k]: v });

  return (
    <div>
      <h2 className="font-display text-xl mb-4">{t("admin.general.title")}</h2>

      <Field label={t("admin.general.siteName")}>
        <Text value={draft.site_name} onChange={(e) => set("site_name", e.target.value)} />
      </Field>
      <Field label={t("admin.general.tagline")} hint={t("admin.general.taglineHint")}>
        <Text value={draft.tagline} onChange={(e) => set("tagline", e.target.value)} />
      </Field>
      <Field label={t("admin.general.siteIcon")} hint={t("admin.general.siteIconHint")}>
        <LinkedSourceHeader
          sourceLabel={t("admin.linkedSource.themeOptionsBookmark", {
            defaultValue: "Opcje motywu - Zakładka (bookmark)",
          })}
          sourceHref="/admin/theme-options#logo"
          sourceValue={themeLogo.bookmark_ios}
          preview={<LinkedImagePreview src={themeLogo.bookmark_ios} />}
          hint={t("admin.linkedSource.overrideHint", {
            defaultValue:
              "Puste pole = użyj wartości ze źródła. Wpisz URL, aby nadpisać dla tej witryny.",
          })}
        />
        <Text
          value={draft.site_icon_url}
          onChange={(e) => set("site_icon_url", e.target.value)}
          placeholder={themeLogo.bookmark_ios || "https://…"}
        />
      </Field>
      <Field label={t("admin.general.siteLogo")}>
        <LinkedSourceHeader
          sourceLabel={t("admin.linkedSource.themeOptionsLogo", {
            defaultValue: "Opcje motywu - Logo główne",
          })}
          sourceHref="/admin/theme-options#logo"
          sourceValue={themeLogo.main}
          preview={<LinkedImagePreview src={themeLogo.main} />}
          hint={t("admin.linkedSource.overrideHint", {
            defaultValue:
              "Puste pole = użyj wartości ze źródła. Wpisz URL, aby nadpisać dla tej witryny.",
          })}
        />
        <Text
          value={draft.site_logo_url}
          onChange={(e) => set("site_logo_url", e.target.value)}
          placeholder={themeLogo.main || "https://…"}
        />
      </Field>
      <Field label={t("admin.general.siteUrl")}>
        <Text
          value={draft.site_url}
          onChange={(e) => set("site_url", e.target.value)}
          placeholder="https://example.com"
        />
      </Field>
      <Field label={t("admin.general.adminEmail")}>
        <Text
          type="email"
          value={draft.admin_email}
          onChange={(e) => set("admin_email", e.target.value)}
        />
      </Field>
      <Field label={t("admin.general.siteLanguage")}>
        <Select
          value={draft.default_language}
          onChange={(e) => set("default_language", e.target.value as "pl" | "en")}
        >
          <option value="pl">Polski</option>
          <option value="en">English</option>
        </Select>
      </Field>
      <Field label={t("admin.general.timezone")}>
        <Text
          value={draft.timezone}
          onChange={(e) => set("timezone", e.target.value)}
          placeholder="Europe/Warsaw"
        />
      </Field>
      <Field label={t("admin.general.dateFormat")} hint={t("admin.general.dateFormatHint")}>
        <Text
          value={draft.date_format}
          onChange={(e) => set("date_format", e.target.value)}
          className="w-40"
        />
      </Field>
      <Field label={t("admin.general.timeFormat")}>
        <Text
          value={draft.time_format}
          onChange={(e) => set("time_format", e.target.value)}
          className="w-40"
        />
      </Field>
      <Field label={t("admin.general.weekStart")}>
        <Select
          value={String(draft.week_starts_on)}
          onChange={(e) => set("week_starts_on", Number(e.target.value))}
        >
          <option value="1">{t("admin.general.monday")}</option>
          <option value="0">{t("admin.general.sunday")}</option>
        </Select>
      </Field>
      <Field label={t("admin.general.iconPack")} hint={t("admin.general.iconPackHint")}>
        <Select
          value={draft.icon_pack}
          onChange={(e) => set("icon_pack", e.target.value as IconPack)}
        >
          <option value="lucide">{t("admin.general.iconLucide")}</option>
          <option value="fontawesome">{t("admin.general.iconFA")}</option>
        </Select>
      </Field>

      <SaveBar saving={save.isPending} onSave={() => save.mutate(draft)} />
    </div>
  );
}
