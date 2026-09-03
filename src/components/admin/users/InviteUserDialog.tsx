// Kompaktowa modalka pojedynczego zaproszenia użytkownika.
//
// Układ: po lewej kafel awataru (zdjęcie z dysku albo inicjały wyliczone
// z imienia i nazwiska), po prawej dwukolumnowa siatka pól. Zdjęcie i LinkedIn
// lecą w `metadata` zaproszenia - warstwa serwerowa przepisuje je do
// `profiles.avatar_url` / `profiles.linkedin_url` przy tworzeniu konta.
// „Autoakceptacja” oznacza zaproszenie zamknięte od razu po utworzeniu konta
// (status `accepted`), bez czekania na pierwsze logowanie.
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-team-media";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Upload, X, Loader2 } from "@/lib/lucide-shim";
import { supabase } from "@/integrations/supabase/client";
import { useRequiredTenant } from "@/hooks/useAuth";
import { createInvitations, sendInvitation } from "@/lib/admin/invitations.functions";
import { useServerFn } from "@tanstack/react-start";
import {
  initialsFromNameParts,
  isLinkedInInputValid,
  normalizeLinkedInUrl,
} from "@/lib/admin/inviteIdentity";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone?: () => void;
}

const ROLES = ["admin", "editor", "author", "user"] as const;
type Role = (typeof ROLES)[number];
const MODES = ["magic_link", "temp_password"] as const;
type Mode = (typeof MODES)[number];

