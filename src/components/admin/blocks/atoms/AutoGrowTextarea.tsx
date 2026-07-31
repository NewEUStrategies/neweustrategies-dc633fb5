// Textarea, która nigdy nie ucina treści w edytorze bloków: wysokość rośnie
// razem z zawartością (jak render publiczny), zamiast chować tekst za
// jednolinijkowym oknem `.admin-compact textarea`.
import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

type Props = TextareaHTMLAttributes<HTMLTextAreaElement>;

export function AutoGrowTextarea({ value, style, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const resize = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      rows={1}
      style={{ overflow: "hidden", resize: "none", ...style }}
      {...rest}
    />
  );
}
