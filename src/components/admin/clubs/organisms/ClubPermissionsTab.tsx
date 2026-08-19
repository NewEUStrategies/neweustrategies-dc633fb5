// Organizm: zakładka "Uprawnienia" - macierz zdolności plus podgląd realny.
//
// Dwie warstwy o różnym statusie i to rozróżnienie jest tu najważniejsze:
//   * MACIERZ opisuje regułę (dane z capabilityMatrix.ts) - jest dokumentacją,
//   * PODGLĄD pyta bazę o konkretną osobę (club_capabilities) - jest prawdą.
// Gdyby się rozjechały, prawdą jest baza. Dlatego podgląd nie renderuje się
// z macierzy, tylko z RPC, i pokazuje także `reason`.
//
// CO STĄD WYSZŁO I GDZIE JEST. Składanie macierzy na wiersze, czterostanowy
// podgląd (brak wyboru / w locie / gotowe / awaria RPC) i odczyt zdolności
// z odpowiedzi są w `lib/clubs/adminClubPermissions.ts`; ikona komórki jest
// w molekule `ClubTableCapabilityCell`. Tutaj zostaje sklejenie: co jedzie do
// zapytania podglądu i co się rysuje dla którego stanu.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Minus, UserSearch } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MemberPicker } from "@/components/admin/community/MemberPicker";
import { ClubTableCapabilityCell } from "../molecules/ClubTableCapabilityCell";
import { CAPABILITY_ROLES } from "@/lib/clubs/capabilityMatrix";
import {
  capabilityPreviewState,
  capabilityPreviewUserId,
  clubCapabilityMatrixRows,
} from "@/lib/clubs/adminClubPermissions";
import { useClubCapabilitiesPreview } from "@/lib/clubs/useClubs";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";

export function ClubPermissionsTab({ clubId }: { clubId: string }) {
  ensureAdminClubsI18n();
  const { t } = useTranslation();
  const [previewUserId, setPreviewUserId] = useState("");

  const previewQ = useClubCapabilitiesPreview({
    clubId,
    userId: capabilityPreviewUserId(previewUserId),
  });
  const matrixRows = clubCapabilityMatrixRows();
  const preview = capabilityPreviewState({
    userId: previewUserId,
    isPending: previewQ.isPending,
    caps: previewQ.data,
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("adminClubs.permissions.title")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("adminClubs.permissions.hint")}</p>
        </CardHeader>
        <CardContent>
          {/* Macierz jest szeroka z natury (9 kolumn ról), więc scrolluje się
              we WŁASNYM kontenerze - strona nigdy nie scrolluje poziomo. */}
          <div className="overflow-x-auto rounded-lg border border-border/60">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 z-10 bg-background min-w-[180px]">
                    {t("adminClubs.permissions.title")}
                  </TableHead>
                  {CAPABILITY_ROLES.map((role) => (
                    <TableHead key={role} className="text-center whitespace-nowrap">
                      {t(`adminClubs.permissions.roles.${role}`)}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {matrixRows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className="sticky left-0 z-10 bg-background text-sm font-medium">
                      {t(`adminClubs.permissions.caps.${row.key}`)}
                    </TableCell>
                    {row.cells.map((cell) => (
                      <TableCell key={cell.role} className="text-center">
                        <ClubTableCapabilityCell value={cell.value} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <UserSearch className="h-4 w-4" />
            {t("adminClubs.permissions.previewAs")}
          </CardTitle>
          <p className="text-sm text-muted-foreground">{t("adminClubs.permissions.previewHint")}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-md">
            <MemberPicker
              value={previewUserId}
              onChange={setPreviewUserId}
              labels={{
                placeholder: t("adminClubs.permissions.previewAs"),
                search: t("adminClubs.searchPlaceholder"),
                hint: t("adminClubs.members.addHint"),
                loading: t("club.retry"),
                empty: t("adminClubs.members.empty"),
                clear: t("adminClubs.filterAny"),
              }}
            />
          </div>

          {preview.kind === "empty" ? (
            <p className="text-sm text-muted-foreground">
              {t("adminClubs.permissions.previewEmpty")}
            </p>
          ) : null}

          {preview.kind === "pending" ? (
            <div className="h-24 animate-pulse rounded-lg bg-muted/50" aria-busy="true" />
          ) : null}

          {preview.kind === "ready" ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                <span>
                  <span className="text-muted-foreground">
                    {t("adminClubs.permissions.effectiveRole")}:{" "}
                  </span>
                  <span className="font-medium">{t(preview.summary.roleKey)}</span>
                </span>
                <span>
                  <span className="text-muted-foreground">
                    {t("adminClubs.permissions.reasonLabel")}:{" "}
                  </span>
                  <span className="font-medium">
                    {preview.summary.reasonKey === null
                      ? t("adminClubs.permissions.reasonNone")
                      : t(preview.summary.reasonKey)}
                  </span>
                </span>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {preview.rows.map((row) => (
                  <div
                    key={row.key}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm"
                  >
                    <span>{t(`adminClubs.permissions.caps.${row.key}`)}</span>
                    {row.granted ? (
                      <Check className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <Minus className="h-4 w-4 shrink-0 text-muted-foreground/60" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
