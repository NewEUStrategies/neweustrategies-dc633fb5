// Modal do wysłania pojedynczego zaproszenia (email + rola + tryb).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createInvitations, sendInvitation } from "@/lib/admin/invitations.functions";
import { useServerFn } from "@tanstack/react-start";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone?: () => void;
}

export function InviteUserDialog({ open, onOpenChange, onDone }: Props) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"admin" | "editor" | "author" | "user">("author");
  const [mode, setMode] = useState<"magic_link" | "temp_password">("magic_link");
  const [busy, setBusy] = useState(false);
  const create = useServerFn(createInvitations);
  const send = useServerFn(sendInvitation);

  const submit = async () => {
    if (!email || !name) return;
    setBusy(true);
    try {
      const r = await create({
        data: {
          items: [{ email, display_name: name, role, mode, source: "manual" }],
        },
      });
      const id = r.ids[0];
      if (!id) throw new Error("no_id");
      const s = await send({ data: { id } });
      if (s.ok) {
        toast.success(t("admin.users.invite.sent", { defaultValue: "Zaproszenie wysłane" }));
        if (s.tempPassword) toast.info(`Hasło tymczasowe: ${s.tempPassword}`);
      } else {
        toast.error(s.error ?? "failed");
      }
      onDone?.();
      onOpenChange(false);
      setEmail("");
      setName("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("admin.users.invite.title", { defaultValue: "Zaproś użytkownika" })}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label>E-mail</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label>{t("admin.users.name", { defaultValue: "Imię i nazwisko" })}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label>{t("admin.users.role", { defaultValue: "Rola" })}</Label>
            <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="editor">Editor</SelectItem>
                <SelectItem value="author">Author</SelectItem>
                <SelectItem value="user">User</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label>{t("admin.users.invite.mode", { defaultValue: "Tryb" })}</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="magic_link">Link aktywacyjny (user ustawia hasło)</SelectItem>
                <SelectItem value="temp_password">Login + hasło tymczasowe (email)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("common.cancel", { defaultValue: "Anuluj" })}
          </Button>
          <Button onClick={submit} disabled={busy || !email || !name}>
            {busy ? "..." : t("admin.users.invite.send", { defaultValue: "Wyślij zaproszenie" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
