// Organizm: PRZESTRZEN ROBOCZA jednego planu sali.
//
// TRZY KOLUMNY: sekcje i kategorie (uklad) | plotno albo tabela + szczegol
// zaznaczenia (miejsca) | uczestnicy (kogo sadzamy). Pasek narzedzi: edycja
// planu, publikacja, auto-przydzial, eksport, druk listy przy drzwiach.
//
// PRZYDZIAL ROZSTRZYGA BAZA. Klikniecie miejsca z wybrana osoba (albo
// upuszczenie osoby na plan) woła `admin_event_seat_assign`; odmowa
// "rezerwacja innej firmy" lub "bilet spoza kategorii" to pytanie o swiadome
// obejscie (`force`), a "miejsce zajete" przy osobie, ktora juz siedzi -
// pytanie o zamiane (`swap`). Wszystko inne to komunikat z mapy bledow.
//
// ZAPIS JAWNY. Studio nie zapisuje samo: kazda zmiana to swiadome klikniecie
// (przydzial, zwolnienie z potwierdzeniem, dialog), bez aktualizacji
// optymistycznych - ekran rysuje stan bazy po odswiezeniu galezi cache.
import { useCallback, useMemo, useState } from "react";
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { SeatMapLegend } from "@/components/admin/events/atoms/SeatMapLegend";
import { EventSeatCategoryDialog } from "@/components/admin/events/molecules/EventSeatCategoryDialog";
import { EventSeatMapDialog } from "@/components/admin/events/molecules/EventSeatMapDialog";
import { EventSeatSectionDialog } from "@/components/admin/events/molecules/EventSeatSectionDialog";
import { SeatAutoAssignDialog } from "@/components/admin/events/molecules/SeatAutoAssignDialog";
import {
  SEAT_CANVAS_DROP_ID,
  SeatMapCanvas,
} from "@/components/admin/events/molecules/SeatMapCanvas";
import { SeatDetailsCard } from "@/components/admin/events/molecules/SeatDetailsCard";
import {
  SeatExportMenu,
  type SeatExportCompany,
} from "@/components/admin/events/molecules/SeatExportMenu";
import { SeatHoldDialog } from "@/components/admin/events/molecules/SeatHoldDialog";
import { SeatMapTable } from "@/components/admin/events/molecules/SeatMapTable";
import { SeatingAttendeesPanel } from "@/components/admin/events/organisms/SeatingAttendeesPanel";
import { AdminCatalogListState } from "@/components/admin/molecules/AdminCatalogListState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/lib/appDialogs";
import {
  ArrowLeft,
  LayoutGrid,
  Pencil,
  Plus,
  Printer,
  Rows,
  Trash2,
  Wand2,
  X,
} from "@/lib/lucide-shim";
import { adminSeatingErrorMessage, adminSeatingFailure } from "@/lib/events/adminSeatingErrors";
import {
  candidateName,
  fetchSeatingExport,
  type Seat,
  type SeatCategory,
  type SeatExportRow,
  type SeatSection,
  type SeatSectionKind,
  type SeatStatus,
} from "@/lib/events/seatingApi";
import { seatingCsvRows, seatingPersonName } from "@/lib/events/seatingCsv";
import { SEAT_STATUS_LABEL_KEYS } from "@/lib/events/seatingDraft";
import { seatDropTarget } from "@/lib/events/seatingDnd";
import { seatLabelMessage, seatLabelMessageFromRow } from "@/lib/events/seatLabel";
import { seatPlanPrintHtml } from "@/lib/events/seatPlanPrintDocument";
import { useEventTickets } from "@/lib/events/useEventRegistrations";
import {
  useAssignSeat,
  useDeleteSeatCategory,
  useDeleteSeatSection,
  useReleaseSeats,
  useSaveSeatCategory,
  useSaveSeatMap,
  useSaveSeatSection,
  useSeatMapDetail,
  useUpdateSeats,
} from "@/lib/events/useEventSeating";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { ensureSeatingI18n } from "@/lib/i18n-admin-event-seating";
import { ensureEventSeatingI18n } from "@/lib/i18n-event-seating";

ensureSeatingI18n();
ensureEventSeatingI18n();

const ERR = "adminEventSeating.errors.";

type View = "canvas" | "table";

interface Armed {
  id: string;
  name: string;
}

export interface SeatMapWorkspaceProps {
  eventId: string;
  eventSlug: string;
  eventTitle: string;
  mapId: string;
  onBack: () => void;
}

