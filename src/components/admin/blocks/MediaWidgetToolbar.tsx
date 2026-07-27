// Floating "WordStyleToolbar" analog dla mediów (image/video/audio).
// Zawsze widoczny nad blokiem gdy blok jest aktywny - pozwala szybko podpiąć
// źródło, link, atrybuty odtwarzania oraz podmienić/wyczyścić URL.
// PL/EN i18n przez useBlocksI18n().
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

  const set = (patch: Record<string, Json>) =>
    onChange({ ...block, data: { ...block.data, ...patch } });


  const promptFor = async (
    field: string,
    title: string,
    label: string,
    defaultValue = "",
  ) => {
    const v = await promptDialog({
      title,
      label,
      defaultValue: String(block.data[field] ?? defaultValue),
      confirmLabel: i18n.t("blocks.toolbar.apply", { defaultValue: "Zastosuj" }),
    });
    if (v === null) return;
    set({ [field]: v });
  };

  const toggle = (field: string) => set({ [field]: !block.data[field] });

  return (
    <div
      ref={rootRef}
      className="absolute -top-[38px] left-0 z-30 flex items-center gap-0.5 rounded-md border border-border bg-popover px-1.5 py-1 shadow-md"
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => e.stopPropagation()}
    >
      <TBtn
        title={i18n.t("blocks.toolbar.replaceUrl", { defaultValue: "Podmień URL" })}
        onClick={() =>
          promptFor(
            "url",
            i18n.t("blocks.toolbar.replaceUrl", { defaultValue: "Podmień URL" }),
            "URL",
          )
        }
      >
        <Replace className="h-3.5 w-3.5" />
      </TBtn>

      {kind === "image" && (
        <>
          <TBtn
            title={i18n.t("blocks.toolbar.altText", { defaultValue: "Tekst alternatywny" })}
            active={Boolean(block.data.alt)}
            onClick={() =>
              promptFor(
                "alt",
                i18n.t("blocks.toolbar.altText", { defaultValue: "Tekst alternatywny" }),
                "alt",
              )
            }
          >
            <Type className="h-3.5 w-3.5" />
          </TBtn>
          <TBtn
            title={i18n.t("blocks.toolbar.link", { defaultValue: "Link" })}
            active={Boolean(block.data.href)}
            onClick={() =>
              promptFor(
                "href",
                i18n.t("blocks.toolbar.link", { defaultValue: "Link" }),
                "URL",
              )
            }
          >
            <LinkIcon className="h-3.5 w-3.5" />
          </TBtn>
          {Boolean(block.data.href) && (
            <TBtn
              title={i18n.t("blocks.toolbar.unlink", { defaultValue: "Usuń link" })}
              onClick={() => set({ href: "" })}
            >
              <Link2Off className="h-3.5 w-3.5" />
            </TBtn>
          )}
        </>
      )}

      {kind === "video" && (
        <>
          <TBtn
            title={i18n.t("blocks.toolbar.poster", { defaultValue: "Miniatura (poster)" })}
            active={Boolean(block.data.poster)}
            onClick={() =>
              promptFor(
                "poster",
                i18n.t("blocks.toolbar.poster", { defaultValue: "Miniatura (poster)" }),
                "URL",
              )
            }
          >
            <ImageIcon className="h-3.5 w-3.5" />
          </TBtn>
        </>
      )}

      {(kind === "video" || kind === "audio") && (
        <>
          <TBtn
            title="Autoplay"
            active={Boolean(block.data.autoplay)}
            onClick={() => toggle("autoplay")}
          >
            <Play className="h-3.5 w-3.5" />
          </TBtn>
          <TBtn
            title="Loop"
            active={Boolean(block.data.loop)}
            onClick={() => toggle("loop")}
          >
            <RotateCw className="h-3.5 w-3.5" />
          </TBtn>
          <TBtn
            title={block.data.muted ? "Unmute" : "Mute"}
            active={Boolean(block.data.muted)}
            onClick={() => toggle("muted")}
          >
            {block.data.muted ? (
              <VolumeX className="h-3.5 w-3.5" />
            ) : (
              <Volume2 className="h-3.5 w-3.5" />
            )}
          </TBtn>
        </>
      )}

      <Divider />

      <TBtn
        title={i18n.t("blocks.toolbar.source", { defaultValue: "Źródło" })}
        active={Boolean(block.data.source) || Boolean(block.data.sourceUrl)}
        onClick={async () => {
          const label = await promptDialog({
            title: i18n.t("blocks.toolbar.source", { defaultValue: "Źródło" }),
            label: i18n.t("blocks.toolbar.sourceLabel", {
              defaultValue: "Nazwa źródła (np. autor, agencja)",
            }),
            defaultValue: String(block.data.source ?? ""),
            confirmLabel: i18n.t("blocks.toolbar.next", { defaultValue: "Dalej" }),
          });
          if (label === null) return;
          const url = await promptDialog({
            title: i18n.t("blocks.toolbar.source", { defaultValue: "Źródło" }),
            label: i18n.t("blocks.toolbar.sourceUrl", {
              defaultValue: "URL źródła (opcjonalny)",
            }),
            defaultValue: String(block.data.sourceUrl ?? ""),
            confirmLabel: i18n.t("blocks.toolbar.apply", { defaultValue: "Zastosuj" }),
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

      <TBtn
        title={i18n.t("blocks.toolbar.clearUrl", { defaultValue: "Wyczyść URL" })}
        onClick={() => set({ url: "" })}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </TBtn>
    </div>
  );
}
