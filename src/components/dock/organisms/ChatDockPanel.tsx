// Organizm: panel czatu w doku. Wyszukiwarka osób + rozwijane sekcje rozmów.
// Otwarcie rozmowy deleguje do ISTNIEJĄCEGO ChatDock przez chatDockBus -
// nie budujemy drugiego okna czatu.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, MessageCircle, Search, Users } from "lucide-react";
import { DockPanelShell } from "../DockPanelShell";
import { DockEmptyState } from "../atoms/DockEmptyState";
import {
  splitArchived,
  useConversations,
  usePeerProfiles,
  usePeopleSearch,
  useStartConversation,
} from "@/lib/chat/useConversations";
import { conversationDisplay, isGroupView } from "@/lib/chat/display";
import { openChatWindow } from "@/lib/chat/chatDockBus";
import { cn } from "@/lib/utils";

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 bg-muted/50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
      >
        <ChevronDown
          className={cn("h-3.5 w-3.5 transition-transform", !open && "-rotate-90")}
          aria-hidden
        />
        <span className="flex-1 text-left">{title}</span>
        <span>{count}</span>
      </button>
      {open ? children : null}
    </section>
  );
}

export function ChatDockPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const conversationsQ = useConversations();
  const peopleQ = usePeopleSearch(query.trim().length >= 2 ? query : "");
  const start = useStartConversation();

  const { active } = useMemo(() => splitArchived(conversationsQ.data ?? []), [conversationsQ.data]);
  const peerIds = useMemo(
    () => active.flatMap((view) => view.peers.map((peer) => peer.user_id)),
    [active],
  );
  const peersQ = usePeerProfiles(peerIds);

  const direct = active.filter((view) => !isGroupView(view));
  const groups = active.filter((view) => isGroupView(view));
  const needle = query.trim().toLowerCase();

  const label = (conversationId: string): string => {
    const view = active.find((item) => item.conversation.id === conversationId);
    if (!view) return "";
    return conversationDisplay(view, peersQ.data, t("dock.chat.sections.groups")).name;
  };

  const renderList = (views: typeof active) => (
    <ul className="divide-y divide-border">
      {views
        .filter(
          (view) =>
            needle.length === 0 || label(view.conversation.id).toLowerCase().includes(needle),
        )
        .map((view) => (
          <li key={view.conversation.id}>
            <button
              type="button"
              onClick={() => {
                openChatWindow({ conversationId: view.conversation.id });
                onClose();
              }}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted"
            >
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                {label(view.conversation.id) || t("dock.chat.title")}
              </span>
              {view.me.unread_count > 0 ? (
                <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                  {view.me.unread_count}
                </span>
              ) : null}
            </button>
          </li>
        ))}
    </ul>
  );

  return (
    <DockPanelShell
      title={t("dock.chat.title")}
      icon={<MessageCircle className="h-4 w-4" />}
      onClose={onClose}
      actions={
        <a
          href="/messages"
          className="rounded-[6px] px-2 py-1 text-[11px] font-medium text-primary hover:underline"
        >
          {t("dock.chat.openAll")}
        </a>
      }
    >
      <div className="relative border-b border-border p-3">
        <Search
          className="pointer-events-none absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("dock.chat.searchPlaceholder")}
          aria-label={t("dock.chat.searchPlaceholder")}
          className="w-full rounded-[6px] border border-input bg-background py-2 pl-8 pr-3 text-sm text-foreground"
        />
      </div>

      {query.trim().length >= 2 ? (
        <Section title={t("dock.chat.sections.people")} count={peopleQ.data?.length ?? 0}>
          {(peopleQ.data ?? []).length === 0 ? (
            <DockEmptyState icon={<Users className="h-5 w-5" aria-hidden />}>
              {t("dock.chat.noPeople")}
            </DockEmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {(peopleQ.data ?? []).map((person) => (
                <li key={person.id} className="flex items-center gap-2 px-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">
                      {person.display_name}
                    </span>
                    {person.job_title ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {person.job_title}
                      </span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    disabled={start.isPending}
                    onClick={async () => {
                      const conversationId = await start.mutateAsync({ peerId: person.id });
                      openChatWindow({ conversationId });
                      onClose();
                    }}
                    className="rounded-[6px] bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    {t("dock.chat.start")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}

      {conversationsQ.isError ? (
        <DockEmptyState>{t("dock.error")}</DockEmptyState>
      ) : active.length === 0 ? (
        <DockEmptyState icon={<MessageCircle className="h-6 w-6" aria-hidden />}>
          {t("dock.chat.empty")}
        </DockEmptyState>
      ) : (
        <>
          <Section title={t("dock.chat.sections.direct")} count={direct.length}>
            {renderList(direct)}
          </Section>
          {groups.length > 0 ? (
            <Section title={t("dock.chat.sections.groups")} count={groups.length}>
              {renderList(groups)}
            </Section>
          ) : null}
        </>
      )}
    </DockPanelShell>
  );
}
