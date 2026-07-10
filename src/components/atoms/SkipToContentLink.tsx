import { useTranslation } from "react-i18next";

// Visually hidden until focused (Tab from the top of the page) - lets
// keyboard and screen-reader users jump past the header/mega-menu/sidebar
// straight to the page's main content instead of tabbing through every nav
// item on every single page load.
export function SkipToContentLink({ targetId = "main-content" }: { targetId?: string }) {
  const { t } = useTranslation();
  return (
    <a
      href={`#${targetId}`}
      className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[10000] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-lg"
    >
      {t("nav.skipToContent")}
    </a>
  );
}
