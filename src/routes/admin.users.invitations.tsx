// Lista zaproszeń użytkowników - filtrowanie po statusie, ponowne wysłanie,
// wycofanie. Dostęp tylko dla admin/super_admin (RLS + server-fn check).
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, Clock3, Mail, Search, TriangleAlert, UserRoundCheck } from "@/lib/lucide-shim";
import {
  listInvitations,
  sendInvitation,
  revokeInvitation,
} from "@/lib/admin/invitations.functions";
import { adminToast } from "@/lib/adminToasts";
import { ensureI18n as ensureAdminMiscRoutesI18n } from "@/lib/i18n-admin-misc-routes";
export const Route = createFileRoute("/admin/users/invitations")({
  component: InvitationsPage,
  head: () => ({
    meta: [
      { title: "Zaproszenia użytkowników | New European Strategies" },
      { name: "description", content: "Statusy zaproszeń i aktywacji kont użytkowników." },
      { property: "og:title", content: "Zaproszenia użytkowników | New European Strategies" },
      { property: "og:description", content: "Statusy zaproszeń i aktywacji kont użytkowników." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function InvitationsPage() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureAdminMiscRoutesI18n();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const list = useServerFn(listInvitations);
  const resend = useServerFn(sendInvitation);
  const revoke = useServerFn(revokeInvitation);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");

  const { data } = useQuery({
    queryKey: ["user-invitations"],
    queryFn: () => list(),
  });

  const doResend = async (id: string) => {
    const r = await resend({ data: { id } });
    if (r.ok) {
      toast.success(adminToast.sent());
      if (r.tempPassword)
        toast.info(t("adminMiscRoutes.invitations.passwordToast", { password: r.tempPassword }));
    } else toast.error(r.error ?? "failed");
    qc.invalidateQueries({ queryKey: ["user-invitations"] });
  };

  const doRevoke = async (id: string) => {
    await revoke({ data: { id } });
    qc.invalidateQueries({ queryKey: ["user-invitations"] });
  };

  const invitations = data?.invitations ?? [];
  const stats = useMemo(
    () => ({
      all: invitations.length,
      waiting: invitations.filter((inv) => inv.status === "pending" || inv.status === "sent").length,
      failed: invitations.filter((inv) => inv.status === "failed" || inv.send_count >= 5).length,
      accepted: invitations.filter((inv) => inv.status === "accepted" || inv.accepted_at).length,
    }),
    [invitations],
  );
  const visible = useMemo(() => {
    const q = search.trim().toLocaleLowerCase();
    return invitations.filter((inv) => {
      const activated = inv.status === "accepted" || Boolean(inv.accepted_at);
      const matchesStatus =
        status === "all" ||
        (status === "accepted" && activated) ||
        (status === "waiting" && (inv.status === "pending" || inv.status === "sent")) ||
        (status === "failed" && (inv.status === "failed" || inv.send_count >= 5)) ||
        (status === "revoked" && inv.status === "revoked");
      const matchesSearch =
        !q ||
        inv.email.toLocaleLowerCase().includes(q) ||
        (inv.display_name ?? "").toLocaleLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
  }, [invitations, search, status]);

  const date = (value: string | null) =>
    value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "-";

  const statusLabel = (value: string, activated: boolean) => {
    if (activated) return t("adminMiscRoutes.invitations.statusAccepted");
    return t(`adminMiscRoutes.invitations.status${value.charAt(0).toUpperCase()}${value.slice(1)}`);
  };

  return (
    <div className="min-w-0 font-display">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">{t("adminMiscRoutes.invitations.pageTitle")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("adminMiscRoutes.invitations.intro")}</p>
        </div>
        <Button asChild variant="outline"><Link to="/admin/users">{t("adminMiscRoutes.invitations.allUsers")}</Link></Button>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["all", stats.all, Mail],
          ["waiting", stats.waiting, Clock3],
          ["failed", stats.failed, TriangleAlert],
          ["accepted", stats.accepted, UserRoundCheck],
        ].map(([key, value, Icon]) => (
          <button key={String(key)} type="button" onClick={() => setStatus(String(key))} className="flex min-h-20 items-center gap-3 rounded-[6px] border border-border bg-card p-4 text-left transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="grid size-10 shrink-0 place-items-center rounded-[6px] bg-muted"><Icon className="size-5" /></span>
            <span><span className="block text-2xl font-semibold">{value}</span><span className="text-xs text-muted-foreground">{t(`adminMiscRoutes.invitations.summary${String(key).charAt(0).toUpperCase()}${String(key).slice(1)}`)}</span></span>
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("adminMiscRoutes.invitations.searchPlaceholder")} className="pl-9" /></div>
        <Select value={status} onValueChange={setStatus}><SelectTrigger className="w-full sm:w-56"><SelectValue /></SelectTrigger><SelectContent>
          {(["all", "waiting", "failed", "accepted", "revoked"] as const).map((value) => <SelectItem key={value} value={value}>{t(`adminMiscRoutes.invitations.filter${value.charAt(0).toUpperCase()}${value.slice(1)}`)}</SelectItem>)}
        </SelectContent></Select>
      </div>

      <div className="overflow-x-auto rounded-[6px] border border-border bg-card">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left p-3">{t("adminMiscRoutes.invitations.colName")}</th>
              <th className="text-left p-3">{t("adminMiscRoutes.invitations.colEmail")}</th>
              <th className="text-left p-3">{t("adminMiscRoutes.invitations.colRole")}</th>
              <th className="text-left p-3">{t("adminMiscRoutes.invitations.colMode")}</th>
              <th className="text-left p-3">{t("adminMiscRoutes.invitations.colStatus")}</th>
              <th className="text-left p-3">{t("adminMiscRoutes.invitations.colCreated")}</th>
              <th className="text-left p-3">{t("adminMiscRoutes.invitations.colSent")}</th>
              <th className="text-left p-3">{t("adminMiscRoutes.invitations.colAccepted")}</th>
              <th className="text-left p-3">{t("adminMiscRoutes.invitations.colAttempts")}</th>
              <th className="text-right p-3">{t("adminMiscRoutes.invitations.colActions")}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((inv) => {
              const activated = inv.status === "accepted" || Boolean(inv.accepted_at);
              const sendCount = inv.send_count ?? 0;
              const canSend = !activated && inv.status !== "revoked" && sendCount < 5;
              return (
              <tr key={inv.id} className="border-t border-border">
                <td className="p-3">{inv.display_name}</td>
                <td className="p-3 text-muted-foreground">{inv.email}</td>
                <td className="p-3">
                  <Badge variant="outline">{inv.role}</Badge>
                </td>
                <td className="p-3 text-xs">{inv.mode}</td>
                <td className="p-3">
                  <Badge variant={activated ? "default" : inv.status === "failed" ? "destructive" : "secondary"} className="gap-1 rounded-[6px]">
                    {activated && <CheckCircle2 className="size-3" />}{statusLabel(inv.status, activated)}
                  </Badge>
                  {inv.last_error && (
                    <div
                      className="text-[10px] text-destructive mt-1 max-w-[200px] truncate"
                      title={inv.last_error}
                    >
                      {inv.last_error}
                    </div>
                  )}
                </td>
                <td className="p-3 text-xs text-muted-foreground">{date(inv.created_at)}</td>
                <td className="p-3 text-xs text-muted-foreground">{date(inv.sent_at)}</td>
                <td className="p-3 text-xs text-muted-foreground">{date(inv.accepted_at)}</td>
                <td className="p-3"><Badge variant={sendCount >= 5 ? "destructive" : "outline"} className="rounded-[6px] tabular-nums">{sendCount} / 5</Badge></td>
                <td className="p-3 text-right whitespace-nowrap">
                  {canSend && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => doResend(inv.id)}>
                        {inv.status === "sent"
                          ? t("adminMiscRoutes.invitations.resend")
                          : t("adminMiscRoutes.invitations.send")}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => doRevoke(inv.id)}>
                        {t("adminMiscRoutes.invitations.revoke")}
                      </Button>
                    </>
                  )}
                  {inv.auth_user_id && <Button asChild size="sm" variant="ghost"><Link to="/admin/users/$id" params={{ id: inv.auth_user_id }}>{t("adminMiscRoutes.invitations.openAccount")}</Link></Button>}
                </td>
              </tr>
            );})}
            {visible.length === 0 && (
              <tr>
                <td colSpan={10} className="p-8 text-center text-sm text-muted-foreground">
                  {t("adminMiscRoutes.invitations.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
