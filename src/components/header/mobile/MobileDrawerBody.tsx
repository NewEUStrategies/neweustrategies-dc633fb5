import type { ReactElement } from "react";
// Orchestrator zawartości mobilnego drawera. Bloki są renderowane w
// kolejności zdefiniowanej przez super-admina w `section_order` -
// wszystko poza tym pozostaje statyczne.
import { useSuspenseQuery } from "@tanstack/react-query";
import { useLang } from "@/lib/i18n/useLang";
import { BuilderRenderer } from "@/components/builder/organisms/BuilderRenderer";
import type { BuilderDocument } from "@/lib/builder/types";
import { mobileDrawerConfigQueryOptions } from "@/lib/queries/mobileDrawer";
import type { DrawerSection } from "@/lib/mobileDrawer";
import { MobileTopTools } from "./MobileTopTools";
import { MobileAccountSection } from "./MobileAccountSection";
import { MobileNavSection } from "./MobileNavSection";

type Props = {
  builderDoc: BuilderDocument;
  onNavigate: () => void;
};

export function MobileDrawerBody({ builderDoc, onNavigate }: Props) {
  const lang = useLang();
  const { data: cfg } = useSuspenseQuery(mobileDrawerConfigQueryOptions);

  const renderers: Record<DrawerSection, () => ReactElement | null> = {
    top_tools: () => <MobileTopTools tools={cfg.top_tools} onNavigate={onNavigate} />,
    account: () => <MobileAccountSection onNavigate={onNavigate} />,
    nav: () => <MobileNavSection items={cfg.nav_items} onNavigate={onNavigate} />,
    builder: () => (
      // Wymuszamy render mobilny, żeby kolumny buildera zwijały się w jedną.
      // Ukrywamy wybrane widgety które w drawerze są zbędne (duplikaty
      // top_tools / account / nav) – zostają widoczne na desktop headerze.
      <div className="relative z-0 isolate mobile-drawer-builder">
        <BuilderRenderer doc={builderDoc} lang={lang} device="mobile" />
      </div>
    ),
  };

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain isolate [&_*]:max-w-full">
      {cfg.section_order.map((section) => (
        <div key={section} className="relative z-10 isolate">
          {renderers[section]()}
        </div>
      ))}
    </div>
  );
}
