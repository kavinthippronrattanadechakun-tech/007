import { admin, fail } from "../../../lib/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseUrl } from "../../../lib/supabase-config";
import { createHash } from "crypto";
import {
  bankCodeForName,
  isSlipImage,
  verifySlip,
  verifyNearbySlip,
  SlipCheckError,
} from "../../../lib/slip-verification";
export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
const selectedProvider = () =>
  process.env.SLIPVERIFY_API_TOKEN
    ? "slipverify"
    : process.env.EASYSLIP_API_KEY
      ? "easyslip"
      : null;
const autoEnabled = () =>
  !!selectedProvider() && process.env.SLIP_AUTO_VERIFY_ENABLED !== "false";
export async function GET() {
  return Response.json(
    {
      mode: autoEnabled() ? "automatic" : "manual",
      provider: autoEnabled()
        ? selectedProvider() === "slipverify"
          ? "SlipVerify"
          : "EasySlip"
        : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(req: Request) {
  try {
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return fail("กรุณาเข้าสู่ระบบ", 401);
    const publicClient = createClient(
      supabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL!),
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(),
      { auth: { persistSession: false } },
    );
    const { data: auth, error: authError } =
      await publicClient.auth.getUser(token);
    if (authError || !auth.user) return fail("กรุณาเข้าสู่ระบบ", 401);
    if (Number(req.headers.get("content-length") || 0) > 4500000)
      return fail("รูปสลิปต้องไม่เกิน 4 MB", 413);
    const form = await req.formData(),
      amount = Number(form.get("amount")),
      file = form.get("slip");
    if (!Number.isInteger(amount) || amount < 1 || amount > 100000)
      return fail("ยอดเติมเงินไม่ถูกต้อง");
    if (!(file instanceof File) || file.size > 4194304 || file.size === 0)
      return fail("กรุณาแนบรูป JPG, PNG หรือ WEBP ไม่เกิน 4 MB");
    const bytes = Buffer.from(await file.arrayBuffer());
    if (!isSlipImage(bytes, file.type))
      return fail("ไฟล์นี้ไม่ใช่รูป JPG, PNG หรือ WEBP ที่รองรับ");
    const db = admin(),
      automatic = autoEnabled();
    const { data: bank, error: bankError } = await db
      .from("store_settings")
      .select("bank_name,bank_account_name,bank_account_number")
      .eq("id", true)
      .single();
    if (
      bankError ||
      !bank?.bank_name ||
      !bank.bank_account_name ||
      !bank.bank_account_number
    )
      return fail("ร้านค้ายังไม่ได้ตั้งค่าบัญชีรับเงินครบถ้วน", 503);
    const bankCode =
      process.env.EASYSLIP_RECEIVER_BANK_CODE ||
      bankCodeForName(bank.bank_name);
    if (automatic && !bankCode)
      return fail(
        "ร้านค้าต้องตั้งค่าธนาคารให้ถูกต้องก่อนตรวจสลิปอัตโนมัติ",
        503,
      );
    const hash = createHash("sha256").update(bytes).digest("hex"),
      id = crypto.randomUUID(),
      path = `${auth.user.id}/${id}.${file.type.split("/")[1]}`;
    const { error: reserveError } = await db.rpc("reserve_topup", {
      p_id: id,
      p_user_id: auth.user.id,
      p_amount: amount,
      p_path: path,
      p_hash: hash,
    });
    if (reserveError)
      return fail(
        reserveError.code === "23505"
          ? "สลิปภาพนี้เคยถูกส่งแล้ว"
          : reserveError.message.includes("Too many")
            ? "ส่งสลิปถี่เกินไป กรุณารอ 1 นาที"
            : "บันทึกรายการเติมเงินไม่สำเร็จ",
        reserveError.message.includes("Too many") ? 429 : 400,
      );
    const upload = await db.storage
      .from("slips")
      .upload(path, bytes, { contentType: file.type, upsert: false });
    if (upload.error) {
      await db.from("topups").delete().eq("id", id).eq("status", "pending");
      return fail("อัปโหลดสลิปไม่สำเร็จ", 503);
    }
    if (!automatic)
      return Response.json({
        ok: true,
        status: "pending",
        message: "ส่งสลิปแล้ว รอผู้ดูแลตรวจสอบธุรกรรมจริง",
      });
    try {
      const provider = selectedProvider()!;
      const audit = await db
        .from("topups")
        .update({ verification_provider: provider })
        .eq("id", id)
        .eq("status", "pending");
      if (audit.error)
        throw new SlipCheckError(
          "บันทึกการตรวจสลิปไม่สำเร็จ รายการยังไม่เพิ่มยอด",
          true,
        );
      const result = await (
        provider === "slipverify" ? verifyNearbySlip : verifySlip
      )(
        file,
        {
          amount,
          bankName: bank.bank_name,
          accountName: bank.bank_account_name,
          accountNumber: bank.bank_account_number,
          bankCode: bankCode!,
          earliestDate: Date.parse(auth.user.created_at) - 300000,
        },
        (provider === "slipverify"
          ? process.env.SLIPVERIFY_API_TOKEN
          : process.env.EASYSLIP_API_KEY)!,
      );
      const { error } = await db.rpc("credit_verified_topup", {
        p_id: id,
        p_reference: result.reference,
        p_amount: result.amount,
        p_transfer_at: result.transferAt,
        p_account_number: bank.bank_account_number.replace(/[ -]/g, ""),
        p_bank_name: bank.bank_name,
        p_account_name: bank.bank_account_name,
      });
      if (error) {
        if (error.code === "23505") {
          await db
            .from("topups")
            .update({ status: "rejected" })
            .eq("id", id)
            .eq("status", "pending");
          return fail("ธุรกรรมนี้เคยใช้เติมเงินแล้ว ไม่สามารถใช้ซ้ำได้");
        }
        return Response.json({
          ok: true,
          status: "pending",
          message:
            "ตรวจสลิปแล้วแต่เพิ่มยอดยังไม่สำเร็จ รายการถูกเก็บไว้ กรุณาติดต่อร้านค้า",
        });
      }
      return Response.json({
        ok: true,
        status: "approved",
        message: `ตรวจสอบธุรกรรมสำเร็จ เพิ่มยอด ฿${amount} แล้ว`,
      });
    } catch (e) {
      const error =
        e instanceof SlipCheckError
          ? e
          : new SlipCheckError(
              "ยังยืนยันรายการไม่ได้ กรุณาติดต่อร้านค้า",
              true,
            );
      if (!error.retryable)
        await db
          .from("topups")
          .update({ status: "rejected" })
          .eq("id", id)
          .eq("status", "pending");
      return Response.json({
        ok: true,
        status: error.retryable ? "pending" : "rejected",
        message: error.message,
      });
    }
  } catch {
    return fail("ระบบเติมเงินไม่พร้อม กรุณาติดต่อร้านค้า", 503);
  }
}
