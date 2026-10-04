// LIŚĆ `<style>` ARKUSZY KORZENIA (Wydajność PSI 85/95, fala 1, pozycja P1.2).
//
// PO CO. React 19 porównuje `dangerouslySetInnerHTML` po TOŻSAMOŚCI obiektu
// (`updateProperties`: `nextProp !== lastProp` -> `setProp` -> `innerHTML =`,
// bez porównania samego napisu), a literał `{{ __html }}` w JSX tworzy nowy
// obiekt przy każdym renderze. Każdy re-render komponentu z arkuszem
// przepisywał więc `innerHTML` bloku - także przy IDENTYCZNYM tekście. Dla
// `style[data-brand-tokens]` (26,6 KB zmiennych `:root`) to przeliczenie stylu
// całego dokumentu i layout (260-390 ms przy CDP 4x, werdykt hydration:H2),
// wyzwalane przez dowolny re-render korzenia, np. `site_font_scale`
// przechodzące po hydratacji z `undefined` na `{}` przy tym samym skrócie.
//
// MECHANIKA. `memo` porównuje propsy płytko, a `css` jest PRYMITYWNYM napisem:
// re-render rodzica z tym samym tekstem i tymi samymi atrybutami w ogóle nie
// dochodzi do `<style>`, więc DOM bloku zostaje nietknięty. Nowy obiekt
// `{__html}` (czyli jedno `innerHTML =`) powstaje wyłącznie wtedy, gdy zmienił
// się któryś props - tekst arkusza albo atrybut (np. `data-css-hash`, który
// `useDeferredStyleCss` zmienia razem z CSS-em).
//
// BRAMKA `check:dangerous-html`. `hardenStyleCss` jest wołane TUTAJ, w miejscu
// renderu, z literałem `{__html}` - bramka akceptuje `<style>` wyłącznie z tym
// sanitizerem i dowodem w tym samym pliku (`src/lib/ci/dangerousHtml.ts`), bez
// wpisu w allowliście. Funkcja jest idempotentna, więc wołający podają surowy
// napis: CSS z generatora (już utwardzony) i migawka z DOM-u dają ten sam wynik.
//
// PARYTET SSR/HYDRATACJI. Atrybuty trafiają na `<style>` w kolejności podanej
// przez wołającego (rozwinięcie przed `dangerouslySetInnerHTML`), więc HTML
// serwera jest bajt w bajt taki jak przed wydzieleniem liścia - `data-css-hash`
// czyta potem `readStyleSnapshot` (`lib/theme/styleSnapshot`).
//
// ZAKRES. Arkusze korzenia (`__root.tsx`); arkusze per widget i tickera mają
// własnych właścicieli w planie (P2.4, P2.3) i mogą użyć tego samego liścia.
import { memo } from "react";
import { hardenStyleCss } from "@/lib/sanitizePure";

/** Atrybuty `data-*` bloku (znacznik migawki, skrót danych, język, tryb). */
type StyleDataAttributes = { [name: `data-${string}`]: string | boolean | undefined };

export type StyleSinkProps = StyleDataAttributes & {
  /** Surowy CSS bloku; utwardzany w miejscu renderu. */
  css: string;
};

export const StyleSink = memo(function StyleSink({ css, ...attrs }: StyleSinkProps) {
  return <style {...attrs} dangerouslySetInnerHTML={{ __html: hardenStyleCss(css) }} />;
});
