// Organizm: zakładka "Zaproszenia" - cztery panele w jednym ekranie (V2 §3).
//
//   Wyślij   - przełącznik ścieżki (osoba / e-mail), pod spodem właściwa kontrolka
//   Segment  - kampania na zbiór wyliczony regułą (ścieżka D). Do 2026-08-08
//              ta ścieżka miała w bazie tabelę reguł i RPC podglądu, a w panelu
//              nic - czyli licznik "wyślę 137 zaproszeń" bez przycisku.
//   Linki    - tabela z wykorzystaniem, wygasaniem, kopiowaniem i unieważnianiem
//   Historia - wszystkie ścieżki w jednej liście, bo administrator pyta "kogo
//              zaprosiliśmy", a nie "kogo zaprosiliśmy którą tabelą"
//
// Token linku pokazujemy RAZ, tuż po utworzeniu. Trzymanie go w widoku listy
// zamieniałoby tabelę w listę żywych zaproszeń do klubu, którą wystarczy
// sfotografować przez ramię.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Copy, Link2, Mail, Send, UserPlus, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { MemberPicker } from "@/components/admin/community/MemberPicker";
import { ConfirmDialog, type ConfirmState } from "@/components/admin/ConfirmDialog";
import { ClubEnumSelect } from "@/components/clubs/molecules/ClubEnumSelect";
import { ClubSegmentCampaign } from "./ClubSegmentCampaign";
import {
  useClubInvitations,
  useClubInviteLinks,
  useCreateClubInviteLink,
  useInviteClubMember,
  useInviteClubMemberByEmail,
  useRevokeClubInviteLink,
} from "@/lib/clubs/useClubs";
import { toClubInviteError, type ClubMemberRole } from "@/lib/clubs/types";
import { formatDateShort } from "@/lib/i18n/format";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";

/** Role możliwe do nadania zaproszeniem masowym. `lead` celowo poza listą. */
const INVITABLE_ROLES = ["moderator", "member", "observer"] as const;
type InvitableRole = (typeof INVITABLE_ROLES)[number];

type SendMode = "person" | "email";

