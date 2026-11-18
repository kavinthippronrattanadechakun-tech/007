import { admin, user, isAdmin, fail } from "../../../../../lib/server";
export async function POST(req: Request) {
  try {
    const actor = await user(req);
    if (!actor || !(await isAdmin(actor.id))) return fail("ไม่มีสิทธิ์", 403);
    const {
      stockId,
      kind,
      fromProductId,
      targetProductId,
      expectedRemaining = null,
    } = await req.json();
    if (
      typeof stockId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        stockId,
      ) ||
      !["account", "code"].includes(kind) ||
      typeof fromProductId !== "string" ||
      !fromProductId ||
      fromProductId.length > 200 ||
      typeof targetProductId !== "string" ||
      !targetProductId ||
      targetProductId.length > 200 ||
      targetProductId === fromProductId ||
      (kind === "account" &&
        (!Number.isSafeInteger(expectedRemaining) ||
          expectedRemaining < 1 ||
          expectedRemaining > 100000))
    )
      return fail("กรุณาเลือกสินค้าปลายทางและสต็อกให้ถูกต้อง");
    const { data, error } = await admin().rpc("admin_move_stock", {
      p_id: stockId,
      p_kind: kind,
      p_from_product: fromProductId,
      p_target_product: targetProductId,
      p_actor: actor.id,
      p_expected_remaining: kind === "account" ? expectedRemaining : null,
    });
    if (error)
      return fail(
        error.message === "Target credentials differ"
          ? "ปลายทางมีเมล/จอเดียวกันแต่ข้อมูลส่งมอบไม่ตรงกัน กรุณาตรวจสอบก่อน"
          : error.message === "Target stock full"
            ? "จำนวนสต็อกปลายทางเต็มแล้ว"
            : error.message === "Source stock changed"
              ? "สต็อกเปลี่ยนจากการซื้อหรือการย้าย กรุณารีเฟรชแล้วลองใหม่"
              : error.message === "Invalid target product"
                ? "ปลายทางต้องเป็นสินค้าที่ส่งจากสต็อกอัตโนมัติ"
                : error.code === "23505"
                  ? "ปลายทางมีสต็อกนี้อยู่แล้ว"
                  : "ย้ายสต็อกไม่สำเร็จ กรุณารีเฟรชเพื่อตรวจผล",
        409,
      );
    return Response.json(
      { data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return fail("ยังยืนยันผลไม่ได้ กรุณารีเฟรชเพื่อตรวจผล", 503);
  }
}
