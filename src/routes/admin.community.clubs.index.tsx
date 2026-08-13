// /admin/community/clubs - lista klubów dyskusyjnych.
//
// Trasa dokłada WŁASNĄ bramkę `isAdmin` ponad bramkę `isStaff` z admin.tsx.
// Redaktor i autor przechodzą przez admin.tsx, ale strukturą klubów zarządza
// wyłącznie admin (V2 §0), więc bez tego warunku zobaczyliby pustą tabelę
// zamiast zdania wyjaśniającego. Bramka po stronie serwera i tak jest w RPC -
// ta tutaj sprawia tylko, że interfejs nie kłamie o dostępności.
import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Plus, Search, ShieldAlert, MessagesSquare } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ClubsTable } from "@/components/admin/clubs/organisms/ClubsTable";
import { AdminPagination } from "@/components/admin/molecules/AdminPagination";
import { useAdminClubs } from "@/lib/clubs/useClubs";
import { ClubCreateDialog } from "@/components/admin/clubs/organisms/ClubCreateDialog";
import {
  CLUB_STATUSES,
  CLUB_VISIBILITIES,
  type ClubStatus,
  type ClubVisibility,
} from "@/lib/clubs/types";
import { ensureClubI18n } from "@/lib/i18n-club";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

export const Route = createFileRoute("/admin/community/clubs/")({
  head: () => ({ meta: [{ title: "Clubs · Community · Admin" }] }),
  component: AdminClubsList,
});

const ANY = "__any__";

function AdminClubsList() {
  ensureClubI18n();
  const { t } = useTranslation();
  const { isAdmin } = useAuth();
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ClubStatus | null>(null);
  const [visibility, setVisibility] = useState<ClubVisibility | null>(null);

  // 250 ms - ta sama wartość, co w /people i /network. Spójny debounce
  // sprawia, że wyszukiwarki w całym panelu "reagują tak samo szybko".
  const debouncedSearch = useDebouncedValue(search, 250);

  // Lista chodziła na domyślnym limicie RPC (50) i ani go nie przesuwała, ani
  // nie czytała `total_count`, który to samo RPC zwraca w każdym wierszu.
  // Pięćdziesiąty pierwszy klub istniał w bazie i nie istniał w panelu - bez
  // komunikatu, bez licznika, bez sposobu, żeby to zauważyć.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // Zmiana filtra przestawia na pierwszą stronę. Bez tego zawężenie wyników
  // przy otwartej stronie trzeciej pokazuje pustkę zamiast trafień.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, status, visibility, pageSize]);

  const filters = useMemo(
    () => ({
      search: debouncedSearch,
      status,
      visibility,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
    [debouncedSearch, status, visibility, page, pageSize],
  );

  const clubsQ = useAdminClubs(filters, isAdmin);
  const [createOpen, setCreateOpen] = useState(false);

  if (!isAdmin) {
    return (
      <Card className="mt-6">
        <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
          <ShieldAlert className="h-8 w-8 text-muted-foreground" />
          <h2 className="text-lg font-semibold">{t("adminClubs.noPermissionTitle")}</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            {t("adminClubs.noPermissionBody")}
          </p>
        </CardContent>
      </Card>
    );
  }

  const rows = clubsQ.data?.rows ?? [];
  const total = clubsQ.data?.total ?? 0;
  const hasFilters = debouncedSearch.trim().length > 0 || status !== null || visibility !== null;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("adminClubs.title")}</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">{t("adminClubs.subtitle")}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          {t("adminClubs.newClub")}
        </Button>
      </header>

      {/* Pasek filtrów: grid, żeby na wąskim ekranie pola układały się
          w kolumnę zamiast zwężać się do nieczytelnej szerokości. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_200px_200px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("adminClubs.searchPlaceholder")}
            className="pl-9"
            aria-label={t("adminClubs.searchPlaceholder")}
          />
        </div>

        <Select
          value={status ?? ANY}
          onValueChange={(v) => setStatus(v === ANY ? null : (v as ClubStatus))}
        >
          <SelectTrigger aria-label={t("adminClubs.filterStatus")}>
            <SelectValue placeholder={t("adminClubs.filterStatus")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{t("adminClubs.filterAny")}</SelectItem>
            {CLUB_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`club.status.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={visibility ?? ANY}
          onValueChange={(v) => setVisibility(v === ANY ? null : (v as ClubVisibility))}
        >
          <SelectTrigger aria-label={t("adminClubs.filterVisibility")}>
            <SelectValue placeholder={t("adminClubs.filterVisibility")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{t("adminClubs.filterAny")}</SelectItem>
            {CLUB_VISIBILITIES.map((v) => (
              <SelectItem key={v} value={v}>
                {t(`club.visibility.${v}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {clubsQ.isError ? (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">
            {t("adminClubs.loadError")}
          </CardContent>
        </Card>
      ) : clubsQ.isPending ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-muted/50" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <MessagesSquare className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {hasFilters ? t("adminClubs.emptyFiltered") : t("adminClubs.empty")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {/* `ClubsTable` niesie własną ramkę (tabela od lg, karty niżej), więc
              pasek stronicowania dostaje swoją zamiast zagnieżdżać się w cudzej.
              Pokazujemy go dopiero, gdy jest co stronicować - "1-3 z 3" przy
              trzech klubach to szum, a nie informacja. */}
          <ClubsTable rows={rows} />
          {total > pageSize ? (
            <div className="overflow-hidden rounded-lg border border-border/60">
              <AdminPagination
                page={page}
                pageSize={pageSize}
                total={total}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
              />
            </div>
          ) : null}
        </div>
      )}

      <ClubCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(clubId) =>
          void navigate({
            to: "/admin/community/clubs/$clubId",
            params: { clubId },
            search: { tab: "general" as const },
          })
        }
      />
    </div>
  );
}
