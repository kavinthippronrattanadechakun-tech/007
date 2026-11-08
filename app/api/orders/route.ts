import { createClient } from "@supabase/supabase-js";
import { supabaseUrl } from "../../../lib/supabase-config";
import { fail } from "../../../lib/server";
export async function POST(req: Request) {
  try {
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return fail("กรุณาเข้าสู่ระบบ", 401);
    const db = createClient(
      supabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL!),
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(),
      {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false },
      },
    );
    const { data: auth, error: authError } = await db.auth.getUser(token);
    if (authError || !auth.user) return fail("กรุณาเข้าสู่ระบบ", 401);
    const { productId, email } = await req.json();
    if (typeof productId !== "string" || (email && typeof email !== "string"))
      return fail("ข้อมูลไม่ถูกต้อง");
    const { data, error } = await db.rpc("buy_product", {
      p_product_id: productId,
      p_email: email || null,
    });
    if (error)
      return fail(
        error.message === "Out of stock"
          ? "สินค้าหมดชั่วคราว กรุณาลองใหม่ภายหลัง"
          : error.message === "Customer email required"
            ? "กรุณากรอกอีเมลสำหรับสินค้านี้ให้ถูกต้อง"
            : error.message,
      );
    return Response.json({ data });
  } catch {
    return fail("สั่งซื้อไม่สำเร็จ", 500);
  }
}
