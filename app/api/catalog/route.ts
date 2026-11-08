import { admin, fail } from "../../../lib/server";
export async function GET() {
  try {
    const { data, error } = await admin().rpc("catalog_stock_counts");
    if (error) return fail("โหลดจำนวนคงเหลือไม่สำเร็จ", 503);
    return Response.json(
      { stock: data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return fail("โหลดจำนวนคงเหลือไม่สำเร็จ", 503);
  }
}
