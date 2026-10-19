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

/** Elementy blokowe, których granica jest granicą słowa dla lektora. */
const BLOCK_SELECTOR =
  "p,h1,h2,h3,h4,h5,h6,li,dt,dd,blockquote,figcaption,pre,td,th,div,section,article,aside,br";

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
      clone
        .querySelectorAll("script,style,nav,header,footer,button,iframe")
        .forEach((n) => n.remove());
      // `textContent` nie zna granic bloków: DOM Reacta nie ma białych znaków
      // między elementami, więc `<h1>Tytuł</h1><p>Akapit` dawało „TytułAkapit"
      // - lektor czytał zlepione słowa. Separator po każdym bloku (na klonie).
      clone.querySelectorAll(BLOCK_SELECTOR).forEach((n) => n.after(" "));
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
