// Conversation personalization hub (direct + group threads): shared color
// theme, wallpaper and quick emoji plus per-member nicknames - all applied
// optimistically with a live preview strip rendered in the selected theme.
// Every choice is server-validated (chat_set_appearance / chat_set_nickname);
// this dialog only relays intent.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Palette, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { useNicknames, useSetNickname, nicknameFor } from "@/lib/chat/nicknames";
import {
  CHAT_THEMES,
  CHAT_WALLPAPERS,
  DEFAULT_QUICK_EMOJI,
  QUICK_EMOJI_CHOICES,
  normalizeQuickEmoji,
  normalizeTheme,
  normalizeWallpaper,
  themeClass,
  themeDbValue,
  themeLabelKey,
  wallpaperClass,
  wallpaperDbValue,
  wallpaperLabelKey,
  type ChatThemeId,
  type ChatWallpaperId,
} from "@/lib/chat/themes";
import { usePeerProfiles, useSetConversationAppearance } from "@/lib/chat/useConversations";
import type { ConversationView, PeerProfile } from "@/lib/chat/types";
import { cn } from "@/lib/utils";
import { ChatAvatar } from "./ChatAvatar";

export interface ChatAppearanceDialogProps {
  view: ConversationView;
  open: boolean;
  onClose: () => void;
}

/** Live sample of the selected theme + wallpaper (two bubbles, no data). */
function ThemePreview({ theme, wallpaper }: { theme: ChatThemeId; wallpaper: ChatWallpaperId }) {
  const { t } = useTranslation();
  return (
    <div className={themeClass(theme)}>
      <div
        className={cn("flex flex-col gap-1.5 rounded-[6px] px-3 py-3", wallpaperClass(wallpaper))}
        aria-hidden
      >
        <div className="max-w-[75%] self-start rounded-[6px] bg-muted px-3 py-1.5 text-[12px] text-foreground shadow-sm">
          {t("chat.appearance.previewIncoming")}
        </div>
        <div
          className="max-w-[75%] self-end rounded-[6px] px-3 py-1.5 text-[12px] shadow-sm"
          style={{
            background: "linear-gradient(135deg, var(--chat-user-from), var(--chat-user-to))",
            color: "var(--chat-user-foreground)",
          }}
        >
          {t("chat.appearance.previewOutgoing")}
        </div>
      </div>
    </div>
  );
}

/** One member row with inline nickname editing. */
function NicknameRow({
  conversationId,
  userId,
  isMe,
  profile,
  nickname,
}: {
  conversationId: string;
  userId: string;
  isMe: boolean;
  profile: PeerProfile | undefined;
  nickname: string | null;
}) {
  const { t } = useTranslation();
  const setNickname = useSetNickname();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const realName = profile?.display_name ?? "...";
  const shownName = nickname ?? realName;

  const startEdit = () => {
    setDraft(nickname ?? "");
    setEditing(true);
  };

  const save = () => {
    const trimmed = draft.trim();
    if (trimmed === (nickname ?? "")) {
      setEditing(false);
      return;
    }
    setNickname.mutate(
      { conversationId, userId, nickname: trimmed },
      {
        onSuccess: () =>
          toast.success(
            trimmed ? t("chat.appearance.nicknameSaved") : t("chat.appearance.nicknameCleared"),
          ),
        onError: () => toast.error(t("chat.appearance.nicknameError")),
      },
    );
    setEditing(false);
  };

  return (
    <li className="flex items-center gap-2.5 rounded-[6px] px-2 py-1.5">
      <ChatAvatar name={realName} avatarUrl={profile?.avatar_url} size="sm" />
      {editing ? (
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <input
            type="text"
            value={draft}
            autoFocus
            maxLength={60}
            placeholder={t("chat.appearance.nicknamePlaceholder")}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setEditing(false);
            }}
            aria-label={t("chat.appearance.nicknameEdit", { name: realName })}
            className="h-8 min-w-0 flex-1 rounded-[6px] border border-input bg-muted/40 px-2 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <button
            type="button"
            onClick={save}
            disabled={setNickname.isPending}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            aria-label={t("chat.appearance.nicknameSave")}
            title={t("chat.appearance.nicknameSave")}
          >
            <Check className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] border border-border/60 text-muted-foreground transition-colors hover:bg-muted"
            aria-label={t("chat.close")}
            title={t("chat.close")}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </span>
      ) : (
        <>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">
              {shownName}
              {isMe && (
                <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                  ({t("chat.you")})
                </span>
              )}
            </span>
            {nickname && (
              <span className="block truncate text-[11px] text-muted-foreground">{realName}</span>
            )}
          </span>
          <button
            type="button"
            onClick={startEdit}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={t("chat.appearance.nicknameEdit", { name: realName })}
            title={t("chat.appearance.nicknameEdit", { name: realName })}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
          </button>
        </>
      )}
    </li>
  );
}

