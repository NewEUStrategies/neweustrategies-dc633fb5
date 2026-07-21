// Molecule: compact validation summary shown at the top of the SEO panel.
// Aggregates the pure `validateSeoPanel` output into human-readable lines
// with exact numbers (chars / cap, px / Google budget) so editors can fix
// snippets before they ship. Blocking rows (hard character caps) are styled
// as errors; pixel-budget overflows render as warnings.
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check } from "@/lib/lucide-shim";
import { cn } from "@/lib/utils";
import type { SeoIssue } from "@/lib/seo/validation";
import type { HeadingIssue } from "@/lib/seo/headingValidation";

const LANG_LABEL: Record<SeoIssue["lang"], string> = { pl: "PL", en: "EN" };

interface SeoValidationSummaryProps {
  issues: SeoIssue[];
  headingIssues?: HeadingIssue[];
}

export function SeoValidationSummary({ issues, headingIssues = [] }: SeoValidationSummaryProps) {
  const { t } = useTranslation();
  const all: Array<{ key: string; severity: "error" | "warning"; text: string }> = [];

  for (const issue of issues) {
    const fieldLabel =
      issue.kind === "title"
        ? t("admin.seo.titleLabel", { defaultValue: "Tytuł SEO" })
        : t("admin.seo.descriptionLabel", { defaultValue: "Opis meta (description)" });
    const text =
      issue.severity === "error"
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
          });
    all.push({
      key: `m-${issue.lang}-${issue.kind}-${issue.severity}`,
      severity: issue.severity,
      text: `${LANG_LABEL[issue.lang]} - ${fieldLabel}: ${text}`,
    });
  }

  for (const h of headingIssues) {
    let text = "";
    if (h.kind === "missing_h1") {
      text = t("admin.seo.validation.missingH1", {
        defaultValue: "Brakuje H1 w treści - dodaj główny nagłówek.",
      });
    } else if (h.kind === "multiple_h1") {
      text = t("admin.seo.validation.multipleH1", {
        defaultValue: "Znaleziono {{count}} nagłówków H1 - powinien być tylko jeden.",
        count: h.count ?? 2,
      });
    } else if (h.kind === "skipped_level") {
      text = t("admin.seo.validation.skippedLevel", {
        defaultValue:
          "Przeskoczony poziom nagłówka: H{{from}} → H{{to}}. Zachowaj hierarchię H2 → H3 → H4.",
        from: h.from,
        to: h.to,
      });
    } else if (h.kind === "empty_heading") {
      text = t("admin.seo.validation.emptyHeading", {
        defaultValue: "Pusty nagłówek w treści - usuń lub uzupełnij.",
      });
    }
    all.push({
      key: `h-${h.lang}-${h.kind}`,
      severity: h.severity,
      text: `${LANG_LABEL[h.lang]} - ${t("admin.seo.validation.headingLabel", { defaultValue: "Struktura nagłówków" })}: ${text}`,
    });
  }

  if (all.length === 0) {
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
  const hasError = all.some((i) => i.severity === "error");
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
                defaultValue: "Zapis zablokowany - przekroczono twardy limit.",
              })
            : t("admin.seo.validation.warnHeading", {
                defaultValue: "Ostrzeżenia SEO - warto poprawić przed publikacją.",
              })}
        </span>
      </div>
      <ul className="space-y-0.5 pl-5 list-disc">
        {all.map((row) => (
          <li key={row.key}>
            <span className="tabular-nums">{row.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
