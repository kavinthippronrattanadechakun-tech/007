"use client";
import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
type Status = {
  configured: boolean;
  cycleDay: number;
  providerRemaining: number | null;
  providerError: boolean;
  usage: {
    used: number;
    limit: number;
    remaining: number;
    period_start: string;
    period_end: string;
    paused: boolean;
  };
};
export default function SlipOKQuota({ db }: { db: SupabaseClient }) {
  const [data, setData] = useState<Status | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function load() {
    setBusy(true);
    setError("");
    try {
      const { data: session } = await db.auth.getSession();
      if (!session.session) throw Error("กรุณาเข้าสู่ระบบใหม่");
      const r = await fetch("/api/admin/slipok", {
        headers: { Authorization: `Bearer ${session.session.access_token}` },
        cache: "no-store",
      });
      const body = await r.json();
      if (!r.ok) throw Error(body.error || "โหลดโควต้าไม่สำเร็จ");
      setData(body);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    load();
  }, [db]);
  return (
    <section className="slipok-quota">
      <h3>ตรวจสลิป SlipOK</h3>
      {error && <p role="status">{error}</p>}
      {data && (
        <>
          <p>
            คำขอตรวจในรอบนี้ <strong>{data.usage.used} / 99</strong> ครั้ง ·
            เหลือสิทธิ์ผ่านเว็บ {data.usage.remaining} ครั้ง
          </p>
          <p>
            รอบ {data.usage.period_start} ถึงก่อน {data.usage.period_end} ·
            เริ่มทุกวันที่ {data.cycleDay} ตามเวลาไทย
          </p>
          <p>
            โควต้าคงเหลือจาก SlipOK:{" "}
            {data.providerRemaining === null
              ? "ยังตรวจสอบไม่ได้"
              : data.providerRemaining + " ครั้ง"}
          </p>
          <p>
            {!data.configured
              ? "ยังไม่ได้เชื่อม SlipOK"
              : data.usage.used >= 99
                ? "ใช้การตรวจโดยแอดมินในรอบนี้"
                : data.usage.paused
                  ? "พักตรวจอัตโนมัติชั่วคราว รอสักครู่แล้วรีเฟรช"
                  : data.providerRemaining === 0
                    ? "โควต้า SlipOK หมด ใช้การตรวจโดยแอดมินจนโควต้ากลับมา"
                    : data.providerError
                      ? "ติดต่อ SlipOK ไม่สำเร็จ ใช้การตรวจโดยแอดมินชั่วคราว"
                      : "เปิดตรวจสลิปอัตโนมัติ เมื่อผลตรวจผ่านจะเพิ่มเงินให้ลูกค้า"}
          </p>
          <small>
            นับคำขอที่จองส่งตรวจ รวมกรณีที่ผลไม่ผ่านหรือการเชื่อมต่อไม่แน่นอน
            ไม่คืนจำนวนเพื่อป้องกันเกิน 99 ครั้ง
            เมื่อครบแล้วตรวจจากรายการโอนจริงและอนุมัติในหลังบ้านได้ตามเดิม
            โดยไม่เรียก SlipOK เพิ่ม
          </small>
        </>
      )}
      <div className="actions">
        <button
          type="button"
          disabled={busy}
          className="outline"
          onClick={load}
        >
          {busy ? "กำลังโหลด…" : "รีเฟรชโควต้า SlipOK"}
        </button>
      </div>
    </section>
  );
}
