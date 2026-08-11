// Organizm: zarządzanie katalogiem specjalizacji klubów dyskusyjnych.
//
// Specjalizacja to najwyższy poziom taksonomii: to ona ma własną stronę
// publiczną (/club/specialization/<slug>) i to po niej zarówno anonim, jak
// i członek wchodzi do katalogu klubów. Dlatego formularz pyta o komplet
// tekstów PL/EN (nazwa, zajawka na kafel, opis na stronę), a nie tylko
// o etykietę - niedokończony wpis wygląda na stronie jak brak treści.
//
// Wyłączenie jest osobne od usunięcia z premedytacją: specjalizacja
// przypisana do klubów nie może zniknąć, bo osierociłaby te kluby (nie
// pokazałaby ich żadna strona). Kasowanie działa tylko przy zerowym użyciu.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useAdminClubSpecializations,
  useDeleteClubSpecialization,
  useSetClubSpecializationActive,
  useUpsertClubSpecialization,
} from "@/lib/clubs/useClubSpecializations";
import type { ClubSpecializationAdminRow } from "@/lib/clubs/specializationsApi";
import {
  CLUB_SPECIALIZATION_ICON_NAMES,
  resolveSpecializationIcon,
} from "@/lib/clubs/specializations";
import { clubSlugFromName } from "@/lib/clubs/types";

interface DraftState {
  id: string | null;
  slug: string;
  labelPl: string;
  labelEn: string;
  leadPl: string;
  leadEn: string;
  descPl: string;
  descEn: string;
  icon: string;
  sortOrder: number;
  isActive: boolean;
  isSystem: boolean;
}

const EMPTY_DRAFT: DraftState = {
  id: null,
  slug: "",
  labelPl: "",
  labelEn: "",
  leadPl: "",
  leadEn: "",
  descPl: "",
  descEn: "",
  icon: "Globe2",
  sortOrder: 100,
  isActive: true,
  isSystem: false,
};

function toDraft(row: ClubSpecializationAdminRow): DraftState {
  return {
    id: row.id,
    slug: row.slug,
    labelPl: row.label_pl,
    labelEn: row.label_en,
    leadPl: row.lead_pl ?? "",
    leadEn: row.lead_en ?? "",
    descPl: row.desc_pl ?? "",
    descEn: row.desc_en ?? "",
    icon: row.icon,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    isSystem: row.is_system,
  };
}

