// Organizm: zakładka „Zaproszenia” - cztery panele w jednym ekranie (V2 §3).
//
//   Wyślij   - przełącznik ścieżki (osoba / e-mail), pod spodem właściwa kontrolka
//   Segment  - kampania na zbiór wyliczony regułą (ścieżka D). Do 2026-08-08
//              ta ścieżka miała w bazie tabelę reguł i RPC podglądu, a w panelu
//              nic - czyli licznik „wyślę 137 zaproszeń” bez przycisku.
//   Linki    - tabela z wykorzystaniem, wygasaniem, kopiowaniem i unieważnianiem
//   Historia - wszystkie ścieżki w jednej liście, bo administrator pyta „kogo
//              zaprosiliśmy”, a nie „kogo zaprosiliśmy którą tabelą”
//
// Token linku pokazujemy RAZ, tuż po utworzeniu. Trzymanie go w widoku listy
// zamieniałoby tabelę w listę żywych zaproszeń do klubu, którą wystarczy
// sfotografować przez ramię.
//
// PO ROZŁOŻENIU NA WARSTWY ten plik jest KOMPOZYCJĄ:
//   * REGUŁY (zbiór ról bez `lead`, bramka wysyłki, dwa ładunki wysyłki,
//     przełożenie wyjątku bazy na klucz komunikatu, parsowanie limitu użyć,
//     adres zaproszenia, stan wiersza linku, klucze kanału i statusu)
//     mieszkają w `@/lib/clubs/adminClubInvites`;
//   * WIERSZE OBU TABEL mieszkają w `molecules/ClubRoster*`;
//   * tutaj zostaje SKLEJENIE: co jedzie do której mutacji i co widać po
//     odmowie z bazy.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Copy, Link2, Mail, Send, UserPlus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MemberPicker } from "@/components/admin/community/MemberPicker";
import { ConfirmDialog, type ConfirmState } from "@/components/admin/ConfirmDialog";
import { ClubEnumSelect } from "@/components/clubs/molecules/ClubEnumSelect";
import { ClubRosterInviteHistoryRow } from "../molecules/ClubRosterInviteHistoryRow";
import { ClubRosterInviteLinkRow } from "../molecules/ClubRosterInviteLinkRow";
import { ClubSegmentCampaign } from "./ClubSegmentCampaign";
import {
  useClubInvitations,
  useClubInviteLinks,
  useCreateClubInviteLink,
  useInviteClubMember,
  useInviteClubMemberByEmail,
  useRevokeClubInviteLink,
} from "@/lib/clubs/useClubs";
import {
  CLUB_INVITE_REVOKE_PROMPT,
  INVITABLE_CLUB_ROLES,
  canSendClubInvite,
  clubInviteErrorKey,
  clubInviteJoinUrl,
  clubInviteLinkPayload,
  clubInviteSendPayload,
  toClubInvitationView,
  toClubInviteLinkView,
  type ClubInviteMode,
  type InvitableClubRole,
} from "@/lib/clubs/adminClubInvites";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";

export function ClubInvitationsTab({ clubId }: { clubId: string }) {
  ensureAdminClubsI18n();
  const { t, i18n } = useTranslation();
  const [mode, setMode] = useState<ClubInviteMode>("person");
  const [userId, setUserId] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [role, setRole] = useState<InvitableClubRole>("member");
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
  const reportError = (error: unknown) => toast.error(t(clubInviteErrorKey(error)));

  const draft = { mode, userId, email, role, message };

  const handleSend = () => {
    const payload = clubInviteSendPayload(draft);
    if (payload === null) return;
    if (payload.channel === "direct") {
      inviteM.mutate(
        { userId: payload.userId, role: payload.role, message: payload.message },
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
    inviteEmailM.mutate(
      { email: payload.email, role: payload.role },
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
    createLinkM.mutate(clubInviteLinkPayload({ label: linkLabel, maxUses: linkMaxUses, role }), {
      onSuccess: ({ token }) => {
        setFreshToken(token);
        setLinkLabel("");
        setLinkMaxUses("");
        toast.success(t("adminClubs.invitations.linkCreated"));
      },
      onError: reportError,
    });
  };

  const copyLink = (token: string) =>
    void navigator.clipboard.writeText(clubInviteJoinUrl(window.location.origin, token)).then(
      () => toast.success(t("adminClubs.invitations.linkCopied")),
      () => toast.error(t("adminClubs.saveFailed")),
    );

  /** Unieważnienie linku jest NIEODWRACALNE - idzie przez potwierdzenie. */
  const confirmRevoke = (linkId: string) =>
    setConfirm({
      title: t(CLUB_INVITE_REVOKE_PROMPT.titleKey),
      description: t(CLUB_INVITE_REVOKE_PROMPT.bodyKey),
      destructive: true,
      onConfirm: () =>
        revokeM.mutateAsync(linkId).then(
          () => {
            toast.success(t(CLUB_INVITE_REVOKE_PROMPT.successKey));
          },
          () => {
            toast.error(t("adminClubs.saveFailed"));
          },
        ),
    });

  const sending = inviteM.isPending || inviteEmailM.isPending;
  const links = linksQ.data ?? [];
  const invitations = invitationsQ.data ?? [];

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
                  onChange={(event) => setEmail(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {t("adminClubs.invitations.emailHint")}
                </p>
              </div>
            )}

            {/* Rola powyżej `lead` NIE JEST OFEROWANA - patrz nagłówek
                `adminClubInvites.ts`. Lista powstaje z odsiania słownika. */}
            <ClubEnumSelect
              id="club-invite-role"
              label={t("adminClubs.columns.role")}
              value={role}
              options={INVITABLE_CLUB_ROLES}
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
                onChange={(event) => setMessage(event.target.value)}
              />
            </div>
          ) : null}

          <Button onClick={handleSend} disabled={sending || !canSendClubInvite(draft)}>
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
                onChange={(event) => setLinkLabel(event.target.value)}
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
                onChange={(event) => setLinkMaxUses(event.target.value)}
              />
            </div>
            <Button variant="outline" onClick={handleCreateLink} disabled={createLinkM.isPending}>
              {t("adminClubs.invitations.createLink")}
            </Button>
          </div>

          {/* Token widoczny RAZ - potem tylko etykieta i licznik użyć. */}
          {freshToken === null ? null : (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
              <code className="min-w-0 flex-1 truncate text-xs">
                {clubInviteJoinUrl(window.location.origin, freshToken)}
              </code>
              <Button size="sm" variant="outline" onClick={() => copyLink(freshToken)}>
                <Copy className="mr-1.5 h-3.5 w-3.5" />
                {t("adminClubs.invitations.copy")}
              </Button>
              <p className="w-full text-xs text-muted-foreground">
                {t("adminClubs.invitations.tokenOnceHint")}
              </p>
            </div>
          )}

          {linksQ.isPending ? (
            <div className="h-16 animate-pulse rounded-lg bg-muted/50" aria-busy="true" />
          ) : links.length === 0 ? (
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
                  {links.map((link) => (
                    <ClubRosterInviteLinkRow
                      key={link.id}
                      view={toClubInviteLinkView(link)}
                      language={i18n.language}
                      pending={revokeM.isPending}
                      onRevoke={() => confirmRevoke(link.id)}
                    />
                  ))}
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
          ) : invitations.length === 0 ? (
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
                  {invitations.map((row) => {
                    const view = toClubInvitationView(row);
                    return (
                      <ClubRosterInviteHistoryRow
                        key={view.key}
                        view={view}
                        language={i18n.language}
                      />
                    );
                  })}
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
