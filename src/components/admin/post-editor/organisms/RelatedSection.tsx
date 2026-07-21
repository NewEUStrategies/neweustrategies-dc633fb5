// Organizm: sekcja override'u powiązanych wpisów (zakładka szczegółów).
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { RelatedOverrideEditor } from "@/components/admin/RelatedOverrideEditor";
import type { PostEditorFormApi } from "../hooks";
import "@/lib/i18n-admin-post-panes";

export function RelatedSection({ formApi }: { formApi: PostEditorFormApi }) {
  const { t } = useTranslation();
  const { form, set } = formApi;
  if (!form) return null;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-display font-semibold">
            {t("adminPostPanes.sections.relatedTitle")}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t("adminPostPanes.sections.relatedHint")}
          </p>
        </div>
        <Link to="/admin/related-posts" className="text-xs text-brand underline">
          {t("adminPostPanes.sections.relatedGlobalConfig")}
        </Link>
      </div>
      <RelatedOverrideEditor
        value={form.related_override}
        onChange={(next: Record<string, unknown> | null) => set("related_override", next)}
      />
    </div>
  );
}
