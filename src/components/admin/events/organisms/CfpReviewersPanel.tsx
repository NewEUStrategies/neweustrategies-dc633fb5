// Organizm: „Recenzenci" - konta, które oceniają zgłoszenia naboru.
//
// RECENZENT TO KONTO W ORGANIZACJI, nie adres e-mail. Ocena trafia do panelu
// recenzenta na stronie wydarzenia, a baza sprawdza członkostwo przy każdym
// odczycie kolejki - dlatego dodajemy konta wyszukiwarką członków, a nie
// wklejamy adresów (zaproszenia osób spoza systemu są poza zakresem v1).
//
// ZAKRES ŚCIEŻEK JEST OPCJONALNY. Brak zaznaczenia = wszystkie ścieżki; wybór
// zawęża kolejkę recenzenta do zgłoszeń z tych ścieżek.
//
// „WIDZI PRELEGENTÓW" DZIAŁA TYLKO PRZY OCENIE W CIEMNO. Bez niej wszyscy
// widzą dane prelegentów, więc przełącznik mówi to w podpowiedzi.
//
// USUNIĘCIE RECENZENTA Z OCENAMI GO WYŁĄCZA, NIE KASUJE. Oceny są częścią
// historii decyzji; baza odpowiada `deactivated` i ekran mówi to wprost.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MemberPicker } from "@/components/admin/community/MemberPicker";
import { AdminCatalogListState } from "@/components/admin/molecules/AdminCatalogListState";
import { confirmDialog } from "@/lib/appDialogs";
import { adminCfpErrorMessage } from "@/lib/events/adminCfpErrors";
import type { CfpReviewerInput, CfpReviewerRow } from "@/lib/events/cfpApi";
import { localizedPair } from "@/lib/events/cfpEnums";
import { toggleId } from "@/lib/events/cfpSettingsDraft";
import type { CfpTrackOption } from "@/lib/events/cfpSurface";
import {
  useCfpReviewers,
  useCfpSettings,
  useRemoveCfpReviewer,
  useSetCfpReviewer,
} from "@/lib/events/useEventCfp";
import { uiLang } from "@/lib/i18n/format";
import { ensureAdminEventCfpI18n } from "@/lib/i18n-admin-event-cfp";

