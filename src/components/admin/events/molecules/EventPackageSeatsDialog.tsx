// Molekuła: MIEJSCA jednego zamówienia pakietowego wraz z zaproszeniami.
//
// TOKEN POKAZUJEMY DOKŁADNIE RAZ. Baza trzyma wyłącznie skrót zaproszenia, więc
// po zamknięciu okna nie da się go odtworzyć - dlatego odnośnik zostaje na
// ekranie do momentu skopiowania i mówi to wprost, zamiast znikać po sekundzie.
//
// COFNIĘCIE MIEJSCA NIE KASUJE WIERSZA. Zamówienie ma stałą pulę: cofnięte
// miejsce wraca do puli jako zajęte historycznie, a organizator wystawia nowe
// zaproszenie - stąd stan „revoked" obok „free" zamiast usuwania.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Copy, Mail, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AdminCatalogListState } from "@/components/admin/molecules/AdminCatalogListState";
import { AdminFormTextRow } from "@/components/admin/molecules/AdminFormTextRow";
import { adminRegistrationErrorMessage } from "@/lib/events/adminRegistrationErrors";
import { formatDateTime } from "@/lib/i18n/format";
import {
  packageInviteUrl,
  type EventPackageSeatRow,
  type PackageSeatState,
} from "@/lib/events/packagesApi";
import {
  useInvitePackageSeat,
  usePackageSeats,
  useRevokePackageSeat,
} from "@/lib/events/useEventPackages";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function seatState(row: EventPackageSeatRow): PackageSeatState {
  const state = row.state;
  return state === "invited" || state === "assigned" || state === "revoked" ? state : "free";
}

interface EventPackageSeatsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  orderId: string | null;
}

export function EventPackageSeatsDialog({
  open,
  onOpenChange,
  eventId,
  orderId,
}: EventPackageSeatsDialogProps) {
  const { t, i18n } = useTranslation();
  const seatsQ = usePackageSeats(open ? orderId : null);
  const invite = useInvitePackageSeat(eventId);
  const revoke = useRevokePackageSeat(eventId);

  const [activeSeat, setActiveSeat] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [validDays, setValidDays] = useState("14");
  const [issuedLink, setIssuedLink] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    setActiveSeat(null);
    setEmail("");
    setName("");
    setValidDays("14");
    setIssuedLink(null);
  }, [open]);

  const rows = seatsQ.data ?? [];
  const fail = (error: unknown) => toast.error(adminRegistrationErrorMessage(error));

  const emailInvalid = !EMAIL_PATTERN.test(email.trim());
  const daysInvalid = !/^\d+$/.test(validDays.trim()) || Number(validDays) < 1 || Number(validDays) > 90;

  const sendInvite = () => {
    if (activeSeat === null || emailInvalid || daysInvalid) return;
    invite.mutate(
      {
        seatId: activeSeat,
        inviteEmail: email.trim(),
        inviteName: name.trim(),
        validDays: Number.parseInt(validDays, 10),
      },
      {
        onSuccess: (result) => {
          toast.success(t("adminEventRegistration.packages.seats.toasts.invited"));
          const origin = typeof window === "undefined" ? "" : window.location.origin;
          setIssuedLink(packageInviteUrl(origin, result.inviteToken));
          setActiveSeat(null);
          setEmail("");
          setName("");
        },
        onError: fail,
      },
    );
  };

  const copyLink = async () => {
    if (issuedLink === null) return;
    await navigator.clipboard.writeText(issuedLink);
    toast.success(t("adminEventRegistration.packages.seats.toasts.copied"));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="event-dialog-compact max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("adminEventRegistration.packages.seats.title")}</DialogTitle>
          <DialogDescription>
            {t("adminEventRegistration.packages.seats.subtitle")}
          </DialogDescription>
        </DialogHeader>

        {issuedLink === null ? null : (
          <div className="rounded-[6px] border border-primary/40 bg-primary/5 p-3">
            <p className="text-sm font-medium">
              {t("adminEventRegistration.packages.seats.tokenTitle")}
            </p>
            <p className="mt-1 break-all font-mono text-xs">{issuedLink}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("adminEventRegistration.packages.seats.tokenHint")}
            </p>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => void copyLink()}>
              <Copy className="mr-2 h-3.5 w-3.5" />
              {t("adminEventRegistration.packages.seats.copyAction")}
            </Button>
          </div>
        )}

        <AdminCatalogListState
          isLoading={seatsQ.isLoading}
          errorMessage={
            seatsQ.error === null ? null : adminRegistrationErrorMessage(seatsQ.error)
          }
          isEmpty={rows.length === 0}
          loadingLabel={t("adminEventRegistration.packages.seats.loading")}
          emptyLabel={t("adminEventRegistration.packages.seats.empty")}
        >
          <ul className="space-y-2">
            {rows.map((row) => {
              const state = seatState(row);
              const isEditing = activeSeat === row.id;
              return (
                <li key={row.id} className="rounded-[6px] border border-border/70 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={state === "assigned" ? "default" : "outline"}>
                      {t(`adminEventRegistration.packages.seats.states.${state}`)}
                    </Badge>
                    <span className="text-sm">
                      {row.attendee_name !== null && row.attendee_name !== ""
                        ? row.attendee_name
                        : (row.invite_email ?? "-")}
                    </span>
                    {row.invite_expires_at === null || state !== "invited" ? null : (
                      <span className="text-xs text-muted-foreground">
                        {t("adminEventRegistration.packages.seats.expiresAt", {
                          date: formatDateTime(row.invite_expires_at, i18n.language),
                        })}
                      </span>
                    )}
                    <div className="ml-auto flex gap-2">
                      {state === "assigned" ? null : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setActiveSeat(isEditing ? null : row.id);
                            setIssuedLink(null);
                          }}
                        >
                          <Mail className="mr-2 h-3.5 w-3.5" />
                          {t("adminEventRegistration.packages.seats.inviteAction")}
                        </Button>
                      )}
                      {state === "free" || state === "revoked" ? null : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            revoke.mutate(row.id, {
                              onSuccess: () =>
                                toast.success(
                                  t("adminEventRegistration.packages.seats.toasts.revoked"),
                                ),
                              onError: fail,
                            })
                          }
                        >
                          <Undo2 className="mr-2 h-3.5 w-3.5" />
                          {t("adminEventRegistration.packages.seats.revokeAction")}
                        </Button>
                      )}
                    </div>
                  </div>

                  {!isEditing ? null : (
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <AdminFormTextRow
                        label={t("adminEventRegistration.packages.seats.inviteEmail")}
                        value={email}
                        onValueChange={setEmail}
                        type="email"
                        maxLength={200}
                        error={
                          email !== "" && emailInvalid
                            ? t("adminEventRegistration.errors.packageSeatEmail")
                            : null
                        }
                      />
                      <AdminFormTextRow
                        label={t("adminEventRegistration.packages.seats.inviteName")}
                        value={name}
                        onValueChange={setName}
                        maxLength={200}
                      />
                      <AdminFormTextRow
                        label={t("adminEventRegistration.packages.seats.validDays")}
                        value={validDays}
                        onValueChange={setValidDays}
                        inputMode="numeric"
                        error={
                          daysInvalid
                            ? t("adminEventRegistration.errors.packageSeatValidDays")
                            : null
                        }
                      />
                      <div className="sm:col-span-3">
                        <Button
                          size="sm"
                          onClick={sendInvite}
                          disabled={invite.isPending || emailInvalid || daysInvalid}
                        >
                          {t("adminEventRegistration.packages.seats.send")}
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </AdminCatalogListState>
      </DialogContent>
    </Dialog>
  );
}
