// Pattern picker dialog. Used by /admin/pages/new (and post creator) to
// browse the built-in starter library, preview a pattern at scale, edit its
// PL/EN strings, and apply the result.
import { useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { BuilderRenderer } from "@/components/admin/builder/BuilderRenderer";
import {
  PATTERNS, PAGE_PATTERNS, POST_PATTERNS,
} from "@/lib/patterns/library";
import type { Pattern, PagePattern, PostPattern } from "@/lib/patterns/types";
import {
  collectI18nFields, applyI18nOverrides, type I18nField,
} from "@/lib/patterns/i18n";

type Lang = "pl" | "en";

interface AppliedPage {
  kind: "page";
  pattern: PagePattern;
  title_pl: string;
  title_en: string;
  builder: PagePattern["builder"];
}
interface AppliedPost {
  kind: "post";
  pattern: PostPattern;
  title_pl: string;
  title_en: string;
  excerpt_pl: string;
  excerpt_en: string;
  content_pl: string;
  content_en: string;
}
export type AppliedPattern = AppliedPage | AppliedPost;

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Which kinds to surface. */
  kind: "page" | "post" | "all";
  /** Called with the cloned + i18n-edited payload ready to persist. */
  onApply: (applied: AppliedPattern) => void;
  /** Called when user picks the blank (no template) option. */
  onSkip?: () => void;
  lang: Lang;
}