export function ClubSpecializationsManager() {
  const { t } = useTranslation();
  const listQ = useAdminClubSpecializations();
  const upsert = useUpsertClubSpecialization();
  const setActive = useSetClubSpecializationActive();
  const remove = useDeleteClubSpecialization();

  const [draft, setDraft] = useState<DraftState | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ClubSpecializationAdminRow | null>(null);

  const rows = useMemo(() => listQ.data ?? [], [listQ.data]);
  const activeCount = rows.filter((r) => r.is_active).length;

  const openCreate = () => {
    setSlugTouched(false);
    setDraft({ ...EMPTY_DRAFT, sortOrder: (rows.at(-1)?.sort_order ?? 90) + 10 });
  };

  const save = () => {
    if (draft === null) return;
    const slug = draft.id === null ? clubSlugFromName(draft.slug) : draft.slug;
    if (draft.labelPl.trim().length < 2 || draft.labelEn.trim().length < 2) {
      toast.error(t("adminClubs.specializations.errors.labels"));
      return;
    }
    if (draft.id === null && slug.length < 3) {
      toast.error(t("adminClubs.specializations.errors.slug"));
      return;
    }
    upsert.mutate(
      {
        id: draft.id,
        slug,
        key: slug,
        labelPl: draft.labelPl.trim(),
        labelEn: draft.labelEn.trim(),
        leadPl: draft.leadPl.trim(),
        leadEn: draft.leadEn.trim(),
        descPl: draft.descPl.trim(),
        descEn: draft.descEn.trim(),
        icon: draft.icon,
        sortOrder: draft.sortOrder,
        isActive: draft.isActive,
      },
      {
        onSuccess: () => {
          toast.success(t("adminClubs.specializations.saved"));
          setDraft(null);
        },
        onError: (error) => {
          const message = error.message.includes("duplicate key")
            ? t("adminClubs.specializations.errors.duplicate")
            : error.message;
          toast.error(message);
        },
      },
    );
  };

  const confirmDelete = () => {
    if (pendingDelete === null) return;
    remove.mutate(pendingDelete.id, {
      onSuccess: () => {
        toast.success(t("adminClubs.specializations.deleted"));
        setPendingDelete(null);
      },
      onError: (error) => {
        const message = error.message.includes("in_use")
          ? t("adminClubs.specializations.errors.inUse")
          : error.message;
        toast.error(message);
      },
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("adminClubs.specializations.title")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("adminClubs.specializations.subtitle")}
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-1.5 h-4 w-4" />
          {t("adminClubs.specializations.add")}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        {t("adminClubs.specializations.activeSummary", {
          active: activeCount,
          total: rows.length,
        })}
      </p>

      {listQ.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {t("adminClubs.specializations.loading")}
        </div>
      ) : listQ.isError ? (
        <p className="text-sm text-destructive">{listQ.error.message}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("adminClubs.specializations.empty")}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => {
            const Icon = resolveSpecializationIcon(row.icon);
            return (
              <li key={row.id}>
                <Card className={row.is_active ? "" : "opacity-70"}>
                  <CardContent className="flex flex-wrap items-center gap-3 p-3 sm:p-4">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/60">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{row.label_pl}</span>
                        <span className="text-xs text-muted-foreground">/ {row.label_en}</span>
                        {row.is_system ? (
                          <Badge variant="outline" className="text-[10px]">
                            {t("adminClubs.specializations.system")}
                          </Badge>
                        ) : null}
                        {!row.is_active ? (
                          <Badge variant="secondary" className="text-[10px]">
                            {t("adminClubs.specializations.disabled")}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        <span className="font-mono">{row.slug}</span> ·{" "}
                        {t("adminClubs.specializations.usage", { clubs: row.clubs_count })} ·{" "}
                        {t("adminClubs.specializations.order")}: {row.sort_order}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <Button
                        asChild
                        variant="ghost"
                        size="icon"
                        aria-label={t("adminClubs.specializations.preview")}
                      >
                        <Link
                          to="/club/specialization/$slug"
                          params={{ slug: row.slug }}
                          target="_blank"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Link>
                      </Button>
                      <Switch
                        checked={row.is_active}
                        disabled={setActive.isPending}
                        aria-label={t("adminClubs.specializations.toggleAria", {
                          name: row.label_pl,
                        })}
                        onCheckedChange={(checked) =>
                          setActive.mutate(
                            { id: row.id, isActive: checked },
                            { onError: (error) => toast.error(error.message) },
                          )
                        }
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("adminClubs.specializations.edit")}
                        onClick={() => {
                          setSlugTouched(true);
                          setDraft(toDraft(row));
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("adminClubs.specializations.delete")}
                        disabled={row.is_system || row.clubs_count > 0}
                        onClick={() => setPendingDelete(row)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={draft !== null} onOpenChange={(open) => (open ? null : setDraft(null))}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {draft?.id === null
                ? t("adminClubs.specializations.dialogCreate")
                : t("adminClubs.specializations.dialogEdit")}
            </DialogTitle>
            <DialogDescription>{t("adminClubs.specializations.dialogHint")}</DialogDescription>
          </DialogHeader>

          {draft !== null ? (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="spec-label-pl">
                    {t("adminClubs.specializations.labelPl")}
                  </Label>
                  <Input
                    id="spec-label-pl"
                    value={draft.labelPl}
                    onChange={(e) => {
                      const labelPl = e.target.value;
                      setDraft({
                        ...draft,
                        labelPl,
                        slug: slugTouched ? draft.slug : clubSlugFromName(labelPl),
                      });
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="spec-label-en">
                    {t("adminClubs.specializations.labelEn")}
                  </Label>
                  <Input
                    id="spec-label-en"
                    value={draft.labelEn}
                    onChange={(e) => setDraft({ ...draft, labelEn: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="spec-lead-pl">{t("adminClubs.specializations.leadPl")}</Label>
                  <Textarea
                    id="spec-lead-pl"
                    rows={2}
                    value={draft.leadPl}
                    onChange={(e) => setDraft({ ...draft, leadPl: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="spec-lead-en">{t("adminClubs.specializations.leadEn")}</Label>
                  <Textarea
                    id="spec-lead-en"
                    rows={2}
                    value={draft.leadEn}
                    onChange={(e) => setDraft({ ...draft, leadEn: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="spec-desc-pl">{t("adminClubs.specializations.descPl")}</Label>
                  <Textarea
                    id="spec-desc-pl"
                    rows={3}
                    value={draft.descPl}
                    onChange={(e) => setDraft({ ...draft, descPl: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="spec-desc-en">{t("adminClubs.specializations.descEn")}</Label>
                  <Textarea
                    id="spec-desc-en"
                    rows={3}
                    value={draft.descEn}
                    onChange={(e) => setDraft({ ...draft, descEn: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="spec-slug">{t("adminClubs.specializations.slug")}</Label>
                  <Input
                    id="spec-slug"
                    value={draft.slug}
                    onChange={(e) => {
                      setSlugTouched(true);
                      setDraft({ ...draft, slug: clubSlugFromName(e.target.value) });
                    }}
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="spec-icon">{t("adminClubs.specializations.icon")}</Label>
                  <Select
                    value={draft.icon}
                    onValueChange={(icon) => setDraft({ ...draft, icon })}
                  >
                    <SelectTrigger id="spec-icon">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CLUB_SPECIALIZATION_ICON_NAMES.map((name) => {
                        const Icon = resolveSpecializationIcon(name);
                        return (
                          <SelectItem key={name} value={name}>
                            <span className="flex items-center gap-2">
                              <Icon className="h-4 w-4" aria-hidden="true" />
                              {name}
                            </span>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="spec-order">{t("adminClubs.specializations.order")}</Label>
                  <Input
                    id="spec-order"
                    type="number"
                    value={String(draft.sortOrder)}
                    onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) || 0 })}
                  />
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                {t("adminClubs.specializations.slugHint")}
              </p>

              <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
                <Label htmlFor="spec-active" className="text-sm">
                  {t("adminClubs.specializations.activeLabel")}
                </Label>
                <Switch
                  id="spec-active"
                  checked={draft.isActive}
                  onCheckedChange={(checked) => setDraft({ ...draft, isActive: checked })}
                />
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              {t("adminClubs.specializations.cancel")}
            </Button>
            <Button onClick={save} disabled={upsert.isPending}>
              {upsert.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              {t("adminClubs.specializations.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => (open ? null : setPendingDelete(null))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("adminClubs.specializations.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("adminClubs.specializations.deleteBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("adminClubs.specializations.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={remove.isPending}>
              {t("adminClubs.specializations.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
