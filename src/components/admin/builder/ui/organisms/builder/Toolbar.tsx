import { Monitor, Tablet, Smartphone, Undo, Redo, Sun, Moon } from "@/lib/lucide-shim";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-builder";
import type { Device, Mode } from "@/lib/builder/types";

export function Toolbar({
  lang,
  onLangChange,
  device,
  setDevice,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  mode,
  setMode,
}: {
  lang: "pl" | "en";
  onLangChange: (l: "pl" | "en") => void;
  device: Device;
  setDevice: (d: Device) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  mode: Mode;
  setMode: (m: Mode) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="border-b border-border p-2 flex items-center justify-between gap-2 bg-card">
      <div className="flex items-center gap-1">
        {(["pl", "en"] as const).map((l) => (
          <button
            key={l}
            onClick={() => onLangChange(l)}
            data-active={lang === l}
            className="cms-tb-btn text-xs"
            style={{ minWidth: 32 }}
          >
            {l.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <div className="flex gap-1">
          {(
            [
              ["desktop", Monitor],
              ["tablet", Tablet],
              ["mobile", Smartphone],
            ] as const
          ).map(([d, Icon]) => (
            <button
              key={d}
              onClick={() => setDevice(d)}
              data-active={device === d}
              className="cms-tb-btn"
              title={d}
            >
              <Icon />
            </button>
          ))}
        </div>
        <div className="cms-mode-switch" role="group" aria-label={t("builder.chrome.previewMode")}>
          {(
            [
              ["light", Sun, t("builder.chrome.lightMode"), t("builder.chrome.light")],
              ["dark", Moon, t("builder.chrome.darkMode"), t("builder.chrome.dark")],
            ] as const
          ).map(([m, Icon, title, label]) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              data-active={mode === m}
              className="cms-mode-switch__btn"
              title={title}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className="cms-tb-btn"
          title={t("builder.chrome.undo")}
        >
          <Undo />
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          className="cms-tb-btn"
          title={t("builder.chrome.redo")}
        >
          <Redo />
        </button>
      </div>
    </div>
  );
}
