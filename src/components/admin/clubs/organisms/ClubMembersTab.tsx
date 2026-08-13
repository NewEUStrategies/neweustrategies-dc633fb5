// Organizm: zakładka "Członkowie" edytora klubu.
//
// Rola zmienia się inline dropListą, bo zmiana roli to najczęstsza operacja
// w tej tabeli - osobny dialog na każdą zmianę zamieniłby minutę pracy
// w kwadrans. Usunięcie idzie przez potwierdzenie, bo jest nieodwracalne
// w sensie utraty historii członkostwa.
//
// Trzy rzeczy, których tu nie było:
//   1. KOLEJKA PRÓŚB. `join_policy: 'request'` jest domyślną polityką klubu,
//      więc kolejka powstaje w każdym nowym klubie - a jedyną drogą do jej
//      obsłużenia było ponowne "dodanie" osoby kartą wyżej. To działało, ale
//      przestawiało rolę na 'member' i kasowało kadencję, więc zatwierdzenie
//      prośby z linku niosącego rolę moderatora po cichu ją odbierało.
//   2. KADENCJA. Kolumna była wyłącznie do odczytu, a `club_scheduler_tick`
//      wygasza role po terminie - nie miał czego wygaszać, bo terminu nie dało
//      się nigdzie ustawić.
//   3. WERSJA MOBILNA. Tabela z sześcioma kolumnami scrollowała się w poziomie,
//      przez co droplista roli i kosz lądowały poza ekranem.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CalendarClock, Check, Trash2, UserPlus, X } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MemberPicker } from "@/components/admin/community/MemberPicker";
import { ConfirmDialog, type ConfirmState } from "@/components/admin/ConfirmDialog";
import { ClubMemberStatusBadge } from "../atoms/ClubBadges";
import {
  useBulkSetClubMemberRole,
  useClubMembers,
  useRemoveClubMember,
  useUpsertClubMember,
} from "@/lib/clubs/useClubs";
import { Checkbox } from "@/components/ui/checkbox";
import {
  CLUB_MEMBER_ROLES,
  CLUB_MEMBER_STATUSES,
  type ClubMemberRow,
  type ClubMemberRole,
  type ClubMemberStatus,
} from "@/lib/clubs/types";
import { formatDateShort, formatDateTime } from "@/lib/i18n/format";

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

function isExpired(value: string | null): boolean {
  return value !== null && new Date(value).getTime() <= Date.now();
}

