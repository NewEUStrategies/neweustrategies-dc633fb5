// `noindex` ekranu błędu (zgłoszenie 2026-10-09: sitelink „Problem
// z połączeniem"). Znacznik ma żyć DOKŁADNIE tak długo jak ekran błędu -
// zostawiony po udanym ponowieniu wyrzuciłby z indeksu poprawną stronę.
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ERROR_NOINDEX_ATTR, useErrorNoindex } from "@/lib/seo/useErrorNoindex";

function Probe({ active }: { active?: boolean }) {
  useErrorNoindex(active);
  return null;
}

function injected(): HTMLMetaElement[] {
  return [...document.head.querySelectorAll<HTMLMetaElement>(`meta[${ERROR_NOINDEX_ATTR}]`)];
}

afterEach(() => {
  for (const meta of injected()) meta.remove();
});

describe("useErrorNoindex", () => {
  it("dopisuje osobny `<meta name=robots content=noindex>` na czas montażu", () => {
    const view = render(<Probe />);
    const metas = injected();
    expect(metas).toHaveLength(1);
    expect(metas[0]?.getAttribute("name")).toBe("robots");
    expect(metas[0]?.getAttribute("content")).toBe("noindex");
    view.unmount();
    expect(injected()).toHaveLength(0);
  });

  it("nie dotyka istniejącego znacznika robots z `head()` trasy", () => {
    const routeMeta = document.createElement("meta");
    routeMeta.setAttribute("name", "robots");
    routeMeta.setAttribute("content", "index, follow");
    document.head.appendChild(routeMeta);
    const view = render(<Probe />);
    expect(routeMeta.getAttribute("content")).toBe("index, follow");
    view.unmount();
    expect(routeMeta.isConnected).toBe(true);
    routeMeta.remove();
  });

  it("wyłączony nie dopisuje niczego", () => {
    render(<Probe active={false} />);
    expect(injected()).toHaveLength(0);
  });
});
