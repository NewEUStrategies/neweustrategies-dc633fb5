// Karta pojedynczego materiału w eksploratorze huba eksperta. Heterogeniczna
// (publikacja / raport / wideo / podcast / wydarzenie) - stąd własna karta
// zamiast PostListCard (który zakłada kształt wpisu bloga).
import { Link } from "@tanstack/react-router";
import { FileText, BarChart3, Video, Mic, CalendarDays } from "lucide-react";
import { OptimizedImage } from "@/components/atoms/OptimizedImage";
import { formatDateShort } from "@/lib/i18n/format";
import type { ExpertMaterial, MaterialKind } from "@/lib/experts/types";
import type { TFunction } from "i18next";

const KIND_ICON: Record<MaterialKind, typeof FileText> = {
  article: FileText,
  report: BarChart3,
  video: Video,
  podcast: Mic,
  event: CalendarDays,
};

const CARD_IMAGE_SIZES = "(min-width: 1024px) 360px, (min-width: 768px) 45vw, 92vw";

export function ExpertMaterialCard({
  material,
  lang,
  t,
}: {
  material: ExpertMaterial;
  lang: "pl" | "en";
  t: TFunction;
}) {
  const title = (lang === "en" ? material.title_en : material.title_pl) || material.title_pl;
  const excerpt = lang === "en" ? material.excerpt_en : material.excerpt_pl;
  const Icon = KIND_ICON[material.kind];
  const kindLabel = t(`expert.kind.${material.kind}`);

  return (
    <Link
      to={material.href as "/"}
      className="group flex flex-col overflow-hidden rounded-[10px] border border-border/60 bg-card transition-colors hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {material.cover_url ? (
        <div className="aspect-[16/9] w-full overflow-hidden bg-muted">
          <OptimizedImage
            src={material.cover_url}
            alt=""
            sizes={CARD_IMAGE_SIZES}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        </div>
      ) : (
        <div className="flex aspect-[16/9] w-full items-center justify-center bg-muted/50">
          <Icon className="h-8 w-8 text-muted-foreground/40" aria-hidden />
        </div>
      )}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-[var(--brand)]">
          <Icon className="h-3.5 w-3.5" aria-hidden />
          <span>{kindLabel}</span>
          {material.isCoauthor && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-normal normal-case tracking-normal text-muted-foreground">
              {t("expert.coauthor")}
            </span>
          )}
        </div>
        <h3 className="font-display text-base leading-snug text-foreground group-hover:text-brand">
          {title}
        </h3>
        {excerpt && <p className="line-clamp-2 text-sm text-muted-foreground">{excerpt}</p>}
        {material.date && (
          <p className="mt-auto pt-1 text-xs text-muted-foreground/80">
            {formatDateShort(material.date, lang)}
          </p>
        )}
      </div>
    </Link>
  );
}
