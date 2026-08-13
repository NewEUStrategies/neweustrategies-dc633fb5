// Organizm: zakładka "Uprawnienia" - macierz zdolności plus podgląd realny.
//
// Dwie warstwy o różnym statusie i to rozróżnienie jest tu najważniejsze:
//   * MACIERZ opisuje regułę (dane z capabilityMatrix.ts) - jest dokumentacją,
//   * PODGLĄD pyta bazę o konkretną osobę (club_capabilities) - jest prawdą.
// Gdyby się rozjechały, prawdą jest baza. Dlatego podgląd nie renderuje się
// z macierzy, tylko z RPC, i pokazuje także `reason`.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Minus, Settings2, UserSearch } from "lucide-react";
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
import {
  CAPABILITY_KEYS,
  CAPABILITY_ROLES,
  capabilityValue,
  readCapability,
  type CapabilityValue,
} from "@/lib/clubs/capabilityMatrix";
import { useClubCapabilitiesPreview } from "@/lib/clubs/useClubs";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";

function CapabilityCell({ value }: { value: CapabilityValue }) {
  const { t } = useTranslation();
  if (value === "yes") {
    return (
      <span
        className="inline-flex items-center justify-center"
        title={t("adminClubs.permissions.value.yes")}
      >
        <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
        <span className="sr-only">{t("adminClubs.permissions.value.yes")}</span>
      </span>
    );
  }
  if (value === "cond") {
    return (
      <span
        className="inline-flex items-center justify-center"
        title={t("adminClubs.permissions.value.conditional")}
      >
        <Settings2 className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <span className="sr-only">{t("adminClubs.permissions.value.conditional")}</span>
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center justify-center"
      title={t("adminClubs.permissions.value.no")}
    >
      <Minus className="h-4 w-4 text-muted-foreground/60" />
      <span className="sr-only">{t("adminClubs.permissions.value.no")}</span>
    </span>
  );
}

export function ClubPermissionsTab({ clubId }: { clubId: string }) {
  ensureAdminClubsI18n();
  const { t } = useTranslation();
  const [previewUserId, setPreviewUserId] = useState("");

  const previewQ = useClubCapabilitiesPreview({
    clubId,
    userId: previewUserId.length > 0 ? previewUserId : undefined,
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
                {CAPABILITY_KEYS.map((key) => (
                  <TableRow key={key}>
                    <TableCell className="sticky left-0 z-10 bg-background text-sm font-medium">
                      {t(`adminClubs.permissions.caps.${key}`)}
                    </TableCell>
                    {CAPABILITY_ROLES.map((role) => (
                      <TableCell key={role} className="text-center">
                        <CapabilityCell value={capabilityValue(key, role)} />
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

          {previewUserId.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("adminClubs.permissions.previewEmpty")}
            </p>
          ) : previewQ.isPending ? (
            <div className="h-24 animate-pulse rounded-lg bg-muted/50" aria-busy="true" />
          ) : previewQ.data ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                <span>
                  <span className="text-muted-foreground">
                    {t("adminClubs.permissions.effectiveRole")}:{" "}
                  </span>
                  <span className="font-medium">
                    {t(`club.role.${previewQ.data.effectiveRole}`)}
                  </span>
                </span>
                <span>
                  <span className="text-muted-foreground">
                    {t("adminClubs.permissions.reasonLabel")}:{" "}
                  </span>
                  <span className="font-medium">
                    {previewQ.data.reason
                      ? t(`club.reason.${previewQ.data.reason}`)
                      : t("adminClubs.permissions.reasonNone")}
                  </span>
                </span>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {CAPABILITY_KEYS.map((key) => {
                  const granted = readCapability(previewQ.data, key);
                  return (
                    <div
                      key={key}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm"
                    >
                      <span>{t(`adminClubs.permissions.caps.${key}`)}</span>
                      {granted ? (
                        <Check className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <Minus className="h-4 w-4 shrink-0 text-muted-foreground/60" />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
