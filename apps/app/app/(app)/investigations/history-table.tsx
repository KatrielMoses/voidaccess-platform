"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from "@voidaccess/ui";
import { DEPTH_COPY } from "@/content/examples";
import { StatusBadge } from "@/components/status-badge";

export interface HistoryRow {
  id: string;
  title: string;
  depth: string;
  status: string;
  creditsCharged: number;
  createdAt: string;
}

const TERMINAL = new Set(["completed", "failed", "cancelled"]);
const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

export function HistoryTable({ rows }: { rows: HistoryRow[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [renaming, setRenaming] = useState<HistoryRow | null>(null);
  const [deleting, setDeleting] = useState<HistoryRow | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  async function call(url: string, init: RequestInit, ok: string) {
    setBusy(true);
    try {
      const res = await fetch(url, { ...init, headers: { "content-type": "application/json" } });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { message?: string };
        toast({ title: b.message ?? "That didn't work", variant: "danger" });
        return false;
      }
      toast({ title: ok });
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Investigation</TableHead>
            <TableHead className="max-[640px]:hidden">Date</TableHead>
            <TableHead className="max-[640px]:hidden">Depth</TableHead>
            <TableHead className="text-right max-[640px]:hidden">Credits</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="max-w-[22rem] min-w-44">
                <Link
                  href={`/investigations/${r.id}`}
                  className="block truncate text-[15px] font-medium text-paper decoration-line-3 underline-offset-4 hover:underline"
                  title={r.title}
                >
                  {r.title}
                </Link>
              </TableCell>
              <TableCell className="font-mono text-[13px] whitespace-nowrap text-dim tabular-nums max-[640px]:hidden">
                {fmt.format(new Date(r.createdAt))} UTC
              </TableCell>
              <TableCell className="text-dim max-[640px]:hidden">
                {DEPTH_COPY[r.depth as keyof typeof DEPTH_COPY]?.label ?? r.depth}
              </TableCell>
              <TableCell className="text-right font-mono text-[13px] tabular-nums">
                {r.creditsCharged}
              </TableCell>
              <TableCell>
                <StatusBadge status={r.status} />
              </TableCell>
              <TableCell className="text-right whitespace-nowrap last:pr-0">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setRenaming(r);
                    setValue(r.title);
                  }}
                >
                  Rename
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!TERMINAL.has(r.status)}
                  title={TERMINAL.has(r.status) ? undefined : "Cancel the run before deleting it"}
                  onClick={() => setDeleting(r)}
                >
                  Delete
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={renaming !== null} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename investigation</DialogTitle>
            <DialogDescription>Leave it blank to go back to the original query.</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!renaming) return;
              const ok = await call(
                `/api/investigations/${renaming.id}`,
                { method: "PATCH", body: JSON.stringify({ title: value }) },
                "Renamed",
              );
              if (ok) setRenaming(null);
            }}
          >
            <label htmlFor="rename" className="sr-only">
              Title
            </label>
            <Input
              id="rename"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              maxLength={200}
              autoFocus
            />
            <DialogFooter>
              <Button type="submit" loading={busy}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this investigation?</DialogTitle>
            <DialogDescription>
              The report and everything collected for it are removed for good. Credits already spent are not
              returned.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Keep it
            </Button>
            <Button
              variant="secondary"
              loading={busy}
              onClick={async () => {
                if (!deleting) return;
                const ok = await call(`/api/investigations/${deleting.id}`, { method: "DELETE" }, "Deleted");
                if (ok) setDeleting(null);
              }}
            >
              Delete investigation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
