import { admin, fail } from "../../../lib/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseUrl } from "../../../lib/supabase-config";
import { createHash } from "crypto";
import {
  slipOKConfig,
  slipOKSetup,
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
    return Response.json(
      { mode: "manual", reason: "not_configured", setup: slipOKSetup() },
      { headers: { "Cache-Control": "no-store" } },
    );
  try {
    const { data, error } = await admin().rpc("slipok_usage_status", {
      p_day: config.day,
    });
    if (error) throw error;
    if (data.used >= 99)
      return Response.json({ mode: "manual", reason: "quota" });
    if (data.paused)
      return Response.json(
        { mode: "manual", reason: "unavailable" },
        { headers: { "Cache-Control": "no-store" } },
      );
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
  } catch (e) {
    return Response.json(
      {
        mode: "manual",
        reason: "unavailable",
        provider_code: e instanceof SlipOKError ? e.providerCode || null : null,
      },
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
    if (reserveError) {
      if (reserveError.message.includes("Slip is processing"))
        return Response.json({
          ok: true,
          status: "pending",
          message: "รายการเดิมกำลังตรวจสอบ กรุณารอสักครู่แล้วลองใหม่",
        });
      return fail(
        reserveError.message.includes("Slip already credited")
          ? "สลิปนี้เพิ่มเงินสำเร็จแล้ว ไม่สามารถใช้ซ้ำได้"
          : reserveError.message.includes("Slip belongs")
            ? "สลิปนี้มีรายการในบัญชีอื่น กรุณาติดต่อร้านค้า"
            : reserveError.message.includes("Too many")
              ? "ส่งสลิปถี่เกินไป กรุณารอ 1 นาที"
              : reserveError.code === "23505"
                ? "รายการนี้กำลังดำเนินการ กรุณาตรวจประวัติหรือติดต่อร้านค้า"
                : "บันทึกรายการไม่สำเร็จ",
        reserveError.message.includes("Too many") ? 429 : 400,
      );
    }
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
    type Receipt = {
      reference: string;
      amount: number;
      transferAt: string;
      bankCode: string;
      accountNumber: string;
    };
    const storedReceipt = (r: any): Receipt => ({
      reference: r.reference,
      amount: r.amount,
      transferAt: r.transfer_at,
      bankCode: r.bank_code,
      accountNumber: r.account_number,
    });
    async function applyReceipt(receipt: Receipt) {
      if (
        receipt.bankCode !== receiverCode ||
        receipt.accountNumber !==
          bank.bank_account_number.replace(/[ -]/g, "") ||
        !Number.isSafeInteger(receipt.amount) ||
        receipt.amount < 1 ||
        receipt.amount > 100000
      )
        return pending("ข้อมูลบัญชีหรือยอดจากผลตรวจไม่ครบ ส่งให้แอดมินตรวจสอบ");
      if (receipt.amount !== amount) {
        await db
          .from("topups")
          .update({ status: "rejected", rejection_code: "amount_mismatch" })
          .eq("id", id)
          .eq("status", "pending");
        return Response.json({
          ok: true,
          status: "rejected",
          correctAmount: receipt.amount,
          message: `ยอดโอนจริง ฿${receipt.amount} แต่กรอก ฿${amount} กรุณาตรวจสอบยอดแล้วส่งสลิปเดิมอีกครั้งได้`,
        });
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
          "รายการอาจถูกตรวจสอบแล้ว กรุณารีเฟรชประวัติหรือติดต่อร้านค้า",
        );
      const { error } = await db.rpc("credit_verified_topup", {
        p_id: id,
        p_reference: receipt.reference,
        p_amount: receipt.amount,
        p_transfer_at: receipt.transferAt,
        p_account_number: receipt.accountNumber,
        p_bank_name: bank.bank_name,
        p_account_name: bank.bank_account_name,
      });
      if (error) {
        if (error.code === "23505") {
          await db
            .from("topups")
            .update({ status: "rejected", rejection_code: "already_credited" })
            .eq("id", id)
            .eq("status", "pending");
          return fail("ธุรกรรมนี้เพิ่มเงินสำเร็จแล้ว ไม่สามารถใช้ซ้ำได้");
        }
        return pending("ยังยืนยันการเพิ่มยอดไม่ได้ ส่งให้แอดมินตรวจสอบ");
      }
      return Response.json({
        ok: true,
        status: "approved",
        message: `ตรวจสลิปสำเร็จ เพิ่มยอด ฿${amount} แล้ว`,
      });
    }
    const { data: cached, error: cacheReadError } = await db
      .from("verified_slip_receipts")
      .select("*")
      .eq("slip_hash", hash)
      .eq("user_id", auth.user.id)
      .maybeSingle();
    if (cacheReadError)
      return pending("อ่านประวัติผลตรวจไม่ได้ ส่งให้แอดมินตรวจสอบ");
    if (cached) return applyReceipt(storedReceipt(cached));
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
      if (
        !Number.isSafeInteger(verified.amount) ||
        verified.amount < 1 ||
        verified.amount > 100000
      )
        return pending("ยอดโอนนี้ต้องให้แอดมินตรวจสอบ");
      const receipt: Receipt = {
        ...verified,
        bankCode: receiverCode,
        accountNumber: bank.bank_account_number.replace(/[ -]/g, ""),
      };
      const { error: cacheWriteError } = await db
        .from("verified_slip_receipts")
        .insert({
          slip_hash: hash,
          user_id: auth.user.id,
          reference: receipt.reference,
          amount: receipt.amount,
          transfer_at: receipt.transferAt,
          bank_code: receipt.bankCode,
          account_number: receipt.accountNumber,
        });
      if (cacheWriteError) {
        if (cacheWriteError.code === "23505") {
          const { data: prior } = await db
            .from("verified_slip_receipts")
            .select("*")
            .eq("reference", receipt.reference)
            .eq("user_id", auth.user.id)
            .maybeSingle();
          if (prior) return applyReceipt(storedReceipt(prior));
        }
        return pending("บันทึกผลตรวจยังไม่สำเร็จ ส่งให้แอดมินตรวจสอบ");
      }
      return applyReceipt(receipt);
    } catch (e) {
      const error =
        e instanceof SlipOKError
          ? e
          : new SlipOKError(
              "บริการตรวจสลิปไม่พร้อม ส่งรายการให้แอดมินตรวจสอบ",
              { retryable: true },
            );
      if (error.providerCode === 1012) {
        if (error.reference) {
          const { data: credited, error: creditedError } = await db
            .from("topups")
            .select("id")
            .eq("bank_reference", error.reference)
            .eq("status", "approved")
            .limit(1)
            .maybeSingle();
          if (!creditedError && credited) {
            await db
              .from("topups")
              .update({
                status: "rejected",
                rejection_code: "already_credited",
              })
              .eq("id", id)
              .eq("status", "pending");
            return fail("ธุรกรรมนี้เพิ่มเงินสำเร็จแล้ว ไม่สามารถใช้ซ้ำได้");
          }
          if (!creditedError) {
            const { data: proof } = await db
              .from("verified_slip_receipts")
              .select("*")
              .eq("reference", error.reference)
              .eq("user_id", auth.user.id)
              .maybeSingle();
            if (proof) return applyReceipt(storedReceipt(proof));
          }
        }
        return pending(
          "SlipOK เคยตรวจสลิปนี้แล้ว แต่ต้องตรวจประวัติการเพิ่มเงินในร้านก่อน ส่งรายการให้แอดมินตรวจสอบ",
        );
      }
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
