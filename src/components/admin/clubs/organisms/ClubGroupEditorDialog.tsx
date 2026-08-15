// Organizm: edytor grupy klubu.
//
// Do tej pory `admin_club_group_upsert` przyjmowało piętnaście pól, a panel
// wysyłał cztery przy zakładaniu i nic potem: grupa raz założona zostawała
// w wersji roboczej z nazwą "Nowa grupa" na zawsze. Cała warstwa dziedziczenia
// (widoczność, kto zakłada temat, moderacja, próg planu, tryb autorstwa) i cały
// harmonogram istniały wyłącznie w bazie.
//
// Dziedziczenie jest tu PIERWSZOKLASOWE, nie ukryte za pustym stringiem:
// przełącznik "dziedzicz / nadpisz" pokazuje, skąd bierze się wartość, zanim
// administrator ją zmieni. Wysyłka pustego stringa (a nie null) to wymóg RPC -
// Radix Select nie potrafi przechować wartości null, więc kontrakt migracji
// przyjmuje "" jako "dziedzicz".
//
// RESPONSYWNOŚĆ: jedna kolumna do sm, dwie wyżej. Dialog scrolluje się w
// pionie, bo na telefonie piętnaście pól nie mieści się na ekranie i obcięty
// przycisk zapisu jest gorszy niż scroll.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog, type ConfirmState } from "@/components/admin/ConfirmDialog";
import { InheritedField } from "../atoms/InheritedField";
import { ClubEnumSelect } from "@/components/clubs/molecules/ClubEnumSelect";
import { useDeleteClubGroup, useUpsertClubGroup } from "@/lib/clubs/useClubs";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";
import {
  CLUB_ATTRIBUTION_MODES,
  CLUB_GROUP_STATUSES,
  CLUB_GROUP_VISIBILITIES,
  CLUB_MODERATION_MODES,
  CLUB_POST_POLICIES,
  CLUB_VISIBILITIES,
  toClubGroupVisibility,
  toGroupSettings,
  type AdminClubGroupRow,
  type ClubAttributionMode,
  type ClubGroupStatus,
  type ClubModerationMode,
  type ClubPostPolicy,
  type ClubVisibility,
} from "@/lib/clubs/types";

/** Wersja robocza formularza. Pole `*Inherit` steruje tym, czy wartość w ogóle
 *  poleci do RPC - dziedziczenie wysyła pusty string, nie wartość. */
interface GroupDraft {
  slug: string;
  namePl: string;
  nameEn: string;
  descriptionPl: string;
  descriptionEn: string;
  status: ClubGroupStatus;
  visibility: ClubVisibility;
  visibilityInherit: boolean;
  whoCanPost: ClubPostPolicy;
  whoCanPostInherit: boolean;
  moderationMode: ClubModerationMode;
  moderationModeInherit: boolean;
  attributionMode: ClubAttributionMode;
  attributionModeInherit: boolean;
  minTierRank: number;
  minTierRankInherit: boolean;
  opensAt: string;
  closesAt: string;
}

function narrow<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** timestamptz z bazy -> wartość dla `<input type="datetime-local">`.
 *  Ucinamy strefę i sekundy: pole HTML nie umie ich pokazać, a wysłanie
 *  pełnego ISO z powrotem i tak nastąpi dopiero po edycji. */
