// Molecule: "new message" people search - debounced query against the
// registered-only directory RPC; picking a person opens the direct thread.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, UserRoundSearch } from "lucide-react";
import { toast } from "sonner";
import { usePeopleSearch, useStartConversation } from "@/lib/chat/useConversations";
import { useOnlineUsers } from "@/lib/chat/presence";
import { ChatAvatar } from "./ChatAvatar";

export function NewChatSearch({ onOpened }: { onOpened: (conversationId: string) => void }) {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const online = useOnlineUsers();
  const start = useStartConversation();

  useEffect(() => {
    const handle = setTimeout(() => setQuery(input), 250);
    return () => clearTimeout(handle);
  }, [input]);

  const peopleQ = usePeopleSearch(query, 12);
  const people = peopleQ.data ?? [];

  return (
    <div className="flex flex-col">
      <div className="relative p-2">
        <Search
          className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          type="text"
          value={input}
          autoFocus
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("chat.searchPeoplePlaceholder")}
          aria-label={t("chat.searchPeoplePlaceholder")}
          className="h-8 w-full rounded-[6px] border border-input bg-muted/40 pl-8 pr-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <div className="max-h-[260px] overflow-y-auto px-1 pb-1">
        {peopleQ.isLoading ? (
          <p className="p-4 text-center text-xs text-muted-foreground">
            {t("common.loading", { defaultValue: "..." })}
          </p>
        ) : people.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 p-5 text-center">
            <UserRoundSearch className="h-5 w-5 text-muted-foreground/50" aria-hidden />
            <p className="text-xs text-muted-foreground">
              {query ? t("people.empty") : t("people.emptyDirectory")}
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {people.map((person) => (
              <li key={person.id}>
                <button
                  type="button"
                  disabled={start.isPending}
                  onClick={() =>
                    start.mutate(person.id, {
                      onSuccess: (conversationId) => onOpened(conversationId),
                      onError: () => toast.error(t("chat.startError")),
                    })
                  }
                  className="flex w-full items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-left transition-colors hover:bg-muted/60 disabled:opacity-60"
                >
                  <ChatAvatar
                    name={person.display_name}
                    avatarUrl={person.avatar_url}
                    online={online.has(person.id)}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">
                      {person.display_name}
                    </span>
                    {(person.job_title || person.current_company) && (
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {[person.job_title, person.current_company].filter(Boolean).join(" - ")}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
