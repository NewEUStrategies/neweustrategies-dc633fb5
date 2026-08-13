// Floating "WordStyleToolbar" analog dla mediów (image/video/audio).
// Zawsze widoczny nad blokiem gdy blok jest aktywny - dopasowany do możliwości
// każdego formatu (obraz: wyrównanie/rozmiar/kadr, wideo: poster/aspect/tryby,
// audio: cover/download). PL/EN i18n przez useBlocksI18n().
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Link as LinkIcon,
  Link2Off,
  Type,
  Image as ImageIcon,
  RotateCw,
  Volume2,
  VolumeX,
  Play,
  Quote,
  Trash2,
  Replace,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Maximize2,
  Minimize2,
  Square,
  RectangleHorizontal,
  Sliders,
  Download,
  Disc,
  Captions,
} from "lucide-react";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import "@/lib/i18n-admin-blocks";
import { promptDialog } from "@/lib/appDialogs";
import type { Block, Json } from "@/lib/blocks/types";

type MediaKind = "image" | "video" | "audio";

interface Props {
  kind: MediaKind;
  block: Block;
  onChange: (next: Block) => void;
}

function TBtn({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  title: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={[
        "inline-flex h-7 w-7 items-center justify-center rounded-sm border border-transparent",
        "text-foreground hover:bg-foreground/5 transition-colors",
        active ? "bg-foreground/10 border-foreground/20" : "",
      ].join(" ")}
      title={title}
      aria-label={title}
      aria-pressed={active ? true : undefined}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />;
}

export function MediaWidgetToolbar({ kind, block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [, force] = useState(0);
  useEffect(() => force((n) => n + 1), [block.data]);

  const d = block.data as Record<string, Json>;
  const set = (patch: Record<string, Json>) =>
    onChange({ ...block, data: { ...block.data, ...patch } });
  const toggle = (field: string) => set({ [field]: !d[field] });

  const promptFor = async (field: string, title: string, label: string, defaultValue = "") => {
    const v = await promptDialog({
      title,
      label,
      defaultValue: String(d[field] ?? defaultValue),
      confirmLabel: i18n.t("blocks.toolbar.apply"),
    });
    if (v === null) return;
    set({ [field]: v });
  };

  const align = String(d.align ?? "center");
  const size = String(d.size ?? "full");
  const aspect = String(d.aspect ?? "16:9");

  return (
    <div
      ref={rootRef}
      className="absolute -top-[38px] left-0 z-30 flex items-center gap-0.5 rounded-md border border-border bg-popover px-1.5 py-1 shadow-md"
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* --- Common: replace URL --- */}
      <TBtn
        title={i18n.t("blocks.toolbar.replaceUrl")}
        onClick={() => promptFor("url", i18n.t("blocks.toolbar.replaceUrl"), "URL")}
      >
        <Replace className="h-3.5 w-3.5" />
      </TBtn>

      {/* ============ IMAGE ============ */}
      {kind === "image" && (
        <>
          <Divider />
          <TBtn
            title={i18n.t("blocks.toolbar.altText")}
            active={Boolean(d.alt)}
            onClick={() => promptFor("alt", i18n.t("blocks.toolbar.altText"), "alt")}
          >
            <Type className="h-3.5 w-3.5" />
          </TBtn>
          <TBtn
            title={i18n.t("blocks.toolbar.link")}
            active={Boolean(d.href)}
            onClick={() => promptFor("href", i18n.t("blocks.toolbar.link"), "URL")}
          >
            <LinkIcon className="h-3.5 w-3.5" />
          </TBtn>
          {Boolean(d.href) && (
            <TBtn title={i18n.t("blocks.toolbar.unlink")} onClick={() => set({ href: "" })}>
              <Link2Off className="h-3.5 w-3.5" />
            </TBtn>
          )}

          <Divider />
          {/* Wyrównanie */}
          <TBtn
            title={i18n.t("blocks.toolbar.alignLeft")}
            active={align === "left"}
            onClick={() => set({ align: "left" })}
          >
            <AlignLeft className="h-3.5 w-3.5" />
          </TBtn>
          <TBtn
            title={i18n.t("blocks.toolbar.alignCenter")}
            active={align === "center"}
            onClick={() => set({ align: "center" })}
          >
            <AlignCenter className="h-3.5 w-3.5" />
          </TBtn>
          <TBtn
            title={i18n.t("blocks.toolbar.alignRight")}
            active={align === "right"}
            onClick={() => set({ align: "right" })}
          >
            <AlignRight className="h-3.5 w-3.5" />
          </TBtn>

          <Divider />
          {/* Rozmiar */}
          <TBtn
            title={i18n.t("blocks.toolbar.sizeSmall")}
            active={size === "small"}
            onClick={() => set({ size: "small" })}
          >
            <Minimize2 className="h-3.5 w-3.5" />
          </TBtn>
          <TBtn
            title={i18n.t("blocks.toolbar.sizeMedium")}
            active={size === "medium"}
            onClick={() => set({ size: "medium" })}
          >
            <Square className="h-3.5 w-3.5" />
          </TBtn>
          <TBtn
            title={i18n.t("blocks.toolbar.sizeFull")}
            active={size === "full"}
            onClick={() => set({ size: "full" })}
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </TBtn>

          <Divider />
          <TBtn
            title={i18n.t("blocks.toolbar.rounded")}
            active={Boolean(d.rounded)}
            onClick={() => toggle("rounded")}
          >
            <RectangleHorizontal className="h-3.5 w-3.5" />
          </TBtn>
          <TBtn
            title={i18n.t("blocks.toolbar.shadow")}
            active={Boolean(d.shadow)}
            onClick={() => toggle("shadow")}
          >
            <Sliders className="h-3.5 w-3.5" />
          </TBtn>
        </>
      )}

      {/* ============ VIDEO ============ */}
      {kind === "video" && (
        <>
          <Divider />
          <TBtn
            title={i18n.t("blocks.toolbar.poster")}
            active={Boolean(d.poster)}
            onClick={() => promptFor("poster", i18n.t("blocks.toolbar.poster"), "URL")}
          >
            <ImageIcon className="h-3.5 w-3.5" />
          </TBtn>
          <TBtn
            title={i18n.t("blocks.toolbar.captions")}
            active={Boolean(d.captionsUrl)}
            onClick={() => promptFor("captionsUrl", i18n.t("blocks.toolbar.captions"), "URL .vtt")}
          >
            <Captions className="h-3.5 w-3.5" />
          </TBtn>

          <Divider />
          {/* Aspect ratio */}
          {(["16:9", "4:3", "1:1", "9:16"] as const).map((r) => (
            <TBtn
              key={r}
              title={`${i18n.t("blocks.toolbar.aspect")} ${r}`}
              active={aspect === r}
              onClick={() => set({ aspect: r })}
            >
              <span className="text-[10px] font-medium leading-none">{r}</span>
            </TBtn>
          ))}
        </>
      )}

      {/* ============ AUDIO ============ */}
      {kind === "audio" && (
        <>
          <Divider />
          <TBtn
            title={i18n.t("blocks.toolbar.cover")}
            active={Boolean(d.cover)}
            onClick={() => promptFor("cover", i18n.t("blocks.toolbar.cover"), "URL")}
          >
            <Disc className="h-3.5 w-3.5" />
          </TBtn>
          <TBtn
            title={i18n.t("blocks.toolbar.download")}
            active={Boolean(d.download)}
            onClick={() => toggle("download")}
          >
            <Download className="h-3.5 w-3.5" />
          </TBtn>
        </>
      )}

      {/* ============ Video/Audio common playback ============ */}
      {(kind === "video" || kind === "audio") && (
        <>
          <Divider />
          <TBtn title="Autoplay" active={Boolean(d.autoplay)} onClick={() => toggle("autoplay")}>
            <Play className="h-3.5 w-3.5" />
          </TBtn>
          <TBtn title="Loop" active={Boolean(d.loop)} onClick={() => toggle("loop")}>
            <RotateCw className="h-3.5 w-3.5" />
          </TBtn>
          <TBtn
            title={d.muted ? "Unmute" : "Mute"}
            active={Boolean(d.muted)}
            onClick={() => toggle("muted")}
          >
            {d.muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
          </TBtn>
        </>
      )}

      <Divider />

      {/* --- Common: source attribution --- */}
      <TBtn
        title={i18n.t("blocks.toolbar.source")}
        active={Boolean(d.source) || Boolean(d.sourceUrl)}
        onClick={async () => {
          const label = await promptDialog({
            title: i18n.t("blocks.toolbar.source"),
            label: i18n.t("blocks.toolbar.sourceLabel"),
            defaultValue: String(d.source ?? ""),
            confirmLabel: i18n.t("blocks.toolbar.next"),
          });
          if (label === null) return;
          const url = await promptDialog({
            title: i18n.t("blocks.toolbar.source"),
            label: i18n.t("blocks.toolbar.sourceUrl"),
            defaultValue: String(d.sourceUrl ?? ""),
            confirmLabel: i18n.t("blocks.toolbar.apply"),
          });
          if (url === null) {
            set({ source: label });
            return;
          }
          set({ source: label, sourceUrl: url });
        }}
      >
        <Quote className="h-3.5 w-3.5" />
      </TBtn>

      <Divider />

      <TBtn title={i18n.t("blocks.toolbar.clearUrl")} onClick={() => set({ url: "" })}>
        <Trash2 className="h-3.5 w-3.5" />
      </TBtn>
    </div>
  );
}
