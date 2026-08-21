// Organizm: zakładka "Grupy" edytora klubu.
//
// Kolejność zmienia się przeciąganiem i zapisuje JEDNYM wywołaniem na całą
// listę. Optymistyczna zmiana lokalnej tablicy przed odpowiedzią serwera jest
// tu konieczna, bo przeciąganie, które "wraca na miejsce" na czas round-tripu,
// czyta się jak zepsute.
//
// CO STĄD WYSZŁO I GDZIE JEST. Nowa kolejność po upuszczeniu (razem z rozpoznaniem
// przeciągnięcia, którego NIE MA CO zapisywać), projekcja wiersza działu
// i trzy stany tablicy są w `lib/clubs/adminClubGroupsBoard.ts`; sam wiersz
// jest molekułą `ClubTableGroupRow`. Tutaj zostaje sklejenie: co jedzie do
// mutacji, co się dzieje po jej błędzie i co otwiera edytor działu.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Plus, Layers } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ClubTableGroupRow } from "../molecules/ClubTableGroupRow";
import { ClubGroupEditorDialog } from "./ClubGroupEditorDialog";
import { useAdminClubGroups, useReorderClubGroups, useUpsertClubGroup } from "@/lib/clubs/useClubs";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";
import {
  clubGroupReorder,
  clubGroupRowView,
  clubGroupsBoardMode,
} from "@/lib/clubs/adminClubGroupsBoard";
import type { AdminClubGroupRow } from "@/lib/clubs/types";

export function ClubGroupsTab({ clubId }: { clubId: string }) {
  ensureAdminClubsI18n();
  const { t, i18n } = useTranslation();
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
    const next = clubGroupReorder(order, active.id, over ? over.id : null);
    if (next === null) return;

    setOrder(next.rows);
    reorderM.mutate(next.ids, {
      onSuccess: () => toast.success(t("adminClubs.groups.reordered")),
      onError: () => {
        // Cofamy optymistyczną zmianę: lista, która pokazuje kolejność
        // inną niż zapisana, jest gorsza niż brak przeciągania.
        setOrder(groupsQ.data ?? []);
        toast.error(t("adminClubs.saveFailed"));
      },
    });
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

  const mode = clubGroupsBoardMode({ isPending: groupsQ.isPending, count: order.length });

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
        {mode === "pending" ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-lg bg-muted/50" />
            ))}
          </div>
        ) : mode === "empty" ? (
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
                    <ClubTableGroupRow
                      key={group.id}
                      view={clubGroupRowView(group, i18n.language)}
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
