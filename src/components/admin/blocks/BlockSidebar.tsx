import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import type { Block, BlockStyle, BlocksDoc } from "@/lib/blocks/types";
import { BLOCK_SPECS } from "@/lib/blocks/registry";
import { DocumentOutline } from "./molecules/DocumentOutline";
import "@/lib/i18n-admin-blocks";

interface Props {
  doc: BlocksDoc;
  activeBlock: Block | null;
  activeId: string | null;
  onSelect: (id: string) => void;
  onChangeBlock: (next: Block) => void;
  documentPane: React.ReactNode;
}

export function BlockSidebar({
  doc,
  activeBlock,
  activeId,
  onSelect,
  onChangeBlock,
  documentPane,
}: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"block" | "document">("document");

  // Auto-switch to "block" when a block is selected
  const effectiveTab = activeBlock ? tab : "document";

  return (
    <Tabs
      value={effectiveTab}
      onValueChange={(v) => setTab(v as "block" | "document")}
      className="h-full flex flex-col"
    >
      <TabsList className="grid grid-cols-2 m-3 mb-0">
        <TabsTrigger value="block" disabled={!activeBlock}>
          {t("blocks.sidebar.block")}
        </TabsTrigger>
        <TabsTrigger value="document">{t("blocks.sidebar.document")}</TabsTrigger>
      </TabsList>

      <TabsContent value="block" className="flex-1 overflow-y-auto p-3 space-y-3 mt-0">
        {activeBlock ? (
          <BlockSettings block={activeBlock} onChange={onChangeBlock} />
        ) : (
          <p className="text-xs text-muted-foreground italic">{t("blocks.sidebar.selectBlock")}</p>
        )}
      </TabsContent>

      <TabsContent value="document" className="flex-1 overflow-y-auto p-3 space-y-4 mt-0">
        <DocumentOutline doc={doc} activeId={activeId} onSelect={onSelect} />
        <div className="pt-2 border-t border-border">{documentPane}</div>
      </TabsContent>
    </Tabs>
  );
}

type AlignValue = NonNullable<BlockStyle["align"]>;

// Block types with dedicated, hand-built inspector controls below. Every other
// block type still gets the shared Layout section (align/spacing/visibility)
// plus a "edited in the canvas" hint, so unconfigured blocks no longer look
// broken with a lone alignment select.
const HANDLED_TYPES = new Set([
  "heading",
  "image",
  "list",
  "quote",
  "embed",
  "video",
  "callout",
  "button",
  "separator",
  "code",
  "html",
]);

