// Public widget rendered above post content.
// "Z tego materiału dowiesz się, że ..." / "From this material you will learn that ..."
// Max 6 bullet points, bilingual. Atomic-design "molecule".
import { useTranslation } from "react-i18next";
import { Check } from "@/lib/lucide-shim";

interface KeyTakeawaysProps {
  items: readonly string[];
  className?: string;
}

export function KeyTakeaways({ items, className }: KeyTakeawaysProps) {
  const { t } = useTranslation();
  const clean = items
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter((s) => s.length > 0)
    .slice(0, 6);
  if (clean.length === 0) return null;

  return (
    <aside
      aria-label={t("post.takeaways.title")}
      className={`my-8 rounded-xl border border-border bg-card/60 backdrop-blur-sm p-5 lg:p-6 shadow-sm ${className ?? ""}`}
    >
      <h2 className="font-display text-lg lg:text-xl font-semibold mb-4 text-foreground">
        {t("post.takeaways.title")}
      </h2>
      <ul className="space-y-2.5">
        {clean.map((bullet, i) => (
          <li key={i} className="flex items-start gap-3 text-sm lg:text-base leading-relaxed">
            <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5 text-brand" aria-hidden="true" />
            <span className="text-foreground/90">{bullet}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
