import { admin, user, isAdmin, fail } from "../../../../../lib/server";
const uuid = (v: unknown) =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v,
  );
const messages: Record<string, string> = {
  "Order not found": "ไม่พบคำสั่งซื้อ",
  "Order not delivered": "คำสั่งซื้อนี้ยังไม่ได้ส่งสินค้า",
  "Order not expired": "ยังไม่ถึงวันหมดอายุ หรือไม่ได้กำหนดวันหมดอายุ",
  "Order already processed": "รายการนี้จัดการสต็อกไปแล้ว กรุณารีเฟรช",
  "Stock already available": "สต็อกนี้พร้อมขายอยู่แล้ว ไม่เพิ่มซ้ำ",
  "Stock not found": "ไม่พบสต็อกต้นทาง",
  "No stock source": "รายการนี้ไม่มีสต็อกต้นทาง กรุณาเพิ่มผ่านหน้าสต็อกสินค้า",
  "Other customers active":
    "อีเมลนี้ยังมีลูกค้ารายอื่นใช้งานอยู่ จึงยังเปลี่ยนรหัสผ่านไม่ได้",
};
export async function GET(req: Request) {
  try {
    const actor = await user(req);
    if (!actor || !(await isAdmin(actor.id))) return fail("ไม่มีสิทธิ์", 403);
    const id = new URL(req.url).searchParams.get("orderId");
    if (!uuid(id)) return fail("รหัสคำสั่งซื้อไม่ถูกต้อง");
    const { data, error } = await admin().rpc("admin_order_inventory", {
      p_order: id,
      p_actor: actor.id,
    });
    if (error)
      return fail(messages[error.message] || "โหลดข้อมูลสต็อกไม่สำเร็จ");
    return Response.json(
      { data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return fail("โหลดข้อมูลสต็อกไม่สำเร็จ", 503);
  }
}
export async function POST(req: Request) {
  try {
    const actor = await user(req);
    if (!actor || !(await isAdmin(actor.id))) return fail("ไม่มีสิทธิ์", 403);
    const { orderId, action, password = "", secret = "" } = await req.json();
    if (
      !uuid(orderId) ||
      !["restock", "remove"].includes(action) ||
      typeof password !== "string" ||
      password.length > 1000 ||
      /[\r\n]/.test(password) ||
      typeof secret !== "string" ||
      secret.length > 16384
    )
      return fail("ข้อมูลไม่ถูกต้อง");
    const { data, error } = await admin().rpc("admin_manage_order_inventory", {
      p_order: orderId,
      p_actor: actor.id,
      p_action: action,
      p_password: password,
      p_secret: secret,
    });
    if (error)
      return fail(
        messages[error.message] ||
          (error.code === "23505"
            ? "ข้อมูลสต็อกนี้มีอยู่แล้ว"
            : "บันทึกไม่สำเร็จ กรุณารีเฟรชเพื่อตรวจผล"),
      );
    return Response.json(
      { data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return fail("ยังยืนยันผลไม่ได้ กรุณารีเฟรชเพื่อตรวจผล", 503);
  }
}
