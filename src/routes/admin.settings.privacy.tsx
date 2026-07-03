import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useSettings, useDraft } from "@/lib/admin/useSettings";
import { Field, Text, Checkbox, SaveBar } from "@/components/admin/settings/fields";

type Privacy = {
  privacy_page_slug: string;
  cookie_banner: boolean;
};

const DEFAULTS: Privacy = { privacy_page_slug: "", cookie_banner: true };

export const Route = createFileRoute("/admin/settings/privacy")({
  component: PrivacySettings,
});

function PrivacySettings() {
  const { t } = useTranslation();
  const { query, save } = useSettings<Privacy>("privacy", DEFAULTS);
  const [draft, setDraft] = useDraft(query.data);
  if (!draft) return <p className="text-sm text-muted-foreground">{t("admin.loading")}</p>;
  const set = <K extends keyof Privacy>(k: K, v: Privacy[K]) => setDraft({ ...draft, [k]: v });

  return (
    <div>
      <h2 className="font-display text-xl mb-4">{t("admin.privacy.title")}</h2>
      <Field label={t("admin.privacy.policyPage")} hint={t("admin.privacy.policyPageHint")}>
        <Text
          value={draft.privacy_page_slug}
          onChange={(e) => set("privacy_page_slug", e.target.value)}
          placeholder="polityka-prywatnosci"
        />
      </Field>
      <Field label={t("admin.privacy.cookieBanner")}>
        <Checkbox
          label={t("admin.privacy.cookieBannerLabel")}
          checked={draft.cookie_banner}
          onChange={(v) => set("cookie_banner", v)}
        />
      </Field>
      <SaveBar saving={save.isPending} onSave={() => save.mutate(draft)} />
    </div>
  );
}
