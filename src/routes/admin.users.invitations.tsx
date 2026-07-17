// Lista zaproszeń użytkowników - filtrowanie po statusie, ponowne wysłanie,
// wycofanie. Dostęp tylko dla admin/super_admin (RLS + server-fn check).
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  listInvitations,
  sendInvitation,
  revokeInvitation,
} from "@/lib/admin/invitations.functions";

export const Route = createFileRoute("/admin/users/invitations")({
  component: InvitationsPage,
});

function InvitationsPage() {
  const qc = useQueryClient();
  const list = useServerFn(listInvitations);
  const resend = useServerFn(sendInvitation);
  const revoke = useServerFn(revokeInvitation);

  const { data } = useQuery({
    queryKey: ["user-invitations"],
    queryFn: () => list(),
  });

  const doResend = async (id: string) => {
    const r = await resend({ data: { id } });
    if (r.ok) {
      toast.success("Wysłano");
      if (r.tempPassword) toast.info(`Hasło: ${r.tempPassword}`);
    } else toast.error(r.error ?? "failed");
    qc.invalidateQueries({ queryKey: ["user-invitations"] });
  };

  const doRevoke = async (id: string) => {
    await revoke({ data: { id } });
    qc.invalidateQueries({ queryKey: ["user-invitations"] });
  };

  const invitations = data?.invitations ?? [];

  return (
    <div>
      <h1 className="font-display text-3xl font-bold mb-6">Zaproszenia</h1>
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left p-3">Imię</th>
              <th className="text-left p-3">E-mail</th>
              <th className="text-left p-3">Rola</th>
              <th className="text-left p-3">Tryb</th>
              <th className="text-left p-3">Status</th>
              <th className="text-left p-3">Źródło</th>
              <th className="text-left p-3">Wysłano</th>
              <th className="text-right p-3">Akcje</th>
            </tr>
          </thead>
          <tbody>
            {invitations.map((inv) => (
              <tr key={inv.id} className="border-t border-border">
                <td className="p-3">{inv.display_name}</td>
                <td className="p-3 text-muted-foreground">{inv.email}</td>
                <td className="p-3">
                  <Badge variant="outline">{inv.role}</Badge>
                </td>
                <td className="p-3 text-xs">{inv.mode}</td>
                <td className="p-3">
                  <Badge
                    variant={
                      inv.status === "sent"
                        ? "default"
                        : inv.status === "accepted"
                          ? "default"
                          : inv.status === "failed"
                            ? "destructive"
                            : "secondary"
                    }
                  >
                    {inv.status}
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
                <td className="p-3 text-xs text-muted-foreground">{inv.source ?? "-"}</td>
                <td className="p-3 text-xs text-muted-foreground">
                  {inv.sent_at ? new Date(inv.sent_at).toLocaleString("pl-PL") : "-"}
                </td>
                <td className="p-3 text-right whitespace-nowrap">
                  {inv.status !== "revoked" && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => doResend(inv.id)}>
                        {inv.status === "sent" ? "Ponów" : "Wyślij"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => doRevoke(inv.id)}>
                        Wycofaj
                      </Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {invitations.length === 0 && (
              <tr>
                <td colSpan={8} className="p-6 text-center text-sm text-muted-foreground">
                  Brak zaproszeń
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
