// Organizm: FIRMY przypiete do jednego wydarzenia.
//
// FILTRY I STRONICOWANIE PO STRONIE BAZY. `admin_event_sponsors_list` zwraca
// `total_count` w kazdym wierszu, wiec licznik nie klamie po zmianie filtra -
// filtrowanie w pamieci pokazywaloby „12 z 12" na kazdej stronie.
//
// ROZJAZD Z CRM-EM MA WLASNA ODZNAKE. `crm_drift` znaczy, ze migawka na stronie
// publicznej rozni sie od danych firmy; odswiezenie jest DECYZJA organizatora,
// bo migawka wpisana recznie bywa celowa.
//
// PUBLIKACJA HURTOWA IDZIE JEDNYM RPC. Klikanie przelacznika w dwudziestu
// wierszach to dwadziescia zapytan i dwadziescia okazji na polowiczny stan.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ChevronDown, Eye, EyeOff, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FormSelect } from "@/components/atoms/FormSelect";
import { AdminCatalogListState } from "@/components/admin/molecules/AdminCatalogListState";
import { AdminPagination } from "@/components/admin/molecules/AdminPagination";
import { EventSponsorDialog } from "@/components/admin/events/molecules/EventSponsorDialog";
import { SponsorMaterialsPanel } from "@/components/admin/events/organisms/SponsorMaterialsPanel";
import { adminSponsorErrorMessage } from "@/lib/events/adminSponsorErrors";
import {
  useDeleteSponsor,
  useRefreshSponsorSnapshots,
  useSaveSponsor,
  useSetSponsorsPublished,
  useSponsorTiers,
  useSponsors,
} from "@/lib/events/useEventSponsors";
import {
  SPONSOR_ROLES,
  type EventSponsorRow,
  type SponsorInput,
  type SponsorPublishedFilter,
  type SponsorRoleFilter,
} from "@/lib/events/sponsorsApi";