export function PatternPicker({ open, onOpenChange, kind, onApply, onSkip, lang }: Props) {
  const pool = useMemo(() => {
    if (kind === "page") return PAGE_PATTERNS;
    if (kind === "post") return POST_PATTERNS;
    return PATTERNS;
  }, [kind]);

  const [selectedId, setSelectedId] = useState<string | null>(pool[0]?.id ?? null);
  const selected = useMemo(() => pool.find((p) => p.id === selectedId) ?? null, [pool, selectedId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[calc(100vw-32px)] p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-5 pb-3 border-b border-border">
          <DialogTitle className="font-display text-xl">Biblioteka szablonów</DialogTitle>
          <DialogDescription>
            Wybierz gotowy układ, podejrzyj go i zmień teksty PL/EN przed zastosowaniem.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-[260px_minmax(0,1fr)] min-h-[60vh]">
          {/* Pattern list */}
          <aside className="border-r border-border bg-muted/30">
            <ScrollArea className="h-[60vh]">
              <ul className="p-2 space-y-1">
                <li>
                  <button
                    type="button"
                    onClick={() => { onOpenChange(false); onSkip?.(); }}
                    className="w-full text-left rounded-md px-3 py-2 text-sm hover:bg-muted border border-dashed border-border"
                  >
                    + Pusta strona (bez szablonu)
                  </button>
                </li>
                {pool.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(p.id)}
                      className={`w-full text-left rounded-md px-3 py-2 text-sm transition ${
                        selectedId === p.id
                          ? "bg-background border border-brand shadow-sm"
                          : "hover:bg-muted border border-transparent"
                      }`}
                    >
                      <div className="font-semibold text-foreground">{p.name[lang]}</div>
                      <div className="text-[11px] text-muted-foreground line-clamp-2">{p.description[lang]}</div>
                      <div className="mt-1 flex items-center gap-1">
                        <Badge variant="outline" className="text-[10px] py-0">{p.kind === "page" ? "strona" : "wpis"}</Badge>
                        <Badge variant="outline" className="text-[10px] py-0">{p.category}</Badge>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </aside>

          {/* Selected pattern panel */}
          {selected ? (
            <SelectedPanel
              key={selected.id}
              pattern={selected}
              onApply={(applied) => { onApply(applied); onOpenChange(false); }}
              lang={lang}
            />
          ) : (
            <div className="p-8 text-sm text-muted-foreground">Wybierz szablon z listy.</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SelectedPanel({
  pattern, onApply, lang,
}: {
  pattern: Pattern;
  onApply: (applied: AppliedPattern) => void;
  lang: Lang;
}) {
  if (pattern.kind === "page") {
    return <PagePanel pattern={pattern} onApply={onApply} lang={lang} />;
  }
  return <PostPanel pattern={pattern} onApply={onApply} lang={lang} />;
}

function PagePanel({
  pattern, onApply, lang,
}: {
  pattern: PagePattern;
  onApply: (applied: AppliedPattern) => void;
  lang: Lang;
}) {
  const fields = useMemo<I18nField[]>(() => collectI18nFields(pattern.builder), [pattern]);
  const [overrides, setOverrides] = useState(() => fields.map((f) => ({ pl: f.pl, en: f.en })));
  const [titlePl, setTitlePl] = useState(pattern.defaultTitle.pl);
  const [titleEn, setTitleEn] = useState(pattern.defaultTitle.en);
  const editedDoc = useMemo(
    () => applyI18nOverrides(pattern.builder, fields, overrides),
    [pattern, fields, overrides],
  );

  return (
    <div className="grid grid-rows-[minmax(0,1fr)_auto] min-h-[60vh]">
      <Tabs defaultValue="preview" className="flex flex-col min-h-0">
        <TabsList className="mx-4 mt-3 self-start">
          <TabsTrigger value="preview">Podgląd</TabsTrigger>
          <TabsTrigger value="content">Treść (PL / EN)</TabsTrigger>
          <TabsTrigger value="meta">Tytuł strony</TabsTrigger>
        </TabsList>

        <TabsContent value="preview" className="mt-2 flex-1 min-h-0">
          <PreviewFrame>
            <BuilderRenderer doc={editedDoc} lang={lang} device="desktop" />
          </PreviewFrame>
        </TabsContent>

        <TabsContent value="content" className="mt-2 flex-1 min-h-0 px-4">
          <ScrollArea className="h-[48vh]">
            <div className="space-y-3 pr-3 pb-4">
              {fields.length === 0 ? (
                <p className="text-xs text-muted-foreground">Ten szablon nie ma edytowalnych pól tekstowych.</p>
              ) : (
                fields.map((f, i) => (
                  <div key={`${f.widgetId}.${f.baseKey}`} className="rounded-md border border-border p-3 space-y-2 bg-background">
                    <div className="flex items-center justify-between">
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        {f.widgetType} · {f.baseKey}
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <FieldInput
                        label="PL" value={overrides[i]?.pl ?? ""}
                        onChange={(v) => setOverrides((prev) => prev.map((o, j) => (j === i ? { pl: v, en: o.en } : o)))}
                        multiline={f.baseKey === "html" || f.baseKey === "excerpt"}
                      />
                      <FieldInput
                        label="EN" value={overrides[i]?.en ?? ""}
                        onChange={(v) => setOverrides((prev) => prev.map((o, j) => (j === i ? { pl: o.pl, en: v } : o)))}
                        multiline={f.baseKey === "html" || f.baseKey === "excerpt"}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="meta" className="mt-2 flex-1 min-h-0 px-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 max-w-2xl">
            <FieldInput label="Tytuł PL" value={titlePl} onChange={setTitlePl} />
            <FieldInput label="Title EN" value={titleEn} onChange={setTitleEn} />
          </div>
        </TabsContent>
      </Tabs>

      <ApplyBar
        onApply={() => onApply({
          kind: "page",
          pattern,
          title_pl: titlePl.trim(),
          title_en: titleEn.trim(),
          builder: editedDoc,
        })}
      />
    </div>
  );
}

function PostPanel({
  pattern, onApply, lang,
}: {
  pattern: PostPattern;
  onApply: (applied: AppliedPattern) => void;
  lang: Lang;
}) {
  const [titlePl, setTitlePl] = useState(pattern.defaultTitle.pl);
  const [titleEn, setTitleEn] = useState(pattern.defaultTitle.en);
  const [excerptPl, setExcerptPl] = useState(pattern.defaultExcerpt?.pl ?? "");
  const [excerptEn, setExcerptEn] = useState(pattern.defaultExcerpt?.en ?? "");
  const [contentPl, setContentPl] = useState(pattern.content.pl);
  const [contentEn, setContentEn] = useState(pattern.content.en);

  return (
    <div className="grid grid-rows-[minmax(0,1fr)_auto] min-h-[60vh]">
      <Tabs defaultValue="preview" className="flex flex-col min-h-0">
        <TabsList className="mx-4 mt-3 self-start">
          <TabsTrigger value="preview">Podgląd</TabsTrigger>
          <TabsTrigger value="content">Treść (PL / EN)</TabsTrigger>
          <TabsTrigger value="meta">Tytuł i lead</TabsTrigger>
        </TabsList>

        <TabsContent value="preview" className="mt-2 flex-1 min-h-0">
          <PreviewFrame>
            <article className="prose prose-sm max-w-none px-6 py-8">
              <h1>{lang === "pl" ? titlePl : titleEn}</h1>
              {(lang === "pl" ? excerptPl : excerptEn) && (
                <p className="lead text-muted-foreground">{lang === "pl" ? excerptPl : excerptEn}</p>
              )}
              <div dangerouslySetInnerHTML={{ __html: lang === "pl" ? contentPl : contentEn }} />
            </article>
          </PreviewFrame>
        </TabsContent>

        <TabsContent value="content" className="mt-2 flex-1 min-h-0 px-4">
          <ScrollArea className="h-[48vh]">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pr-3 pb-4">
              <FieldInput label="Treść PL (HTML)" value={contentPl} onChange={setContentPl} multiline rows={16} />
              <FieldInput label="Content EN (HTML)" value={contentEn} onChange={setContentEn} multiline rows={16} />
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="meta" className="mt-2 flex-1 min-h-0 px-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 max-w-3xl">
            <FieldInput label="Tytuł PL" value={titlePl} onChange={setTitlePl} />
            <FieldInput label="Title EN" value={titleEn} onChange={setTitleEn} />
            <FieldInput label="Lead PL" value={excerptPl} onChange={setExcerptPl} multiline />
            <FieldInput label="Excerpt EN" value={excerptEn} onChange={setExcerptEn} multiline />
          </div>
        </TabsContent>
      </Tabs>

      <ApplyBar
        onApply={() => onApply({
          kind: "post",
          pattern,
          title_pl: titlePl.trim(), title_en: titleEn.trim(),
          excerpt_pl: excerptPl.trim(), excerpt_en: excerptEn.trim(),
          content_pl: contentPl, content_en: contentEn,
        })}
      />
    </div>
  );
}

function PreviewFrame({ children }: { children: React.ReactNode }) {
  // Scaled-down "device" frame so the preview fits in the dialog without
  // shrinking content typography. Internal width 1280 -> scaled by container.
  return (
    <div className="relative h-[48vh] mx-4 my-2 rounded-lg border border-border overflow-hidden bg-background">
      <div className="absolute inset-0 overflow-auto">
        <div className="origin-top-left" style={{ width: 1280, transform: "scale(0.6)", transformOrigin: "top left" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function ApplyBar({ onApply }: { onApply: () => void }) {
  return (
    <DialogFooter className="px-6 py-3 border-t border-border bg-muted/30">
      <Button onClick={onApply}>Zastosuj szablon</Button>
    </DialogFooter>
  );
}

function FieldInput({
  label, value, onChange, multiline, rows = 3,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      {multiline ? (
        <Textarea value={value} onChange={(e) => onChange(e.target.value)} rows={rows} className="mt-1 text-xs font-mono" />
      ) : (
        <Input value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 h-8 text-sm" />
      )}
    </label>
  );
}
