// Zagnieżdżona dyskusja jako akordeon: gałąź odpowiedzi da się zwinąć.
//
// Prymityw NEUTRALNY - używają go trzy powierzchnie o różnych modułach (wątki
// klubów, komentarze pod artykułami, ściana klubu). Stąd `components/ui`, a nie
// atom jednego z nich: atom klubowy zaciągnąłby moduł klubów do komentarzy.
//
// PO CO OSOBNY BYT. Wątek klubowy schodzi do trzech poziomów i przy żywej
// dyskusji rozjeżdża się na kilka ekranów. Do tej pory nie dało się go w żaden
// sposób złożyć - czytelnik przewijał każdą odpowiedź, także te, które już zna.
// Akordeon DODAJE zwijanie; domyślnie wszystko jest rozwinięte, więc nikomu nie
// znika treść, na którą wszedł z powiadomienia.
//
// DLACZEGO NIE `ui/accordion.tsx`. Tamten `AccordionContent` ma zahardkodowaną
// klasę na animowanym elemencie, a przekazany `className` ląduje na wewnętrznym
// `<div>` z `text-muted-foreground` - treści odpowiedzi nie da się tam ani
// odszarzyć, ani wciąć w dobrym miejscu. `AccordionItem` dokleja dodatkowo
// `border-b`. Edycja tamtego pliku uderzyłaby w FAQ cennika i ściągę panelu.
//
// SEMANTYKA LISTY ZOSTAJE. Odpowiedzi to `<ul>/<li>`, a Radix renderuje `<div>`.
// Dlatego Root i Item idą przez `asChild`: Root STAJE SIĘ `<ul>`, Item `<li>`.
// Bez tego `<div>` wylądowałby bezpośrednio w `<ul>` - niepoprawny HTML, który
// psuje nawigację czytnikiem ekranu i selektor potomka `li li`.
//
// STAN ŻYJE WYŻEJ. Każdy Root dostaje identyfikatory SWOICH rodzeństw i zbiór
// zwiniętych; zdarzenie Radiksa (tablica otwartych) tłumaczymy z powrotem na
// pojedyncze przełączenie po ID odpowiedzi. Stan po ID, a nie po pozycji, bo
// nowa partia odpowiedzi przestawiłaby stan indeksowany na złe gałęzie.
import type { ReactNode } from "react";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Klasy pionowego grzbietu gałęzi: wcięcie plus gradientowa linia gasnąca ku
 * dołowi. Czysta funkcja, a nie literał w JSX - tak samo jak `clubDossierSpineClass`
 * w module klubów, dzięki czemu wygląd gałęzi ma dowód bez montowania drzewa.
 */
export function discussionSpineClass(): string {
  return [
    "relative pl-4 sm:pl-6",
    "before:absolute before:inset-y-0 before:left-1.5 before:w-px",
    "before:bg-gradient-to-b before:from-border before:via-border/60 before:to-transparent",
  ].join(" ");
}

/**
 * Lista rodzeństwa odpowiedzi; stan otwarcia jest sterowany z góry.
 *
 * `element` istnieje, bo powierzchnie mają RÓŻNĄ semantykę dokumentu: wątek
 * klubowy buduje odpowiedzi jako `<ul>/<li>`, a komentarze pod artykułami jako
 * zagnieżdżone `<div>`. Wymuszenie jednej z nich przepisywałoby cudzy DOM przy
 * okazji dorzucania zwijania - a to psuje testy ról i nawigację czytnikiem.
 */
export function Discussion({
  siblingIds,
  collapsed,
  onToggle,
  element = "ul",
  className,
  children,
}: {
  element?: "ul" | "div";
  /** ID odpowiedzi renderowanych bezpośrednio w tej liście. */
  siblingIds: readonly string[];
  /** Zbiór ID gałęzi ZWINIĘTYCH. Pusty zbiór = wszystko rozwinięte. */
  collapsed: ReadonlySet<string>;
  onToggle: (replyId: string, open: boolean) => void;
  className?: string;
  children: ReactNode;
}) {
  const open = siblingIds.filter((id) => !collapsed.has(id));
  return (
    <AccordionPrimitive.Root
      type="multiple"
      value={open}
      onValueChange={(next) => {
        const nextOpen = new Set(next);
        for (const id of siblingIds) {
          const wasOpen = !collapsed.has(id);
          const isOpen = nextOpen.has(id);
          if (wasOpen !== isOpen) onToggle(id, isOpen);
        }
      }}
      asChild
    >
      {element === "ul" ? (
        <ul className={cn("space-y-2.5", className)}>{children}</ul>
      ) : (
        <div className={cn("space-y-2.5", className)}>{children}</div>
      )}
    </AccordionPrimitive.Root>
  );
}

/** Pojedynczy wpis. `element` musi pasować do listy nadrzędnej: `<li>` w `<ul>`,
 *  `<div>` w `<div>` - inaczej powstaje niepoprawny HTML. */
export function DiscussionItem({
  value,
  element = "li",
  className,
  children,
}: {
  value: string;
  element?: "li" | "div" | "article";
  className?: string;
  children: ReactNode;
}) {
  return (
    <AccordionPrimitive.Item value={value} asChild>
      {element === "li" ? (
        <li className={cn("group/reply", className)}>{children}</li>
      ) : element === "article" ? (
        <article className={cn("group/reply", className)}>{children}</article>
      ) : (
        <div className={cn("group/reply", className)}>{children}</div>
      )}
    </AccordionPrimitive.Item>
  );
}

/**
 * Przełącznik gałęzi. Etykietę liczy wywołujący (zna licznik i stan), więc w
 * drzewie dostępności stoi JEDEN napis - a nie dwa, z których jeden jest ukryty
 * klasą i myli czytnik ekranu oraz asercje testów.
 */
export function DiscussionExpand({ label, className }: { label: string; className?: string }) {
  return (
    <AccordionPrimitive.Header asChild>
      <div className="flex">
        <AccordionPrimitive.Trigger
          data-testid="discussion-expand"
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium",
            "text-muted-foreground transition-colors hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "[&[data-state=open]>svg]:rotate-180",
            className,
          )}
        >
          <ChevronDown
            className="h-3.5 w-3.5 shrink-0 transition-transform duration-200"
            aria-hidden="true"
          />
          {label}
        </AccordionPrimitive.Trigger>
      </div>
    </AccordionPrimitive.Header>
  );
}

/** Zwijana zawartość gałęzi - zagnieżdżone odpowiedzi z grzbietem po lewej. */
export function DiscussionReplies({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <AccordionPrimitive.Content
      className={cn(
        "overflow-hidden",
        "data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down",
      )}
    >
      <div className={cn("mt-2", discussionSpineClass(), className)}>{children}</div>
    </AccordionPrimitive.Content>
  );
}
