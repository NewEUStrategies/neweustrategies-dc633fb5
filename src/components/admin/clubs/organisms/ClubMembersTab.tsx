// Organizm: zakładka "Członkowie" edytora klubu.
//
// Rola zmienia się inline dropListą, bo zmiana roli to najczęstsza operacja
// w tej tabeli - osobny dialog na każdą zmianę zamieniłby minutę pracy
// w kwadrans. Usunięcie idzie przez potwierdzenie, bo jest nieodwracalne
// w sensie utraty historii członkostwa.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Trash2, UserPlus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MemberPicker } from "@/components/admin/community/MemberPicker";
import { ConfirmDialog, type ConfirmState } from "@/components/admin/ConfirmDialog";
import { ClubMemberStatusBadge } from "../atoms/ClubBadges";
import { useClubMembers, useRemoveClubMember, useUpsertClubMember } from "@/lib/clubs/useClubs";
import {
  CLUB_MEMBER_ROLES,
  CLUB_MEMBER_STATUSES,
  type ClubMemberRole,
  type ClubMemberStatus,
} from "@/lib/clubs/types";

const ANY = "__any__";

function asRole(value: string): ClubMemberRole {
  return (CLUB_MEMBER_ROLES as readonly string[]).includes(value)
    ? (value as ClubMemberRole)
    : "member";
}

function asStatus(value: string): ClubMemberStatus {
  return (CLUB_MEMBER_STATUSES as readonly string[]).includes(value)
    ? (value as ClubMemberStatus)
    : "active";
}

export function ClubMembersTab({ clubId, isPl }: { clubId: string; isPl: boolean }) {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<ClubMemberStatus | null>(null);
  const [newMemberId, setNewMemberId] = useState("");
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const membersQ = useClubMembers({ clubId, status: statusFilter });
  const upsertM = useUpsertClubMember(clubId);
  const removeM = useRemoveClubMember(clubId);

  const rows = membersQ.data?.rows ?? [];

  const handleAdd = () => {
    if (newMemberId.length === 0) return;
    upsertM.mutate(
      { userId: newMemberId, role: "member", status: "active" },
      {
        onSuccess: () => {
          toast.success(t("adminClubs.members.added"));
          setNewMemberId("");
        },
        onError: () => toast.error(t("adminClubs.saveFailed")),
      },
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <UserPlus className="h-4 w-4" />
            {t("adminClubs.members.add")}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="min-w-[260px] flex-1">
            <MemberPicker
              value={newMemberId}
              onChange={setNewMemberId}
              disabled={upsertM.isPending}
              labels={{
                placeholder: t("adminClubs.members.add"),
                search: t("adminClubs.searchPlaceholder"),
                hint: t("adminClubs.members.addHint"),
                loading: t("club.retry"),
                empty: t("adminClubs.members.empty"),
                clear: t("adminClubs.filterAny"),
              }}
            />
          </div>
          <Button onClick={handleAdd} disabled={newMemberId.length === 0 || upsertM.isPending}>
            {t("adminClubs.members.add")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-3">
          <CardTitle className="text-base">{t("adminClubs.members.title")}</CardTitle>
          <Select
            value={statusFilter ?? ANY}
            onValueChange={(v) => setStatusFilter(v === ANY ? null : asStatus(v))}
          >
            <SelectTrigger className="w-[200px]" aria-label={t("adminClubs.members.filterStatus")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t("adminClubs.filterAny")}</SelectItem>
              {CLUB_MEMBER_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`club.memberStatus.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>

        <CardContent>
          {membersQ.isPending ? (
            <div className="space-y-2" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-lg bg-muted/50" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t("adminClubs.members.empty")}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border/60">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("adminClubs.columns.name")}</TableHead>
                    <TableHead className="min-w-[150px]">{t("adminClubs.columns.role")}</TableHead>
                    <TableHead>{t("adminClubs.columns.status")}</TableHead>
                    <TableHead>{t("adminClubs.columns.joined")}</TableHead>
                    <TableHead>{t("adminClubs.columns.roleExpires")}</TableHead>
                    <TableHead className="w-10 sr-only">
                      {t("adminClubs.columns.actions")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const role = asRole(row.role);
                    const expired =
                      row.role_expires_at !== null &&
                      new Date(row.role_expires_at).getTime() <= Date.now();
                    return (
                      <TableRow key={row.user_id}>
                        <TableCell>
                          <div className="font-medium">{row.display_name}</div>
                          {row.job_title ? (
                            <div className="text-xs text-muted-foreground">{row.job_title}</div>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={role}
                            disabled={upsertM.isPending}
                            onValueChange={(v) =>
                              upsertM.mutate(
                                {
                                  userId: row.user_id,
                                  role: asRole(v),
                                  status: asStatus(row.status),
                                },
                                {
                                  onSuccess: () =>
                                    toast.success(t("adminClubs.members.roleChanged")),
                                  onError: () => toast.error(t("adminClubs.saveFailed")),
                                },
                              )
                            }
                          >
                            <SelectTrigger className="h-8 w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {CLUB_MEMBER_ROLES.map((r) => (
                                <SelectItem key={r} value={r}>
                                  {t(`club.role.${r}`)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <ClubMemberStatusBadge status={asStatus(row.status)} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {new Date(row.joined_at).toLocaleDateString(isPl ? "pl-PL" : "en-GB")}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          {row.role_expires_at === null ? (
                            <span className="text-muted-foreground">-</span>
                          ) : expired ? (
                            <span className="text-amber-700 dark:text-amber-300">
                              {t("adminClubs.members.roleExpired")}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">
                              {new Date(row.role_expires_at).toLocaleDateString(
                                isPl ? "pl-PL" : "en-GB",
                              )}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            disabled={removeM.isPending}
                            onClick={() =>
                              // Dialog aplikacji, nie window.confirm: natywne
                              // okna zostały świadomie usunięte z panelu, bo nie
                              // dają się ostylować ani przetłumaczyć.
                              setConfirm({
                                title: t("adminClubs.members.removeConfirmTitle", {
                                  name: row.display_name,
                                }),
                                description: t("adminClubs.members.removeConfirmBody"),
                                destructive: true,
                                onConfirm: () =>
                                  removeM.mutateAsync(row.user_id).then(
                                    () => toast.success(t("adminClubs.members.removed")),
                                    () => toast.error(t("adminClubs.saveFailed")),
                                  ),
                              })
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                            <span className="sr-only">{t("adminClubs.columns.actions")}</span>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog state={confirm} onOpenChange={(open) => !open && setConfirm(null)} />
    </div>
  );
}
