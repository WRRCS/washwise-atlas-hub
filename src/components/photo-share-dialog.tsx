import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Copy, Mail, ExternalLink } from "lucide-react";

export function PhotoShareDialog({
  link,
  onClose,
}: {
  link: { url: string; title: string } | null;
  onClose: () => void;
}) {
  const mailto = link
    ? `mailto:?subject=${encodeURIComponent(link.title)}&body=${encodeURIComponent(`${link.title}\n\n${link.url}\n\n(Link works for 30 days.)`)}`
    : "#";
  return (
    <Dialog open={!!link} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{link?.title}</DialogTitle>
          <DialogDescription>Anyone with this link can view the photos for 30 days.</DialogDescription>
        </DialogHeader>
        <input
          readOnly
          value={link?.url ?? ""}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded-md border bg-muted px-3 py-2 text-sm"
        />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={async () => {
              if (!link) return;
              try { await navigator.clipboard.writeText(link.url); toast.success("Link copied"); }
              catch { toast.error("Couldn't copy — press and hold the link to copy it"); }
            }}
          >
            <Copy className="size-4 mr-1" /> Copy link
          </Button>
          <Button asChild className="bg-brand text-brand-foreground hover:opacity-90">
            <a href={mailto}><Mail className="size-4 mr-1" /> Email it</a>
          </Button>
          <Button asChild variant="ghost">
            <a href={link?.url} target="_blank" rel="noreferrer"><ExternalLink className="size-4 mr-1" /> Open</a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
