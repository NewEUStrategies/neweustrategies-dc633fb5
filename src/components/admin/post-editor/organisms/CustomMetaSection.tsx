// Organizm: sekcja własnych pól meta (zakładka szczegółów). Wartości są
// tenant-scoped przez CustomMetaValuesEditor (data.tenantId aktywnego obszaru).
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CustomMetaValuesEditor } from "@/components/admin/CustomMetaValuesEditor";
import type { PostEditorData, PostEditorFormApi } from "../hooks";
import "@/lib/i18n-admin-post-panes";

export function CustomMetaSection({
  formApi,
  data,
}: {
  formApi: PostEditorFormApi;
  data: PostEditorData;
}) {
  const { t } = useTranslation();
  const { form, set } = formApi;
  if (!form) return null;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-display font-semibold">
            {t("adminPostPanes.sections.customMetaTitle")}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t("adminPostPanes.sections.customMetaHint")}
          </p>
        </div>
        <Link to="/admin/custom-meta" className="text-xs text-brand underline">
          {t("adminPostPanes.sections.customMetaEditDefs")}
        </Link>
      </div>
      <CustomMetaValuesEditor
        tenantId={data.tenantId}
        lang="pl"
        values={form.custom_meta}
        onChange={(next) => set("custom_meta", next)}
      />
    </div>
  );
}
