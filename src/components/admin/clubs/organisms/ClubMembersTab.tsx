// Organizm: zakładka „Członkowie” edytora klubu.
//
// Rola zmienia się inline dropListą, bo zmiana roli to najczęstsza operacja
// w tej tabeli - osobny dialog na każdą zmianę zamieniłby minutę pracy
// w kwadrans. Usunięcie idzie przez potwierdzenie, bo jest nieodwracalne
// w sensie utraty historii członkostwa.
//
// Trzy rzeczy, których tu nie było:
//   1. KOLEJKA PRÓŚB. `join_policy: 'request'` jest domyślną polityką klubu,
//      więc kolejka powstaje w każdym nowym klubie - a jedyną drogą do jej
//      obsłużenia było ponowne „dodanie” osoby kartą wyżej. To działało, ale
//      przestawiało rolę na 'member' i kasowało kadencję, więc zatwierdzenie
//      prośby z linku niosącego rolę moderatora po cichu ją odbierało.
//   2. KADENCJA. Kolumna była wyłącznie do odczytu, a `club_scheduler_tick`
//      wygasza role po terminie - nie miał czego wygaszać, bo terminu nie dało
//      się nigdzie ustawić.
//   3. WERSJA MOBILNA. Tabela z sześcioma kolumnami scrollowała się w poziomie,
//      przez co droplista roli i kosz lądowały poza ekranem.
//
// PO ROZŁOŻENIU NA WARSTWY ten plik jest KOMPOZYCJĄ i niczym więcej:
//   * REGUŁY (zawężenia enumów, filtr statusu, okno strony, granice
//     stronicowania z `total_count`, zaznaczenie, cztery ładunki mutacji,
//     deskryptor potwierdzenia, stan kadencji, mapowanie wiersza na widok)
//     mieszkają w `@/lib/clubs/adminMemberRoster` - bez Reacta i bez i18n,
//     więc dają się sprawdzić tabelą przypadków, a nie montowaniem zakładki;
//   * POWTARZALNE FRAGMENTY UI (wiersz tabeli, karta mobilna, pozycja
//     kolejki, pasek masowy, droplista roli, kadencja, dialog kadencji)
//     mieszkają w `molecules/ClubRoster*` - to one były wcześniej dwukrotnie
//     wpisane w ten plik, co dało kartę mobilną BEZ przycisku zatwierdzenia;
//   * tutaj zostaje SKLEJENIE: co jedzie do której mutacji, co się dzieje po
//     błędzie i który stan listy jest na ekranie.
//
// Handlery są jednolinijkowe z zasady: handler, który robi cokolwiek poza
// `setState(value)` albo wywołaniem mutacji gotowym ładunkiem, jest regułą
// schowaną w JSX-ie.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { MemberPicker } from "@/components/admin/community/MemberPicker";
import { ConfirmDialog, type ConfirmState } from "@/components/admin/ConfirmDialog";
import { ClubRosterBulkBar } from "../molecules/ClubRosterBulkBar";
import { ClubRosterMemberCard } from "../molecules/ClubRosterMemberCard";
import { ClubRosterMemberRow } from "../molecules/ClubRosterMemberRow";
import { ClubRosterRequestItem } from "../molecules/ClubRosterRequestItem";
import { ClubRosterTenureDialog } from "../molecules/ClubRosterTenureDialog";
import {
  useBulkSetClubMemberRole,
  useClubMembers,
  useRemoveClubMember,
  useUpsertClubMember,
} from "@/lib/clubs/useClubs";
import {
  addMemberPayload,
  adminMemberPaging,
  adminMemberStatusValue,
  adminMemberWindow,
  approveMemberPayload,
  areAllMembersSelected,
  bulkMemberRolePayload,
  changeMemberRolePayload,
  memberRemovalPrompt,
  memberTenurePayload,
  toAdminMemberRequestView,
  toAdminMemberRowView,
  toAdminMemberStatusFilter,
  toggleAllMembersSelection,
  toggleMemberSelection,
} from "@/lib/clubs/adminMemberRoster";
import {
  CLUB_MEMBER_STATUSES,
  type ClubMemberRole,
  type ClubMemberRow,
  type ClubMemberStatus,
} from "@/lib/clubs/types";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";

