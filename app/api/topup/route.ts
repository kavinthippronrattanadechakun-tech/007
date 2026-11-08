import { admin, fail } from "../../../lib/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseUrl } from "../../../lib/supabase-config";
import { createHash } from "crypto";
import {
  slipOKConfig,
  bankCode,
  validSlipImage,
  getSlipOKQuota,
  verifySlipOK,
  SlipOKError,
} from "../../../lib/slipok";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
let quotaCache: { until: number; quota: number } | null = null;
export async function GET() {
  const config = slipOKConfig();
  if (!config)
    return Response.json({ mode: "manual", reason: "not_configured" });
  try {
    const { data, error } = await admin().rpc("slipok_usage_status", {
      p_day: config.day,
    });
    if (error) throw error;
    if (data.used >= 99 || data.paused)
      return Response.json({ mode: "manual", reason: "quota" });
    if (!quotaCache || quotaCache.until < Date.now())
      quotaCache = {
        until: Date.now() + 30000,
        quota: await getSlipOKQuota(config),
      };
    return Response.json(
      {
        mode: quotaCache.quota > 0 ? "automatic" : "manual",
        reason: quotaCache.quota > 0 ? null : "quota",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { mode: "manual", reason: "unavailable" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
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
    if (!(file instanceof File) || !file.size || file.size > 4194304)
      return fail("กรุณาแนบรูป JPG, PNG หรือ WEBP ไม่เกิน 4 MB");
    const bytes = Buffer.from(await file.arrayBuffer());
    if (!validSlipImage(bytes, file.type)) return fail("รูปสลิปไม่ถูกต้อง");
    const db = admin(),
      config = slipOKConfig();
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
    const id = crypto.randomUUID(),
      hash = createHash("sha256").update(bytes).digest("hex"),
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
          ? "สลิปภาพนี้เคยส่งแล้ว"
          : reserveError.message.includes("Too many")
            ? "ส่งสลิปถี่เกินไป กรุณารอ 1 นาที"
            : "บันทึกรายการไม่สำเร็จ",
        reserveError.message.includes("Too many") ? 429 : 400,
      );
    const upload = await db.storage
      .from("slips")
      .upload(path, bytes, { contentType: file.type, upsert: false });
    if (upload.error) {
      await db.from("topups").delete().eq("id", id).eq("status", "pending");
      return fail("อัปโหลดสลิปไม่สำเร็จ", 503);
    }
    const pending = (message: string) =>
      Response.json({ ok: true, status: "pending", message });
    if (!config) return pending("ส่งสลิปแล้ว รอผู้ดูแลตรวจสอบ");
    const receiverCode = bankCode(bank.bank_name);
    if (!receiverCode)
      return pending(
        "ร้านค้าต้องตรวจสอบการตั้งค่าธนาคาร ส่งรายการให้แอดมินตรวจสอบ",
      );
    const { data: lock, error: lockError } = await db.rpc("lock_slipok_check", {
      p_id: id,
      p_day: config.day,
    });
    if (lockError || !lock?.allowed)
      return pending(
        lock?.reason === "quota"
          ? "ครบโควต้าตรวจอัตโนมัติรอบนี้แล้ว ส่งสลิปเข้าคิวให้แอดมินตรวจสอบ"
          : "ระบบตรวจอัตโนมัติยังไม่พร้อม ส่งรายการให้แอดมินตรวจสอบ",
      );
    let pause = false,
      hold = false;
    try {
      const available = await getSlipOKQuota(config);
      if (available < 1) {
        pause = true;
        quotaCache = { until: Date.now() + 30000, quota: 0 };
        return pending("โควต้า SlipOK หมดแล้ว ส่งรายการให้แอดมินตรวจสอบ");
      }
      const audit = await db
        .from("topups")
        .update({ verification_provider: "slipok" })
        .eq("id", id)
        .eq("status", "pending")
        .select("id")
        .single();
      if (audit.error)
        return pending(
          "ระบบยังยืนยันการบันทึกไม่ได้ ส่งรายการให้แอดมินตรวจสอบ",
        );
      const { data: budget, error: budgetError } = await db.rpc(
        "consume_slipok_check",
        { p_id: id, p_day: config.day },
      );
      if (budgetError || !budget?.allowed)
        return pending(
          "ครบโควต้าหรือรอบตรวจเปลี่ยนแล้ว ส่งรายการให้แอดมินตรวจสอบ",
        );
      const verified = await verifySlipOK(
        file,
        {
          amount,
          bankCode: receiverCode,
          accountNumber: bank.bank_account_number,
          earliestDate: Date.parse(auth.user.created_at) - 300000,
        },
        config,
      );
      const { error } = await db.rpc("credit_verified_topup", {
        p_id: id,
        p_reference: verified.reference,
        p_amount: verified.amount,
        p_transfer_at: verified.transferAt,
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
        return pending(
          "ตรวจสลิปแล้วแต่ยังยืนยันการเพิ่มยอดไม่ได้ ส่งรายการให้แอดมินตรวจสอบ",
        );
      }
      return Response.json({
        ok: true,
        status: "approved",
        message: `ตรวจสลิปสำเร็จ เพิ่มยอด ฿${amount} แล้ว`,
      });
    } catch (e) {
      const error =
        e instanceof SlipOKError
          ? e
          : new SlipOKError(
              "บริการตรวจสลิปไม่พร้อม ส่งรายการให้แอดมินตรวจสอบ",
              { retryable: true },
            );
      pause = error.quota;
      hold = error.uncertain;
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
    } finally {
      await db.rpc("finish_slipok_check", {
        p_id: id,
        p_pause: pause,
        p_hold: hold,
      });
    }
  } catch {
    return fail("ระบบเติมเงินไม่พร้อม กรุณาติดต่อร้านค้า", 503);
  }
}
