// Molekuła: JEDEN wiersz listy działów klubu, przeciągalny.
//
// Wyjęta z `organisms/ClubGroupsTab.tsx` (był tam jako lokalny `SortableGroupRow`).
// Odpowiedzialność jedna: pokazać `ClubGroupRowView` i oddać uchwyt
// przeciągania. Reguły projekcji wiersza (zawężenie statusu i widoczności,
// odczyt dziedziczenia) są w `lib/clubs/adminClubGroupsBoard.ts`, a kolejność
// liczy `clubGroupReorder` - tutaj nie ma ani jednej z tych decyzji.
import { useTranslation } from "react-i18next";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClubGroupStatusBadge, ClubVisibilityBadge } from "../atoms/ClubBadges";
import type { ClubGroupRowView } from "@/lib/clubs/adminClubGroupsBoard";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";

interface ClubTableGroupRowProps {
  view: ClubGroupRowView;
  onEdit: () => void;
}

export function ClubTableGroupRow({ view, onEdit }: ClubTableGroupRowProps) {
  ensureAdminClubsI18n();
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: view.id,
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={
        "flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-card p-3 " +
        (isDragging ? "opacity-60 shadow-lg" : "")
      }
    >
      <button
        type="button"
        className="cursor-grab touch-none rounded p-1 text-muted-foreground hover:text-foreground active:cursor-grabbing"
        aria-label={t("adminClubs.groups.reorderHint")}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {/* Nazwa jest przyciskiem: kliknięcie w wiersz to najkrótsza droga do
          ustawień, a ikona obok zostaje dla tych, którzy jej szukają. */}
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={onEdit}
          className="block w-full truncate text-left font-medium hover:text-primary"
        >
          {view.name}
        </button>
        <div className="text-xs text-muted-foreground">{view.slugPath}</div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ClubVisibilityBadge visibility={view.visibility} />
        {/* Etykieta dziedziczenia jest jawna: bez niej wartość klubu wygląda
            jak wartość ustawiona na grupie, a pierwsza zmiana klubu przestaje
            działać "bez powodu". */}
        {view.visibilityInherited ? (
          <span className="text-[11px] text-muted-foreground">{t("club.inheritedFromClub")}</span>
        ) : null}
        <ClubGroupStatusBadge status={view.status} />
        <span className="text-xs tabular-nums text-muted-foreground">
          {t("club.threadsCount", { count: view.threadCount })}
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={onEdit}
          aria-label={t("adminClubs.groups.editTitle")}
        >
          <Settings2 className="h-4 w-4" />
        </Button>
      </div>
    </li>
  );
}