const isRole = (v: string): v is Role => (ROLES as readonly string[]).includes(v);
const isMode = (v: string): v is Mode => (MODES as readonly string[]).includes(v);

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export function InviteUserDialog({ open, onOpenChange, onDone }: Props) {
  const { t } = useTranslation();
  const tenantId = useRequiredTenant();
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [photo, setPhoto] = useState("");
  const [role, setRole] = useState<Role>("author");
  const [mode, setMode] = useState<Mode>("magic_link");
  const [autoAccept, setAutoAccept] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const create = useServerFn(createInvitations);
  const send = useServerFn(sendInvitation);

  const initials = useMemo(() => initialsFromNameParts(firstName, lastName), [firstName, lastName]);
  const displayName = useMemo(
    () => `${firstName.trim()} ${lastName.trim()}`.trim(),
    [firstName, lastName],
  );
  const linkedinOk = isLinkedInInputValid(linkedin);

  const reset = () => {
    setEmail("");
    setFirstName("");
    setLastName("");
    setLinkedin("");
    setPhoto("");
    setAutoAccept(true);
  };

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error(t("adminTeamMedia.inviteUser.photoTypeError"));
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      toast.error(t("adminTeamMedia.inviteUser.photoSizeError"));
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `${tenantId}/invites/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage
        .from("media")
        .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type });
      if (error) throw error;
      const { data } = supabase.storage.from("media").getPublicUrl(path);
      setPhoto(data.publicUrl);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    const first = firstName.trim();
    const last = lastName.trim();
    if (!email || !first || !last || !linkedinOk) return;
    setBusy(true);
    try {
      const linkedinUrl = normalizeLinkedInUrl(linkedin);
      const r = await create({
        data: {
          items: [
            {
              email,
              display_name: displayName,
              role,
              mode,
              source: "manual",
              metadata: {
                ...(photo ? { photo } : {}),
                ...(linkedinUrl ? { linkedin: linkedinUrl } : {}),
                auto_accept: autoAccept,
              },
            },
          ],
        },
      });
      const id = r.ids[0];
      if (!id) throw new Error("no_id");
      const s = await send({ data: { id } });
      if (s.ok) {
        toast.success(t("adminTeamMedia.inviteUser.sent"));
        if (s.tempPassword)
          toast.info(t("adminTeamMedia.inviteUser.tempPassword", { pw: s.tempPassword }));
      } else {
        toast.error(s.error ?? "failed");
      }
      onDone?.();
      onOpenChange(false);
      reset();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] w-[calc(100vw-2rem)] max-w-xl overflow-y-auto overflow-x-hidden rounded-[6px]">
        <DialogHeader>
          <DialogTitle className="pr-8 break-words">
            {t("adminTeamMedia.inviteUser.title")}
          </DialogTitle>
        </DialogHeader>

        <div className="flex w-full min-w-0 flex-col gap-4 sm:flex-row">
          <div className="flex shrink-0 flex-col items-center gap-2">
            <div
              data-testid="invite-avatar"
              className="relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-[6px] border border-border bg-muted/50"
            >
              {photo ? (
                <img src={photo} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="text-2xl font-semibold tracking-wide text-muted-foreground">
                  {initials || "?"}
                </span>
              )}
              {uploading ? (
                <span className="absolute inset-0 flex items-center justify-center bg-background/70">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </span>
              ) : null}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              data-testid="invite-photo-input"
              onChange={(e) => void pickPhoto(e.target.files?.[0])}
            />
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="rounded-[6px]"
                disabled={uploading || busy}
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="mr-1 h-3.5 w-3.5" />
                {t("adminTeamMedia.inviteUser.photo")}
              </Button>
              {photo ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="rounded-[6px]"
                  aria-label={t("adminTeamMedia.inviteUser.photoRemove")}
                  onClick={() => setPhoto("")}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              ) : null}
            </div>
          </div>

          <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
            <div className="grid min-w-0 gap-1">
              <Label htmlFor="invite-email">{t("adminTeamMedia.inviteUser.email")}</Label>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="grid min-w-0 gap-1">
              <Label htmlFor="invite-first-name">{t("adminTeamMedia.inviteUser.firstName")}</Label>
              <Input
                id="invite-first-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>
            <div className="grid min-w-0 gap-1">
              <Label htmlFor="invite-last-name">{t("adminTeamMedia.inviteUser.lastName")}</Label>
              <Input
                id="invite-last-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
            <div className="grid min-w-0 gap-1 sm:col-span-2">
              <Label htmlFor="invite-linkedin">{t("adminTeamMedia.inviteUser.linkedin")}</Label>
              <Input
                id="invite-linkedin"
                value={linkedin}
                aria-invalid={!linkedinOk}
                placeholder="linkedin.com/in/..."
                onChange={(e) => setLinkedin(e.target.value)}
              />
              {!linkedinOk ? (
                <p className="text-xs text-destructive">
                  {t("adminTeamMedia.inviteUser.linkedinError")}
                </p>
              ) : null}
            </div>
            <div className="grid min-w-0 gap-1">
              <Label>{t("adminTeamMedia.inviteUser.role")}</Label>
              <Select value={role} onValueChange={(v) => isRole(v) && setRole(v)}>
                <SelectTrigger className="w-full min-w-0">
                  <SelectValue className="truncate" />
                </SelectTrigger>

                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="editor">Editor</SelectItem>
                  <SelectItem value="author">Author</SelectItem>
                  <SelectItem value="user">User</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid min-w-0 gap-1">
              <Label>{t("adminTeamMedia.inviteUser.mode")}</Label>
              <Select value={mode} onValueChange={(v) => isMode(v) && setMode(v)}>
                <SelectTrigger className="w-full min-w-0">
                  <SelectValue className="truncate" />
                </SelectTrigger>

                <SelectContent>
                  <SelectItem value="magic_link">
                    {t("adminTeamMedia.inviteUser.modeMagic")}
                  </SelectItem>
                  <SelectItem value="temp_password">
                    {t("adminTeamMedia.inviteUser.modeTempPassword")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-start gap-2 sm:col-span-2">
              <Checkbox
                checked={autoAccept}
                onCheckedChange={(v) => setAutoAccept(v === true)}
                aria-label={t("adminTeamMedia.inviteUser.autoAccept")}
              />
              <span className="text-sm leading-tight">
                {t("adminTeamMedia.inviteUser.autoAccept")}
                <span className="block text-xs text-muted-foreground">
                  {t("adminTeamMedia.inviteUser.autoAcceptHint")}
                </span>
              </span>
            </label>
          </div>
        </div>

        <DialogFooter className="flex-wrap gap-2">
          <Button
            variant="ghost"
            className="rounded-[6px]"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {t("common.cancel")}
          </Button>
          <Button
            className="rounded-[6px]"
            onClick={submit}
            disabled={
              busy || uploading || !email || !firstName.trim() || !lastName.trim() || !linkedinOk
            }
          >
            {busy ? "..." : t("adminTeamMedia.inviteUser.send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
