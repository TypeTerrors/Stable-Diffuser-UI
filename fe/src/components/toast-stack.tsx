import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import type { ComponentType } from "react";

export type ToastVariant = "info" | "success" | "error";

export type ToastItem = {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
};

const variantStyles: Record<ToastVariant, { className: string; icon: ComponentType<{ className?: string }> }> = {
  info: { className: "border-sky-500/20 bg-sky-500/10", icon: Info },
  success: { className: "border-emerald-500/25 bg-emerald-500/10", icon: CheckCircle2 },
  error: { className: "", icon: TriangleAlert },
};

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed right-4 top-4 z-50 flex w-[min(420px,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((toast) => {
        const variant = variantStyles[toast.variant];
        const Icon = variant.icon;
        return (
          <Alert key={toast.id} variant={toast.variant === "error" ? "destructive" : "default"} className={cn(variant.className)}>
            <Icon className="size-4" />
            <div className="absolute right-2 top-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label="Dismiss notification"
                onClick={() => onDismiss(toast.id)}
              >
                <X className="size-4" />
              </Button>
            </div>
            <AlertTitle className="pr-8">{toast.title}</AlertTitle>
            {toast.description ? <AlertDescription className="pr-8">{toast.description}</AlertDescription> : null}
          </Alert>
        );
      })}
    </div>
  );
}
