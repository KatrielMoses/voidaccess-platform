import { cn } from "@voidaccess/ui";
import { ARCHIVE_GLYPH, glyphFor, glyphSvg, type ShapeName } from "@/lib/results/glyphs";

/** The entity family's shape, as drawn in the graph. Decorative: the type is always also written out. */
export function ShapeGlyph({ shape, className }: { shape: ShapeName; className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="-6 -6 12 12"
      className={cn("size-3 shrink-0 overflow-visible", className)}
      // static, generated markup (no user data)
      dangerouslySetInnerHTML={{ __html: glyphSvg(shape, 0, 0, 4.4, "currentColor", "none", 1, 1) }}
    />
  );
}

export function TypeGlyph({
  type,
  archive,
  className,
}: {
  type: string;
  archive?: boolean;
  className?: string;
}) {
  return <ShapeGlyph shape={(archive ? ARCHIVE_GLYPH : glyphFor(type)).shape} className={className} />;
}
