// Molekuła: karta jednej sekcji sponsorów na tablicy - tytuł, logotypy, edycja, kolejność.
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, Image as ImageIcon, LayoutGrid, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { brandedMediaUrl } from "@/lib/media/publicUrl";
import type { SponsorSectionLayout } from "@/lib/events/sponsorBoardApi";
import "@/lib/i18n-admin-event-sponsor-board";

export interface SponsorLogo {
  id: string;
  name: string;
  logoUrl: string;
}

export function SponsorSectionCard({
  title,
  layout,
  logos,
  isFirst,
  isLast,
  onEdit,
  onMove,
}: {
  title: string;
  layout: SponsorSectionLayout;
  logos: SponsorLogo[];
  isFirst: boolean;
  isLast: boolean;
  onEdit: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const { t } = useTranslation();
  const LayoutIcon = layout === "banner" ? ImageIcon : LayoutGrid;
  return (
    <section
      data-sponsor-section={layout}
      className="group border-b border-border p-5 transition-colors last:border-b-0 hover:bg-muted/40"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="truncate font-semibold text-foreground">{title}</h4>
          <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
            <LayoutIcon className="h-3 w-3" aria-hidden />
            {t(`sponsorBoard.sponsors.${layout}`)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="flex-col gap-0 h-auto py-1 text-muted-foreground hover:text-primary"
            onClick={onEdit}
            aria-label={`${t("sponsorBoard.sponsors.edit")}: ${title}`}
          >
            <Pencil className="h-4 w-4" aria-hidden />
            <span className="text-[11px] font-semibold opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              {t("sponsorBoard.sponsors.edit")}
            </span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={isFirst}
            onClick={() => onMove(-1)}
            aria-label={t("sponsorBoard.sponsors.moveUp")}
          >
            <ArrowUp className="h-4 w-4" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={isLast}
            onClick={() => onMove(1)}
            aria-label={t("sponsorBoard.sponsors.moveDown")}
          >
            <ArrowDown className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </header>
      {logos.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("sponsorBoard.sponsors.noLogos")}</p>
      ) : layout === "banner" ? (
        <div className="mt-3 overflow-hidden rounded-md border border-border bg-background">
          <img
            src={brandedMediaUrl(logos[0].logoUrl)}
            alt={logos[0].name}
            className="h-24 w-full object-contain"
            loading="lazy"
          />
        </div>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-4">
          {logos.map((logo) => (
            <li
              key={logo.id}
              className="flex h-16 w-20 items-center justify-center rounded-md bg-background p-1"
              title={logo.name}
            >
              {logo.logoUrl === "" ? (
                <span className="line-clamp-2 text-center text-xs font-medium">{logo.name}</span>
              ) : (
                <img
                  src={brandedMediaUrl(logo.logoUrl)}
                  alt={logo.name}
                  className="max-h-full max-w-full object-contain"
                  loading="lazy"
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
