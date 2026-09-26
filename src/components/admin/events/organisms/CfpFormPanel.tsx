// Organizm: „Formularz zgłoszenia" - własne pytania naboru prelegentów.
//
// STAŁA CZĘŚĆ FORMULARZA (dane prelegenta, tytuł, streszczenie, forma, ścieżka,
// współprelegenci) nie jest tu edytowana - wynika z ustawień naboru. Ten ekran
// dokłada pytania organizatora (doświadczenie, poziom, zgoda na nagranie...).
//
// USUNIĘCIE PYTANIA Z ODPOWIEDZIAMI PYTA O POTWIERDZENIE i mówi, ile zgłoszeń
// na nie odpowiedziało. Odpowiedzi zostają w zgłoszeniach, ale formularz i
// recenzenci przestają je widzieć - wyłączenie pytania jest łagodniejszą drogą.
//
// KOLEJNOŚĆ STRZAŁKAMI. Przeciąganie nie działa z klawiatury; dwie strzałki
// działają wszędzie i zapisują od razu pełną listę (`admin_event_cfp_fields_reorder`).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ChevronDown, ChevronUp } from "@/lib/lucide-shim";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AdminCatalogListState } from "@/components/admin/molecules/AdminCatalogListState";
import { CfpFieldDialog } from "@/components/admin/events/molecules/CfpFieldDialog";
import { confirmDialog } from "@/lib/appDialogs";
import { adminCfpErrorMessage } from "@/lib/events/adminCfpErrors";
import { CFP_FIELD_TYPE_LABEL_KEYS } from "@/lib/events/adminCfpLabels";
import { asOneOf, CFP_FIELD_TYPES, localizedPair } from "@/lib/events/cfpEnums";
import type { CfpFieldInput, CfpFieldRow } from "@/lib/events/cfpApi";
import { moveItem } from "@/lib/events/cfpFieldDraft";
import {
  useCfpFields,
  useDeleteCfpField,
  useReorderCfpFields,
  useSaveCfpField,
} from "@/lib/events/useEventCfp";
import { uiLang } from "@/lib/i18n/format";
import { ensureAdminEventCfpI18n } from "@/lib/i18n-admin-event-cfp";

export function CfpFormPanel({ eventId }: { eventId: string }) {
  ensureAdminEventCfpI18n();
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const fieldsQ = useCfpFields(eventId);
  const saveField = useSaveCfpField(eventId);
  const deleteField = useDeleteCfpField(eventId);
  const reorder = useReorderCfpFields(eventId);
  const [editing, setEditing] = useState<CfpFieldRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const rows = fieldsQ.data ?? [];

  const openDialog = (row: CfpFieldRow | null) => {
    setEditing(row);
    setDialogOpen(true);
  };

  const submit = (input: CfpFieldInput) =>
    saveField.mutate(input, {
      onSuccess: () => {
        setDialogOpen(false);
        toast.success(t("adminEventCfp.toasts.fieldSaved"));
      },
      onError: (error) => toast.error(adminCfpErrorMessage(error)),
    });

  const move = (index: number, delta: -1 | 1) =>
    reorder.mutate(
      moveItem(rows, index, delta).map((row) => row.id),
      { onError: (error) => toast.error(adminCfpErrorMessage(error)) },
    );

  const remove = async (row: CfpFieldRow) => {
    const confirmed = await confirmDialog({
      title: t("adminEventCfp.form.deleteTitle"),
      description:
        row.answers_count > 0
          ? t("adminEventCfp.form.deleteWithAnswers", { count: row.answers_count })
          : t("adminEventCfp.form.deleteDescription"),
      confirmLabel: t("adminEventCfp.common.delete"),
      cancelLabel: t("adminEventCfp.common.cancel"),
      destructive: true,
    });
    if (!confirmed) return;
    deleteField.mutate(row.id, {
      onSuccess: () => toast.success(t("adminEventCfp.toasts.fieldDeleted")),
      onError: (error) => toast.error(adminCfpErrorMessage(error)),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-muted-foreground">{t("adminEventCfp.form.lead")}</p>
        <Button type="button" size="sm" onClick={() => openDialog(null)}>
          {t("adminEventCfp.form.add")}
        </Button>
      </div>

      <AdminCatalogListState
        isLoading={fieldsQ.isLoading}
        loadingLabel={t("adminEventCfp.common.loading")}
        errorMessage={fieldsQ.error ? adminCfpErrorMessage(fieldsQ.error) : null}
        isEmpty={rows.length === 0}
        emptyLabel={t("adminEventCfp.form.empty")}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("adminEventCfp.form.columns.question")}</TableHead>
              <TableHead>{t("adminEventCfp.form.columns.type")}</TableHead>
              <TableHead>{t("adminEventCfp.form.columns.answers")}</TableHead>
              <TableHead className="text-right">
                {t("adminEventCfp.form.columns.actions")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => (
              <TableRow key={row.id}>
                <TableCell>
                  <div className="font-medium">
                    {localizedPair(lang, row.label_pl, row.label_en)}
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <code>{row.key}</code>
                    {row.is_required ? <span>{t("adminEventCfp.form.required")}</span> : null}
                    {row.is_active ? null : <span>{t("adminEventCfp.form.inactive")}</span>}
                  </div>
                </TableCell>
                <TableCell>
                  {t(CFP_FIELD_TYPE_LABEL_KEYS[asOneOf(CFP_FIELD_TYPES, row.field_type, "text")])}
                </TableCell>
                <TableCell className="tabular-nums">{row.answers_count}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={index === 0 || reorder.isPending}
                      aria-label={t("adminEventCfp.form.moveUp")}
                      onClick={() => move(index, -1)}
                    >
                      <ChevronUp className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={index === rows.length - 1 || reorder.isPending}
                      aria-label={t("adminEventCfp.form.moveDown")}
                      onClick={() => move(index, 1)}
                    >
                      <ChevronDown className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => openDialog(row)}
                    >
                      {t("adminEventCfp.common.edit")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void remove(row)}
                    >
                      {t("adminEventCfp.common.delete")}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </AdminCatalogListState>

      <CfpFieldDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        eventId={eventId}
        field={editing}
        isSaving={saveField.isPending}
        onSubmit={submit}
      />
    </div>
  );
}
