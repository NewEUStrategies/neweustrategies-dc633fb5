import type { NewsletterSettings } from "@/hooks/useNewsletterSettings";

export type PopupContent =
  | {
      kind: "showcase";
      Component: typeof import("@/components/popups/SignupPopupPanel").SignupPopupPanel;
    }
  | {
      kind: "document";
      Component: typeof import("@/components/newsletter/NewsletterDocRenderer").NewsletterDocRenderer;
    }
  | { kind: "form"; Component: typeof import("@/components/PopupSignupForm").PopupSignupForm };

/** Only load the configured variant. Keep form/builder code outside the page's startup graph. */
export async function loadPopupContent(settings: NewsletterSettings): Promise<PopupContent> {
  if (settings.popup_layout === "showcase") {
    const { SignupPopupPanel } = await import("@/components/popups/SignupPopupPanel");
    return { kind: "showcase", Component: SignupPopupPanel };
  }
  if (settings.popup_doc) {
    const { NewsletterDocRenderer } = await import("@/components/newsletter/NewsletterDocRenderer");
    return { kind: "document", Component: NewsletterDocRenderer };
  }
  const { PopupSignupForm } = await import("@/components/PopupSignupForm");
  return { kind: "form", Component: PopupSignupForm };
}
