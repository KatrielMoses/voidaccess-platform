"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  Button,
  buttonVariants,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  useToast,
} from "@voidaccess/ui";
import { deleteInvestigation, renameInvestigation } from "@/app/(app)/investigations/[id]/results/actions";

export function HeaderActions({ id }: { id: string }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [open, setOpen] = useState<"rename" | "delete" | null>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, done: string) =>
    start(async () => {
      const r = await fn();
      toast({
        title: r.ok ? done : (r.message ?? "That didn't work."),
        variant: r.ok ? "success" : "warning",
      });
      if (r.ok) setOpen(null);
    });

  return (
    <div className="flex gap-2">
      <Link
        href={`/investigations/${id}/replay`}
        className={buttonVariants({ variant: "secondary", size: "sm" })}
        data-testid="replay-run"
      >
        Replay run
      </Link>
      <Dialog open={open === "rename"} onOpenChange={(o) => setOpen(o ? "rename" : null)}>
        <DialogTrigger asChild>
          <Button variant="secondary" size="sm">
            Rename
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename investigation</DialogTitle>
            <DialogDescription>Give this investigation a name you will recognise.</DialogDescription>
          </DialogHeader>
          <Input
            aria-label="Investigation name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button
              loading={pending}
              disabled={!name.trim()}
              onClick={() => run(() => renameInvestigation(id, name), "Renamed")}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={open === "delete"} onOpenChange={(o) => setOpen(o ? "delete" : null)}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm">
            Delete
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this investigation?</DialogTitle>
            <DialogDescription>
              Your results are removed from your account. Findings already added to the shared, anonymous
              archive stay there.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button
              variant="danger"
              loading={pending}
              onClick={() => run(() => deleteInvestigation(id), "Deleted")}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
