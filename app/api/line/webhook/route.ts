import { createHmac, timingSafeEqual } from "node:crypto";
import { admin, fail } from "../../../../lib/server";
export async function POST(req: Request) {
  const secret = process.env.LINE_CHANNEL_SECRET?.trim();
  if (!secret) return fail("LINE ยังไม่ได้ตั้งค่า", 503);
  const raw = await req.text();
  if (Buffer.byteLength(raw) > 262144) return fail("ข้อมูลใหญ่เกินไป", 413);
  const supplied = req.headers.get("x-line-signature") || "";
  const expected = createHmac("sha256", secret).update(raw).digest("base64");
  if (
    Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  )
    return fail("Invalid signature", 401);
  try {
    const payload = JSON.parse(raw);
    if (!Array.isArray(payload.events) || payload.events.length > 100)
      return fail("Invalid events");
    const targets = new Map<
      string,
      { id: string; kind: string; last_seen_at: string }
    >();
    for (const event of payload.events) {
      if (!["follow", "join", "message"].includes(event.type)) continue;
      const source = event.source || {},
        kind = source.type;
      const id =
        kind === "group"
          ? source.groupId
          : kind === "room"
            ? source.roomId
            : kind === "user"
              ? source.userId
              : null;
      const prefix = (
        { user: "U", group: "C", room: "R" } as Record<string, string>
      )[kind];
      if (
        typeof id === "string" &&
        prefix &&
        new RegExp(`^${prefix}[0-9a-f]{32}$`).test(id)
      )
        targets.set(id, { id, kind, last_seen_at: new Date().toISOString() });
    }
    if (targets.size) {
      const { error } = await admin()
        .from("line_destinations")
        .upsert([...targets.values()], { onConflict: "id" });
      if (error) return fail("บันทึกปลายทางไม่สำเร็จ", 503);
    }
    return Response.json({ ok: true });
  } catch {
    return fail("รับข้อมูลไม่สำเร็จ", 400);
  }
}
