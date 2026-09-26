// Organizm: materiały prelegentów (prezentacje, dokumenty, nagrania jako adresy
// https) z publikacją przez organizatora.
//
// PUBLIKUJE ORGANIZATOR, NIE PRELEGENT. Prelegent dodaje adres i wybiera, kto
// ma go widzieć; na stronę wydarzenia trafia dopiero po zatwierdzeniu tutaj.
// Każda zmiana przez prelegenta wycofuje publikację (baza), więc podmieniony
// adres nie wychodzi publicznie bez ponownego spojrzenia organizatora.
//
// ADRES OTWIERA SIĘ W NOWEJ KARCIE Z `noopener noreferrer`. To adres wpisany
// przez osobę spoza zespołu - nie może dostać dostępu do okna panelu.
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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
import { adminCfpErrorMessage } from "@/lib/events/adminCfpErrors";
import {
  asOneOf,
  localizedPair,
  SPEAKER_MATERIAL_KIND_LABEL_KEYS,
  SPEAKER_MATERIAL_KINDS,
  SPEAKER_MATERIAL_VISIBILITIES,
  SPEAKER_MATERIAL_VISIBILITY_LABEL_KEYS,
} from "@/lib/events/cfpEnums";
import { formatEventDateTime } from "@/lib/events/timezone";
import { useCfpMaterials, usePublishCfpMaterial } from "@/lib/events/useEventCfp";
import { uiLang } from "@/lib/i18n/format";
import { ensureAdminEventCfpI18n } from "@/lib/i18n-admin-event-cfp";

export function CfpMaterialsTable({ eventId, timezone }: { eventId: string; timezone: string }) {
  ensureAdminEventCfpI18n();
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const materialsQ = useCfpMaterials(eventId);
  const publish = usePublishCfpMaterial(eventId);
  const rows = materialsQ.data ?? [];

  const toggle = (id: string, isPublished: boolean) =>
    publish.mutate(
      { id, isPublished },
      {
        onSuccess: () =>
          toast.success(
            t(isPublished ? "adminEventCfp.toasts.materialPublished" : "adminEventCfp.toasts.materialUnpublished"),
          ),
        onError: (error) => toast.error(adminCfpErrorMessage(error)),
      },
    );

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-muted-foreground">{t("adminEventCfp.materials.lead")}</p>
      <AdminCatalogListState
        isLoading={materialsQ.isLoading}
        loadingLabel={t("adminEventCfp.common.loading")}
        errorMessage={materialsQ.error ? adminCfpErrorMessage(materialsQ.error) : null}
        isEmpty={rows.length === 0}
        emptyLabel={t("adminEventCfp.materials.empty")}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("adminEventCfp.materials.columns.title")}</TableHead>
              <TableHead>{t("adminEventCfp.materials.columns.speaker")}</TableHead>
              <TableHead>{t("adminEventCfp.materials.columns.kind")}</TableHead>
              <TableHead>{t("adminEventCfp.materials.columns.visibility")}</TableHead>
              <TableHead>{t("adminEventCfp.materials.columns.status")}</TableHead>
              <TableHead className="text-right">{t("adminEventCfp.materials.columns.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <div className="font-medium">{localizedPair(lang, row.title_pl, row.title_en)}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatEventDateTime(row.updated_at, timezone, lang)}
                  </div>
                </TableCell>
                <TableCell>{row.speaker_name}</TableCell>
                <TableCell>
                  {t(SPEAKER_MATERIAL_KIND_LABEL_KEYS[asOneOf(SPEAKER_MATERIAL_KINDS, row.kind, "link")])}
                </TableCell>
                <TableCell>
                  {t(
                    SPEAKER_MATERIAL_VISIBILITY_LABEL_KEYS[
                      asOneOf(SPEAKER_MATERIAL_VISIBILITIES, row.visibility, "organizers")
                    ],
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={row.is_published ? "default" : "outline"}>
                    {t(row.is_published ? "adminEventCfp.materials.published" : "adminEventCfp.materials.unpublished")}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button asChild type="button" variant="ghost" size="sm">
                      <a href={row.url} target="_blank" rel="noopener noreferrer nofollow">
                        {t("adminEventCfp.materials.open")}
                      </a>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={publish.isPending}
                      onClick={() => toggle(row.id, !row.is_published)}
                    >
                      {t(row.is_published ? "adminEventCfp.materials.unpublish" : "adminEventCfp.materials.publish")}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </AdminCatalogListState>
    </div>
  );
}
