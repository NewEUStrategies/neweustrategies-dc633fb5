// Organizm: DOWIAZANIA KONT DO KARTOTEK UCZESTNIKOW (REG-01, D14).
//
// TRZY LISTY, JEDNA DECYZJA NA WIERSZ. Gora - dowiazania, ktorych konto NIE
// potwierdzilo adresu kartoteki (po naprawie historii zwykle pusta; pojawia
// sie tu np. konto, ktorego adres potwierdzil administrator). Srodek - lista
// PRZEGLADU (przeglad R12): dowiazania zgodne z regula, ale z sygnalem
// przejecia - adres kartoteki zmieniony po wysylce maili albo zgloszenia
// zalozone przez inne konto. Baza ich nie odwiazuje sama; organizator
// decyduje. Dol - dziennik odwiazan: naprawa historii i decyzje organizatora,
// z przywroceniem. Przywrocenie to JAWNY, LOGOWANY atest - organizator
// poswiadcza, ze konto nalezy do osoby, choc regula tego nie potwierdza.
//
// POTWIERDZENIE PRZED KAZDA ZMIANA. Odwiazanie zabiera uczestnikowi panel
// i „Moje zgloszenia", przywrocenie oddaje kontu cudze dane, jesli decyzja
// jest bledna - oba ida przez okno potwierdzenia z opisem skutku.
//
// BRAMKA ROLI JEST W BAZIE (`assert_event_admin_tenant()`): redaktor dostanie
// `forbidden`, ktory mapa odmow zamienia na zdanie.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2Off, Loader2, RotateCcw, ShieldAlert, UserCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  fetchAccountBindings,
  restorePersonAccount,
  unbindPersonAccount,
  type AccountBindingsOverview,
} from "@/lib/events/accountBindingsAdminApi";
import { adminRegistrationErrorMessage } from "@/lib/events/adminRegistrationErrors";
import { formatDateTime } from "@/lib/i18n/format";
import { ensureI18n } from "@/lib/i18n-admin-event-registration";

ensureI18n();

const KEY = ["admin", "event-account-bindings"] as const;

type Pending =
  | { kind: "unbind"; personId: string; name: string }
  | { kind: "restore"; unbindId: string; name: string };

function fullName(first: string, last: string): string {
  return [first, last].filter((part) => part.trim() !== "").join(" ") || "-";
}