export function ChatAppearanceDialog({ view, open, onClose }: ChatAppearanceDialogProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const conversationId = view.conversation.id;

  const theme = normalizeTheme(view.conversation.theme);
  const wallpaper = normalizeWallpaper(view.conversation.wallpaper);
  const quickEmoji = normalizeQuickEmoji(view.conversation.quick_emoji);

  const memberIds = [view.me.user_id, ...view.peers.map((p) => p.user_id)];
  const profilesQ = usePeerProfiles(memberIds);
  const nicknamesQ = useNicknames();
  const setAppearance = useSetConversationAppearance();

  const appearanceError = () => toast.error(t("chat.appearance.error"));

  const pickTheme = (next: ChatThemeId) => {
    if (next === theme) return;
    setAppearance.mutate(
      { conversationId, theme: themeDbValue(next) },
      { onError: appearanceError },
    );
  };
  const pickWallpaper = (next: ChatWallpaperId) => {
    if (next === wallpaper) return;
    setAppearance.mutate(
      { conversationId, wallpaper: wallpaperDbValue(next) },
      { onError: appearanceError },
    );
  };
  const pickQuickEmoji = (next: string) => {
    if (next === quickEmoji) return;
    setAppearance.mutate(
      { conversationId, quickEmoji: next === DEFAULT_QUICK_EMOJI ? null : next },
      { onError: appearanceError },
    );
  };

  const sectionHeading = "text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md gap-0 p-0">
        <DialogHeader className="border-b border-border/60 px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Palette className="h-4 w-4 text-muted-foreground" aria-hidden />
            {t("chat.appearance.title")}
          </DialogTitle>
          <DialogDescription className="text-[12px]">
            {t("chat.appearance.sharedHint")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto p-4">
          <section aria-label={t("chat.appearance.preview")}>
            <ThemePreview theme={theme} wallpaper={wallpaper} />
          </section>

          <section>
            <h3 className={cn(sectionHeading, "mb-2")}>{t("chat.appearance.themeSection")}</h3>
            <div
              className="grid grid-cols-4 gap-2"
              role="radiogroup"
              aria-label={t("chat.appearance.themeSection")}
            >
              {CHAT_THEMES.map((id) => {
                const active = id === theme;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => pickTheme(id)}
                    className={cn(
                      "group flex flex-col items-center gap-1 rounded-[6px] border p-1.5 transition-colors",
                      active
                        ? "border-ring bg-muted/60"
                        : "border-border/60 hover:border-border hover:bg-muted/40",
                    )}
                    title={t(themeLabelKey(id))}
                  >
                    <span className={themeClass(id)}>
                      <span
                        className="relative flex h-9 w-9 items-center justify-center rounded-full shadow-sm motion-safe:transition-transform motion-safe:group-hover:scale-105"
                        style={{
                          background:
                            "linear-gradient(135deg, var(--chat-user-from), var(--chat-user-to))",
                        }}
                        aria-hidden
                      >
                        {active && <Check className="h-4 w-4 text-white" aria-hidden />}
                      </span>
                    </span>
                    <span className="w-full truncate text-center text-[10.5px] leading-tight text-muted-foreground">
                      {t(themeLabelKey(id))}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <h3 className={cn(sectionHeading, "mb-2")}>{t("chat.appearance.wallpaperSection")}</h3>
            <div
              className={cn("grid grid-cols-4 gap-2", themeClass(theme))}
              role="radiogroup"
              aria-label={t("chat.appearance.wallpaperSection")}
            >
              {CHAT_WALLPAPERS.map((id) => {
                const active = id === wallpaper;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => pickWallpaper(id)}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-[6px] border p-1.5 transition-colors",
                      active
                        ? "border-ring bg-muted/60"
                        : "border-border/60 hover:border-border hover:bg-muted/40",
                    )}
                    title={t(wallpaperLabelKey(id))}
                  >
                    <span
                      className={cn(
                        "relative h-9 w-full overflow-hidden rounded-[6px] border border-border/40",
                        wallpaperClass(id),
                      )}
                      aria-hidden
                    >
                      {active && (
                        <Check className="absolute inset-0 m-auto h-4 w-4 text-foreground/70" />
                      )}
                    </span>
                    <span className="w-full truncate text-center text-[10.5px] leading-tight text-muted-foreground">
                      {t(wallpaperLabelKey(id))}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <h3 className={cn(sectionHeading, "mb-1")}>{t("chat.appearance.quickEmojiSection")}</h3>
            <p className="mb-2 text-[11px] text-muted-foreground">
              {t("chat.appearance.quickEmojiHint")}
            </p>
            <div
              className="flex flex-wrap gap-1"
              role="radiogroup"
              aria-label={t("chat.appearance.quickEmojiSection")}
            >
              {QUICK_EMOJI_CHOICES.map((emoji) => {
                const active = emoji === quickEmoji;
                return (
                  <button
                    key={emoji}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => pickQuickEmoji(emoji)}
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-[6px] border text-lg leading-none transition-colors",
                      "motion-safe:transition-transform motion-safe:hover:scale-110",
                      active ? "border-ring bg-muted" : "border-border/60 hover:bg-muted/60",
                    )}
                    aria-label={emoji}
                  >
                    {emoji}
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <h3 className={cn(sectionHeading, "mb-1")}>{t("chat.appearance.nicknamesSection")}</h3>
            <p className="mb-2 text-[11px] text-muted-foreground">
              {t("chat.appearance.nicknamesHint")}
            </p>
            <ul
              className="flex flex-col gap-0.5"
              aria-label={t("chat.appearance.nicknamesSection")}
            >
              {memberIds.map((id) => (
                <NicknameRow
                  key={id}
                  conversationId={conversationId}
                  userId={id}
                  isMe={id === user?.id}
                  profile={profilesQ.data?.get(id)}
                  nickname={nicknameFor(nicknamesQ.data, conversationId, id)}
                />
              ))}
            </ul>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
