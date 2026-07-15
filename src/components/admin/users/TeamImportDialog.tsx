// Modal do zbiorczego importu zespołu z widgetów team-member na wskazanej stronie.
// Preview + wybór osób + tryb wysyłki + opcjonalne linkowanie widgetów po imporcie.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  previewTeamImport,
  createInvitations,
  sendInvitationsBulk,
  linkTeamWidgets,
  provisionTeamMembers,
  type TeamImportCandidate,
} from "@/lib/admin/invitations.functions";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pageSlug?: string;
  onDone?: () => void;
}

export function TeamImportDialog({ open, onOpenChange, pageSlug = "o-nas", onDone }: Props) {
  const [candidates, setCandidates] = useState<TeamImportCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"magic_link" | "temp_password">("magic_link");
  const [role, setRole] = useState<"admin" | "editor" | "author" | "user">("author");
  const [autoLink, setAutoLink] = useState(true);
  const [sendNow, setSendNow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  const preview = useServerFn(previewTeamImport);
  const create = useServerFn(createInvitations);
  const bulkSend = useServerFn(sendInvitationsBulk);
  const link = useServerFn(linkTeamWidgets);
  const provision = useServerFn(provisionTeamMembers);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    preview({ data: { pageSlug } })
      .then((r) => {
        setCandidates(r.candidates);
        // domyślnie zaznacz tych, którzy jeszcze nie mają konta ani zaproszenia
        setSelected(new Set(r.candidates.filter((c) => !c.existingUserId && !c.existingInvitationId).map((c) => c.email)));
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [open, pageSlug, preview]);

  const toggle = (email: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(email)) n.delete(email); else n.add(email);
      return n;
    });
  };

  const run = async () => {
    setBusy(true);
    try {
      const items = candidates
        .filter((c) => selected.has(c.email) && !c.existingUserId)
        .map((c) => ({
          email: c.email,
          display_name: c.name,
          role,
          mode,
          source: `team_import:${pageSlug}`,
          metadata: {
            widgetId: c.widgetId,
            position_pl: c.position_pl,
            position_en: c.position_en,
            programLabel_pl: c.programLabel_pl,
            programLabel_en: c.programLabel_en,
            photo: c.photo,
            phone: c.phone,
            bio_pl: c.bio_pl,
            bio_en: c.bio_en,
            linkedin: c.linkedin,
            facebook: c.facebook,
            instagram: c.instagram,
            website: c.website,
          },
        }));

      if (items.length === 0) {
        toast.info("Brak nowych osób do zaproszenia");
        return;
      }

      const r = await create({ data: { items } });
      toast.success(`Utworzono ${r.created} zaproszeń`);

      if (sendNow && r.ids.length > 0) {
        const s = await bulkSend({ data: { ids: r.ids } });
        const ok = s.results.filter((x) => x.ok).length;
        const fail = s.results.length - ok;
        toast.success(`Wysłano ${ok} / błędy: ${fail}`);
      }

      if (autoLink) {
        const l = await link({ data: { pageSlug } });
        toast.success(`Powiązano ${l.updated} widgetów w /${pageSlug}`);
      }

      onDone?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Import zespołu z /{pageSlug}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 py-2">
          <div>
            <Label>Rola dla wszystkich</Label>
            <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="author">Author</SelectItem>
                <SelectItem value="editor">Editor</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="user">User</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Tryb wysyłki</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="magic_link">Link aktywacyjny</SelectItem>
                <SelectItem value="temp_password">Login + hasło tymczasowe</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <Checkbox checked={autoLink} onCheckedChange={(v) => setAutoLink(v === true)} />
            Po imporcie powiąż widgety z profilami
          </label>
          <label className="flex items-center gap-2">
            <Checkbox checked={sendNow} onCheckedChange={(v) => setSendNow(v === true)} />
            Wyślij zaproszenia od razu
          </label>
        </div>

        <div className="flex-1 overflow-auto border border-border rounded mt-2">
          {loading ? (
            <div className="p-6 text-sm text-muted-foreground">Ładowanie…</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase">
                <tr>
                  <th className="p-2 w-8"></th>
                  <th className="p-2 text-left">Imię</th>
                  <th className="p-2 text-left">E-mail</th>
                  <th className="p-2 text-left">Funkcja</th>
                  <th className="p-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => {
                  const exists = !!c.existingUserId;
                  return (
                    <tr key={c.email} className="border-t border-border">
                      <td className="p-2">
                        <Checkbox
                          checked={selected.has(c.email)}
                          disabled={exists}
                          onCheckedChange={() => toggle(c.email)}
                        />
                      </td>
                      <td className="p-2">{c.name}</td>
                      <td className="p-2 text-muted-foreground">{c.email}</td>
                      <td className="p-2 text-xs">{c.programLabel_pl ?? c.position_pl ?? c.position_en ?? "-"}</td>
                      <td className="p-2 text-xs">
                        {exists ? (
                          <span className="text-emerald-600">konto istnieje</span>
                        ) : c.existingInvitationId ? (
                          <span className="text-amber-600">zaproszenie w kolejce</span>
                        ) : (
                          <span className="text-muted-foreground">nowy</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <DialogFooter className="flex-wrap gap-2">
          <div className="flex-1 text-xs text-muted-foreground">
            Zaznaczono: {selected.size} / {candidates.length}
          </div>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Anuluj</Button>
          <Button
            variant="outline"
            disabled={busy || candidates.length === 0}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await provision({ data: { pageSlug, role, autoLink } });
                toast.success(
                  `Utworzono ${r.created} kont, pominięto ${r.skipped}, powiązano ${r.linked} widgetów`,
                );
                if (r.errors.length > 0) {
                  toast.error(`Błędy: ${r.errors.length} (${r.errors[0].email}: ${r.errors[0].error})`);
                }
                onDone?.();
                onOpenChange(false);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "..." : "Utwórz konta (bez maili)"}
          </Button>
          <Button onClick={run} disabled={busy || selected.size === 0}>
            {busy ? "..." : "Utwórz zaproszenia"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
