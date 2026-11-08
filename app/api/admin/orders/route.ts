import { admin, user, isAdmin, fail } from "../../../../lib/server";
export async function GET(req: Request) {
  try {
    const actor = await user(req);
    if (!actor || !(await isAdmin(actor.id))) return fail("ไม่มีสิทธิ์", 403);
    const params = new URL(req.url).searchParams,
      q = params.get("q") || "",
      status = params.get("status") || "",
      page = Number(params.get("page") || 0);
    if (
      q.length > 320 ||
      ![
        "",
        "processing",
        "delivered",
        "expired",
        "active",
        "pending_restock",
        "restocked",
        "removed",
        "manual_pending",
        "manual_delivered",
        "manual_all",
      ].includes(status) ||
      !Number.isSafeInteger(page) ||
      page < 0 ||
      page > 2000
    )
      return fail("ข้อมูลค้นหาไม่ถูกต้อง");
    const { data, error } = await admin().rpc("admin_order_list", {
      p_query: q.trim(),
      p_status: status,
      p_offset: page * 50,
    });
    if (error) return fail("โหลดคำสั่งซื้อไม่สำเร็จ", 503);
    return Response.json(
      { rows: (data || []).slice(0, 50), hasMore: (data || []).length > 50 },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return fail("โหลดคำสั่งซื้อไม่สำเร็จ", 503);
  }
}
