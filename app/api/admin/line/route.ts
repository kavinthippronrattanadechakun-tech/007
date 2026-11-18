import { randomUUID } from "node:crypto";
import { admin, user, isAdmin, fail } from "../../../../lib/server";
import {
  dispatchLineOrders,
  lineCredentialsReady,
  pushLine,
} from "../../../../lib/line-notifications";
export async function GET(req: Request) {
  try {
    const actor = await user(req);
    if (!actor || !(await isAdmin(actor.id))) return fail("ไม่มีสิทธิ์", 403);
    const db = admin();
    const [settings, destinations, jobs] = await Promise.all([
      db
        .from("line_settings")
        .select("enabled,target_id")
        .eq("id", true)
        .single(),
      db
        .from("line_destinations")
        .select("id,kind,last_seen_at")
        .order("last_seen_at", { ascending: false })
        .limit(100),
      db
        .from("line_order_notifications")
        .select("order_id,status,attempts,last_error,created_at,sent_at")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    if (settings.error || destinations.error || jobs.error)
      return fail("โหลดการตั้งค่า LINE ไม่สำเร็จ", 503);
    return Response.json(
      {
        configured: lineCredentialsReady(),
        settings: settings.data,
        destinations: destinations.data,
        jobs: jobs.data,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return fail("โหลดการตั้งค่า LINE ไม่สำเร็จ", 503);
  }
}
export async function POST(req: Request) {
  try {
    const actor = await user(req);
    if (!actor || !(await isAdmin(actor.id))) return fail("ไม่มีสิทธิ์", 403);
    const body = await req.json(),
      db = admin();
    if (body.action === "save") {
      if (
        typeof body.enabled !== "boolean" ||
        (body.targetId !== null &&
          (typeof body.targetId !== "string" ||
            !/^[UCR][0-9a-f]{32}$/.test(body.targetId)))
      )
        return fail("เลือกปลายทางให้ถูกต้อง");
      if (body.enabled && (!lineCredentialsReady() || !body.targetId))
        return fail("กรุณาตั้งค่าคีย์และเลือกแชตปลายทางก่อนเปิดใช้งาน");
      if (body.targetId) {
        const { data, error } = await db
          .from("line_destinations")
          .select("id")
          .eq("id", body.targetId)
          .single();
        if (error || !data)
          return fail("กรุณาเพิ่มเพื่อนหรือเชิญบอตเข้ากลุ่ม แล้วรีเฟรชปลายทาง");
      }
      const { error } = await db
        .from("line_settings")
        .update({
          enabled: body.enabled,
          target_id: body.targetId,
          updated_by: actor.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", true);
      if (error) return fail("บันทึกไม่สำเร็จ", 503);
      return Response.json({ ok: true });
    }
    const { data: settings, error } = await db
      .from("line_settings")
      .select("enabled,target_id")
      .eq("id", true)
      .single();
    if (
      error ||
      !lineCredentialsReady() ||
      !settings?.enabled ||
      !settings.target_id
    )
      return fail("กรุณาเปิดใช้งานและบันทึกปลายทางก่อน");
    if (body.action === "test") {
      const result = await pushLine(
        settings.target_id,
        "✅ ทดสอบแจ้งเตือน KingkeawLnwza สำเร็จ\nคำสั่งซื้อที่ร้านต้องจัดส่งเองจะแจ้งเข้าแชตนี้",
        randomUUID(),
      );
      return result.ok
        ? Response.json({ ok: true })
        : fail("ส่งทดสอบไม่สำเร็จ ตรวจคีย์ โควต้า และการเพิ่มเพื่อน/เชิญบอต", 502);
    }
    if (body.action === "retry") {
      const { error } = await db.rpc("retry_line_order_notifications", {
        p_actor: actor.id,
      });
      if (error) return fail("เตรียมส่งใหม่ไม่สำเร็จ", 503);
      return Response.json(await dispatchLineOrders(null, 3));
    }
    return fail("ข้อมูลไม่ถูกต้อง");
  } catch {
    return fail("ทำรายการ LINE ไม่สำเร็จ กรุณารีเฟรชเพื่อตรวจผล", 503);
  }
}