export function ClubMembersTab({ clubId }: { clubId: string }) {
  const { t, i18n } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<ClubMemberStatus | null>(null);
  const [newMemberId, setNewMemberId] = useState("");
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [tenure, setTenure] = useState<ClubMemberRow | null>(null);

  const membersQ = useClubMembers({ clubId, status: statusFilter });
  // Kolejka próśb jest wołana OSOBNO od tabeli: ma być widoczna niezależnie od
  // tego, jaki filtr statusu wybrał administrator. Zgłoszenie, które znika po
  // przełączeniu filtra, jest zgłoszeniem, o którym się zapomina.
  const pendingQ = useClubMembers({ clubId, status: "pending" });

  const upsertM = useUpsertClubMember(clubId);
  const removeM = useRemoveClubMember(clubId);
  const bulkRoleM = useBulkSetClubMemberRole(clubId);

  // Zaznaczenie trzyma IDENTYFIKATORY, nie wiersze. Po refetchu obiekty
  // wierszy sa nowe, wiec zbior obiektow rozjechalby sie z tabela i pasek
  // masowy pokazywalby liczbe, ktorej nie ma na ekranie.
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulkRole, setBulkRole] = useState<ClubMemberRole>("member");

  const rows = membersQ.data?.rows ?? [];
  const pending = useMemo(() => pendingQ.data?.rows ?? [], [pendingQ.data]);
  // Plakietka mówi, ILE PRÓŚB CZEKA, a nie ile ich zmieściło się na stronie.
  // RPC stronicuje po 50 i zwraca `total_count` w każdym wierszu; liczenie
  // `pending.length` zatrzymywało licznik na pięćdziesiątce i zamieniało
  // "czeka 137 osób" w "czeka 50" - dokładnie w momencie, w którym kolejka
  // wymaga uwagi najbardziej.
  const pendingTotal = pendingQ.data?.total ?? pending.length;

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

  /** Zatwierdzenie ZACHOWUJE rolę z prośby: zaproszenie z linku może nieść
   *  rolę moderatora, a przepisanie jej na 'member' cicho ją odbierało. */
  const approve = (row: ClubMemberRow) =>
    upsertM.mutate(
      { userId: row.user_id, role: asRole(row.role), status: "active" },
      {
        onSuccess: () => toast.success(t("adminClubs.members.approved")),
        onError: () => toast.error(t("adminClubs.saveFailed")),
      },
    );

  const changeRole = (row: ClubMemberRow, role: string) =>
    upsertM.mutate(
      { userId: row.user_id, role: asRole(role), status: asStatus(row.status) },
      {
        onSuccess: () => toast.success(t("adminClubs.members.roleChanged")),
        onError: () => toast.error(t("adminClubs.saveFailed")),
      },
    );

  const toggleOne = (userId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });

  // "Zaznacz wszystko" dotyczy WIDOCZNEJ strony, nie calego klubu - inaczej
  // jeden klik na przefiltrowanej liscie zmienialby role osobom, ktorych
  // administrator nigdy nie zobaczyl.
  const visibleIds = rows.map((r) => r.user_id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const toggleAllVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });

  const applyBulkRole = () => {
    const userIds = [...selected];
    if (userIds.length === 0) return;
    bulkRoleM.mutate(
      { userIds, role: bulkRole },
      {
        onSuccess: (changed) => {
          toast.success(t("adminClubs.members.bulkDone", { count: changed }));
          setSelected(new Set());
        },
        onError: () => toast.error(t("adminClubs.saveFailed")),
      },
    );
  };

  const confirmRemove = (row: ClubMemberRow, reject: boolean) =>
    setConfirm({
      title: reject
        ? t("adminClubs.members.rejectConfirmTitle", { name: row.display_name })
        : t("adminClubs.members.removeConfirmTitle", { name: row.display_name }),
      description: reject
        ? t("adminClubs.members.rejectConfirmBody")
        : t("adminClubs.members.removeConfirmBody"),
      destructive: true,
      onConfirm: () =>
        removeM.mutateAsync(row.user_id).then(
          () => {
            toast.success(
              reject ? t("adminClubs.members.rejected") : t("adminClubs.members.removed"),
            );
          },
          () => {
            toast.error(t("adminClubs.saveFailed"));
          },
        ),
    });

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------------------------ */}
      {/* Kolejka próśb o dostęp                                              */}
      {/* ------------------------------------------------------------------ */}
      {pending.length > 0 ? (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader className="gap-1 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              {t("adminClubs.members.requestsTitle")}
              <Badge variant="secondary" className="tabular-nums">
                {pendingTotal}
              </Badge>
            </CardTitle>
            <CardDescription>
              {t("adminClubs.members.requestsHint")}
              {pendingTotal > pending.length ? (
                <>
                  {" "}
                  {t("adminClubs.members.requestsTruncated", {
                    shown: pending.length,
                    total: pendingTotal,
                  })}
                </>
              ) : null}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 sm:grid-cols-2">
              {pending.map((row) => (
                <li
                  key={row.user_id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-card p-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{row.display_name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {t(`club.role.${asRole(row.role)}`)}
                      {row.current_company !== null && row.current_company !== ""
                        ? ` · ${row.current_company}`
                        : ""}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    className="h-8"
                    disabled={upsertM.isPending}
                    onClick={() => approve(row)}
                  >
                    <Check className="mr-1.5 h-3.5 w-3.5" />
                    {t("adminClubs.members.approve")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-destructive"
                    disabled={removeM.isPending}
                    onClick={() => confirmRemove(row, true)}
                  >
                    <X className="mr-1.5 h-3.5 w-3.5" />
                    {t("adminClubs.members.reject")}
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

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
            <SelectTrigger
              className="w-full sm:w-[200px]"
              aria-label={t("adminClubs.members.filterStatus")}
            >
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
            <>
              {/* Pasek masowy pojawia sie DOPIERO po zaznaczeniu: pusty pasek
                  z nieaktywna droplista to szum nad kazda tabela. */}
              {selected.size > 0 ? (
                <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
                  <span className="text-sm font-medium">
                    {t("adminClubs.members.bulkSelected", { count: selected.size })}
                  </span>
                  <Select value={bulkRole} onValueChange={(v) => setBulkRole(asRole(v))}>
                    <SelectTrigger
                      className="w-full sm:w-[190px]"
                      aria-label={t("adminClubs.members.bulkRole")}
                    >
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
                  <Button size="sm" disabled={bulkRoleM.isPending} onClick={applyBulkRole}>
                    {t("adminClubs.members.bulkApply")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={bulkRoleM.isPending}
                    onClick={() => setSelected(new Set())}
                  >
                    {t("adminClubs.members.bulkClear")}
                  </Button>
                </div>
              ) : null}

              {/* Tabela od lg w górę */}
              <div className="hidden overflow-hidden rounded-lg border border-border/60 lg:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={allVisibleSelected}
                          onCheckedChange={toggleAllVisible}
                          aria-label={t("adminClubs.members.bulkSelectAll")}
                        />
                      </TableHead>
                      <TableHead>{t("adminClubs.columns.name")}</TableHead>
                      <TableHead className="min-w-[150px]">
                        {t("adminClubs.columns.role")}
                      </TableHead>
                      <TableHead>{t("adminClubs.columns.status")}</TableHead>
                      <TableHead>{t("adminClubs.columns.joined")}</TableHead>
                      <TableHead>{t("adminClubs.columns.roleExpires")}</TableHead>
                      <TableHead className="w-20 sr-only">
                        {t("adminClubs.columns.actions")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow
                        key={row.user_id}
                        data-state={selected.has(row.user_id) ? "selected" : undefined}
                      >
                        <TableCell>
                          <Checkbox
                            checked={selected.has(row.user_id)}
                            onCheckedChange={() => toggleOne(row.user_id)}
                            aria-label={row.display_name}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{row.display_name}</div>
                          {row.job_title ? (
                            <div className="text-xs text-muted-foreground">{row.job_title}</div>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <RoleSelect
                            row={row}
                            disabled={upsertM.isPending}
                            onChange={(v) => changeRole(row, v)}
                          />
                        </TableCell>
                        <TableCell>
                          <ClubMemberStatusBadge status={asStatus(row.status)} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {formatDateShort(row.joined_at, i18n.language)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          <TenureCell row={row} onEdit={() => setTenure(row)} />
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {row.status === "pending" ? (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                disabled={upsertM.isPending}
                                onClick={() => approve(row)}
                                aria-label={t("adminClubs.members.approve")}
                              >
                                <Check className="h-4 w-4" />
                              </Button>
                            ) : null}
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              disabled={removeM.isPending}
                              // Dialog aplikacji, nie window.confirm: natywne
                              // okna zostały świadomie usunięte z panelu, bo nie
                              // dają się ostylować ani przetłumaczyć.
                              onClick={() => confirmRemove(row, false)}
                              aria-label={t("adminClubs.members.removed")}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Karty poniżej lg - te same operacje, układ pionowy */}
              <ul className="grid gap-2 lg:hidden">
                {rows.map((row) => (
                  <li key={row.user_id} className="rounded-lg border border-border/60 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex min-w-0 items-start gap-2">
                        <Checkbox
                          className="mt-0.5"
                          checked={selected.has(row.user_id)}
                          onCheckedChange={() => toggleOne(row.user_id)}
                          aria-label={row.display_name}
                        />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{row.display_name}</p>
                          {row.job_title ? (
                            <p className="truncate text-xs text-muted-foreground">
                              {row.job_title}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <ClubMemberStatusBadge status={asStatus(row.status)} />
                    </div>

                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <RoleSelect
                        row={row}
                        disabled={upsertM.isPending}
                        onChange={(v) => changeRole(row, v)}
                      />
                      <div className="flex items-center text-sm">
                        <TenureCell row={row} onEdit={() => setTenure(row)} />
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-1 border-t border-border/60 pt-2">
                      {row.status === "pending" ? (
                        <Button
                          size="sm"
                          className="h-8"
                          disabled={upsertM.isPending}
                          onClick={() => approve(row)}
                        >
                          <Check className="mr-1.5 h-3.5 w-3.5" />
                          {t("adminClubs.members.approve")}
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-destructive"
                        disabled={removeM.isPending}
                        onClick={() => confirmRemove(row, false)}
                      >
                        <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                        {t("common.delete")}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>

      <TenureDialog
        clubId={clubId}
        member={tenure}
        onOpenChange={(open) => !open && setTenure(null)}
      />
      <ConfirmDialog state={confirm} onOpenChange={(open) => !open && setConfirm(null)} />
    </div>
  );
}

function RoleSelect({
  row,
  disabled,
  onChange,
}: {
  row: ClubMemberRow;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Select value={asRole(row.role)} disabled={disabled} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-full" aria-label={t("adminClubs.columns.role")}>
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
  );
}

/** Kadencja jako przycisk, nie tekst: bez tego kolumna była martwym odczytem,
 *  a `club_scheduler_tick` nie miał czego wygaszać. */
function TenureCell({ row, onEdit }: { row: ClubMemberRow; onEdit: () => void }) {
  const { t, i18n } = useTranslation();
  const expired = isExpired(row.role_expires_at);

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 gap-1.5 px-2 text-xs font-normal"
      onClick={onEdit}
    >
      <CalendarClock className="h-3.5 w-3.5 shrink-0" />
      {row.role_expires_at === null ? (
        <span className="text-muted-foreground">{t("adminClubs.members.tenureNone")}</span>
      ) : expired ? (
        <span className="text-amber-700 dark:text-amber-300">
          {t("adminClubs.members.roleExpired")}
        </span>
      ) : (
        <span className="text-muted-foreground">
          {formatDateShort(row.role_expires_at, i18n.language)}
        </span>
      )}
    </Button>
  );
}

function TenureDialog({
  clubId,
  member,
  onOpenChange,
}: {
  clubId: string;
  member: ClubMemberRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const upsertM = useUpsertClubMember(clubId);
  const [value, setValue] = useState("");

  // Pole daty startuje puste także wtedy, gdy kadencja jest ustawiona:
  // dialog otwiera się po to, żeby ją ZMIENIĆ, a bieżący termin i tak stoi
  // w zdaniu wyżej. Wstępne wypełnienie kusiłoby do zapisu bez zmiany.
  const current = member?.role_expires_at ?? null;

  const save = (clear: boolean) => {
    if (!member) return;
    if (!clear && value.trim() === "") return;
    upsertM.mutate(
      {
        userId: member.user_id,
        role: asRole(member.role),
        status: asStatus(member.status),
        roleExpiresAt: clear ? null : new Date(value).toISOString(),
        clearRoleExpiry: clear,
      },
      {
        onSuccess: () => {
          toast.success(clear ? t("adminClubs.members.tenureCleared") : t("adminClubs.saved"));
          setValue("");
          onOpenChange(false);
        },
        onError: () => toast.error(t("adminClubs.saveFailed")),
      },
    );
  };

  return (
    <Dialog open={member !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-left">{t("adminClubs.members.tenureTitle")}</DialogTitle>
          <DialogDescription className="text-left">
            {t("adminClubs.members.tenureHint")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <p className="rounded-md bg-muted/50 px-3 py-2 text-sm">
            <span className="font-medium">{member?.display_name}</span>
            {" · "}
            {current === null
              ? t("adminClubs.members.tenureNone")
              : formatDateTime(current, i18n.language)}
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="club-tenure-date">{t("adminClubs.members.tenureUntil")}</Label>
            <Input
              id="club-tenure-date"
              type="date"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button
            variant="ghost"
            className="sm:mr-auto"
            disabled={current === null || upsertM.isPending}
            onClick={() => save(true)}
          >
            {t("adminClubs.members.tenureClear")}
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button disabled={value.trim() === "" || upsertM.isPending} onClick={() => save(false)}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
