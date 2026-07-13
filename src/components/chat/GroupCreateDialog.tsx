// Create a circle ("krąg"): title + multi-select members. The RPC filters
// candidates server-side (tenant, blocks, allow_messages_from) and returns
// the new conversation id, which we open immediately.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { UsersRound } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCreateGroup } from "@/lib/chat/useGroups";
import { GroupMemberPicker } from "./GroupMemberPicker";

export function GroupCreateDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (conversationId: string) => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<ReadonlyMap<string, string>>(new Map());
  const createGroup = useCreateGroup();

  const reset = () => {
    setTitle("");
    setSelected(new Map());
  };

  const toggle = (id: string, name: string) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, name);
      return next;
    });
  };

  const trimmed = title.trim();
  const valid = trimmed.length >= 2 && trimmed.length <= 80 && selected.size > 0;

  const submit = () => {
    if (trimmed.length < 2 || trimmed.length > 80) {
      toast.error(t("chat.group.titleInvalid"));
      return;
    }
    if (selected.size === 0) {
      toast.error(t("chat.group.membersRequired"));
      return;
    }
    createGroup.mutate(
      { title: trimmed, memberIds: [...selected.keys()] },
      {
        onSuccess: (conversationId) => {
          reset();
          onClose();
          onCreated(conversationId);
        },
        onError: (err) => {
          if (err.message.includes("invalid group title"))
            toast.error(t("chat.group.titleInvalid"));
          else if (err.message.includes("no eligible members"))
            toast.error(t("chat.group.noEligible"));
          else if (err.message.includes("too many members")) toast.error(t("chat.group.tooMany"));
          else toast.error(t("chat.group.createError"));
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-md gap-0 p-0">
        <DialogHeader className="border-b border-border/60 px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <UsersRound className="h-4 w-4 text-muted-foreground" aria-hidden />
            {t("chat.group.createTitle")}
          </DialogTitle>
          <DialogDescription className="text-[12px]">
            {t("chat.group.createHint")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 p-4">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("chat.group.titleLabel")}
            </span>
            <input
              type="text"
              value={title}
              autoFocus
              maxLength={80}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("chat.group.titlePlaceholder")}
              aria-label={t("chat.group.titleLabel")}
              className="h-9 w-full rounded-[6px] border border-input bg-muted/40 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <div>
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("chat.group.membersLabel")}
            </span>
            <GroupMemberPicker selected={selected} onToggle={toggle} />
          </div>
          <button
            type="button"
            disabled={!valid || createGroup.isPending}
            onClick={submit}
            className="h-9 rounded-[6px] bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {t("chat.group.create")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
