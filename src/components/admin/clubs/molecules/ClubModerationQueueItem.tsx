// Molekuła: JEDNA pozycja kolejki premoderacji.
//
// CO BYŁO W ORGANIZMIE. Sto linii JSX-a wewnątrz `queue.map(...)` w
// `ClubModerationTab`: karta z cytatem treści, plakietkami typu i anonimowości,
// polem zaznaczenia oraz PIĘCIOMA przyciskami, każdy z inline'owym handlerem -
// w tym dwoma, które składały deskryptor dialogu potwierdzenia i cel
// ujawnienia. Organizm ma być kompozycją, a nie miejscem, w którym mieszka
// karta.
//
// JEDNA ODPOWIEDZIALNOŚĆ: pokazać JEDEN wpis do decyzji i oddać sześć zdarzeń.
// Molekuła nie woła mutacji, nie zna klubu i nie decyduje, czy usunięcie
// wymaga potwierdzenia - `onDelete` jest zdarzeniem „moderator chce usunąć”,
// a nie usunięciem.
//
// DWIE RZECZY, KTÓRE SĄ TU REGUŁĄ, NIE UKŁADEM, i dlatego nie dają się
// przestawić bez zauważenia:
//   * wpis anonimowy NIE POKAZUJE nazwiska - pokazuje plakietkę; nazwisko
//     wychodzi wyłącznie osobną, logowaną akcją ujawnienia,
//   * przycisk ujawnienia istnieje WYŁĄCZNIE przy wpisie anonimowym - przy
//     wpisie podpisanym nie ma czego ujawniać.
//
// CYTAT TREŚCI JEST OBCIĘTY DO CZTERECH WIERSZY (`line-clamp-4`), a nie do
// jednego: decyzja o usunięciu cudzej wypowiedzi na podstawie pierwszych
// pięciu słów to nie moderacja.
import { useTranslation } from "react-i18next";
import { Check, EyeOff, PencilLine, ShieldOff, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { formatDateTime } from "@/lib/i18n/format";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";
import type { AdminClubModerationItem } from "@/lib/clubs/types";

export function ClubModerationQueueItem({
  item,
  selected,
  pending,
  language,
  onToggle,
  onApprove,
  onHide,
  onDelete,
  onEdit,
  onReveal,
}: {
  item: AdminClubModerationItem;
  selected: boolean;
  pending: boolean;
  language: string;
  onToggle: () => void;
  onApprove: () => void;
  onHide: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onReveal: () => void;
}) {
  ensureAdminClubsI18n();
  const { t } = useTranslation();

  return (
    <li className="rounded-lg border border-border/60 bg-card p-3">
      <div className="flex items-start gap-3">
        <Checkbox
          className="mt-1"
          aria-label={item.title}
          checked={selected}
          onCheckedChange={onToggle}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Badge variant="outline" className="text-[11px]">
              {t(`adminClubs.moderation.target.${item.target_type}`)}
            </Badge>
            {item.is_anonymous ? (
              <Badge
                variant="outline"
                className="border-amber-500/40 text-[11px] text-amber-700 dark:text-amber-300"
              >
                {t("adminClubs.moderation.anonymous")}
              </Badge>
            ) : (
              <span className="font-medium text-foreground">{item.author_name}</span>
            )}
            <span>{formatDateTime(item.created_at, language)}</span>
          </div>
          <p className="mt-1 truncate text-sm font-medium">{item.title}</p>
          <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-sm text-muted-foreground">
            {item.body}
          </p>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-border/60 pt-2.5">
        <Button size="sm" className="h-8" disabled={pending} onClick={onApprove}>
          <Check className="mr-1.5 h-3.5 w-3.5" />
          {t("adminClubs.moderation.approve")}
        </Button>
        <Button size="sm" variant="outline" className="h-8" disabled={pending} onClick={onHide}>
          <EyeOff className="mr-1.5 h-3.5 w-3.5" />
          {t("adminClubs.moderation.hide")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-destructive"
          disabled={pending}
          onClick={onDelete}
        >
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          {t("adminClubs.moderation.delete")}
        </Button>
        {/* Redakcja PRZED zatwierdzeniem: wpis z jednym zdaniem do zaczernienia
            nie musi wracać do autora. */}
        <Button size="sm" variant="outline" className="h-8" onClick={onEdit}>
          <PencilLine className="mr-1.5 h-3.5 w-3.5" />
          {t("adminClubs.moderation.edit")}
        </Button>
        {item.is_anonymous ? (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-8 text-amber-700 dark:text-amber-300"
            onClick={onReveal}
          >
            <ShieldOff className="mr-1.5 h-3.5 w-3.5" />
            {t("adminClubs.moderation.reveal")}
          </Button>
        ) : null}
      </div>
    </li>
  );
}
