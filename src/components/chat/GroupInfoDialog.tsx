// Circle info & management: member list with roles/presence, owner-only
// rename + invite, leave for everyone. All mutations are SECURITY DEFINER
// RPCs - owner checks, candidate filtering and owner hand-off happen in the DB.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Crown, DoorOpen, Pencil, UserRoundPlus, UsersRound } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { useOnlineUsers } from "@/lib/chat/presence";
import { usePeerProfiles, useSetGroupDescription } from "@/lib/chat/useConversations";
import { useAddGroupMembers, useLeaveGroup, useRenameGroup } from "@/lib/chat/useGroups";
import type { ConversationView } from "@/lib/chat/types";
import { cn } from "@/lib/utils";
import { ChatAvatar } from "./ChatAvatar";
import { GroupMemberPicker } from "./GroupMemberPicker";

export function GroupInfoDialog({
  view,
  open,
  onClose,
  onLeft,
}: {
  view: ConversationView;
  open: boolean;
  onClose: () => void;
  /** Called after the caller successfully left the circle. */
  onLeft?: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const online = useOnlineUsers();

  const conversationId = view.conversation.id;
  const isOwner = view.me.role === "owner";
  const memberIds = [view.me.user_id, ...view.peers.map((p) => p.user_id)];
  const profilesQ = usePeerProfiles(memberIds);

  const renameGroup = useRenameGroup();
  const addMembers = useAddGroupMembers();
  const leaveGroup = useLeaveGroup();
  const setDescription = useSetGroupDescription();

  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [inviting, setInviting] = useState(false);
  const [invitees, setInvitees] = useState<ReadonlyMap<string, string>>(new Map());
  const [leaveOpen, setLeaveOpen] = useState(false);

  const title = view.conversation.title?.trim() || t("chat.group.circle");
  const description = view.conversation.description?.trim() || "";

  const startDescriptionEdit = () => {
    setDescriptionDraft(description);
    setEditingDescription(true);
  };

  const saveDescription = () => {
    setDescription.mutate(
      { conversationId, description: descriptionDraft.trim() },
      {
        onSuccess: () => {
          setEditingDescription(false);
          toast.success(t("chat.group.descriptionSaved"));
        },
        onError: () => toast.error(t("chat.group.descriptionError")),
      },
    );
  };

  const startRename = () => {
    setTitleDraft(view.conversation.title ?? "");
    setRenaming(true);
  };

  const saveRename = () => {
    const trimmed = titleDraft.trim();
    if (trimmed.length < 2 || trimmed.length > 80) {
      toast.error(t("chat.group.titleInvalid"));
      return;
    }
    renameGroup.mutate(
      { conversationId, title: trimmed },
      {
        onSuccess: () => {
          setRenaming(false);
          toast.success(t("chat.group.renamed"));
        },
        onError: () => toast.error(t("chat.group.renameError")),
      },
    );
  };

  const toggleInvitee = (id: string, name: string) => {
    setInvitees((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, name);
      return next;
    });
  };

  const submitInvites = () => {
    if (invitees.size === 0) return;
    addMembers.mutate(
      { conversationId, memberIds: [...invitees.keys()] },
      {
        onSuccess: (added) => {
          setInvitees(new Map());
          setInviting(false);
          if (added > 0) toast.success(t("chat.group.added", { count: added }));
          else toast.info(t("chat.group.noneAdded"));
        },
        onError: () => toast.error(t("chat.group.addMembersError")),
      },
    );
  };

  const confirmLeave = () => {
    setLeaveOpen(false);
    leaveGroup.mutate(conversationId, {
      onSuccess: () => {
        toast.success(t("chat.group.left"));
        onClose();
        onLeft?.();
      },
      onError: () => toast.error(t("chat.group.leaveError")),
    });
  };

  // My row first, then peers by join date (stable enough for a small list).
  const rows = [
    { participant: view.me, isMe: true },
    ...view.peers.map((participant) => ({ participant, isMe: false })),
  ];

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
        <DialogContent className="max-w-md gap-0 p-0">
          <DialogHeader className="border-b border-border/60 px-4 py-3">
            <DialogTitle className="flex items-center gap-2 text-sm">
              <UsersRound className="h-4 w-4 text-muted-foreground" aria-hidden />
              {renaming ? (
                <span className="flex flex-1 items-center gap-1.5">
                  <input
                    type="text"
                    value={titleDraft}
                    autoFocus
                    maxLength={80}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveRename();
                      if (e.key === "Escape") setRenaming(false);
                    }}
                    aria-label={t("chat.group.rename")}
                    className="h-7 min-w-0 flex-1 rounded-[6px] border border-input bg-muted/40 px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <button
                    type="button"
                    onClick={saveRename}
                    disabled={renameGroup.isPending}
                    className="h-7 shrink-0 rounded-[6px] bg-primary px-2.5 text-[11px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {t("chat.group.renameSave")}
                  </button>
                </span>
              ) : (
                <>
                  <span className="truncate">{title}</span>
                  {isOwner && (
                    <button
                      type="button"
                      onClick={startRename}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      aria-label={t("chat.group.rename")}
                      title={t("chat.group.rename")}
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  )}
                </>
              )}
            </DialogTitle>
            <DialogDescription className="text-[12px]">
              {t("chat.group.members", { count: rows.length })}
            </DialogDescription>
          </DialogHeader>

          <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto p-4">
            <section aria-label={t("chat.group.descriptionLabel")}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("chat.group.descriptionLabel")}
                </h3>
                {isOwner && !editingDescription && (
                  <button
                    type="button"
                    onClick={startDescriptionEdit}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label={t("chat.group.descriptionLabel")}
                    title={t("chat.group.descriptionLabel")}
                  >
                    <Pencil className="h-3 w-3" aria-hidden />
                  </button>
                )}
              </div>
              {editingDescription ? (
                <div className="mt-1.5 flex flex-col gap-2">
                  <textarea
                    value={descriptionDraft}
                    autoFocus
                    maxLength={500}
                    rows={3}
                    placeholder={t("chat.group.descriptionPlaceholder")}
                    onChange={(e) => setDescriptionDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setEditingDescription(false);
                    }}
                    aria-label={t("chat.group.descriptionLabel")}
                    className="w-full resize-none rounded-[6px] border border-input bg-muted/40 px-2.5 py-1.5 text-[13px] leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingDescription(false)}
                      className="h-8 rounded-[6px] border border-border/60 px-3 text-[12px] font-medium transition-colors hover:bg-muted"
                    >
                      {t("chat.close")}
                    </button>
                    <button
                      type="button"
                      onClick={saveDescription}
                      disabled={setDescription.isPending}
                      className="h-8 rounded-[6px] bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      {t("chat.group.descriptionSave")}
                    </button>
                  </div>
                </div>
              ) : (
                <p
                  className={cn(
                    "mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed",
                    description ? "text-foreground" : "italic text-muted-foreground",
                  )}
                >
                  {description || t("chat.group.descriptionEmpty")}
                </p>
              )}
            </section>

            <ul className="flex flex-col gap-0.5" aria-label={t("chat.group.membersLabel")}>
              {rows.map(({ participant, isMe }) => {
                const profile = profilesQ.data?.get(participant.user_id);
                const name = isMe ? t("chat.group.you") : (profile?.display_name ?? "...");
                return (
                  <li
                    key={participant.user_id}
                    className="flex items-center gap-2.5 rounded-[6px] px-2 py-1.5"
                  >
                    <ChatAvatar
                      name={profile?.display_name ?? name}
                      avatarUrl={profile?.avatar_url}
                      online={online.has(participant.user_id)}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{name}</span>
                    {participant.role === "owner" && (
                      <span
                        className="inline-flex shrink-0 items-center gap-1 rounded-[6px] bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                        title={t("chat.group.owner")}
                      >
                        <Crown className="h-3 w-3" aria-hidden />
                        {t("chat.group.owner")}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>

            {isOwner &&
              (inviting ? (
                <div className="rounded-[6px] border border-border/60 p-3">
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t("chat.group.addMembers")}
                  </p>
                  <GroupMemberPicker
                    selected={invitees}
                    onToggle={toggleInvitee}
                    excludeIds={new Set(memberIds)}
                  />
                  <div className="mt-2 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setInviting(false);
                        setInvitees(new Map());
                      }}
                      className="h-8 rounded-[6px] border border-border/60 px-3 text-[12px] font-medium transition-colors hover:bg-muted"
                    >
                      {t("chat.close")}
                    </button>
                    <button
                      type="button"
                      disabled={invitees.size === 0 || addMembers.isPending}
                      onClick={submitInvites}
                      className="h-8 rounded-[6px] bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      {t("chat.group.addMembers")}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setInviting(true)}
                  className="flex h-9 items-center justify-center gap-2 rounded-[6px] border border-border/60 text-[12px] font-medium transition-colors hover:bg-muted"
                >
                  <UserRoundPlus className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                  {t("chat.group.addMembers")}
                </button>
              ))}

            <button
              type="button"
              onClick={() => setLeaveOpen(true)}
              disabled={leaveGroup.isPending}
              className={cn(
                "flex h-9 items-center justify-center gap-2 rounded-[6px] border border-border/60 text-[12px] font-medium",
                "text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50",
              )}
            >
              <DoorOpen className="h-3.5 w-3.5" aria-hidden />
              {t("chat.group.leave")}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("chat.group.leave")}</AlertDialogTitle>
            <AlertDialogDescription>{t("chat.group.leaveConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("chat.close")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmLeave}>{t("chat.group.leave")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
