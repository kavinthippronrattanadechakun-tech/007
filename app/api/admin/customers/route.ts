import { admin, user, isAdmin, fail } from "../../../../lib/server";
export async function GET(req: Request) {
  try {
    const actor = await user(req);
    if (!actor || !(await isAdmin(actor.id))) return fail("ไม่มีสิทธิ์", 403);
    const email = new URL(req.url).searchParams.get("email") || "";
    if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return fail("กรอกอีเมลลูกค้าให้ถูกต้อง");
    const db = admin(),
      { data, error } = await db.rpc("admin_customer_lookup", {
        p_email: email,
      });
    if (error) return fail("ค้นหาลูกค้าไม่สำเร็จ", 503);
    const customer = data?.[0] || null;
    const history = customer
      ? await db
          .from("admin_wallet_credits")
          .select("id,amount,note,reference,created_at")
          .eq("user_id", customer.id)
          .order("created_at", { ascending: false })
          .limit(20)
      : null;
    if (history?.error) return fail("โหลดประวัติไม่สำเร็จ", 503);
    return Response.json(
      { customer, history: history?.data || [] },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return fail("ค้นหาลูกค้าไม่สำเร็จ", 503);
  }
}
export async function POST(req: Request) {
  try {
    const actor = await user(req);
    if (!actor || !(await isAdmin(actor.id))) return fail("ไม่มีสิทธิ์", 403);
    const { requestId, userId, amount, reference, note } = await req.json();
    if (
      typeof requestId !== "string" ||
      !isUuid(requestId) ||
      typeof userId !== "string" ||
      !isUuid(userId) ||
      !Number.isSafeInteger(amount) ||
      amount < 1 ||
      amount > 100000 ||
      typeof reference !== "string" ||
      !/^[A-Za-z0-9_-]{6,200}$/.test(reference.trim()) ||
      typeof note !== "string" ||
      !note.trim() ||
      note.trim().length > 1000
    )
      return fail("กรอกข้อมูลการเติมเงินให้ครบถ้วน");
    const { data, error } = await admin().rpc("admin_credit_wallet", {
      p_id: requestId,
      p_actor: actor.id,
      p_user: userId,
      p_amount: amount,
      p_reference: reference.trim(),
      p_note: note.trim(),
    });
    if (error)
      return fail(
        error.code === "23505"
          ? "เลขอ้างอิงนี้เติมเงินแล้ว กรุณาตรวจประวัติ"
          : error.message === "Request conflict"
            ? "รหัสรายการถูกใช้กับข้อมูลอื่นแล้ว"
            : "เติมเงินไม่สำเร็จ กรุณาตรวจประวัติก่อนลองอีกครั้ง",
        error.code === "23505" ? 409 : 400,
      );
    return Response.json(
      { data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return fail("ยังยืนยันผลไม่ได้ กรุณาตรวจประวัติก่อนลองอีกครั้ง", 503);
  }
}
function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v,
  );
}
