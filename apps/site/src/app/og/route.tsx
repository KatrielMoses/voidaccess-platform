import { ImageResponse } from "next/og";

export const dynamic = "force-dynamic";

/** Branded social card: /og?title=… (title is length-capped and rendered as text only). */
export function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("title") ?? "VoidAccess";
  const title = raw.slice(0, 110);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#080b11", color: "#e6edf3", padding: 72 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 34, color: "#9b9fee" }}>
          <div style={{ width: 18, height: 18, borderRadius: 9, background: "#9b9fee" }} />
          VoidAccess
        </div>
        <div style={{ fontSize: title.length > 60 ? 54 : 70, fontWeight: 700, lineHeight: 1.1, letterSpacing: -2 }}>{title}</div>
        <div style={{ fontSize: 28, color: "#8b949e" }}>voidaccess.pro · dark-web threat intelligence, without the dark web</div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