export function SponsorsListPanel({ eventId }: { eventId: string }) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language.startsWith("en");

  const [role, setRole] = useState<SponsorRoleFilter>("all");
  const [published, setPublished] = useState<SponsorPublishedFilter>("all");
  const [tierId, setTierId] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [edited, setEdited] = useState<EventSponsorRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<EventSponsorRow | null>(null);

  const tiersQ = useSponsorTiers(eventId);
  const listQ = useSponsors({
    eventId,
    role,
    published,
    tierId: tierId === "all" ? undefined : tierId,
    q: search.trim() === "" ? undefined : search.trim(),
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  const save = useSaveSponsor(eventId);
  const remove = useDeleteSponsor(eventId);
  const setPublishedMutation = useSetSponsorsPublished(eventId);
  const refresh = useRefreshSponsorSnapshots(eventId);

  const rows = listQ.data ?? [];
  const total = rows[0]?.total_count ?? 0;
  const tiers = tiersQ.data ?? [];
  const nextSortOrder = rows.reduce((max, row) => Math.max(max, row.sort_order), 0) + 10;

  const fail = (error: unknown) => toast.error(adminSponsorErrorMessage(error));

  const tierOptions = useMemo(
    () => [
      { value: "all", label: t("adminEventSponsors.filters.all") },
      ...tiers.map((tier) => ({
        value: tier.id,
        label: isEn ? tier.name_en || tier.name_pl : tier.name_pl || tier.name_en,
      })),
    ],
    [tiers, isEn, t],
  );

  const submit = (input: SponsorInput) => {
    save.mutate(input, {
      onSuccess: () => {
        toast.success(t("adminEventSponsors.sponsors.toasts.saved"));
        setDialogOpen(false);
        setEdited(null);
      },
      onError: fail,
    });
  };

  const confirmDelete = () => {
    if (pendingDelete === null) return;
    remove.mutate(pendingDelete.id, {
      onSuccess: () => {
        toast.success(t("adminEventSponsors.sponsors.toasts.deleted"));
        setPendingDelete(null);
        setSelected([]);
      },
      onError: (error) => {
        fail(error);
        setPendingDelete(null);
      },
    });
  };

  const applyPublished = (isPublished: boolean) => {
    if (selected.length === 0) return;
    setPublishedMutation.mutate(
      { ids: selected, isPublished },
      {
        onSuccess: (count) => {
          toast.success(t("adminEventSponsors.sponsors.toasts.published", { count }));
          setSelected([]);
        },
        onError: fail,
      },
    );
  };

  const refreshSnapshots = (includeManual: boolean) => {
    refresh.mutate(
      selected.length > 0 ? { ids: selected, includeManual } : { eventId, includeManual },
      {
        onSuccess: (count) => {
          toast.success(t("adminEventSponsors.sponsors.toasts.snapshotsRefreshed", { count }));
        },
        onError: fail,
      },
    );
  };

  const nameOf = (row: EventSponsorRow): string => row.snapshot_name || row.crm_name;
  const tierNameOf = (row: EventSponsorRow): string =>
    isEn ? row.tier_name_en || row.tier_name_pl : row.tier_name_pl || row.tier_name_en;

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="font-display text-lg">{t("adminEventSponsors.sponsors.title")}</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t("adminEventSponsors.sponsors.subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => refreshSnapshots(false)}
            disabled={refresh.isPending}
          >
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            {t("adminEventSponsors.actions.refreshSnapshots")}
          </Button>
          <Button
            onClick={() => {
              setEdited(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            {t("adminEventSponsors.actions.addSponsor")}
          </Button>
        </div>
      </header>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            className="pl-9"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder={t("adminEventSponsors.filters.search")}
            aria-label={t("adminEventSponsors.filters.search")}
          />
        </div>
        <FormSelect
          value={tierId}
          options={tierOptions}
          aria-label={t("adminEventSponsors.filters.tier")}
          onValueChange={(value) => {
            setTierId(value);
            setPage(1);
          }}
        />
        <FormSelect
          value={role}
          options={[
            { value: "all", label: t("adminEventSponsors.filters.all") },
            ...SPONSOR_ROLES.map((option) => ({
              value: option,
              label: t(`adminEventSponsors.roles.${option}`),
            })),
          ]}
          aria-label={t("adminEventSponsors.filters.role")}
          onValueChange={(value) => {
            setRole(value as SponsorRoleFilter);
            setPage(1);
          }}
        />
        <FormSelect
          value={published}
          options={[
            { value: "all", label: t("adminEventSponsors.filters.all") },
            { value: "published", label: t("adminEventSponsors.filters.published") },
            { value: "draft", label: t("adminEventSponsors.filters.draft") },
          ]}
          aria-label={t("adminEventSponsors.filters.published")}
          onValueChange={(value) => {
            setPublished(value as SponsorPublishedFilter);
            setPage(1);
          }}
        />
      </div>

      {selected.length === 0 ? null : (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/70 bg-muted/30 p-2 text-sm">
          <span>{t("adminEventSponsors.sponsors.selected", { count: selected.length })}</span>
          <Button size="sm" variant="outline" onClick={() => applyPublished(true)}>
            <Eye className="mr-2 h-4 w-4" aria-hidden="true" />
            {t("adminEventSponsors.actions.publish")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => applyPublished(false)}>
            <EyeOff className="mr-2 h-4 w-4" aria-hidden="true" />
            {t("adminEventSponsors.actions.unpublish")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => refreshSnapshots(true)}>
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            {t("adminEventSponsors.actions.includeManual")}
          </Button>
        </div>
      )}

      <AdminCatalogListState
        isLoading={listQ.isLoading}
        loadingLabel={t("adminEventSponsors.sponsors.loading")}
        errorMessage={
          listQ.error === null || listQ.error === undefined
            ? null
            : adminSponsorErrorMessage(listQ.error)
        }
        isEmpty={rows.length === 0}
        emptyLabel={t("adminEventSponsors.sponsors.empty")}
      >
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="rounded-md border border-border/70">
              <div className="flex flex-wrap items-center gap-3 p-3">
                <Checkbox
                  checked={selected.includes(row.id)}
                  aria-label={t("adminEventSponsors.sponsors.selectRow")}
                  onCheckedChange={(next) =>
                    setSelected((previous) =>
                      next === true
                        ? [...previous, row.id]
                        : previous.filter((id) => id !== row.id),
                    )
                  }
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{nameOf(row)}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[tierNameOf(row), row.booth_label].filter((part) => part).join(" · ")}
                  </p>
                </div>
                <Badge variant="secondary">{t(`adminEventSponsors.roles.${row.role}`)}</Badge>
                <Badge variant={row.is_published ? "default" : "outline"}>
                  {t(
                    row.is_published
                      ? "adminEventSponsors.filters.published"
                      : "adminEventSponsors.filters.draft",
                  )}
                </Badge>
                {row.crm_drift ? (
                  <Badge variant="destructive">{t("adminEventSponsors.labels.crmDrift")}</Badge>
                ) : null}
                <Badge variant="outline">
                  {`${t("adminEventSponsors.labels.contacts")}: ${String(row.contacts_count)}`}
                </Badge>
                <Badge variant="outline">
                  {`${t("adminEventSponsors.labels.materials")}: ${String(row.materials_count)}`}
                </Badge>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("adminEventSponsors.labels.materials")}
                    onClick={() => setExpanded((current) => (current === row.id ? null : row.id))}
                  >
                    <ChevronDown
                      className={
                        "h-4 w-4 transition-transform " + (expanded === row.id ? "rotate-180" : "")
                      }
                      aria-hidden="true"
                    />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("adminEventSponsors.sponsors.dialog.editTitle")}
                    onClick={() => {
                      setEdited(row);
                      setDialogOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("adminEventSponsors.sponsors.deleteConfirm")}
                    onClick={() => setPendingDelete(row)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
              {expanded === row.id ? (
                <div className="border-t border-border/70 p-3">
                  <SponsorMaterialsPanel eventId={eventId} sponsorId={row.id} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </AdminCatalogListState>

      <AdminPagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />

      <EventSponsorDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        eventId={eventId}
        sponsor={edited}
        tiers={tiers}
        nextSortOrder={nextSortOrder}
        isSaving={save.isPending}
        onSubmit={submit}
      />

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("adminEventSponsors.sponsors.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("adminEventSponsors.sponsors.deleteConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("adminEventSponsors.sponsors.dialog.cancelAction")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              {t("adminEventSponsors.sponsors.dialog.saveAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