export function SeatMapWorkspace({
  eventId,
  eventSlug,
  eventTitle,
  mapId,
  onBack,
}: SeatMapWorkspaceProps) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const detailQ = useSeatMapDetail(eventId, mapId);
  const ticketsQ = useEventTickets(eventId);
  const saveMap = useSaveSeatMap(eventId);
  const saveSection = useSaveSeatSection(eventId);
  const deleteSection = useDeleteSeatSection(eventId);
  const saveCategory = useSaveSeatCategory(eventId);
  const deleteCategory = useDeleteSeatCategory(eventId);
  const updateSeats = useUpdateSeats(eventId);
  const assign = useAssignSeat(eventId);
  const release = useReleaseSeats(eventId);

  const [view, setView] = useState<View>("canvas");
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [armed, setArmed] = useState<Armed | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [sectionDialog, setSectionDialog] = useState<{
    section: SeatSection | null;
    kind: SeatSectionKind;
  } | null>(null);
  const [categoryDialog, setCategoryDialog] = useState<{ category: SeatCategory | null } | null>(
    null,
  );
  const [holdOpen, setHoldOpen] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);

  const detail = detailQ.data ?? null;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const occupantBySeat = useMemo(
    () => new Map((detail?.assignments ?? []).map((assignment) => [assignment.seatId, assignment])),
    [detail],
  );
  const seatOfRegistration = useMemo(
    () =>
      new Map(
        (detail?.assignments ?? []).map((assignment) => [
          assignment.registrationId,
          assignment.seatId,
        ]),
      ),
    [detail],
  );

  const seatText = useCallback(
    (seat: Seat): string => {
      const message = seatLabelMessage(seat);
      return t(message.key, message.params);
    },
    [t],
  );

  const seatAria = useCallback(
    (seat: Seat): string => {
      const occupant = occupantBySeat.get(seat.id);
      const holder =
        seat.holdCompanyName ?? seat.holdSponsorName ?? seat.holdPackageBuyer ?? seat.holdNote;
      return [
        seatText(seat),
        t(SEAT_STATUS_LABEL_KEYS[seat.status]),
        occupant === undefined
          ? null
          : t("adminEventSeating.canvas.occupiedBy", {
              name: `${occupant.firstName} ${occupant.lastName}`.trim(),
            }),
        seat.status === "held" && holder !== null
          ? t("adminEventSeating.canvas.heldFor", { name: holder })
          : null,
        seat.isAccessible ? t("adminEventSeating.canvas.accessible") : null,
      ]
        .filter((part): part is string => part !== null)
        .join(", ");
    },
    [occupantBySeat, seatText, t],
  );

  const exportSeatText = useCallback(
    (row: SeatExportRow): string => {
      const message = seatLabelMessageFromRow(row);
      return t(message.key, message.params);
    },
    [t],
  );

  const assignTo = useCallback(
    async (seatId: string, registrationId: string, name: string) => {
      const attempt = async (extra: { force?: boolean; swap?: boolean }): Promise<void> => {
        try {
          const result = await assign.mutateAsync({ mapId, seatId, registrationId, ...extra });
          toast.success(
            result.swappedRegistrationId === null
              ? t("adminEventSeating.toasts.assigned", { name })
              : t("adminEventSeating.toasts.swapped"),
          );
          setArmed(null);
        } catch (error: unknown) {
          const key = adminSeatingFailure(error).key;
          const held = key === `${ERR}seatHeldForOther`;
          if (extra.force !== true && (held || key === `${ERR}categoryTicketMismatch`)) {
            const ok = await confirmDialog({
              title: t(
                held
                  ? "adminEventSeating.confirm.heldTitle"
                  : "adminEventSeating.confirm.categoryTitle",
              ),
              description: t(
                held
                  ? "adminEventSeating.confirm.heldBody"
                  : "adminEventSeating.confirm.categoryBody",
              ),
              confirmLabel: t("adminEventSeating.confirm.force"),
              cancelLabel: t("adminEventSeating.confirm.cancel"),
            });
            if (ok) await attempt({ ...extra, force: true });
            return;
          }
          if (
            extra.swap !== true &&
            key === `${ERR}seatTaken` &&
            seatOfRegistration.has(registrationId)
          ) {
            const ok = await confirmDialog({
              title: t("adminEventSeating.confirm.swapTitle"),
              description: t("adminEventSeating.confirm.swapBody"),
              confirmLabel: t("adminEventSeating.confirm.swap"),
              cancelLabel: t("adminEventSeating.confirm.cancel"),
            });
            if (ok) await attempt({ ...extra, swap: true });
            return;
          }
          toast.error(adminSeatingErrorMessage(error));
        }
      };
      await attempt({});
    },
    [assign, mapId, seatOfRegistration, t],
  );

  const releaseSeatIds = useCallback(
    async (seatIds: readonly string[]) => {
      const taken = seatIds.filter((id) => occupantBySeat.has(id));
      if (taken.length === 0) return;
      const ok = await confirmDialog({
        title: t("adminEventSeating.confirm.releaseTitle"),
        description: t("adminEventSeating.confirm.releaseBody"),
        confirmLabel: t("adminEventSeating.confirm.release"),
        cancelLabel: t("adminEventSeating.confirm.cancel"),
        destructive: true,
      });
      if (!ok) return;
      try {
        const count = await release.mutateAsync({ mapId, seatIds: taken });
        toast.success(t("adminEventSeating.toasts.released", { count }));
      } catch (error: unknown) {
        toast.error(adminSeatingErrorMessage(error));
      }
    },
    [mapId, occupantBySeat, release, t],
  );

  const onActivate = useCallback(
    (seatId: string, extend: boolean) => {
      if (armed !== null) {
        void assignTo(seatId, armed.id, armed.name);
        return;
      }
      setSelected((previous) => {
        if (!extend)
          return previous.size === 1 && previous.has(seatId) ? new Set() : new Set([seatId]);
        const next = new Set(previous);
        if (next.has(seatId)) next.delete(seatId);
        else next.add(seatId);
        return next;
      });
    },
    [armed, assignTo],
  );

  const onToggle = useCallback((seatId: string) => onActivate(seatId, true), [onActivate]);
  const onReleaseOne = useCallback(
    (seatId: string) => void releaseSeatIds([seatId]),
    [releaseSeatIds],
  );

  const onDragEnd = (event: DragEndEvent) => {
    const target = seatDropTarget(event, SEAT_CANVAS_DROP_ID, document);
    if (target !== null) void assignTo(target.seatId, target.registrationId, target.name);
  };

  if (detail === null) {
    return (
      <AdminCatalogListState
        isLoading={detailQ.isLoading}
        loadingLabel={t("adminEventSeating.workspace.loading")}
        errorMessage={detailQ.error === null ? null : adminSeatingErrorMessage(detailQ.error)}
        isEmpty={false}
        emptyLabel=""
      >
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
          {t("adminEventSeating.workspace.back")}
        </Button>
      </AdminCatalogListState>
    );
  }

  const map = detail.map;
  const selectedSeats = detail.seats.filter((seat) => selected.has(seat.id));
  const selectedOccupied = selectedSeats.filter((seat) => occupantBySeat.has(seat.id)).length;
  const categoryName = (category: SeatCategory) =>
    pickLocalized({ name_pl: category.namePl, name_en: category.nameEn }, "name", lang);
  const ticketOptions = (ticketsQ.data ?? []).map((ticket) => ({
    id: ticket.id,
    label: pickLocalized(ticket, "name", lang),
  }));
  const companies = new Map<string, string>();
  for (const seat of detail.seats) {
    if (seat.holdCompanyId !== null && seat.holdCompanyName !== null) {
      companies.set(seat.holdCompanyId, seat.holdCompanyName);
    }
  }
  for (const assignment of detail.assignments) {
    if (assignment.companyId !== null && assignment.company !== null) {
      companies.set(assignment.companyId, assignment.company);
    }
  }
  const exportCompanies: SeatExportCompany[] = [...companies.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const seatsBySection = (section: SeatSection) =>
    detail.seats.filter((seat) => seat.sectionId === section.id).length;
  const busy = updateSeats.isPending || release.isPending || assign.isPending;

  const togglePublish = async () => {
    const publishing = map.status === "draft";
    const ok = await confirmDialog({
      title: t(
        publishing
          ? "adminEventSeating.workspace.publishTitle"
          : "adminEventSeating.workspace.unpublishTitle",
      ),
      description: t(
        publishing
          ? "adminEventSeating.workspace.publishBody"
          : "adminEventSeating.workspace.unpublishBody",
      ),
      confirmLabel: t(
        publishing
          ? "adminEventSeating.workspace.publishConfirm"
          : "adminEventSeating.workspace.unpublishConfirm",
      ),
      cancelLabel: t("adminEventSeating.workspace.cancel"),
    });
    if (!ok) return;
    try {
      await saveMap.mutateAsync({ id: map.id, status: publishing ? "published" : "draft" });
      toast.success(
        t(
          publishing
            ? "adminEventSeating.toasts.published"
            : "adminEventSeating.toasts.unpublished",
        ),
      );
    } catch (error: unknown) {
      toast.error(adminSeatingErrorMessage(error));
    }
  };

  const removeSection = async (section: SeatSection) => {
    const ok = await confirmDialog({
      title: t("adminEventSeating.workspace.deleteSectionTitle", { label: section.label }),
      description: t("adminEventSeating.workspace.deleteSectionBody"),
      confirmLabel: t("adminEventSeating.workspace.deleteConfirm"),
      cancelLabel: t("adminEventSeating.workspace.cancel"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteSection.mutateAsync(section.id);
      setSelected(new Set());
      toast.success(t("adminEventSeating.toasts.sectionDeleted"));
    } catch (error: unknown) {
      toast.error(adminSeatingErrorMessage(error));
    }
  };

  const removeCategory = async (category: SeatCategory) => {
    const ok = await confirmDialog({
      title: t("adminEventSeating.workspace.deleteCategoryTitle", { name: categoryName(category) }),
      description: t("adminEventSeating.workspace.deleteCategoryBody"),
      confirmLabel: t("adminEventSeating.workspace.deleteConfirm"),
      cancelLabel: t("adminEventSeating.workspace.cancel"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteCategory.mutateAsync(category.id);
      toast.success(t("adminEventSeating.toasts.categoryDeleted"));
    } catch (error: unknown) {
      toast.error(adminSeatingErrorMessage(error));
    }
  };

  const print = async () => {
    // Okno PRZED `await` - przegladarka wiaze `window.open` z gestem uzytkownika.
    const printWindow = window.open("", "_blank", "width=900,height=700");
    if (printWindow === null) {
      toast.error(t("adminEventSeating.toasts.popupBlocked"));
      return;
    }
    try {
      const rows = seatingCsvRows(await fetchSeatingExport(map.id), "door", lang);
      printWindow.document.write(
        seatPlanPrintHtml(
          rows.map((row) => ({
            seat: exportSeatText(row),
            name: seatingPersonName(row),
            company: row.company ?? "",
            ticket: pickLocalized(row, "ticket_name", lang),
            note: row.hold_note ?? "",
          })),
          {
            lang,
            documentTitle: t("adminEventSeating.print.documentTitle", { name: map.name }),
            eventTitle,
            mapName: map.name,
            columns: {
              seat: t("adminEventSeating.print.seat"),
              name: t("adminEventSeating.print.name"),
              company: t("adminEventSeating.print.company"),
              ticket: t("adminEventSeating.print.ticket"),
              note: t("adminEventSeating.print.note"),
            },
            emptyLabel: t("adminEventSeating.print.empty"),
          },
        ),
      );
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
    } catch (error: unknown) {
      printWindow.close();
      toast.error(adminSeatingErrorMessage(error));
    }
  };

  const holdInitialStatus: SeatStatus =
    selectedSeats.length === 1 ? selectedSeats[0].status : "held";

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="space-y-4">
        <div
          role="toolbar"
          aria-label={t("adminEventSeating.workspace.toolbarLabel")}
          className="flex flex-wrap items-center gap-2"
        >
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
            {t("adminEventSeating.workspace.back")}
          </Button>
          <h2 className="font-display text-lg">{map.name}</h2>
          <Badge variant={map.status === "published" ? "default" : "outline"}>
            {t(
              map.status === "published"
                ? "adminEventSeating.status.published"
                : "adminEventSeating.status.draft",
            )}
          </Badge>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setMapOpen(true)}>
              <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
              {t("adminEventSeating.workspace.editMap")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAutoOpen(true)}>
              <Wand2 className="mr-2 h-4 w-4" aria-hidden="true" />
              {t("adminEventSeating.workspace.autoAssign")}
            </Button>
            <SeatExportMenu
              eventSlug={eventSlug}
              mapId={map.id}
              mapName={map.name}
              companies={exportCompanies}
              seatText={exportSeatText}
            />
            <Button size="sm" variant="outline" onClick={() => void print()}>
              <Printer className="mr-2 h-4 w-4" aria-hidden="true" />
              {t("adminEventSeating.workspace.print")}
            </Button>
            <Button size="sm" onClick={() => void togglePublish()} disabled={saveMap.isPending}>
              {t(
                map.status === "draft"
                  ? "adminEventSeating.workspace.publish"
                  : "adminEventSeating.workspace.unpublish",
              )}
            </Button>
          </div>
        </div>

        {armed === null ? null : (
          <div
            role="status"
            className="flex flex-wrap items-center gap-2 rounded-[6px] border border-brand p-2 text-sm"
          >
            <span>{t("adminEventSeating.workspace.armedHint", { name: armed.name })}</span>
            <Button size="sm" variant="ghost" onClick={() => setArmed(null)}>
              <X className="mr-1 h-4 w-4" aria-hidden="true" />
              {t("adminEventSeating.workspace.disarm")}
            </Button>
          </div>
        )}

        <div className="grid gap-4 xl:grid-cols-[16rem_minmax(0,1fr)_20rem]">
          <aside className="space-y-5">
            <section aria-labelledby="seat-sections-title" className="space-y-2">
              <h3 id="seat-sections-title" className="text-sm font-semibold">
                {t("adminEventSeating.workspace.sections")}
              </h3>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSectionDialog({ section: null, kind: "rows" })}
                >
                  <Rows className="mr-1 h-4 w-4" aria-hidden="true" />
                  {t("adminEventSeating.workspace.addRows")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSectionDialog({ section: null, kind: "table" })}
                >
                  <LayoutGrid className="mr-1 h-4 w-4" aria-hidden="true" />
                  {t("adminEventSeating.workspace.addTable")}
                </Button>
              </div>
              {detail.sections.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("adminEventSeating.workspace.noSections")}
                </p>
              ) : (
                <ul className="space-y-1">
                  {detail.sections.map((section) => (
                    <li
                      key={section.id}
                      className="flex items-center gap-1 rounded-[6px] border border-border px-2 py-1"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{section.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {t("adminEventSeating.workspace.sectionSeats", {
                            count: seatsBySection(section),
                          })}
                        </p>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={t("adminEventSeating.workspace.editSection", {
                          label: section.label,
                        })}
                        onClick={() => setSectionDialog({ section, kind: section.kind })}
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={t("adminEventSeating.workspace.deleteSection", {
                          label: section.label,
                        })}
                        onClick={() => void removeSection(section)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="seat-categories-title" className="space-y-2">
              <h3 id="seat-categories-title" className="text-sm font-semibold">
                {t("adminEventSeating.workspace.categories")}
              </h3>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCategoryDialog({ category: null })}
              >
                <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
                {t("adminEventSeating.workspace.addCategory")}
              </Button>
              {detail.categories.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("adminEventSeating.workspace.noCategories")}
                </p>
              ) : (
                <ul className="space-y-1">
                  {detail.categories.map((category) => (
                    <li
                      key={category.id}
                      className="flex items-center gap-2 rounded-[6px] border border-border px-2 py-1"
                    >
                      <span
                        aria-hidden="true"
                        className="inline-block h-3 w-3 shrink-0 rounded-full border border-border"
                        style={{ backgroundColor: category.color }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{categoryName(category)}</p>
                        <p className="text-xs text-muted-foreground">
                          {category.ticketTypeIds.length === 0
                            ? t("adminEventSeating.workspace.allTickets")
                            : t("adminEventSeating.workspace.categoryTickets", {
                                count: category.ticketTypeIds.length,
                              })}
                        </p>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={t("adminEventSeating.workspace.editCategory", {
                          name: categoryName(category),
                        })}
                        onClick={() => setCategoryDialog({ category })}
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={t("adminEventSeating.workspace.deleteCategory", {
                          name: categoryName(category),
                        })}
                        onClick={() => void removeCategory(category)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <SeatMapLegend
              categories={detail.categories.map((category) => ({
                id: category.id,
                name: categoryName(category),
                color: category.color,
              }))}
            />
          </aside>

          <div className="min-w-0 space-y-3">
            <div
              role="group"
              aria-label={t("adminEventSeating.workspace.viewLabel")}
              className="flex flex-wrap gap-2"
            >
              <Button
                size="sm"
                variant={view === "canvas" ? "default" : "outline"}
                aria-pressed={view === "canvas"}
                onClick={() => setView("canvas")}
              >
                {t("adminEventSeating.workspace.viewCanvas")}
              </Button>
              <Button
                size="sm"
                variant={view === "table" ? "default" : "outline"}
                aria-pressed={view === "table"}
                onClick={() => setView("table")}
              >
                {t("adminEventSeating.workspace.viewTable")}
              </Button>
              {selected.size === 0 ? null : (
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                  {t("adminEventSeating.workspace.clearSelection")}
                </Button>
              )}
            </div>
            {view === "canvas" ? (
              <SeatMapCanvas
                detail={detail}
                selected={selected}
                occupantBySeat={occupantBySeat}
                labelFor={seatAria}
                onActivate={onActivate}
                onRelease={onReleaseOne}
              />
            ) : (
              <SeatMapTable
                detail={detail}
                selected={selected}
                occupantBySeat={occupantBySeat}
                labelFor={seatText}
                canAssign={armed !== null}
                onToggle={onToggle}
                onAssign={(seatId) => onActivate(seatId, false)}
                onRelease={onReleaseOne}
              />
            )}
            <SeatDetailsCard
              seats={selectedSeats}
              detail={detail}
              occupantBySeat={occupantBySeat}
              labelFor={seatText}
              armedName={armed?.name ?? null}
              busy={busy}
              onAssignArmed={(seatId) => onActivate(seatId, false)}
              onRelease={(seatIds) => void releaseSeatIds(seatIds)}
              onEditStatus={() => setHoldOpen(true)}
              onSetAccessible={(seatIds, value) =>
                updateSeats.mutate(
                  { mapId: map.id, seatIds, isAccessible: value },
                  { onError: (error) => toast.error(adminSeatingErrorMessage(error)) },
                )
              }
              onSetCategory={(seatIds, categoryId) =>
                updateSeats.mutate(
                  { mapId: map.id, seatIds, categoryId },
                  { onError: (error) => toast.error(adminSeatingErrorMessage(error)) },
                )
              }
            />
          </div>

          <SeatingAttendeesPanel
            eventId={eventId}
            mapId={map.id}
            tickets={ticketOptions}
            armedId={armed?.id ?? null}
            onArm={(row) =>
              setArmed(row === null ? null : { id: row.registration_id, name: candidateName(row) })
            }
          />
        </div>
      </div>

      <EventSeatMapDialog
        open={mapOpen}
        onOpenChange={setMapOpen}
        eventId={eventId}
        map={map}
        isSaving={saveMap.isPending}
        onSubmit={(input) =>
          saveMap.mutate(input, {
            onSuccess: () => {
              setMapOpen(false);
              toast.success(t("adminEventSeating.toasts.mapSaved"));
            },
            onError: (error) => toast.error(adminSeatingErrorMessage(error)),
          })
        }
      />
      <EventSeatSectionDialog
        open={sectionDialog !== null}
        onOpenChange={(open) => {
          if (!open) setSectionDialog(null);
        }}
        mapId={map.id}
        section={sectionDialog?.section ?? null}
        kind={sectionDialog?.kind ?? "rows"}
        categories={detail.categories}
        isSaving={saveSection.isPending}
        onSubmit={(input) =>
          saveSection.mutate(input, {
            onSuccess: (result) => {
              setSectionDialog(null);
              toast.success(
                t("adminEventSeating.toasts.sectionSaved", {
                  kept: result.seatsKept,
                  created: result.seatsCreated,
                  removed: result.seatsRemoved,
                }),
              );
            },
            onError: (error) => toast.error(adminSeatingErrorMessage(error)),
          })
        }
      />
      <EventSeatCategoryDialog
        open={categoryDialog !== null}
        onOpenChange={(open) => {
          if (!open) setCategoryDialog(null);
        }}
        eventId={eventId}
        category={categoryDialog?.category ?? null}
        isSaving={saveCategory.isPending}
        onSubmit={(input) =>
          saveCategory.mutate(input, {
            onSuccess: () => {
              setCategoryDialog(null);
              toast.success(t("adminEventSeating.toasts.categorySaved"));
            },
            onError: (error) => toast.error(adminSeatingErrorMessage(error)),
          })
        }
      />
      <SeatHoldDialog
        open={holdOpen}
        onOpenChange={setHoldOpen}
        eventId={eventId}
        mapId={map.id}
        seatIds={selectedSeats.map((seat) => seat.id)}
        occupiedCount={selectedOccupied}
        initialStatus={holdInitialStatus}
        isSaving={updateSeats.isPending}
        onSubmit={(input) =>
          updateSeats.mutate(input, {
            onSuccess: (count) => {
              setHoldOpen(false);
              toast.success(t("adminEventSeating.toasts.seatsUpdated", { count }));
            },
            onError: (error) => toast.error(adminSeatingErrorMessage(error)),
          })
        }
      />
      <SeatAutoAssignDialog
        open={autoOpen}
        onOpenChange={setAutoOpen}
        eventId={eventId}
        detail={detail}
      />
    </DndContext>
  );
}