export function CfpReviewersPanel({ eventId }: { eventId: string }) {
  ensureAdminEventCfpI18n();
  const { t } = useTranslation();
  const reviewersQ = useCfpReviewers(eventId);
  const settingsQ = useCfpSettings(eventId);
  const setReviewer = useSetCfpReviewer(eventId);
  const removeReviewer = useRemoveCfpReviewer(eventId);
  const [picked, setPicked] = useState("");

  const rows = reviewersQ.data ?? [];
  const tracks = settingsQ.data?.tracks ?? [];

  const fail = (error: unknown) => toast.error(adminCfpErrorMessage(error));

  // Przycisk jest wyłączony bez wybranego konta, więc `picked` jest tu niepusty.
  const add = () =>
    setReviewer.mutate(
      { eventId, userId: picked, isActive: true },
      {
        onSuccess: () => {
          setPicked("");
          toast.success(t("adminEventCfp.toasts.reviewerAdded"));
        },
        onError: fail,
      },
    );

  const update = (row: CfpReviewerRow, patch: Partial<CfpReviewerInput>) =>
    setReviewer.mutate(
      {
        eventId,
        userId: row.user_id,
        trackIds: row.track_ids ?? [],
        canSeeIdentity: row.can_see_identity,
        isActive: row.is_active,
        ...patch,
      },
      { onSuccess: () => toast.success(t("adminEventCfp.toasts.reviewerSaved")), onError: fail },
    );

  const remove = async (row: CfpReviewerRow) => {
    const confirmed = await confirmDialog({
      title: t("adminEventCfp.reviewers.removeTitle"),
      description: t("adminEventCfp.reviewers.removeDescription"),
      confirmLabel: t("adminEventCfp.common.delete"),
      cancelLabel: t("adminEventCfp.common.cancel"),
      destructive: true,
    });
    if (!confirmed) return;
    removeReviewer.mutate(row.id, {
      onSuccess: (outcome) =>
        toast.success(
          t(
            outcome === "deleted"
              ? "adminEventCfp.toasts.reviewerRemoved"
              : "adminEventCfp.toasts.reviewerDeactivated",
          ),
        ),
      onError: fail,
    });
  };

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-muted-foreground">{t("adminEventCfp.reviewers.lead")}</p>
      <div className="flex max-w-xl flex-wrap items-end gap-2">
        <div className="min-w-[16rem] flex-1">
          <MemberPicker
            value={picked}
            onChange={setPicked}
            labels={{
              placeholder: t("adminEventCfp.reviewers.picker.placeholder"),
              search: t("adminEventCfp.reviewers.picker.search"),
              hint: t("adminEventCfp.reviewers.picker.hint"),
              loading: t("adminEventCfp.reviewers.picker.loading"),
              empty: t("adminEventCfp.reviewers.picker.empty"),
              clear: t("adminEventCfp.reviewers.picker.clear"),
            }}
          />
        </div>
        <Button type="button" disabled={picked === "" || setReviewer.isPending} onClick={add}>
          {t("adminEventCfp.reviewers.add")}
        </Button>
      </div>

      <AdminCatalogListState
        isLoading={reviewersQ.isLoading}
        loadingLabel={t("adminEventCfp.common.loading")}
        errorMessage={reviewersQ.error ? adminCfpErrorMessage(reviewersQ.error) : null}
        isEmpty={rows.length === 0}
        emptyLabel={t("adminEventCfp.reviewers.empty")}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("adminEventCfp.reviewers.columns.reviewer")}</TableHead>
              <TableHead>{t("adminEventCfp.reviewers.columns.tracks")}</TableHead>
              <TableHead>{t("adminEventCfp.reviewers.columns.identity")}</TableHead>
              <TableHead>{t("adminEventCfp.reviewers.columns.active")}</TableHead>
              <TableHead>{t("adminEventCfp.reviewers.columns.reviews")}</TableHead>
              <TableHead className="text-right">
                {t("adminEventCfp.reviewers.columns.actions")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <ReviewerRow
                key={row.id}
                row={row}
                tracks={tracks}
                busy={setReviewer.isPending || removeReviewer.isPending}
                onUpdate={(patch) => update(row, patch)}
                onRemove={() => void remove(row)}
              />
            ))}
          </TableBody>
        </Table>
      </AdminCatalogListState>
    </div>
  );
}

function ReviewerRow({
  row,
  tracks,
  busy,
  onUpdate,
  onRemove,
}: {
  row: CfpReviewerRow;
  tracks: readonly CfpTrackOption[];
  busy: boolean;
  onUpdate: (patch: Partial<CfpReviewerInput>) => void;
  onRemove: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const name = row.display_name || t("adminEventCfp.reviewers.unnamed");
  const scope = row.track_ids ?? [];

  return (
    <TableRow>
      <TableCell className="font-medium">{name}</TableCell>
      <TableCell>
        {tracks.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            {t("adminEventCfp.reviewers.allTracks")}
          </span>
        ) : (
          <fieldset className="space-y-1">
            <legend className="sr-only">{t("adminEventCfp.reviewers.scopeLabel", { name })}</legend>
            {scope.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t("adminEventCfp.reviewers.scopeHint")}
              </p>
            ) : null}
            {tracks.map((track) => (
              <label key={track.id} className="flex items-center gap-2 text-xs">
                <Checkbox
                  checked={scope.includes(track.id)}
                  disabled={busy}
                  onCheckedChange={() => onUpdate({ trackIds: toggleId(scope, track.id) })}
                />
                <span>{localizedPair(lang, track.namePl, track.nameEn)}</span>
              </label>
            ))}
          </fieldset>
        )}
      </TableCell>
      <TableCell>
        <Switch
          checked={row.can_see_identity}
          disabled={busy}
          aria-label={t("adminEventCfp.reviewers.identityLabel", { name })}
          title={t("adminEventCfp.reviewers.identityHint")}
          onCheckedChange={(checked) => onUpdate({ canSeeIdentity: checked })}
        />
      </TableCell>
      <TableCell>
        <Switch
          checked={row.is_active}
          disabled={busy}
          aria-label={t("adminEventCfp.reviewers.activeLabel", { name })}
          onCheckedChange={(checked) => onUpdate({ isActive: checked })}
        />
      </TableCell>
      <TableCell className="tabular-nums">{row.reviews_count}</TableCell>
      <TableCell className="text-right">
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onRemove}>
          {t("adminEventCfp.common.delete")}
        </Button>
      </TableCell>
    </TableRow>
  );
}
