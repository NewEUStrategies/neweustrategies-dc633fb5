// Molecule: hosts TtsPlayer with auto-extracted page text or custom source.
import { useEffect, useRef, useState } from "react";
import { TtsPlayer } from "@/components/TtsPlayer";

interface Props {
  source: string;
  customText: string;
  label: string;
  voiceId: string;
  model: string;
  nodeId: string;
}

export function TtsPlayerHost({ source, customText, label, voiceId, model, nodeId }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(source === "custom" ? customText : "");

  useEffect(() => {
    if (source === "custom") {
      setText(customText);
      return;
    }
    const grab = () => {
      const el = hostRef.current;
      if (!el) return "";
      const root =
        el.closest("article") ||
        el.closest("[data-post-body]") ||
        el.closest("main") ||
        document.querySelector("article") ||
        document.querySelector("main");
      if (!root) return "";
      const clone = root.cloneNode(true) as HTMLElement;
      const selfClone = clone.querySelector(`[data-w-id="${nodeId}"]`);
      selfClone?.remove();
      clone.querySelectorAll("script,style,nav,header,footer,button,iframe").forEach((n) => n.remove());
      return (clone.textContent || "").replace(/\s+/g, " ").trim();
    };
    setText(grab());
    const id = window.setTimeout(() => setText(grab()), 250);
    return () => window.clearTimeout(id);
  }, [source, customText, nodeId]);

  return (
    <div ref={hostRef}>
      <TtsPlayer text={text} voiceId={voiceId} model={model} label={label} />
    </div>
  );
}
