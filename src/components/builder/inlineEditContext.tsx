// Bridge between the builder canvas (VisualCanvas → BuilderRenderer) and
// individual widget renderers so click-to-edit text/HTML edits made inside a
// contenteditable field on the canvas can flow back into the shared document
// store (`updateWidget`). Public renderer never provides this context, so
// widgets stay read-only outside the admin canvas.
import { createContext, useContext, type ReactNode } from "react";

export type InlineWidgetContentChange = (
  widgetId: string,
  key: string,
  value: string | number,
) => void;

const InlineEditContext = createContext<InlineWidgetContentChange | null>(null);

export function InlineEditProvider({
  onContentChange,
  children,
}: {
  onContentChange: InlineWidgetContentChange;
  children: ReactNode;
}) {
  return (
    <InlineEditContext.Provider value={onContentChange}>{children}</InlineEditContext.Provider>
  );
}

export function useInlineWidgetEdit(): InlineWidgetContentChange | null {
  return useContext(InlineEditContext);
}
