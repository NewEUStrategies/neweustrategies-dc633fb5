// Organizm: URZĄDZENIA SKANUJĄCE.
//
// TOKEN POKAZUJEMY RAZ, TU I TERAZ. Wynik `admin_event_scanner_device_issue`
// trafia do osobnego okienka i ginie z jego zamknięciem; lista pokazuje tylko
// prefiks, bo baza trzyma skrót SHA-256 i nie ma czego odtworzyć.
//
// STAN URZĄDZENIA LICZY BAZA. `state` uwzględnia unieważnienie, wygaśnięcie i
// blokadę po serii nieudanych skanów - ekran nie składa tego z trzech kolumn,
// bo trzy warunki sklejone w UI rozjeżdżają się przy pierwszej zmianie progu
// blokady w migracji.
//
// WSTRZYMANIE ≠ UNIEWAŻNIENIE. Wstrzymane poświadczenie wraca do pracy jednym
// kliknięciem (padł akumulator, zmiana operatora); unieważnione nie wraca nigdy.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Ban, KeyRound, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { AdminCatalogListState } from "@/components/admin/molecules/AdminCatalogListState";
import {
  ScannerCredentialDialog,
  ScannerDeviceDialog,
} from "@/components/admin/events/molecules/ScannerDeviceDialog";
import { adminOnsiteErrorMessage } from "@/lib/events/adminOnsiteErrors";
import {
  useCheckpoints,
  useIssueScannerDevice,
  useRevokeScannerDevice,
  useScannerDevices,
  useSetScannerDeviceActive,
} from "@/lib/events/useEventOnsite";
import { useSponsors } from "@/lib/events/useEventSponsors";
import { uiLang } from "@/lib/i18n/format";
import type {
  ScannerDeviceCredential,
  ScannerDeviceIssueInput,
  ScannerDeviceRow,
} from "@/lib/events/onsiteApi";

export function OnsiteDevicesPanel({ eventId }: { eventId: string }) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const listQ = useScannerDevices(eventId);
  const checkpointsQ = useCheckpoints(eventId);
  const sponsorsQ = useSponsors({ eventId, limit: 200 });
  const issue = useIssueScannerDevice(eventId);
  const revoke = useRevokeScannerDevice(eventId);
  const setActive = useSetScannerDeviceActive(eventId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [credential, setCredential] = useState<ScannerDeviceCredential | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<ScannerDeviceRow | null>(null);

  const rows = listQ.data ?? [];
  const fail = (error: unknown) => toast.error(adminOnsiteErrorMessage(error));

  const checkpoints = useMemo(
    () =>
      (checkpointsQ.data ?? []).map((row) => ({
        id: row.id,
        label: lang === "en" ? row.name_en || row.name_pl : row.name_pl || row.name_en,
      })),
    [checkpointsQ.data, lang],
  );
  const sponsors = useMemo(
    () =>
      (sponsorsQ.data ?? []).map((row) => ({
        id: row.id,
        label: row.snapshot_name || row.crm_name || row.id,
      })),
    [sponsorsQ.data],
  );

  const submit = (input: ScannerDeviceIssueInput) => {
    issue.mutate(input, {
      onSuccess: (result) => {
        toast.success(t("adminEventOnsite.devices.toasts.issued"));
        setDialogOpen(false);
        setCredential(result);
      },
      onError: fail,
    });
  };

  const confirmRevoke = () => {
    if (pendingRevoke === null) return;
    revoke.mutate(pendingRevoke.id, {
      onSuccess: () => {
        toast.success(t("adminEventOnsite.devices.toasts.revoked"));
        setPendingRevoke(null);
      },
      onError: (error) => {
        fail(error);
        setPendingRevoke(null);
      },
    });
  };

  const toggle = (row: ScannerDeviceRow) => {
    const next = !row.is_active;
    setActive.mutate(
      { deviceId: row.id, isActive: next },
      {
        onSuccess: () =>
          toast.success(
            t(
              next
                ? "adminEventOnsite.devices.toasts.resumed"
                : "adminEventOnsite.devices.toasts.paused",
            ),
          ),
        onError: fail,
      },
    );
  };

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="font-display text-lg">{t("adminEventOnsite.devices.title")}</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t("adminEventOnsite.devices.subtitle")}
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <KeyRound className="mr-2 h-4 w-4" aria-hidden="true" />
          {t("adminEventOnsite.actions.issueDevice")}
        </Button>
      </header>

      <AdminCatalogListState
        isLoading={listQ.isLoading}
        loadingLabel={t("adminEventOnsite.devices.loading")}
        errorMessage={
          listQ.error === null || listQ.error === undefined
            ? null
            : adminOnsiteErrorMessage(listQ.error)
        }
        isEmpty={rows.length === 0}
        emptyLabel={t("adminEventOnsite.devices.empty")}
      >
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center gap-3 rounded-md border border-border/70 p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{row.label}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[
                    `${t("adminEventOnsite.labels.tokenPrefix")}: ${row.token_prefix}`,
                    row.checkpoint_id === null
                      ? null
                      : lang === "en"
                        ? row.checkpoint_name_en || row.checkpoint_name_pl
                        : row.checkpoint_name_pl || row.checkpoint_name_en,
                    row.sponsor_name,
                  ]
                    .filter((part) => part !== null && part !== "")
                    .join(" · ")}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <Badge
                  variant={
                    row.state === "active"
                      ? "default"
                      : row.state === "revoked"
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {t(`adminEventOnsite.deviceStates.${row.state}`, { defaultValue: row.state })}
                </Badge>
                {row.scopes.map((scope) => (
                  <Badge key={scope} variant="outline">
                    {t(`adminEventOnsite.scopes.${scope}`, { defaultValue: scope })}
                  </Badge>
                ))}
                <Badge variant="outline">{`${t("adminEventOnsite.labels.scans")}: ${row.scan_count}`}</Badge>
                {row.failed_scan_count > 0 ? (
                  <Badge variant="outline">{`${t("adminEventOnsite.labels.failedScans")}: ${row.failed_scan_count}`}</Badge>
                ) : null}
                {row.expires_at === null ? null : (
                  <span className="text-xs text-muted-foreground">
                    {`${t("adminEventOnsite.labels.expiresAt")}: ${new Date(
                      row.expires_at,
                    ).toLocaleString(i18n.language)}`}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1">
                {row.state === "revoked" ? null : (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t(
                        row.is_active
                          ? "adminEventOnsite.actions.pauseDevice"
                          : "adminEventOnsite.actions.resumeDevice",
                      )}
                      onClick={() => toggle(row)}
                      disabled={setActive.isPending}
                    >
                      {row.is_active ? (
                        <Pause className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Play className="h-4 w-4" aria-hidden="true" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("adminEventOnsite.actions.revokeDevice")}
                      onClick={() => setPendingRevoke(row)}
                    >
                      <Ban className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </AdminCatalogListState>

      <ScannerDeviceDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        eventId={eventId}
        checkpoints={checkpoints}
        sponsors={sponsors}
        isSaving={issue.isPending}
        onSubmit={submit}
      />

      <ScannerCredentialDialog credential={credential} onClose={() => setCredential(null)} />

      <AlertDialog
        open={pendingRevoke !== null}
        onOpenChange={(next) => (next ? undefined : setPendingRevoke(null))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("adminEventOnsite.devices.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("adminEventOnsite.devices.revokeConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("adminEventOnsite.actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRevoke}>
              {t("adminEventOnsite.actions.revokeDevice")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