function toLocalInput(value: string | null): string {
  if (value === null || value === "") return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

function fromLocalInput(value: string): string | null {
  if (value.trim() === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toDraft(group: AdminClubGroupRow): GroupDraft {
  const settings = toGroupSettings(group);
  return {
    slug: group.slug,
    namePl: group.name_pl,
    nameEn: group.name_en,
    descriptionPl: group.description_pl ?? "",
    descriptionEn: group.description_en ?? "",
    status: narrow<ClubGroupStatus>(group.status, CLUB_GROUP_STATUSES, "draft"),
    visibility: settings.visibility.value,
    visibilityInherit: settings.visibility.inherited,
    whoCanPost: settings.whoCanPost.value,
    whoCanPostInherit: settings.whoCanPost.inherited,
    moderationMode: settings.moderationMode.value,
    moderationModeInherit: settings.moderationMode.inherited,
    attributionMode: settings.attributionMode.value,
    attributionModeInherit: settings.attributionMode.inherited,
    minTierRank: settings.minTierRank.value,
    minTierRankInherit: settings.minTierRank.inherited,
    opensAt: toLocalInput(group.opens_at),
    closesAt: toLocalInput(group.closes_at),
  };
}

export function ClubGroupEditorDialog({
  clubId,
  group,
  siblings,
  onOpenChange,
}: {
  clubId: string;
  group: AdminClubGroupRow | null;
  /** Pozostałe grupy klubu - cel przeniesienia wątków przy kasowaniu. */
  siblings: readonly AdminClubGroupRow[];
  onOpenChange: (open: boolean) => void;
}) {
  ensureAdminClubsI18n();
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const saveM = useUpsertClubGroup(clubId);
  const deleteM = useDeleteClubGroup(clubId);

  const [draft, setDraft] = useState<GroupDraft | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [moveTo, setMoveTo] = useState("");

  // Wersja robocza powstaje raz na otwarcie. Zależność po id, nie po całym
  // obiekcie: React Query zwraca nową referencję przy każdym refetchu, a to
  // kasowałoby niezapisane zmiany w otwartym formularzu.
  const groupId = group?.id;
  useEffect(() => {
    setDraft(group ? toDraft(group) : null);
    setMoveTo("");
  }, [group, groupId]);

  const patch = (next: Partial<GroupDraft>) =>
    setDraft((prev) => (prev ? { ...prev, ...next } : prev));

  const others = siblings.filter((g) => g.id !== groupId);
  const hasThreads = (group?.thread_count ?? 0) > 0;

  const submit = () => {
    if (!draft || !group) return;
    if (draft.slug.trim() === "" || draft.namePl.trim() === "") {
      toast.error(t("adminClubs.requiredFields"));
      return;
    }
    saveM.mutate(
      {
        id: group.id,
        club_id: clubId,
        slug: draft.slug.trim(),
        name_pl: draft.namePl.trim(),
        name_en: draft.nameEn.trim() !== "" ? draft.nameEn.trim() : draft.namePl.trim(),
        description_pl: draft.descriptionPl.trim() || null,
        description_en: draft.descriptionEn.trim() || null,
        status: draft.status,
        // Pusty string = "dziedzicz z klubu". To kontrakt RPC, nie skrót:
        // migracja jawnie traktuje '' tak samo jak NULL.
        visibility: draft.visibilityInherit ? "" : draft.visibility,
        who_can_post: draft.whoCanPostInherit ? "" : draft.whoCanPost,
        moderation_mode: draft.moderationModeInherit ? "" : draft.moderationMode,
        attribution_mode: draft.attributionModeInherit ? "" : draft.attributionMode,
        min_tier_rank: draft.minTierRankInherit ? null : draft.minTierRank,
        opens_at: fromLocalInput(draft.opensAt),
        closes_at: fromLocalInput(draft.closesAt),
      },
      {
        onSuccess: () => {
          toast.success(t("adminClubs.saved"));
          onOpenChange(false);
        },
        onError: () => toast.error(t("adminClubs.saveFailed")),
      },
    );
  };

  const remove = () => {
    if (!group) return;
    deleteM.mutate(
      { groupId: group.id, moveToGroupId: moveTo !== "" ? moveTo : null },
      {
        onSuccess: (moved) => {
          toast.success(
            moved > 0
              ? t("adminClubs.groups.deletedWithMove", { count: moved })
              : t("adminClubs.groups.deleted"),
          );
          onOpenChange(false);
        },
        // Komunikat rozróżnia dwie realne odmowy RPC: "grupa nie jest pusta"
        // i "to ostatnia grupa". Jedno "nie udało się" zostawiałoby
        // administratora bez następnego kroku.
        onError: (error) => {
          const message = error instanceof Error ? error.message : "";
          if (message.includes("group not empty")) {
            toast.error(t("adminClubs.groups.deleteNeedsTarget"));
          } else if (message.includes("last group")) {
            toast.error(t("adminClubs.groups.deleteLast"));
          } else {
            toast.error(t("adminClubs.saveFailed"));
          }
        },
      },
    );
  };

  return (
    <Dialog open={group !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-left">{t("adminClubs.groups.editTitle")}</DialogTitle>
          <DialogDescription className="text-left">
            {t("adminClubs.groups.editHint")}
          </DialogDescription>
        </DialogHeader>

        {draft === null ? null : (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="club-group-name-pl">{t("adminClubs.fields.namePl")}</Label>
                <Input
                  id="club-group-name-pl"
                  value={draft.namePl}
                  maxLength={120}
                  onChange={(e) => patch({ namePl: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="club-group-name-en">{t("adminClubs.fields.nameEn")}</Label>
                <Input
                  id="club-group-name-en"
                  value={draft.nameEn}
                  maxLength={120}
                  onChange={(e) => patch({ nameEn: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="club-group-slug">{t("adminClubs.fields.slug")}</Label>
                <Input
                  id="club-group-slug"
                  value={draft.slug}
                  maxLength={80}
                  onChange={(e) => patch({ slug: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">{t("adminClubs.fields.slugHint")}</p>
              </div>
              <ClubEnumSelect
                id="club-group-status"
                label={t("adminClubs.columns.status")}
                value={draft.status}
                options={CLUB_GROUP_STATUSES}
                i18nPrefix="club.groupStatus"
                onChange={(status) => patch({ status })}
                disabled={saveM.isPending}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="club-group-desc-pl">{t("adminClubs.fields.descriptionPl")}</Label>
                <Textarea
                  id="club-group-desc-pl"
                  rows={3}
                  maxLength={2000}
                  value={draft.descriptionPl}
                  onChange={(e) => patch({ descriptionPl: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="club-group-desc-en">{t("adminClubs.fields.descriptionEn")}</Label>
                <Textarea
                  id="club-group-desc-en"
                  rows={3}
                  maxLength={2000}
                  value={draft.descriptionEn}
                  onChange={(e) => patch({ descriptionEn: e.target.value })}
                />
              </div>
            </div>

            {/* --- ustawienia dziedziczone z klubu --- */}
            <div className="space-y-4 rounded-lg border border-border/60 p-3">
              <p className="text-sm font-medium">{t("adminClubs.groups.overridesTitle")}</p>
              <p className="-mt-3 text-xs text-muted-foreground">
                {t("adminClubs.groups.overridesHint")}
              </p>

              <div className="grid gap-4 sm:grid-cols-2">
                {/* Dwa różne słowniki dla jednego pola, bo to dwie różne role.
                    Przy dziedziczeniu pokazujemy wartość EFEKTYWNĄ, a ta w
                    klubie publicznym bywa 'public' - droplista musi umieć ją
                    wyrenderować (jest wtedy i tak wyłączona, więc nic z niej
                    nie poleci do bazy). Przy nadpisaniu obowiązuje CHECK
                    `club_groups.visibility`, który 'public' odrzuca: dział nie
                    może być bardziej otwarty niż klub. Stąd sprowadzenie
                    wartości w momencie zdjęcia dziedziczenia - inaczej
                    administrator zapisywałby wybór, który baza odbija. */}
                <InheritedField
                  label={t("adminClubs.fields.visibility")}
                  inherited={draft.visibilityInherit}
                  onToggleInherit={(inherit) =>
                    patch(
                      inherit
                        ? { visibilityInherit: true }
                        : {
                            visibilityInherit: false,
                            visibility: toClubGroupVisibility(draft.visibility),
                          },
                    )
                  }
                  disabled={saveM.isPending}
                >
                  <ClubEnumSelect
                    value={draft.visibility}
                    options={draft.visibilityInherit ? CLUB_VISIBILITIES : CLUB_GROUP_VISIBILITIES}
                    i18nPrefix="club.visibility"
                    onChange={(visibility) => patch({ visibility })}
                    disabled={saveM.isPending || draft.visibilityInherit}
                  />
                </InheritedField>

                <InheritedField
                  label={t("adminClubs.fields.whoCanPost")}
                  inherited={draft.whoCanPostInherit}
                  onToggleInherit={(inherit) => patch({ whoCanPostInherit: inherit })}
                  disabled={saveM.isPending}
                >
                  <ClubEnumSelect
                    value={draft.whoCanPost}
                    options={CLUB_POST_POLICIES}
                    i18nPrefix="club.whoCanPost"
                    onChange={(whoCanPost) => patch({ whoCanPost })}
                    disabled={saveM.isPending || draft.whoCanPostInherit}
                  />
                </InheritedField>

                <InheritedField
                  label={t("adminClubs.fields.moderationMode")}
                  inherited={draft.moderationModeInherit}
                  onToggleInherit={(inherit) => patch({ moderationModeInherit: inherit })}
                  disabled={saveM.isPending}
                >
                  <ClubEnumSelect
                    value={draft.moderationMode}
                    options={CLUB_MODERATION_MODES}
                    i18nPrefix="club.moderation"
                    onChange={(moderationMode) => patch({ moderationMode })}
                    disabled={saveM.isPending || draft.moderationModeInherit}
                  />
                </InheritedField>

                <InheritedField
                  label={t("adminClubs.fields.attributionMode")}
                  inherited={draft.attributionModeInherit}
                  onToggleInherit={(inherit) => patch({ attributionModeInherit: inherit })}
                  disabled={saveM.isPending}
                >
                  <ClubEnumSelect
                    value={draft.attributionMode}
                    options={CLUB_ATTRIBUTION_MODES}
                    i18nPrefix="club.attribution"
                    onChange={(attributionMode) => patch({ attributionMode })}
                    disabled={saveM.isPending || draft.attributionModeInherit}
                  />
                </InheritedField>

                <InheritedField
                  label={t("adminClubs.fields.minTierRank")}
                  inherited={draft.minTierRankInherit}
                  onToggleInherit={(inherit) => patch({ minTierRankInherit: inherit })}
                  disabled={saveM.isPending}
                >
                  <Input
                    type="number"
                    min={0}
                    max={10}
                    value={draft.minTierRank}
                    disabled={saveM.isPending || draft.minTierRankInherit}
                    onChange={(e) => patch({ minTierRank: Number(e.target.value) || 0 })}
                  />
                </InheritedField>
              </div>
            </div>

            {/* --- harmonogram --- */}
            <div className="space-y-3 rounded-lg border border-border/60 p-3">
              <p className="text-sm font-medium">{t("adminClubs.groups.scheduleTitle")}</p>
              <p className="-mt-2 text-xs text-muted-foreground">
                {t("adminClubs.groups.scheduleHint")}
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="club-group-opens">{t("adminClubs.groups.opensAt")}</Label>
                  <Input
                    id="club-group-opens"
                    type="datetime-local"
                    value={draft.opensAt}
                    onChange={(e) => patch({ opensAt: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="club-group-closes">{t("adminClubs.groups.closesAt")}</Label>
                  <Input
                    id="club-group-closes"
                    type="datetime-local"
                    value={draft.closesAt}
                    onChange={(e) => patch({ closesAt: e.target.value })}
                  />
                </div>
              </div>
            </div>

            {/* --- kasowanie --- */}
            <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-sm font-medium text-destructive">
                {t("adminClubs.groups.deleteTitle")}
              </p>
              <p className="text-xs text-muted-foreground">
                {hasThreads
                  ? t("adminClubs.groups.deleteWithThreads", { count: group?.thread_count ?? 0 })
                  : t("adminClubs.groups.deleteEmpty")}
              </p>
              {hasThreads ? (
                <Select value={moveTo} onValueChange={setMoveTo}>
                  <SelectTrigger aria-label={t("adminClubs.groups.moveTarget")}>
                    <SelectValue placeholder={t("adminClubs.groups.moveTarget")} />
                  </SelectTrigger>
                  <SelectContent>
                    {others.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {pickLocalized(g, "name", lang)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                className="text-destructive"
                // Grupa z wątkami bez wskazanego celu = pewna odmowa RPC.
                // Blokujemy przycisk zamiast pozwolić kliknąć i pokazać błąd.
                disabled={deleteM.isPending || others.length === 0 || (hasThreads && moveTo === "")}
                onClick={() =>
                  setConfirm({
                    title: t("adminClubs.groups.deleteConfirmTitle"),
                    description: hasThreads
                      ? t("adminClubs.groups.deleteConfirmMove")
                      : t("adminClubs.groups.deleteConfirmBody"),
                    destructive: true,
                    onConfirm: remove,
                  })
                }
              >
                <Trash2 className="mr-1.5 h-4 w-4" />
                {t("adminClubs.groups.delete")}
              </Button>
              {others.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("adminClubs.groups.deleteLast")}</p>
              ) : null}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={saveM.isPending || draft === null}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
      <ConfirmDialog state={confirm} onOpenChange={(open) => !open && setConfirm(null)} />
    </Dialog>
  );
}