export function ClubInvitationsTab({ clubId }: { clubId: string }) {
  ensureAdminClubsI18n();
  const { t, i18n } = useTranslation();
  const [mode, setMode] = useState<SendMode>("person");
  const [userId, setUserId] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [role, setRole] = useState<InvitableRole>("member");
  const [linkLabel, setLinkLabel] = useState("");
  const [linkMaxUses, setLinkMaxUses] = useState("");
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const invitationsQ = useClubInvitations(clubId);
  const linksQ = useClubInviteLinks(clubId);
  const inviteM = useInviteClubMember(clubId);
  const inviteEmailM = useInviteClubMemberByEmail(clubId);
  const createLinkM = useCreateClubInviteLink(clubId);
  const revokeM = useRevokeClubInviteLink(clubId);

  /** Komunikat błędu bierze się z kodu, nie z tekstu wyjątku bazy. */
  const reportError = (error: unknown) => {
    const code = toClubInviteError(error);
    toast.error(code ? t(`adminClubs.invitations.error.${code}`) : t("adminClubs.saveFailed"));
  };

  const handleSend = () => {
    if (mode === "person") {
      if (userId.length === 0) return;
      inviteM.mutate(
        { userId, role: role as ClubMemberRole, message: message.trim() || null },
        {
          onSuccess: () => {
            toast.success(t("adminClubs.invitations.sent"));
            setUserId("");
            setMessage("");
          },
          onError: reportError,
        },
      );
      return;
    }
    const trimmed = email.trim();
    if (trimmed.length === 0) return;
    inviteEmailM.mutate(
      { email: trimmed, role },
      {
        onSuccess: () => {
          toast.success(t("adminClubs.invitations.sent"));
          setEmail("");
        },
        onError: reportError,
      },
    );
  };

  const handleCreateLink = () => {
    const parsed = Number.parseInt(linkMaxUses, 10);
    createLinkM.mutate(
      {
        label: linkLabel.trim() || null,
        role,
        maxUses: Number.isFinite(parsed) && parsed > 0 ? parsed : null,
      },
      {
        onSuccess: ({ token }) => {
          setFreshToken(token);
          setLinkLabel("");
          setLinkMaxUses("");
          toast.success(t("adminClubs.invitations.linkCreated"));
        },
        onError: reportError,
      },
    );
  };

  const copyLink = (token: string) => {
    const url = `${window.location.origin}/club/join/${token}`;
    void navigator.clipboard.writeText(url).then(
      () => toast.success(t("adminClubs.invitations.linkCopied")),
      () => toast.error(t("adminClubs.saveFailed")),
    );
  };

  const sending = inviteM.isPending || inviteEmailM.isPending;

  return (
    <div className="space-y-6">
      {/* --- Panel 1: wyślij --- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Send className="h-4 w-4" />
            {t("adminClubs.invitations.send")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="inline-flex rounded-lg border border-border/60 bg-muted/40 p-1">
            <Button
              type="button"
              size="sm"
              variant={mode === "person" ? "default" : "ghost"}
              className="h-8 gap-1.5"
              onClick={() => setMode("person")}
            >
              <UserPlus className="h-3.5 w-3.5" />
              {t("adminClubs.invitations.modePerson")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === "email" ? "default" : "ghost"}
              className="h-8 gap-1.5"
              onClick={() => setMode("email")}
            >
              <Mail className="h-3.5 w-3.5" />
              {t("adminClubs.invitations.modeEmail")}
            </Button>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_200px]">
            {mode === "person" ? (
              <MemberPicker
                value={userId}
                onChange={setUserId}
                disabled={sending}
                labels={{
                  placeholder: t("adminClubs.invitations.modePerson"),
                  search: t("adminClubs.searchPlaceholder"),
                  hint: t("adminClubs.members.addHint"),
                  loading: t("club.retry"),
                  empty: t("adminClubs.members.empty"),
                  clear: t("adminClubs.filterAny"),
                }}
              />
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="club-invite-email">{t("adminClubs.invitations.emailLabel")}</Label>
                <Input
                  id="club-invite-email"
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  value={email}
                  disabled={sending}
                  placeholder={t("adminClubs.invitations.emailPlaceholder")}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {t("adminClubs.invitations.emailHint")}
                </p>
              </div>
            )}

            <ClubEnumSelect
              id="club-invite-role"
              label={t("adminClubs.columns.role")}
              value={role}
              options={INVITABLE_ROLES}
              i18nPrefix="club.role"
              onChange={setRole}
              disabled={sending}
            />
          </div>

          {mode === "person" ? (
            <div className="space-y-1.5">
              <Label htmlFor="club-invite-message">
                {t("adminClubs.invitations.messageLabel")}
              </Label>
              <Textarea
                id="club-invite-message"
                rows={2}
                maxLength={500}
                value={message}
                disabled={sending}
                onChange={(e) => setMessage(e.target.value)}
              />
            </div>
          ) : null}

          <Button
            onClick={handleSend}
            disabled={
              sending || (mode === "person" ? userId.length === 0 : email.trim().length === 0)
            }
          >
            <Send className="mr-2 h-4 w-4" />
            {t("adminClubs.invitations.send")}
          </Button>
        </CardContent>
      </Card>

      {/* --- Panel 2: kampania segmentowa (ścieżka D) --- */}
      <ClubSegmentCampaign clubId={clubId} />

      {/* --- Panel 3: linki --- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Link2 className="h-4 w-4" />
            {t("adminClubs.invitations.links")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="club-link-label">{t("adminClubs.invitations.linkLabel")}</Label>
              <Input
                id="club-link-label"
                value={linkLabel}
                disabled={createLinkM.isPending}
                placeholder={t("adminClubs.invitations.linkLabelPlaceholder")}
                onChange={(e) => setLinkLabel(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="club-link-max">{t("adminClubs.invitations.linkMaxUses")}</Label>
              <Input
                id="club-link-max"
                type="number"
                min={1}
                inputMode="numeric"
                value={linkMaxUses}
                disabled={createLinkM.isPending}
                onChange={(e) => setLinkMaxUses(e.target.value)}
              />
            </div>
            <Button variant="outline" onClick={handleCreateLink} disabled={createLinkM.isPending}>
              {t("adminClubs.invitations.createLink")}
            </Button>
          </div>

          {/* Token widoczny RAZ - potem tylko etykieta i licznik użyć. */}
          {freshToken ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
              <code className="min-w-0 flex-1 truncate text-xs">
                {window.location.origin}/club/join/{freshToken}
              </code>
              <Button size="sm" variant="outline" onClick={() => copyLink(freshToken)}>
                <Copy className="mr-1.5 h-3.5 w-3.5" />
                {t("adminClubs.invitations.copy")}
              </Button>
              <p className="w-full text-xs text-muted-foreground">
                {t("adminClubs.invitations.tokenOnceHint")}
              </p>
            </div>
          ) : null}

          {linksQ.isPending ? (
            <div className="h-16 animate-pulse rounded-lg bg-muted/50" aria-busy="true" />
          ) : (linksQ.data ?? []).length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {t("adminClubs.invitations.noLinks")}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border/60">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("adminClubs.invitations.linkLabel")}</TableHead>
                    <TableHead>{t("adminClubs.columns.role")}</TableHead>
                    <TableHead className="text-right">{t("adminClubs.invitations.uses")}</TableHead>
                    <TableHead>{t("adminClubs.fields.closesAt")}</TableHead>
                    <TableHead>{t("adminClubs.columns.status")}</TableHead>
                    <TableHead className="w-10 sr-only">
                      {t("adminClubs.columns.actions")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(linksQ.data ?? []).map((link) => {
                    const revoked = link.revoked_at !== null;
                    return (
                      <TableRow key={link.id}>
                        <TableCell className="font-medium">
                          {link.label ?? t("adminClubs.invitations.linkUnnamed")}
                        </TableCell>
                        <TableCell>{t(`club.role.${link.club_role}`)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {link.used_count}
                          {link.max_uses !== null ? ` / ${link.max_uses}` : ""}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {link.expires_at ? formatDateShort(link.expires_at, i18n.language) : "-"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={revoked ? "outline" : "secondary"}>
                            {revoked
                              ? t("adminClubs.invitations.revoked")
                              : t("adminClubs.invitations.activeLink")}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {!revoked ? (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              disabled={revokeM.isPending}
                              onClick={() =>
                                setConfirm({
                                  title: t("adminClubs.invitations.revokeConfirmTitle"),
                                  description: t("adminClubs.invitations.revokeConfirmBody"),
                                  destructive: true,
                                  onConfirm: () =>
                                    revokeM.mutateAsync(link.id).then(
                                      () => {
                                        toast.success(t("adminClubs.invitations.revoked"));
                                      },
                                      () => {
                                        toast.error(t("adminClubs.saveFailed"));
                                      },
                                    ),
                                })
                              }
                            >
                              <XCircle className="h-4 w-4" />
                              <span className="sr-only">
                                {t("adminClubs.invitations.revokeLink")}
                              </span>
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* --- Panel 4: historia --- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("adminClubs.invitations.history")}</CardTitle>
        </CardHeader>
        <CardContent>
          {invitationsQ.isPending ? (
            <div className="h-16 animate-pulse rounded-lg bg-muted/50" aria-busy="true" />
          ) : (invitationsQ.data ?? []).length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {t("adminClubs.invitations.noHistory")}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border/60">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("adminClubs.invitations.recipient")}</TableHead>
                    <TableHead>{t("adminClubs.invitations.channel")}</TableHead>
                    <TableHead>{t("adminClubs.columns.role")}</TableHead>
                    <TableHead>{t("adminClubs.columns.status")}</TableHead>
                    <TableHead>{t("adminClubs.invitations.inviter")}</TableHead>
                    <TableHead>{t("adminClubs.columns.joined")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(invitationsQ.data ?? []).map((row) => (
                    <TableRow key={`${row.channel}-${row.id}`}>
                      <TableCell className="font-medium">{row.recipient}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {t(`adminClubs.invitations.channelName.${row.channel}`)}
                        </Badge>
                      </TableCell>
                      <TableCell>{t(`club.role.${row.club_role}`)}</TableCell>
                      <TableCell className="text-sm">
                        {/* Prefiks słownika to `invitations`, nie `invites` -
                            literówka sprawiała, że t() zawsze schodziło do
                            defaultValue i wypisywało surowy status z bazy.
                            defaultValue znika razem z nią: brak klucza ma
                            oblewać bramkę i18n, a nie cicho pokazywać
                            angielski identyfikator w polskim interfejsie. */}
                        {t(`adminClubs.invitations.statusName.${row.status}`)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.inviter_name}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {formatDateShort(row.created_at, i18n.language)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog state={confirm} onOpenChange={(open) => !open && setConfirm(null)} />
    </div>
  );
}
