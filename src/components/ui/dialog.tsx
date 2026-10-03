"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "@/lib/lucide-shim";

import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

// Powrót ogniska po zamknięciu okna modalnego (Dialog, Sheet, AlertDialog).
//
// Radix po zamknięciu oddaje ognisko WYŁĄCZNIE swojemu `Trigger`. Większość
// okien w tym repozytorium jest sterowana propem `open` (przycisk w panelu,
// skrót klawiszowy, host globalnych okien) i żadnego `Trigger` nie ma - wtedy
// ognisko lądowało na <body>, a użytkownik klawiatury i czytnika ekranu wracał
// na początek strony (WCAG 2.4.3). Ten hook zapamiętuje element, który miał
// ognisko w chwili otwarcia, i oddaje mu je przy zamknięciu.
//
// Pierwszeństwo ma wywołujący: jego `onCloseAutoFocus` biegnie pierwszy i jeśli
// zrobi `preventDefault()`, hook niczego nie rusza. Nie są celem: element
// odpięty od DOM (np. pozycja menu, które się zamknęło) ani <body> - klik
// myszą w Safari nie ogniskuje przycisku, więc „otwierającym" bywa <body>,
// a wtedy właściwym celem jest `Trigger` Radiksa. W obu przypadkach zostaje
// domyślne zachowanie biblioteki.
//
// Hook żyje w tym pliku, a nie w osobnym module: `Sheet` i `AlertDialog`
// importują go stąd. Osobny mikromoduł (~0,6 KB) zmieniał decyzje scalania
// małych chunków Rollupa (`experimentalMinChunkSize`) i przerzucał pulpit
// analityki admina do grafu publicznego (bramka `check:bundle`).

type FocusHandler = (event: Event) => void;

export function useReturnFocus(
  onOpenAutoFocus: FocusHandler | undefined,
  onCloseAutoFocus: FocusHandler | undefined,
): { onOpenAutoFocus: FocusHandler; onCloseAutoFocus: FocusHandler } {
  const openerRef = React.useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: (event) => {
      // Zdarzenie montowania przychodzi, zanim Radix przeniesie ognisko do okna.
      const active = document.activeElement;
      openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
      onOpenAutoFocus?.(event);
    },
    onCloseAutoFocus: (event) => {
      onCloseAutoFocus?.(event);
      const opener = openerRef.current;
      openerRef.current = null;
      if (event.defaultPrevented || !opener?.isConnected) return;
      event.preventDefault();
      opener.focus();
    },
  };
}

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, onOpenAutoFocus, onCloseAutoFocus, ...props }, ref) => {
  const focus = useReturnFocus(onOpenAutoFocus, onCloseAutoFocus);
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:rounded-lg",
          className,
        )}
        {...props}
        {...focus}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background cursor-pointer transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
