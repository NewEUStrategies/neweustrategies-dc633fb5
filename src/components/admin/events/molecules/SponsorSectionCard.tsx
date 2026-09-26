// Molekuła: karta jednej sekcji sponsorów na tablicy - tytuł, logotypy, edycja, kolejność.
//
// STAN OGŁOSZENIA JEST NA KARCIE, NIE TYLKO W OKNIE SPONSORA. Logo dodane
// z tablicy zapisuje się jako NIEOGŁOSZONE (`is_published = false`), a strona
// wydarzenia pokazuje wyłącznie ogłoszonych. Karta, która rysowała każde logo
// tak samo, obiecywała organizatorowi partnerów, których uczestnik nie zobaczy -
// dlatego logo nieogłoszone jest przygaszone i podpisane, a nagłówek mówi, ile
// ich w sekcji czeka na ogłoszenie.
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, Image as ImageIcon, LayoutGrid, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { brandedMediaUrl } from "@/lib/media/publicUrl";
import type { SponsorSectionLayout } from "@/lib/events/sponsorBoardApi";
import "@/lib/i18n-admin-event-sponsor-board";

export interface SponsorLogo {
  id: string;
  name: string;
  logoUrl: string;
  /** `false` = przypięcie nieogłoszone: tablica je pokazuje, strona wydarzenia nie. */
  isPublished: boolean;
}

/** Plakietka logo nieogłoszonego - ten sam napis na karcie i w panelu sekcji. */
export function SponsorDraftBadge() {
  const { t } = useTranslation();
  return (
    <Badge variant="outline" className="px-1.5 text-[10px] font-medium text-muted-foreground">
      {t("sponsorBoard.sponsors.draftBadge")}
    </Badge>
  );
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
  // Liczymy WSZYSTKIE logotypy sekcji, także te, których baner nie rysuje -
  // baner pokazuje pierwszą firmę, a nieogłoszona może być druga.
  const drafts = logos.filter((logo) => !logo.isPublished).length;
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
          {drafts > 0 && (
            <p className="mt-0.5 text-xs font-medium text-foreground">
              {t("sponsorBoard.sponsors.draftCount", { count: drafts })}
            </p>
          )}
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
            className={cn("h-24 w-full object-contain", !logos[0].isPublished && "opacity-60")}
            loading="lazy"
          />
          {logos[0].isPublished ? null : (
            <div className="border-t border-border px-2 py-1">
              <SponsorDraftBadge />
            </div>
          )}
        </div>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-4">
          {logos.map((logo) => (
            <li key={logo.id} className="flex w-20 flex-col items-center gap-1" title={logo.name}>
              <span
                className={cn(
                  "flex h-16 w-20 items-center justify-center rounded-md bg-background p-1",
                  !logo.isPublished && "opacity-60",
                )}
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
              </span>
              {logo.isPublished ? null : <SponsorDraftBadge />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
