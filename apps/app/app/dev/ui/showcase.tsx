"use client";

import * as React from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  CreditPill,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  EmptyState,
  ENTITY_BADGE_VARIANTS,
  Input,
  Select,
  Skeleton,
  STATUS_BADGE_VARIANTS,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
  useToast,
} from "@voidaccess/ui";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="border-b border-border-dim pb-2 font-display text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function Showcase() {
  const { toast } = useToast();
  const [checked, setChecked] = React.useState<boolean | "indeterminate">(true);

  return (
    <div className="flex flex-col gap-12">
      <h1 className="font-display text-3xl font-semibold">UI kit</h1>

      <Section title="Button">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button disabled>Disabled</Button>
          <Button loading>Loading</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
          <Button size="icon" variant="secondary" aria-label="Icon button">
            +
          </Button>
        </div>
      </Section>

      <Section title="Form controls">
        <div className="grid max-w-md gap-3">
          <Input placeholder="Input" aria-label="Input" />
          <Input placeholder="Invalid input" aria-invalid="true" aria-label="Invalid input" />
          <Input placeholder="Disabled input" disabled aria-label="Disabled input" />
          <Textarea placeholder="Textarea" aria-label="Textarea" />
          <Select
            aria-label="Select"
            placeholder="Select an option"
            options={[
              { value: "a", label: "Option A" },
              { value: "b", label: "Option B" },
              { value: "c", label: "Disabled option", disabled: true },
            ]}
          />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={checked} onCheckedChange={setChecked} />
            Checkbox (controlled)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked="indeterminate" />
            Indeterminate
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox disabled />
            Disabled
          </label>
        </div>
      </Section>

      <Section title="Card">
        <Card className="max-w-sm">
          <CardHeader>
            <CardTitle>Card title</CardTitle>
            <CardDescription>Card description text.</CardDescription>
          </CardHeader>
          <CardContent>Body content goes here.</CardContent>
          <CardFooter>
            <Button size="sm">Action</Button>
            <Button size="sm" variant="ghost">
              Cancel
            </Button>
          </CardFooter>
        </Card>
      </Section>

      <Section title="Badge">
        <div className="flex flex-wrap gap-2">
          {STATUS_BADGE_VARIANTS.map((v) => (
            <Badge key={v} variant={v}>
              {v}
            </Badge>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {ENTITY_BADGE_VARIANTS.map((v) => (
            <Badge key={v} variant={v}>
              {v}
            </Badge>
          ))}
        </div>
      </Section>

      <Section title="Tabs">
        <Tabs defaultValue="one" className="max-w-lg">
          <TabsList>
            <TabsTrigger value="one">One</TabsTrigger>
            <TabsTrigger value="two">Two</TabsTrigger>
            <TabsTrigger value="three">Three</TabsTrigger>
          </TabsList>
          <TabsContent value="one">First panel</TabsContent>
          <TabsContent value="two">Second panel</TabsContent>
          <TabsContent value="three">Third panel</TabsContent>
        </Tabs>
      </Section>

      <Section title="Dialog, Toast, Tooltip">
        <div className="flex flex-wrap items-center gap-3">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="secondary">Open dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Dialog title</DialogTitle>
                <DialogDescription>Escape or the close button dismisses this.</DialogDescription>
              </DialogHeader>
              <Input placeholder="Focusable field" aria-label="Focusable field" />
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="ghost">Cancel</Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button>Confirm</Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          {(["default", "success", "warning", "danger"] as const).map((variant) => (
            <Button
              key={variant}
              variant="secondary"
              onClick={() => toast({ title: `${variant} toast`, description: "Toast description.", variant })}
            >
              Toast: {variant}
            </Button>
          ))}
          <Tooltip content="Tooltip content">
            <Button variant="ghost">Hover or focus me</Button>
          </Tooltip>
        </div>
      </Section>

      <Section title="Skeleton">
        <div className="flex max-w-sm flex-col gap-2">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </Section>

      <Section title="Table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Entity</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Mentions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-mono">example-actor</TableCell>
              <TableCell>
                <Badge variant="actor">actor</Badge>
              </TableCell>
              <TableCell className="text-right font-mono">12</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono">CVE-0000-0000</TableCell>
              <TableCell>
                <Badge variant="cve">cve</Badge>
              </TableCell>
              <TableCell className="text-right font-mono">3</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Section>

      <Section title="EmptyState">
        <EmptyState
          icon="∅"
          title="Nothing here yet"
          description="Empty states explain what will appear and offer a next step."
          action={<Button size="sm">Primary action</Button>}
        />
      </Section>

      <Section title="CreditPill">
        <div className="flex flex-wrap gap-3">
          <CreditPill balance={0} />
          <CreditPill balance={1234} />
          <CreditPill balance={98765} label="credits left" />
        </div>
      </Section>
    </div>
  );
}
