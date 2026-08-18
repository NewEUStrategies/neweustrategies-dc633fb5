// Widget "accordion" (FAQ) wydzielony z SimpleWidgets do własnego chunku.
//
// PO CO: odpowiedzi akordeonu to jedyne miejsce w SimpleWidgets, które woła
// sanitizeHtml (DOMPurify, ~82 kB źródeł) - jedna krawędź trzymała DOMPurify
// w chunku wejściowym KAŻDEJ strony, choć akordeon nie jest widgetem chrome.
// Ta sama doktryna lazy co pozostałe wpisy w lazyWidgets: SSR wypełnia
// granicę Suspense na serwerze (HTML i LCP identyczne), odroczony jest
// wyłącznie transfer JS na kliencie.
import type { Json, WidgetNode } from "@/lib/builder/types";
import { asOneOf, pickI18n } from "@/lib/content-model/contentValue";
import { sanitizeHtml } from "@/lib/sanitize";

const ACCORDION_VARIANTS = ["bordered", "separated", "minimal"] as const;

export interface AccordionWidgetProps {
  content: WidgetNode["content"];
  lang: "pl" | "en";
}

export function AccordionWidget({ content: c, lang }: AccordionWidgetProps) {
  const items = Array.isArray(c.items)
    ? c.items.filter(
        (it): it is { [key: string]: Json } =>
          typeof it === "object" && it !== null && !Array.isArray(it),
      )
    : [];
  const variant = asOneOf(c.variant, ACCORDION_VARIANTS, "bordered");
  const containerCls =
    variant === "separated"
      ? "space-y-2"
      : variant === "minimal"
        ? "divide-y divide-border"
        : "divide-y divide-border border border-border rounded-lg overflow-hidden";
  const itemCls =
    variant === "separated" ? "group border border-border rounded-lg overflow-hidden" : "group";
  return (
    <div className={containerCls}>
      {items.map((it, i) => (
        <details key={i} className={itemCls}>
          <summary className="cursor-pointer list-none px-4 py-3 flex justify-between items-center hover:bg-muted/30 font-medium text-sm">
            <span>{pickI18n(it, "q", lang)}</span>
            <span className="text-muted-foreground group-open:rotate-180 transition">▾</span>
          </summary>
          <div
            className="px-4 pb-4 text-sm text-muted-foreground"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(pickI18n(it, "a", lang)) }}
          />
        </details>
      ))}
    </div>
  );
}