export function AccountBindingsPanel() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [pending, setPending] = useState<Pending | null>(null);

  const list = useQuery<AccountBindingsOverview>({
    queryKey: KEY,
    queryFn: fetchAccountBindings,
    staleTime: 15_000,
  });

  const unbind = useMutation({
    mutationFn: (personId: string) => unbindPersonAccount(personId),
    onSuccess: () => {
      toast.success(t("adminEventRegistration.bindings.unbound"));
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (error) => toast.error(adminRegistrationErrorMessage(error)),
  });

  const restore = useMutation({
    mutationFn: (unbindId: string) => restorePersonAccount(unbindId),
    onSuccess: () => {
      toast.success(t("adminEventRegistration.bindings.restored"));
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (error) => toast.error(adminRegistrationErrorMessage(error)),
  });

  const busy = unbind.isPending || restore.isPending;

  const confirm = (): void => {
    if (pending === null) return;
    if (pending.kind === "unbind") unbind.mutate(pending.personId);
    else restore.mutate(pending.unbindId);
    setPending(null);
  };

  if (list.isPending) {
    return (
      <div className="space-y-3" aria-busy="true">
        <p role="status" className="sr-only">
          {t("adminEventRegistration.bindings.loading")}
        </p>
        <Skeleton className="h-24 w-full rounded-[6px]" />
        <Skeleton className="h-40 w-full rounded-[6px]" />
      </div>
    );
  }

  if (list.isError) {
    return (
      <p className="flex items-start gap-2 rounded-[6px] border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        {adminRegistrationErrorMessage(list.error)}
      </p>
    );
  }

  const { unverified, unbinds } = list.data;
  // Baza sprzed 20261012180650 nie zwraca listy przegladu.
  const suspect = list.data.suspect ?? [];

  return (
    <div className="space-y-8">
      <section className="space-y-3" aria-labelledby="account-bindings-unverified">
        <h2 id="account-bindings-unverified" className="text-base font-semibold text-foreground">
          {t("adminEventRegistration.bindings.unverifiedTitle")}
        </h2>
        {unverified.length === 0 ? (
          <p className="rounded-[6px] border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
            {t("adminEventRegistration.bindings.unverifiedEmpty")}
          </p>
        ) : (
          <ul className="space-y-2">
            {unverified.map((row) => {
              const name = fullName(row.firstName, row.lastName);
              return (
                <li
                  key={row.personId}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-[6px] border border-border bg-card p-3"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-semibold text-foreground">{name}</p>
                    <p className="break-all text-xs text-muted-foreground">
                      {t("adminEventRegistration.bindings.email")}: {row.email ?? "-"}
                    </p>
                    <p className="break-all text-xs text-muted-foreground">
                      {t("adminEventRegistration.bindings.account")}: {row.accountEmailHint ?? "-"}
                      {!row.accountEmailConfirmed &&
                        ` (${t("adminEventRegistration.bindings.accountUnconfirmed")})`}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">
                        {t(`adminEventRegistration.bindings.risk.${row.risk}`)}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {t("adminEventRegistration.bindings.registrationsByAccount", {
                          count: row.registrationsByAccount,
                        })}
                      </span>
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => setPending({ kind: "unbind", personId: row.personId, name })}
                  >
                    <Link2Off className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    {t("adminEventRegistration.bindings.unbind")}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="account-bindings-suspect">
        <div className="space-y-1">
          <h2 id="account-bindings-suspect" className="text-base font-semibold text-foreground">
            {t("adminEventRegistration.bindings.suspectTitle")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("adminEventRegistration.bindings.suspectLead")}
          </p>
        </div>
        {suspect.length === 0 ? (
          <p className="rounded-[6px] border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
            {t("adminEventRegistration.bindings.suspectEmpty")}
          </p>
        ) : (
          <ul className="space-y-2">
            {suspect.map((row) => {
              const name = fullName(row.firstName, row.lastName);
              return (
                <li
                  key={row.personId}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-[6px] border border-border bg-card p-3"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-semibold text-foreground">{name}</p>
                    <p className="break-all text-xs text-muted-foreground">
                      {t("adminEventRegistration.bindings.email")}: {row.email ?? "-"}
                    </p>
                    <p className="break-all text-xs text-muted-foreground">
                      {t("adminEventRegistration.bindings.account")}: {row.accountEmailHint ?? "-"}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">
                        {t("adminEventRegistration.bindings.risk.suspect_takeover")}
                      </Badge>
                      {row.mailsElsewhere > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {t("adminEventRegistration.bindings.mailsElsewhere", {
                            count: row.mailsElsewhere,
                          })}
                        </span>
                      )}
                      {row.registrationsByOthers > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {t("adminEventRegistration.bindings.registrationsByOthers", {
                            count: row.registrationsByOthers,
                          })}
                        </span>
                      )}
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => setPending({ kind: "unbind", personId: row.personId, name })}
                  >
                    <Link2Off className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    {t("adminEventRegistration.bindings.unbind")}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="account-bindings-log">
        <h2 id="account-bindings-log" className="text-base font-semibold text-foreground">
          {t("adminEventRegistration.bindings.unbindsTitle")}
        </h2>
        {unbinds.length === 0 ? (
          <p className="rounded-[6px] border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
            {t("adminEventRegistration.bindings.unbindsEmpty")}
          </p>
        ) : (
          <ul className="space-y-2">
            {unbinds.map((entry) => {
              const name = fullName(entry.firstName, entry.lastName);
              const restorable =
                entry.restoredAt === null && !entry.accountDeleted && !entry.personBound;
              return (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-[6px] border border-border bg-card p-3"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-semibold text-foreground">{name}</p>
                    <p className="break-all text-xs text-muted-foreground">
                      {t("adminEventRegistration.bindings.email")}: {entry.email ?? "-"}
                    </p>
                    <p className="break-all text-xs text-muted-foreground">
                      {t("adminEventRegistration.bindings.account")}:{" "}
                      {entry.accountDeleted
                        ? t("adminEventRegistration.bindings.accountDeleted")
                        : (entry.accountEmailHint ?? "-")}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">
                        {t(`adminEventRegistration.bindings.risk.${entry.risk}`)}
                      </Badge>
                      <Badge variant="secondary">
                        {t(`adminEventRegistration.bindings.reason.${entry.reason}`)}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {t("adminEventRegistration.bindings.unboundAt", {
                          date: formatDateTime(entry.unboundAt, i18n.language),
                        })}
                      </span>
                      {entry.restoredAt !== null && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
                          {t("adminEventRegistration.bindings.restoredAt", {
                            date: formatDateTime(entry.restoredAt, i18n.language),
                          })}
                        </span>
                      )}
                      {entry.restoredAt === null && entry.personBound && (
                        <span className="text-xs text-muted-foreground">
                          {t("adminEventRegistration.bindings.personBound")}
                        </span>
                      )}
                    </div>
                  </div>
                  {restorable && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => setPending({ kind: "restore", unbindId: entry.id, name })}
                    >
                      <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden="true" />
                      {t("adminEventRegistration.bindings.restore")}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.kind === "restore"
                ? t("adminEventRegistration.bindings.restore")
                : t("adminEventRegistration.bindings.unbind")}
              {pending !== null && `: ${pending.name}`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.kind === "restore"
                ? t("adminEventRegistration.bindings.restoreConfirm")
                : t("adminEventRegistration.bindings.unbindConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("adminEventRegistration.bindings.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirm} disabled={busy}>
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
              {pending?.kind === "restore"
                ? t("adminEventRegistration.bindings.restore")
                : t("adminEventRegistration.bindings.unbind")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
