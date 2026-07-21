// Atom: dashed "live preview" box shown under some editor sections.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-theme-design";

export function PreviewFrame({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="mt-2 p-4 rounded-md border border-dashed border-border bg-muted/30">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
        {t("adminThemeDesign.previewLabel")}
      </div>
      {children}
    </div>
  );
}