export function ClubMembersTab({ clubId }: { clubId: string }) {
  ensureAdminClubsI18n();
  const { t, i18n } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<ClubMemberStatus | null>(null);
  const [newMemberId, setNewMemberId] = useState("");
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [tenure, setTenure] = useState<ClubMemberRow | null>(null);
  const [tenureValue, setTenureValue] = useState("");
  // Zaznaczenie trzyma IDENTYFIKATORY, nie wiersze. Po refetchu obiekty
  // wierszy są nowe, więc zbiór obiektów rozjechałby się z tabelą i pasek
  // masowy pokazywałby liczbę, której nie ma na ekranie.
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulkRole, setBulkRole] = useState<ClubMemberRole>("member");

  const membersQ = useClubMembers({ clubId, status: statusFilter, ...adminMemberWindow(0) });
  // Kolejka próśb jest wołana OSOBNO od tabeli: ma być widoczna niezależnie od
  // tego, jaki filtr statusu wybrał administrator. Zgłoszenie, które znika po
  // przełączeniu filtra, jest zgłoszeniem, o którym się zapomina.
  const pendingQ = useClubMembers({ clubId, status: "pending", ...adminMemberWindow(0) });

  const upsertM = useUpsertClubMember(clubId);
  const removeM = useRemoveClubMember(clubId);
  const bulkRoleM = useBulkSetClubMemberRole(clubId);
  // OSOBNY egzemplarz tej samej mutacji dla dialogu kadencji: wspólny gasiłby
  // droplisty roli w całej tabeli na czas zapisu jednego terminu.
  const tenureM = useUpsertClubMember(clubId);

  const nowMs = Date.now();
  const rows = membersQ.data?.rows ?? [];
  const pending = useMemo(() => pendingQ.data?.rows ?? [], [pendingQ.data]);
  // Plakietka mówi, ILE PRÓŚB CZEKA, a nie ile ich zmieściło się na stronie.
  // RPC stronicuje po 50 i zwraca `total_count` w każdym wierszu; liczenie
  // `pending.length` zatrzymywało licznik na pięćdziesiątce i zamieniało
  // „czeka 137 osób” w „czeka 50” - dokładnie w momencie, w którym kolejka
  // wymaga uwagi najbardziej.
  const queue = adminMemberPaging({
    page: 0,
    shown: pending.length,
    total: pendingQ.data?.total ?? pending.length,
  });

  const visibleIds = rows.map((row) => row.user_id);
  const allVisibleSelected = areAllMembersSelected(selected, visibleIds);

  const handleAdd = () => {
    const payload = addMemberPayload(newMemberId);
    if (payload === null) return;
    upsertM.mutate(payload, {
      onSuccess: () => {
        toast.success(t("adminClubs.members.added"));
        setNewMemberId("");
      },
      onError: () => toast.error(t("adminClubs.saveFailed")),
    });
  };

  const approve = (row: ClubMemberRow) =>
    upsertM.mutate(approveMemberPayload(row), {
      onSuccess: () => toast.success(t("adminClubs.members.approved")),
      onError: () => toast.error(t("adminClubs.saveFailed")),
    });

  const changeRole = (row: ClubMemberRow, role: ClubMemberRole) =>
    upsertM.mutate(changeMemberRolePayload(row, role), {
      onSuccess: () => toast.success(t("adminClubs.members.roleChanged")),
      onError: () => toast.error(t("adminClubs.saveFailed")),
    });

  /** Ładunek operacji masowej JEST warunkiem widoczności paska: pusty pasek
   *  z nieaktywną dropListą to szum, a druga bramka na to samo pytanie
   *  („czy jest kogo zmienić”) rozjeżdżałaby się z pierwszą. */
  const bulkPayload = bulkMemberRolePayload(selected, bulkRole);

  const applyBulkRole = (payload: { userIds: string[]; role: ClubMemberRole }) =>
    bulkRoleM.mutate(payload, {
      onSuccess: (changed) => {
        toast.success(t("adminClubs.members.bulkDone", { count: changed }));
        setSelected(new Set());
      },
      onError: () => toast.error(t("adminClubs.saveFailed")),
    });

  /** Operacja NIEODWRACALNA nie leci z kliknięcia - leci z potwierdzenia. */
  const confirmRemove = (row: ClubMemberRow, reject: boolean) => {
    const prompt = memberRemovalPrompt(row, reject);
    setConfirm({
      title: t(prompt.titleKey, prompt.titleParams),
      description: t(prompt.bodyKey),
      destructive: true,
      onConfirm: () =>
        removeM.mutateAsync(row.user_id).then(
          () => {
            toast.success(t(prompt.successKey));
          },
          () => {
            toast.error(t("adminClubs.saveFailed"));
          },
        ),
    });
  };

  const saveTenure = (clear: boolean) => {
    if (tenure === null) return;
    const payload = memberTenurePayload(tenure, tenureValue, clear);
    if (payload === null) return;
    tenureM.mutate(payload, {
      onSuccess: () => {
        toast.success(clear ? t("adminClubs.members.tenureCleared") : t("adminClubs.saved"));
        setTenureValue("");
        setTenure(null);
      },
      onError: () => toast.error(t("adminClubs.saveFailed")),
    });
  };

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
                {queue.total}
              </Badge>
            </CardTitle>
            <CardDescription>
              {t("adminClubs.members.requestsHint")}
              {queue.hasMore ? (
                <>
                  {" "}
                  {t("adminClubs.members.requestsTruncated", {
                    shown: queue.shown,
                    total: queue.total,
                  })}
                </>
              ) : null}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 sm:grid-cols-2">
              {pending.map((row) => (
                <ClubRosterRequestItem
                  key={row.user_id}
                  view={toAdminMemberRequestView(row)}
                  approvePending={upsertM.isPending}
                  rejectPending={removeM.isPending}
                  onApprove={() => approve(row)}
                  onReject={() => confirmRemove(row, true)}
                />
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
            value={adminMemberStatusValue(statusFilter)}
            onValueChange={(value) => setStatusFilter(toAdminMemberStatusFilter(value))}
          >
            <SelectTrigger
              className="w-full sm:w-[200px]"
              aria-label={t("adminClubs.members.filterStatus")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={adminMemberStatusValue(null)}>
                {t("adminClubs.filterAny")}
              </SelectItem>
              {CLUB_MEMBER_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {t(`club.memberStatus.${status}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>

        <CardContent>
          {membersQ.isPending ? (
            <div className="space-y-2" aria-busy="true">
              {[0, 1, 2].map((slot) => (
                <div key={slot} className="h-12 animate-pulse rounded-lg bg-muted/50" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t("adminClubs.members.empty")}
            </p>
          ) : (
            <>
              {/* Pasek masowy pojawia się DOPIERO po zaznaczeniu. */}
              {bulkPayload === null ? null : (
                <ClubRosterBulkBar
                  count={bulkPayload.userIds.length}
                  role={bulkRole}
                  pending={bulkRoleM.isPending}
                  onRoleChange={setBulkRole}
                  onApply={() => applyBulkRole(bulkPayload)}
                  onClear={() => setSelected(new Set())}
                />
              )}

              {/* Tabela od lg w górę */}
              <div className="hidden overflow-hidden rounded-lg border border-border/60 lg:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={allVisibleSelected}
                          onCheckedChange={() =>
                            setSelected((prev) => toggleAllMembersSelection(prev, visibleIds))
                          }
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
                      <ClubRosterMemberRow
                        key={row.user_id}
                        view={toAdminMemberRowView(row)}
                        selected={selected.has(row.user_id)}
                        nowMs={nowMs}
                        language={i18n.language}
                        rolePending={upsertM.isPending}
                        removePending={removeM.isPending}
                        onToggle={() =>
                          setSelected((prev) => toggleMemberSelection(prev, row.user_id))
                        }
                        onRoleChange={(role) => changeRole(row, role)}
                        onApprove={() => approve(row)}
                        onRemove={() => confirmRemove(row, false)}
                        onEditTenure={() => setTenure(row)}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Karty poniżej lg - te same operacje, układ pionowy */}
              <ul className="grid gap-2 lg:hidden">
                {rows.map((row) => (
                  <ClubRosterMemberCard
                    key={row.user_id}
                    view={toAdminMemberRowView(row)}
                    selected={selected.has(row.user_id)}
                    nowMs={nowMs}
                    language={i18n.language}
                    rolePending={upsertM.isPending}
                    removePending={removeM.isPending}
                    onToggle={() => setSelected((prev) => toggleMemberSelection(prev, row.user_id))}
                    onRoleChange={(role) => changeRole(row, role)}
                    onApprove={() => approve(row)}
                    onRemove={() => confirmRemove(row, false)}
                    onEditTenure={() => setTenure(row)}
                  />
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>

      <ClubRosterTenureDialog
        displayName={tenure === null ? null : tenure.display_name}
        expiresAt={tenure === null ? null : tenure.role_expires_at}
        value={tenureValue}
        language={i18n.language}
        pending={tenureM.isPending}
        onValueChange={setTenureValue}
        onSave={() => saveTenure(false)}
        onClear={() => saveTenure(true)}
        onOpenChange={(open) => !open && setTenure(null)}
      />
      <ConfirmDialog state={confirm} onOpenChange={(open) => !open && setConfirm(null)} />
    </div>
  );
}
