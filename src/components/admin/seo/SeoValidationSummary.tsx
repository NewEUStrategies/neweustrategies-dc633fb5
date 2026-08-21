// Molecule: compact validation summary shown at the top of the SEO panel.
// Aggregates the pure `validateSeoPanel` output into human-readable lines
// with exact numbers (chars / cap, px / Google budget) so editors can fix
// snippets before they ship. Blocking rows (hard character caps) are styled
// as errors; pixel-budget overflows render as warnings.
import { useTranslation } from "react-i18next";
import { Check } from "@/lib/lucide-shim";
import { cn } from "@/lib/utils";
import type { SeoIssue } from "@/lib/seo/validation";
import type { HeadingIssue } from "@/lib/seo/headingValidation";
import {
  SeverityBadge,
  severityLiveRole,
} from "@/components/admin/seo/atoms/SeverityBadge";

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
      issue.kind === "title" ? t("admin.seo.titleLabel") : t("admin.seo.descriptionLabel");
    const text =
      issue.severity === "error"
        ? t("admin.seo.validation.errorLine", {
            chars: issue.chars,
            limit: issue.charLimit,
          })
        : t("admin.seo.validation.warnLine", {
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
    const pos = h.position ? ` (#${h.position})` : "";
    const snip = h.snippet ? ` - "${h.snippet}"` : "";
    if (h.kind === "missing_h1") {
      text = t("admin.seo.validation.missingH1");
    } else if (h.kind === "multiple_h1") {
      text = t("admin.seo.validation.multipleH1", {
        count: h.count ?? 2,
        pos,
        snip,
      });
    } else if (h.kind === "extra_h1") {
      text = t("admin.seo.validation.extraH1", { pos, snip });
    } else if (h.kind === "skipped_level") {
      text = t("admin.seo.validation.skippedLevel", {
        from: h.from,
        to: h.to,
        pos,
        snip,
      });
    } else if (h.kind === "empty_heading") {
      text = t("admin.seo.validation.emptyHeading", {
        pos,
        extra: h.count && h.count > 1 ? ` (łącznie ${h.count})` : "",
      });
    } else if (h.kind === "duplicate_heading") {
      text = t("admin.seo.validation.duplicateHeading", { pos, snip });
    } else if (h.kind === "too_long_heading") {
      text = t("admin.seo.validation.tooLongHeading", { pos, count: h.count, snip });
    } else if (h.kind === "shouty_heading") {
      text = t("admin.seo.validation.shoutyHeading", { pos, snip });
    }
    all.push({
      key: `h-${h.lang}-${h.kind}-${h.position ?? 0}`,
      severity: h.severity,
      text: `${LANG_LABEL[h.lang]} - ${t("admin.seo.validation.headingLabel")}: ${text}`,
    });
  }

  if (all.length === 0) {
    return (
      <div
        role="status"
        className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-[11px] text-emerald-700 dark:text-emerald-300"
      >
        <Check className="h-3.5 w-3.5" aria-hidden />
        <span>{t("admin.seo.validation.ok")}</span>
      </div>
    );
  }
  const hasError = all.some((i) => i.severity === "error");
  return (
    <div
      role={severityLiveRole(hasError ? "error" : "warning")}
      className={cn(
        "space-y-1 rounded-md border px-3 py-2 text-[11px]",
        hasError
          ? "border-destructive/50 bg-destructive/5 text-destructive"
          : "border-amber-500/50 bg-amber-500/5 text-amber-700 dark:text-amber-300",
      )}
    >
      <SeverityBadge severity={hasError ? "error" : "warning"} />
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
