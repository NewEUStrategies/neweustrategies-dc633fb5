// Global command palette. Mount once at root.
// - ⌘K / Ctrl+K toggles open from anywhere (also `/` when not focused on input).
// - Fuzzy-ranks static commands client-side (registry).
// - Debounced server search for posts + pages.
// - Fully bilingual (PL/EN) via i18n bundle `palette.*`.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput,
  CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";
import { useAuth } from "@/hooks/useAuth";
import { visibleCommands, buildHaystack, type PaletteCommand, type CommandSection } from "@/lib/search/registry";
import { rankItems } from "@/lib/search/fuzzy";
import { globalSearch, type SearchHit } from "@/lib/search/search.functions";
import { FileText, Newspaper } from "@/lib/lucide-shim";
import { HighlightedText } from "@/components/search/HighlightedText";
import "@/lib/i18n-search";

const SECTION_ORDER: CommandSection[] = ["actions", "navigation", "account", "admin", "appearance", "settings", "content"];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  const { t, i18n } = useTranslation();
  const lang: "pl" | "en" = (i18n.language ?? "pl").startsWith("pl") ? "pl" : "en";
  const navigate = useNavigate();
  const { isAdmin, user } = useAuth();
  const reqIdRef = useRef(0);

  // Global keyboard listener.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const isK = e.key === "k" || e.key === "K";
      const meta = e.metaKey || e.ctrlKey;
      if (isK && meta) {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === "/" && !open) {
        const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
        const editable = (e.target as HTMLElement | null)?.isContentEditable;
        if (tag !== "input" && tag !== "textarea" && tag !== "select" && !editable) {
          e.preventDefault();
          setOpen(true);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Reset query when closing.
  useEffect(() => { if (!open) { setQuery(""); setHits([]); } }, [open]);

  // Debounced server search.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setHits([]); setSearching(false); return; }
    setSearching(true);
    const id = ++reqIdRef.current;
    const handle = window.setTimeout(() => {
      void globalSearch({ data: { q, limit: 8 } })
        .then((res) => { if (id === reqIdRef.current) setHits(res.hits); })
        .catch(() => { if (id === reqIdRef.current) setHits([]); })
        .finally(() => { if (id === reqIdRef.current) setSearching(false); });
    }, 180);
    return () => window.clearTimeout(handle);
  }, [query]);

  const commands = useMemo<PaletteCommand[]>(
    () => visibleCommands({ isAdmin, isAuthenticated: !!user }),
    [isAdmin, user],
  );

  const ranked = useMemo(() => {
    const items = commands.map((cmd) => ({ cmd, haystack: buildHaystack({ cmd, lang }) }));
    return rankItems(items, query, 40);
  }, [commands, query, lang]);

  const grouped = useMemo(() => {
    const map = new Map<CommandSection, PaletteCommand[]>();
    for (const { cmd } of ranked) {
      const arr = map.get(cmd.section) ?? [];
      arr.push(cmd);
      map.set(cmd.section, arr);
    }
    return SECTION_ORDER
      .filter((s) => map.has(s))
      .map((s) => ({ section: s, items: map.get(s)! }));
  }, [ranked]);

  const onSelect = useCallback((cmd: PaletteCommand): void => {
    setOpen(false);
    if (cmd.run) { void cmd.run(); return; }
    if (cmd.to) void navigate({ to: cmd.to });
  }, [navigate]);

  const onSelectHit = useCallback((hit: SearchHit): void => {
    setOpen(false);
    void navigate({ to: hit.href });
  }, [navigate]);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder={t("palette.placeholder")}
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>{searching ? "..." : t("palette.empty")}</CommandEmpty>

        {grouped.map((g, idx) => (
          <div key={g.section}>
            {idx > 0 && <CommandSeparator />}
            <CommandGroup heading={t(`palette.sections.${g.section}`)}>
              {g.items.map((cmd) => (
                <CommandItem
                  key={cmd.id}
                  value={`${cmd.id} ${buildHaystack({ cmd, lang })}`}
                  onSelect={() => onSelect(cmd)}
                  className="gap-2"
                >
                  {cmd.icon}
                  <span className="flex-1 truncate">{lang === "pl" ? cmd.label_pl : cmd.label_en}</span>
                  {cmd.to && (
                    <span className="text-[10px] text-muted-foreground truncate max-w-[40%]">{cmd.to}</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </div>
        ))}

        {hits.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={t("palette.sections.content")}>
              {hits.map((hit) => {
                const title = (lang === "pl" ? hit.title_pl : hit.title_en) || hit.title_pl || hit.title_en || hit.slug;
                const IconCmp = hit.kind === "post" ? Newspaper : FileText;
                return (
                  <CommandItem
                    key={`${hit.kind}:${hit.id}`}
                    value={`${hit.kind}:${hit.id} ${title} ${hit.slug}`}
                    onSelect={() => onSelectHit(hit)}
                    className="gap-2"
                  >
                    <IconCmp className="w-4 h-4" />
                    <span className="flex-1 truncate">{title}</span>
                    <span className="text-[10px] text-muted-foreground truncate max-w-[40%]">{hit.href}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
