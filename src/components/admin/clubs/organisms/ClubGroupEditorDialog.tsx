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
//
// KOMPOZYCJA, NIE LOGIKA. Reguły (przepisanie wiersza na wersję roboczą,
// kontrakt pustego stringa w payloadzie, zawężenie widoczności przy zdjęciu
// dziedziczenia, harmonogram <-> `datetime-local`, trzy odmowy kasowania)
// mieszkają w `lib/clubs/adminClubGroupForm`. Powtarzalne wiersze pól -
// w molekułach `ClubDialogTextRow` i `ClubDialogInheritedEnum`. Tutaj zostaje
// SKLEJENIE: stan wersji roboczej, co leci do mutacji i co się dzieje z
// odpowiedzią.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { ClubDialogInheritedEnum } from "../molecules/ClubDialogInheritedEnum";
import { ClubDialogTextRow } from "../molecules/ClubDialogTextRow";
import { ClubEnumSelect } from "@/components/clubs/molecules/ClubEnumSelect";
import { useDeleteClubGroup, useUpsertClubGroup } from "@/lib/clubs/useClubs";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";
import {
  CLUB_GROUP_OVERRIDE_OPTIONS,
  canDeleteClubGroup,
  clubGroupDeleteConfirm,
  clubGroupDeleteErrorKey,
  clubGroupDeleteNotice,
  clubGroupDeletedToast,
  clubGroupHasThreads,
  clubGroupMinTierFromInput,
  clubGroupMoveTargets,
  clubGroupOverridePatch,
  clubGroupSaveBlockKey,
  clubGroupSavePayload,
  clubGroupVisibilityOptions,
  toClubGroupDraft,
  type ClubGroupDraft,
} from "@/lib/clubs/adminClubGroupForm";
import { CLUB_GROUP_STATUSES, type AdminClubGroupRow } from "@/lib/clubs/types";

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

  const [draft, setDraft] = useState<ClubGroupDraft | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [moveTo, setMoveTo] = useState("");

  // Wersja robocza powstaje raz na otwarcie. Zależność po id, nie po całym
  // obiekcie: React Query zwraca nową referencję przy każdym refetchu, a to
  // kasowałoby niezapisane zmiany w otwartym formularzu.
  const groupId = group?.id;
  useEffect(() => {
    setDraft(group ? toClubGroupDraft(group) : null);
    setMoveTo("");
  }, [group, groupId]);

  const patch = (next: Partial<ClubGroupDraft>) =>
    setDraft((prev) => (prev ? { ...prev, ...next } : prev));

  const others = clubGroupMoveTargets(siblings, groupId);
  const hasThreads = clubGroupHasThreads(group?.thread_count);
  const notice = clubGroupDeleteNotice(group?.thread_count);

  // Wiersz i wersja robocza idą W PARZE. Wersja robocza powstaje w efekcie,
  // więc jest jedna klatka po otwarciu, w której działu już jest, a formularza
  // jeszcze nie - i dokładnie w tej klatce nie ma czego zapisać ani skasować.
  // Jedna para zamiast dwóch osobnych sprawdzeń w każdym handlerze: drugie
  // sprawdzenie tej samej rzeczy jest pierwszym, o którym się zapomni.
  const ready = group !== null && draft !== null ? { group, draft } : null;

  const submit = (target: AdminClubGroupRow, current: ClubGroupDraft) => {
    const blockKey = clubGroupSaveBlockKey(current);
    if (blockKey !== null) {
      toast.error(t(blockKey));
      return;
    }
    saveM.mutate(clubGroupSavePayload(current, { id: target.id, clubId }), {
      onSuccess: () => {
        toast.success(t("adminClubs.saved"));
        onOpenChange(false);
      },
      onError: () => toast.error(t("adminClubs.saveFailed")),
    });
  };

  const remove = (target: AdminClubGroupRow) => {
    deleteM.mutate(
      { groupId: target.id, moveToGroupId: moveTo !== "" ? moveTo : null },
      {
        onSuccess: (moved) => {
          const done = clubGroupDeletedToast(moved);
          toast.success(done.count === null ? t(done.key) : t(done.key, { count: done.count }));
          onOpenChange(false);
        },
        // Komunikat rozróżnia dwie realne odmowy RPC: "grupa nie jest pusta"
        // i "to ostatnia grupa". Jedno "nie udało się" zostawiałoby
        // administratora bez następnego kroku.
        onError: (error) => toast.error(t(clubGroupDeleteErrorKey(error))),
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

        {ready === null ? null : (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <ClubDialogTextRow
                id="club-group-name-pl"
                labelKey="adminClubs.fields.namePl"
                value={ready.draft.namePl}
                maxLength={120}
                onValueChange={(namePl) => patch({ namePl })}
              />
              <ClubDialogTextRow
                id="club-group-name-en"
                labelKey="adminClubs.fields.nameEn"
                value={ready.draft.nameEn}
                maxLength={120}
                onValueChange={(nameEn) => patch({ nameEn })}
              />
              <ClubDialogTextRow
                id="club-group-slug"
                labelKey="adminClubs.fields.slug"
                value={ready.draft.slug}
                maxLength={80}
                hintKey="adminClubs.fields.slugHint"
                onValueChange={(slug) => patch({ slug })}
              />
              <ClubEnumSelect
                id="club-group-status"
                label={t("adminClubs.columns.status")}
                value={ready.draft.status}
                options={CLUB_GROUP_STATUSES}
                i18nPrefix="club.groupStatus"
                onChange={(status) => patch({ status })}
                disabled={saveM.isPending}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <ClubDialogTextRow
                id="club-group-desc-pl"
                labelKey="adminClubs.fields.descriptionPl"
                value={ready.draft.descriptionPl}
                rows={3}
                maxLength={2000}
                onValueChange={(descriptionPl) => patch({ descriptionPl })}
              />
              <ClubDialogTextRow
                id="club-group-desc-en"
                labelKey="adminClubs.fields.descriptionEn"
                value={ready.draft.descriptionEn}
                rows={3}
                maxLength={2000}
                onValueChange={(descriptionEn) => patch({ descriptionEn })}
              />
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
                <ClubDialogInheritedEnum
                  labelKey="adminClubs.fields.visibility"
                  i18nPrefix="club.visibility"
                  value={ready.draft.visibility}
                  options={clubGroupVisibilityOptions(ready.draft.visibilityInherit)}
                  inherited={ready.draft.visibilityInherit}
                  disabled={saveM.isPending}
                  onToggleInherit={(inherit) =>
                    patch(clubGroupOverridePatch("visibility", inherit, ready.draft))
                  }
                  onValueChange={(visibility) => patch({ visibility })}
                />

                <ClubDialogInheritedEnum
                  labelKey="adminClubs.fields.whoCanPost"
                  i18nPrefix="club.whoCanPost"
                  value={ready.draft.whoCanPost}
                  options={CLUB_GROUP_OVERRIDE_OPTIONS.whoCanPost}
                  inherited={ready.draft.whoCanPostInherit}
                  disabled={saveM.isPending}
                  onToggleInherit={(inherit) =>
                    patch(clubGroupOverridePatch("whoCanPost", inherit, ready.draft))
                  }
                  onValueChange={(whoCanPost) => patch({ whoCanPost })}
                />

                <ClubDialogInheritedEnum
                  labelKey="adminClubs.fields.moderationMode"
                  i18nPrefix="club.moderation"
                  value={ready.draft.moderationMode}
                  options={CLUB_GROUP_OVERRIDE_OPTIONS.moderationMode}
                  inherited={ready.draft.moderationModeInherit}
                  disabled={saveM.isPending}
                  onToggleInherit={(inherit) =>
                    patch(clubGroupOverridePatch("moderationMode", inherit, ready.draft))
                  }
                  onValueChange={(moderationMode) => patch({ moderationMode })}
                />

                <ClubDialogInheritedEnum
                  labelKey="adminClubs.fields.attributionMode"
                  i18nPrefix="club.attribution"
                  value={ready.draft.attributionMode}
                  options={CLUB_GROUP_OVERRIDE_OPTIONS.attributionMode}
                  inherited={ready.draft.attributionModeInherit}
                  disabled={saveM.isPending}
                  onToggleInherit={(inherit) =>
                    patch(clubGroupOverridePatch("attributionMode", inherit, ready.draft))
                  }
                  onValueChange={(attributionMode) => patch({ attributionMode })}
                />

                {/* Próg planu jest LICZBĄ, nie słownikiem - jedyne pole tej
                    sekcji, które nie ma dropListy. */}
                <InheritedField
                  label={t("adminClubs.fields.minTierRank")}
                  inherited={ready.draft.minTierRankInherit}
                  onToggleInherit={(inherit) =>
                    patch(clubGroupOverridePatch("minTierRank", inherit, ready.draft))
                  }
                  disabled={saveM.isPending}
                >
                  <Input
                    type="number"
                    min={0}
                    max={10}
                    value={ready.draft.minTierRank}
                    disabled={saveM.isPending || ready.draft.minTierRankInherit}
                    onChange={(e) =>
                      patch({ minTierRank: clubGroupMinTierFromInput(e.target.value) })
                    }
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
                <ClubDialogTextRow
                  id="club-group-opens"
                  labelKey="adminClubs.groups.opensAt"
                  type="datetime-local"
                  value={ready.draft.opensAt}
                  onValueChange={(opensAt) => patch({ opensAt })}
                />
                <ClubDialogTextRow
                  id="club-group-closes"
                  labelKey="adminClubs.groups.closesAt"
                  type="datetime-local"
                  value={ready.draft.closesAt}
                  onValueChange={(closesAt) => patch({ closesAt })}
                />
              </div>
            </div>

            {/* --- kasowanie --- */}
            <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-sm font-medium text-destructive">
                {t("adminClubs.groups.deleteTitle")}
              </p>
              <p className="text-xs text-muted-foreground">
                {notice.count === null ? t(notice.key) : t(notice.key, { count: notice.count })}
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
                disabled={
                  !canDeleteClubGroup({
                    isPending: deleteM.isPending,
                    targetCount: others.length,
                    hasThreads,
                    moveTo,
                  })
                }
                onClick={() => {
                  const ask = clubGroupDeleteConfirm(hasThreads);
                  setConfirm({
                    title: t(ask.titleKey),
                    description: t(ask.descriptionKey),
                    destructive: true,
                    onConfirm: () => remove(ready.group),
                  });
                }}
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
          <Button
            onClick={ready === null ? undefined : () => submit(ready.group, ready.draft)}
            disabled={saveM.isPending || ready === null}
          >
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
      <ConfirmDialog state={confirm} onOpenChange={(open) => !open && setConfirm(null)} />
    </Dialog>
  );
}
