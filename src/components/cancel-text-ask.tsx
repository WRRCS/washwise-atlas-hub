import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { previewCancelTexts } from "@/lib/jobs.functions";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

/**
 * Before a published cleaning is canceled or deleted, ask the owner whether to
 * text the scheduled cleaners. Resolves true (Send text) or false (Skip).
 * Nothing is asked when nobody would be texted.
 */
export function useAskCancelText() {
  const preview = useServerFn(previewCancelTexts);
  const [names, setNames] = useState<string[] | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);
  const finish = (v: boolean) => { resolver.current?.(v); resolver.current = null; setNames(null); };

  const ask = async (jobId: string): Promise<boolean> => {
    const r = await preview({ data: { id: jobId } }).catch(() => ({ names: [] as string[] }));
    if (!r.names.length) return false;
    return new Promise<boolean>((resolve) => { resolver.current = resolve; setNames(r.names); });
  };

  const dialog = (
    <AlertDialog open={!!names} onOpenChange={(o) => { if (!o) finish(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Text the cleaners?</AlertDialogTitle>
          <AlertDialogDescription>
            This cleaning is on the published schedule. Send a text to {names?.join(", ")} saying it's canceled?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => finish(false)}>Skip</AlertDialogCancel>
          <AlertDialogAction onClick={() => finish(true)}>Send text</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return { ask, dialog };
}
