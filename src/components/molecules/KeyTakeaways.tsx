// Public widget rendered above post content.
// "Z tego materiału dowiesz się, że ..." / "From this material you will learn that ..."
// Max 6 bullet points, bilingual. Atomic-design "molecule".
import { useTranslation } from "react-i18next";


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
      // "key-takeaways" is a stable hook referenced by the SpeakableSpecification
      // cssSelector in the article JSON-LD (src/lib/seo/meta.ts) - do not rename.
      className={`key-takeaways my-10 ${className ?? ""}`}
    >
      <h2 className="font-display text-2xl lg:text-4xl font-semibold mb-5 text-foreground/90">
        {t("post.takeaways.title")}
      </h2>
      <ul className="space-y-3.5 border-t border-border/60 pt-5">
        {clean.map((bullet, i) => (
          <li
            key={i}
            className="flex items-start gap-3 text-base lg:text-lg leading-relaxed text-muted-foreground"
          >
            <span
              className="mt-2.5 inline-block h-2 w-2 shrink-0 rounded-full bg-brand"
              aria-hidden="true"
            />
            <span>{bullet}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
