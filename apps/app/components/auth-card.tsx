/** Auth step: a page head and its form, set straight on the field (no box). */
export function AuthCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-4">
        <h1 className="text-[clamp(32px,3.2vw,44px)] leading-[1.02] font-medium tracking-[-0.04em] text-paper">
          {title}
        </h1>
        {description ? <p className="text-[17px] leading-[1.55] text-dim">{description}</p> : null}
      </div>
      <div className="flex flex-col gap-5 border-t border-line pt-8">{children}</div>
    </div>
  );
}
