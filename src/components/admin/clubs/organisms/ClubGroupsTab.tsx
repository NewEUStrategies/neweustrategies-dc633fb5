// Organizm: zakładka "Grupy" edytora klubu.
//
// Kolejność zmienia się przeciąganiem i zapisuje JEDNYM wywołaniem na całą
// listę. Optymistyczna zmiana lokalnej tablicy przed odpowiedzią serwera jest
// tu konieczna, bo przeciąganie, które "wraca na miejsce" na czas round-tripu,
// czyta się jak zepsute.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { toast } from "sonner";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Layers, Settings2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ClubGroupStatusBadge, ClubVisibilityBadge } from "../atoms/ClubBadges";
import { ClubGroupEditorDialog } from "./ClubGroupEditorDialog";
import { useAdminClubGroups, useReorderClubGroups, useUpsertClubGroup } from "@/lib/clubs/useClubs";
import {
  CLUB_GROUP_STATUSES,
  CLUB_VISIBILITIES,
  toGroupSettings,
  type AdminClubGroupRow,
  type ClubGroupStatus,
  type ClubVisibility,
} from "@/lib/clubs/types";

function asGroupStatus(value: string): ClubGroupStatus {
  return (CLUB_GROUP_STATUSES as readonly string[]).includes(value)
    ? (value as ClubGroupStatus)
    : "draft";
}

function asVisibility(value: string): ClubVisibility {
  return (CLUB_VISIBILITIES as readonly string[]).includes(value)
    ? (value as ClubVisibility)
    : "members";
}

function SortableGroupRow({ group, onEdit }: { group: AdminClubGroupRow; onEdit: () => void }) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: group.id,
  });
  const settings = toGroupSettings(group);

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
          {pickLocalized(group, "name", lang)}
        </button>
        <div className="text-xs text-muted-foreground">/{group.slug}</div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ClubVisibilityBadge visibility={asVisibility(settings.visibility.value)} />
        {/* Etykieta dziedziczenia jest jawna: bez niej wartość klubu wygląda
            jak wartość ustawiona na grupie, a pierwsza zmiana klubu przestaje
            działać "bez powodu". */}
        {settings.visibility.inherited ? (
          <span className="text-[11px] text-muted-foreground">{t("club.inheritedFromClub")}</span>
        ) : null}
        <ClubGroupStatusBadge status={asGroupStatus(group.status)} />
        <span className="text-xs tabular-nums text-muted-foreground">
          {t("club.threadsCount", { count: group.thread_count })}
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

export function ClubGroupsTab({ clubId }: { clubId: string }) {
  const { t } = useTranslation();
  const groupsQ = useAdminClubGroups(clubId);
  const reorderM = useReorderClubGroups(clubId);
  const createM = useUpsertClubGroup(clubId);

  // Lokalna kopia kolejności: dnd-kit potrzebuje natychmiastowej zmiany,
  // a odpowiedź serwera przychodzi po round-tripie.
  const [order, setOrder] = useState<AdminClubGroupRow[]>([]);
  const [editing, setEditing] = useState<AdminClubGroupRow | null>(null);
  useEffect(() => {
    if (groupsQ.data) setOrder(groupsQ.data);
  }, [groupsQ.data]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = order.findIndex((g) => g.id === active.id);
    const newIndex = order.findIndex((g) => g.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const next = arrayMove(order, oldIndex, newIndex);
    setOrder(next);
    reorderM.mutate(
      next.map((g) => g.id),
      {
        onSuccess: () => toast.success(t("adminClubs.groups.reordered")),
        onError: () => {
          // Cofamy optymistyczną zmianę: lista, która pokazuje kolejność
          // inną niż zapisana, jest gorsza niż brak przeciągania.
          setOrder(groupsQ.data ?? []);
          toast.error(t("adminClubs.saveFailed"));
        },
      },
    );
  };

  const handleCreate = () => {
    const stamp = Date.now().toString(36);
    createM.mutate(
      {
        club_id: clubId,
        slug: `dzial-${stamp}`,
        // Wartosci startowe nowego dzialu NIE zaleza od jezyka panelu: przy
        // angielskim interfejsie do kolumny POLSKIEJ wpisywalo sie
        // "New section", wiec polski odwiedzajacy widzial angielska nazwe.
        // Kolumna trzyma jezyk, ktory zapowiada jej nazwa - kropka.
        name_pl: "Nowy dział",
        name_en: "New section",
        status: "draft",
      },
      {
        // Świeżo założona grupa otwiera się od razu w edytorze: bez tego
        // administrator dostaje wiersz "Nowa grupa" i musi się domyślić,
        // że trzeba w niego kliknąć.
        onSuccess: () => toast.success(t("adminClubs.saved")),
        onError: () => toast.error(t("adminClubs.saveFailed")),
      },
    );
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="h-4 w-4" />
            {t("adminClubs.groups.title")}
          </CardTitle>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            {t("adminClubs.groups.hint")}
          </p>
        </div>
        <Button onClick={handleCreate} disabled={createM.isPending}>
          <Plus className="mr-2 h-4 w-4" />
          {t("adminClubs.groups.newGroup")}
        </Button>
      </CardHeader>

      <CardContent>
        {groupsQ.isPending ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-lg bg-muted/50" />
            ))}
          </div>
        ) : order.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t("adminClubs.groups.empty")}
          </p>
        ) : (
          <>
            <p className="mb-3 text-xs text-muted-foreground">
              {t("adminClubs.groups.reorderHint")}
            </p>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={order.map((g) => g.id)}
                strategy={verticalListSortingStrategy}
              >
                <ul className="space-y-2">
                  {order.map((group) => (
                    <SortableGroupRow
                      key={group.id}
                      group={group}
                      onEdit={() => setEditing(group)}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          </>
        )}
      </CardContent>

      <ClubGroupEditorDialog
        clubId={clubId}
        group={editing}
        siblings={order}
        onOpenChange={(open) => !open && setEditing(null)}
      />
    </Card>
  );
}
