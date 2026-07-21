import { useTranslation } from "react-i18next";
import { Upload } from "@/lib/lucide-shim";

/** Atom: the empty-folder prompt shown when there are no files or subfolders. */
export function MediaEmptyState() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center text-muted-foreground text-sm py-16">
      <Upload className="w-6 h-6 mb-2" />
      {t("admin.media.dropHere", {
        defaultValue: "Przeciągnij pliki tutaj lub kliknij „Wgraj”",
      })}
    </div>
  );
}
