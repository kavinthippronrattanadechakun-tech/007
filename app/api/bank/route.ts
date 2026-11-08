import { createClient } from "@supabase/supabase-js";
import { supabaseUrl } from "../../../lib/supabase-config";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const db = createClient(
      supabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL!),
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(),
      { auth: { persistSession: false } },
    );
    const { data, error } = await db
      .from("store_settings")
      .select("bank_name,bank_account_name,bank_account_number")
      .eq("id", true)
      .single();
    if (error) throw error;
    return Response.json(
      {
        bank: data.bank_name,
        name: data.bank_account_name,
        number: data.bank_account_number,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "โหลดข้อมูลบัญชีธนาคารไม่สำเร็จ" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