function BlockSettings({ block, onChange }: { block: Block; onChange: (n: Block) => void }) {
  const { t } = useTranslation();
  const spec = BLOCK_SPECS[block.type];
  const Icon = spec.icon;

  const set = (key: string, value: string | number | boolean) => {
    onChange({ ...block, data: { ...block.data, [key]: value } });
  };

  const setStyle = (key: keyof BlockStyle, value: number | boolean | undefined) => {
    onChange({ ...block, style: { ...block.style, [key]: value } });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 pb-2 border-b border-border">
        <Icon className="w-4 h-4 text-muted-foreground" />
        <div>
          <h3 className="text-sm font-semibold">{spec.label}</h3>
          <p className="text-[10px] text-muted-foreground">{spec.description}</p>
        </div>
      </div>

      {!HANDLED_TYPES.has(block.type) && (
        <p className="text-[11px] text-muted-foreground italic">{t("blocks.sidebar.canvasEdit")}</p>
      )}

      {block.type === "heading" && (
        <>
          <div>
            <Label className="text-xs">{t("blocks.settings.level")}</Label>
            <Select
              value={String(block.data.level ?? 2)}
              onValueChange={(v) => set("level", Number(v))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2">H2</SelectItem>
                <SelectItem value="3">H3</SelectItem>
                <SelectItem value="4">H4</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">{t("blocks.settings.anchor")}</Label>
            <Input
              value={String(block.data.anchor ?? "")}
              onChange={(e) => set("anchor", e.target.value)}
              placeholder={t("blocks.settings.anchorPh")}
            />
          </div>
        </>
      )}

      {block.type === "image" && (
        <>
          <div>
            <Label className="text-xs">{t("blocks.settings.imageUrl")}</Label>
            <Input
              value={String(block.data.url ?? "")}
              onChange={(e) => set("url", e.target.value)}
              placeholder={t("blocks.settings.urlPh")}
            />
          </div>
          <div>
            <Label className="text-xs">{t("blocks.settings.alt")}</Label>
            <Input
              value={String(block.data.alt ?? "")}
              onChange={(e) => set("alt", e.target.value)}
              placeholder={t("blocks.settings.altPh")}
            />
          </div>
          <div>
            <Label className="text-xs">{t("blocks.settings.link")}</Label>
            <Input
              value={String(block.data.href ?? "")}
              onChange={(e) => set("href", e.target.value)}
              placeholder={t("blocks.settings.urlPh")}
            />
          </div>
        </>
      )}

      {block.type === "list" && (
        <div>
          <Label className="text-xs">{t("blocks.settings.listType")}</Label>
          <Select
            value={block.data.ordered ? "ordered" : "unordered"}
            onValueChange={(v) => set("ordered", v === "ordered")}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unordered">{t("blocks.settings.listUnordered")}</SelectItem>
              <SelectItem value="ordered">{t("blocks.settings.listOrdered")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {block.type === "quote" && (
        <div>
          <Label className="text-xs">{t("blocks.settings.cite")}</Label>
          <Input
            value={String(block.data.cite ?? "")}
            onChange={(e) => set("cite", e.target.value)}
            placeholder={t("blocks.settings.citePh")}
          />
        </div>
      )}

      {block.type === "embed" && (
        <div>
          <Label className="text-xs">{t("blocks.settings.embedUrl")}</Label>
          <Input
            value={String(block.data.url ?? "")}
            onChange={(e) => set("url", e.target.value)}
            placeholder={t("blocks.settings.embedUrlPh")}
          />
        </div>
      )}

      {block.type === "video" && (
        <>
          <div>
            <Label className="text-xs">{t("blocks.settings.fileUrl")}</Label>
            <Input
              value={String(block.data.url ?? "")}
              onChange={(e) => set("url", e.target.value)}
              placeholder={t("blocks.settings.fileUrlPh")}
            />
          </div>
          <div>
            <Label className="text-xs">{t("blocks.settings.poster")}</Label>
            <Input
              value={String(block.data.poster ?? "")}
              onChange={(e) => set("poster", e.target.value)}
              placeholder={t("blocks.settings.posterPh")}
            />
          </div>
        </>
      )}

      {block.type === "callout" && (
        <div>
          <Label className="text-xs">{t("blocks.settings.variant")}</Label>
          <Select
            value={String(block.data.variant ?? "info")}
            onValueChange={(v) => set("variant", v)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="info">{t("blocks.settings.calloutInfo")}</SelectItem>
              <SelectItem value="warning">{t("blocks.settings.calloutWarning")}</SelectItem>
              <SelectItem value="success">{t("blocks.settings.calloutSuccess")}</SelectItem>
              <SelectItem value="danger">{t("blocks.settings.calloutDanger")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {block.type === "button" && (
        <>
          <div>
            <Label className="text-xs">{t("blocks.settings.label")}</Label>
            <Input
              value={String(block.data.label ?? "")}
              onChange={(e) => set("label", e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">{t("blocks.settings.href")}</Label>
            <Input
              value={String(block.data.href ?? "")}
              onChange={(e) => set("href", e.target.value)}
              placeholder={t("blocks.settings.urlPh")}
            />
          </div>
          <div>
            <Label className="text-xs">{t("blocks.settings.variant")}</Label>
            <Select
              value={String(block.data.variant ?? "default")}
              onValueChange={(v) => set("variant", v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">{t("blocks.settings.buttonFilled")}</SelectItem>
                <SelectItem value="outline">{t("blocks.settings.buttonOutline")}</SelectItem>
                <SelectItem value="ghost">{t("blocks.settings.buttonGhost")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      {block.type === "separator" && (
        <div>
          <Label className="text-xs">{t("blocks.settings.variant")}</Label>
          <Select
            value={String(block.data.variant ?? "line")}
            onValueChange={(v) => set("variant", v)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="line">{t("blocks.settings.sepLine")}</SelectItem>
              <SelectItem value="wide">{t("blocks.settings.sepGradient")}</SelectItem>
              <SelectItem value="dots">{t("blocks.settings.sepDots")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {block.type === "code" && (
        <div>
          <Label className="text-xs">{t("blocks.settings.codeLang")}</Label>
          <Input
            value={String(block.data.lang ?? "")}
            onChange={(e) => set("lang", e.target.value)}
            placeholder={t("blocks.settings.codeLangPh")}
          />
        </div>
      )}

      {block.type === "html" && (
        <div>
          <Label className="text-xs">{t("blocks.settings.rawHtml")}</Label>
          <textarea
            value={String(block.data.html ?? "")}
            onChange={(e) => set("html", e.target.value)}
            spellCheck={false}
            placeholder="<div>…</div>"
            className="w-full font-mono text-xs p-2 rounded-md border border-border bg-muted/40 min-h-[240px] outline-none focus:ring-1 focus:ring-foreground resize-y"
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            {t("blocks.settings.rawHtmlNote")}
          </p>
        </div>
      )}

      {/* Shared Layout section — renders for EVERY block type so unconfigured
          blocks show a full inspector (alignment + spacing + visibility). */}
      <div className="pt-2 border-t border-border space-y-3">
        <div>
          <Label className="text-xs">{t("blocks.settings.align")}</Label>
          <Select
            value={block.style?.align ?? "left"}
            onValueChange={(v) =>
              onChange({ ...block, style: { ...block.style, align: v as AlignValue } })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="left">{t("blocks.settings.alignLeft")}</SelectItem>
              <SelectItem value="center">{t("blocks.settings.alignCenter")}</SelectItem>
              <SelectItem value="right">{t("blocks.settings.alignRight")}</SelectItem>
              <SelectItem value="wide">{t("blocks.settings.alignWide")}</SelectItem>
              <SelectItem value="full">{t("blocks.settings.alignFull")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs">{t("blocks.settings.spacing")}</Label>
          <div className="grid grid-cols-2 gap-2 mt-1">
            <div>
              <Label className="text-[10px] text-muted-foreground">
                {t("blocks.settings.marginTop")}
              </Label>
              <Input
                type="number"
                min={0}
                max={400}
                value={block.style?.marginTop ?? ""}
                onChange={(e) =>
                  setStyle("marginTop", e.target.value === "" ? undefined : Number(e.target.value))
                }
              />
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">
                {t("blocks.settings.marginBottom")}
              </Label>
              <Input
                type="number"
                min={0}
                max={400}
                value={block.style?.marginBottom ?? ""}
                onChange={(e) =>
                  setStyle(
                    "marginBottom",
                    e.target.value === "" ? undefined : Number(e.target.value),
                  )
                }
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <Label className="text-xs">{t("blocks.settings.visibility")}</Label>
          <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
            {t("blocks.settings.hideOnPublish")}
            <Switch
              checked={block.style?.hidden ?? false}
              onCheckedChange={(checked) => setStyle("hidden", checked ? true : undefined)}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
