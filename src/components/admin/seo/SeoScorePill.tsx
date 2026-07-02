// Atom: 0-100 SEO completeness bar + value, graded by the contentStatus rules.
// Shares the visual language of SerpMeter (thin bar, tone by grade).
import type { SeoGrade } from "@/lib/seo/contentStatus";

const GRADE_BAR: Record<SeoGrade, string> = {
  good: "bg-emerald-500",
  warn: "bg-amber-500",
  poor: "bg-destructive",
};

export function SeoScorePill({ score, grade }: { score: number; grade: SeoGrade }) {
  return (
    <span className="inline-flex items-center gap-2 min-w-[90px]">
      <span className="h-1 flex-1 rounded-full bg-muted overflow-hidden">
        <span
          className={`block h-full rounded-full ${GRADE_BAR[grade]}`}
          style={{ width: `${Math.max(4, Math.min(100, score))}%` }}
        />
      </span>
      <span className="text-[10px] tabular-nums text-muted-foreground w-6 text-right">{score}</span>
    </span>
  );
}
