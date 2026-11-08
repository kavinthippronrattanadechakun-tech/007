import { admin, user, isAdmin, fail } from "../../../../../lib/server";
export async function POST(req: Request) {
  try {
    const actor = await user(req);
    if (!actor || !(await isAdmin(actor.id))) return fail("ไม่มีสิทธิ์", 403);
    const { orderId, delivery = "" } = await req.json();
    if (
      typeof orderId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        orderId,
      ) ||
      typeof delivery !== "string" ||
      delivery.length > 16384
    )
      return fail("ข้อมูลไม่ถูกต้อง");
    const { data, error } = await admin().rpc("admin_fulfill_order", {
      p_order: orderId,
      p_actor: actor.id,
      p_delivery: delivery,
    });
    if (error)
      return fail(
        error.message === "Not manual order"
          ? "รายการนี้เป็นการส่งสินค้าอัตโนมัติ"
          : error.message === "Order not found"
            ? "ไม่พบคำสั่งซื้อ"
            : "บันทึกการจัดส่งไม่สำเร็จ กรุณารีเฟรชเพื่อตรวจผล",
      );
    return Response.json(
      { data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return fail("ยังยืนยันผลไม่ได้ กรุณารีเฟรชเพื่อตรวจผล", 503);
  }
}
