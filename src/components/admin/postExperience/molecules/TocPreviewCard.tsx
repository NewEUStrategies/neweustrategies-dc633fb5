import { useTranslation } from "react-i18next";
import {
  tocPreviewHeadings,
  tocPreviewIndent,
  tocPreviewListClass,
  tocPreviewListTag,
  tocPreviewStyle,
  tocPreviewTitle,
  tocPreviewWrapperClass,
} from "@/lib/toc/panelRules";
import type { TocDefaults } from "@/lib/toc/settings";

interface TocPreviewCardProps {
  settings: TocDefaults;
  lang: "pl" | "en";
}

/**
 * Molekuła: podgląd spisu treści na żywo.
 *
 * Wszystkie decyzje wizualne (styl, klasy opakowania, klasy listy, znacznik
 * listy, wcięcie pozycji, zestaw nagłówków) przychodzą z czystego modułu reguł.
 * Tutaj zostaje wyłącznie złożenie znaczników - a to znaczy, że zmiana reguły
 * ma test, który nie musi renderować panelu.
 */
export function TocPreviewCard({ settings, lang }: TocPreviewCardProps) {
  const { t } = useTranslation();

  if (!settings.enabled) {
    return (
      <p className="text-sm text-muted-foreground italic text-center py-8">
        {t("admin.toc.previewDisabled")}
      </p>
    );
  }

  const title = tocPreviewTitle(settings, lang);
  const ListTag = tocPreviewListTag(settings);

  return (
    <nav
      aria-label={title}
      className={tocPreviewWrapperClass(settings)}
      style={tocPreviewStyle(settings)}
    >
      <p className="text-[10px] uppercase tracking-wider mb-3 font-semibold opacity-70">{title}</p>
      <ListTag className={tocPreviewListClass(settings)}>
        {tocPreviewHeadings(settings).map((heading) => (
          <li
            key={heading.anchor}
            style={{ marginLeft: tocPreviewIndent(heading.level, settings.minLevel) }}
          >
            <a
              href={`#${heading.anchor}`}
              className="hover:underline transition-colors"
              style={{ color: "inherit" }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.color = settings.colors.accent;
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.color = "inherit";
              }}
            >
              {t(heading.textKey, { lng: lang })}
            </a>
          </li>
        ))}
      </ListTag>
    </nav>
  );
}
