// Molecule: compact validation summary shown at the top of the SEO panel.
// Aggregates the pure `validateSeoPanel` output into human-readable lines
// with exact numbers (chars / cap, px / Google budget) so editors can fix
// snippets before they ship. Blocking rows (hard character caps) are styled
// as errors; pixel-budget overflows render as warnings.
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check } from "@/lib/lucide-shim";
import { cn } from "@/lib/utils";
import type { SeoIssue } from "@/lib/seo/validation";

const LANG_LABEL: Record<SeoIssue["lang"], string> = { pl: "PL", en: "EN" };

export function SeoValidationSummary({ issues }: { issues: SeoIssue[] }) {
  const { t } = useTranslation();
  if (issues.length === 0) {
    return (
      <div
        role="status"
        className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-[11px] text-emerald-700 dark:text-emerald-300"
      >
        <Check className="h-3.5 w-3.5" aria-hidden />
        <span>
          {t("admin.seo.validation.ok", {
            defaultValue: "Wszystkie pola mieszczą się w limitach Google.",
          })}
        </span>
      </div>
    );
  }
  const hasError = issues.some((i) => i.severity === "error");
  return (
    <div
      role={hasError ? "alert" : "status"}
      className={cn(
        "space-y-1 rounded-md border px-3 py-2 text-[11px]",
        hasError
          ? "border-destructive/50 bg-destructive/5 text-destructive"
          : "border-amber-500/50 bg-amber-500/5 text-amber-700 dark:text-amber-300",
      )}
    >
      <div className="flex items-center gap-2 font-medium">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
        <span>
          {hasError
            ? t("admin.seo.validation.errorHeading", {
                defaultValue: "Zapis zablokowany - przekroczono twardy limit znaków.",
              })
            : t("admin.seo.validation.warnHeading", {
                defaultValue: "Google utnie te snippety w wynikach wyszukiwania.",
              })}
        </span>
      </div>
      <ul className="space-y-0.5 pl-5 list-disc">
        {issues.map((issue) => {
          const fieldLabel =
            issue.kind === "title"
              ? t("admin.seo.titleLabel", { defaultValue: "Tytuł SEO" })
              : t("admin.seo.descriptionLabel", { defaultValue: "Opis meta (description)" });
          return (
            <li key={`${issue.lang}-${issue.kind}-${issue.severity}`}>
              <span className="tabular-nums">
                {LANG_LABEL[issue.lang]} - {fieldLabel}:{" "}
                {issue.severity === "error"
                  ? t("admin.seo.validation.errorLine", {
                      defaultValue: "{{chars}} / {{limit}} znaków (twardy limit)",
                      chars: issue.chars,
                      limit: issue.charLimit,
                    })
                  : t("admin.seo.validation.warnLine", {
                      defaultValue: "{{chars}} znaków, {{px}}px / {{pxLimit}}px budżetu Google",
                      chars: issue.chars,
                      px: issue.px,
                      pxLimit: issue.pxLimit,
                    })}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
