// Molecule: multi-select people picker for circle creation/invites.
// Same debounced registered-only directory search as NewChatSearch, but with
// checkbox semantics. Server-side eligibility (blocks, allow_messages_from,
// tenant) is re-checked by the RPCs - this list is a convenience, not a gate.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Search, UserRoundSearch } from "lucide-react";
import { usePeopleSearch } from "@/lib/chat/useConversations";
import { useOnlineUsers } from "@/lib/chat/presence";
import { cn } from "@/lib/utils";
import { ChatAvatar } from "./ChatAvatar";

export interface GroupMemberPickerProps {
  selected: ReadonlyMap<string, string>;
  onToggle: (id: string, displayName: string) => void;
  /** Already-member ids to hide from the results (add-members flow). */
  excludeIds?: ReadonlySet<string>;
  className?: string;
}

export function GroupMemberPicker(props: GroupMemberPickerProps) {
  const { selected, onToggle, excludeIds, className } = props;
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const online = useOnlineUsers();

  useEffect(() => {
    const handle = setTimeout(() => setQuery(input), 250);
    return () => clearTimeout(handle);
  }, [input]);

  const peopleQ = usePeopleSearch(query, 20);
  const people = useMemo(
    () => (peopleQ.data ?? []).filter((p) => !excludeIds?.has(p.id)),
    [peopleQ.data, excludeIds],
  );

  return (
    <div className={cn("flex flex-col", className)}>
      <label className="relative block">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("chat.searchPeoplePlaceholder")}
          aria-label={t("chat.searchPeoplePlaceholder")}
          className="h-9 w-full rounded-[6px] border border-input bg-muted/40 !pl-[42px] pr-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>
      <div className="mt-2 max-h-[220px] overflow-y-auto rounded-[6px] border border-border/60">
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
          <ul className="flex flex-col gap-0.5 p-1">
            {people.map((person) => {
              const checked = selected.has(person.id);
              return (
                <li key={person.id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    onClick={() => onToggle(person.id, person.display_name)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-left transition-colors hover:bg-muted/60",
                      checked && "bg-muted/60",
                    )}
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
                    <span
                      className={cn(
                        "flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-[4px] border",
                        checked
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border/80",
                      )}
                      aria-hidden
                    >
                      {checked && <Check className="h-3 w-3" />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {selected.size > 0 && (
        <p className="mt-1.5 text-[11px] text-muted-foreground" aria-live="polite">
          {t("chat.group.selected", { count: selected.size })}
          {": "}
          <span className="text-foreground">{[...selected.values()].join(", ")}</span>
        </p>
      )}
    </div>
  );
}
