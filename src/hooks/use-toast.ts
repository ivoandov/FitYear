/**
 * Compat shim for the legacy useToast() shadcn hook.
 * Forwards to sonner — the modern shadcn toast lib.
 */
import { toast as sonnerToast } from "sonner";

interface ToastInput {
  title?: string;
  description?: string;
  variant?: "default" | "destructive";
  duration?: number;
}

export function useToast() {
  function toast(opts: ToastInput) {
    const message = opts.title ?? opts.description ?? "";
    const description = opts.title && opts.description ? opts.description : undefined;
    const fn =
      opts.variant === "destructive" ? sonnerToast.error : sonnerToast;
    fn(message, { description, duration: opts.duration });
  }
  return { toast };
}

export const toast = (opts: ToastInput) => {
  const message = opts.title ?? opts.description ?? "";
  const description = opts.title && opts.description ? opts.description : undefined;
  const fn = opts.variant === "destructive" ? sonnerToast.error : sonnerToast;
  fn(message, { description, duration: opts.duration });
};
