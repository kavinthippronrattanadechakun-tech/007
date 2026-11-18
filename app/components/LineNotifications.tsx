"use client";
import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
type State = {
  configured: boolean;
  settings: { enabled: boolean; target_id: string | null };
  destinations: { id: string; kind: string; last_seen_at: string }[];
  jobs: {
    order_id: string;
    status: string;
    attempts: number;
    last_error: string | null;
  }[];
};
export default function LineNotifications({ db }: { db: SupabaseClient }) {
  const [state, setState] = useState<State | null>(null),
    [enabled, setEnabled] = useState(false),
    [target, setTarget] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function api(body?: object) {
    const { data } = await db.auth.getSession();
    if (!data.session) throw Error("กรุณาเข้าสู่ระบบใหม่");
    const r = await fetch("/api/admin/line", {
      method: body ? "POST" : "GET",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await r.json();
    if (!r.ok) throw Error(result.error || "เชื่อมต่อ LINE ไม่สำเร็จ");
    return result;
  }
  async function load() {
    const result: State = await api();
    setState(result);
    setEnabled(result.settings.enabled);
    setTarget(result.settings.target_id || "");
  }
  useEffect(() => {
    let live = true;
    api()
      .then((r: State) => {
        if (live) {
          setState(r);
          setEnabled(r.settings.enabled);
          setTarget(r.settings.target_id || "");
        }
      })
      .catch((e) => live && setMessage(e.message));
    return () => {
      live = false;
    };
  }, [db]);
  async function action(type: "save" | "test" | "retry") {
    if (busy) return;
    if (
      type === "retry" &&
      !confirm(
        "ส่งแจ้งเตือนรายการที่ยังส่งไม่สำเร็จอีกครั้ง? อาจมีข้อความซ้ำหาก LINE เคยรับข้อความเดิมแล้ว",
      )
    )
      return;
    setBusy(true);
    setMessage("");
    try {
      const r = await api(
        type === "save"
          ? { action: type, enabled, targetId: target || null }
          : { action: type },
      );
      setMessage(
        type === "save"
          ? "บันทึก LINE แล้ว"
          : type === "test"
            ? "ส่งข้อความทดสอบแล้ว กรุณาดูใน LINE"
            : `ส่งสำเร็จ ${r.sent} รายการ · ไม่สำเร็จ ${r.failed} รายการ`,
      );
      await load();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="line-notifications panel">
      <summary>🔔 ตั้งค่าแจ้งเตือนคำสั่งซื้อเข้า LINE</summary>
      <p>
        แจ้งเฉพาะคำสั่งซื้อใหม่ที่ร้านต้องจัดส่งเอง หลังสั่งซื้อสำเร็จ
        ข้อมูลรหัสผ่านที่ส่งมอบให้ลูกค้าจะอยู่ในเว็บ
      </p>
      {message && <p role="status">{message}</p>}
      {!state ? (
        <button
          className="outline"
          onClick={() => {
            void load().catch((e) => setMessage(e.message));
          }}
        >
          โหลดการตั้งค่า LINE
        </button>
      ) : (
        <>
          <p>
            {state.configured ? "ตั้งค่าคีย์แล้ว" : "ยังไม่ได้ตั้งค่าคีย์ LINE บน Vercel"}
          </p>
          <ol>
            <li>
              สร้าง LINE OA แล้วเปิด Messaging API เพิ่ม LINE_CHANNEL_ACCESS_TOKEN
              และ LINE_CHANNEL_SECRET ใน Vercel (Production) จากนั้น deploy ใหม่
              ห้ามใส่คีย์ในข้อความหน้าร้าน
            </li>
            <li>
              ตั้ง Webhook URL เป็น{" "}
              <code>
                {typeof window === "undefined"
                  ? "https://kingkeawlnwza.vercel.app"
                  : window.location.origin}
                /api/line/webhook
              </code>{" "}
              เปิด Use webhook
            </li>
            <li>
              เพิ่มเพื่อนบอตหรือเชิญเข้ากลุ่มร้าน (เปิด Allow bot to join group chats)
              แล้วส่งข้อความในแชตนั้น จากนั้นรีเฟรชและเลือกปลายทางด้านล่าง
            </li>
          </ol>
          <fieldset disabled={busy} className="admin-fieldset">
            <button
              type="button"
              className="outline"
              onClick={() => {
                void load().catch((e) => setMessage(e.message));
              }}
            >
              รีเฟรชปลายทาง LINE
            </button>
            <label>
              แชต LINE รับแจ้งเตือน
              <select
                aria-label="แชต LINE รับแจ้งเตือน"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">เลือกแชตหรือกลุ่ม</option>
                {state.destinations.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.kind === "group"
                      ? "กลุ่ม"
                      : d.kind === "room"
                        ? "ห้องแชต"
                        : "แชตส่วนตัว"}{" "}
                    · {d.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              เปิดแจ้งเตือน LINE
            </label>
            <div className="actions">
              <button onClick={() => action("save")}>บันทึก LINE</button>
              <button
                className="outline"
                disabled={!state.configured || !state.settings.enabled}
                onClick={() => action("test")}
              >
                ส่งทดสอบเข้า LINE
              </button>
              <button
                className="outline"
                disabled={!state.configured || !state.settings.enabled}
                onClick={() => action("retry")}
              >
                ส่งแจ้งเตือนที่ค้าง
              </button>
            </div>
          </fieldset>
          {!!state.jobs.length && (
            <>
              <h4>การแจ้งเตือนล่าสุด</h4>
              <ul>
                {state.jobs.map((j) => (
                  <li key={j.order_id}>
                    {j.order_id.slice(0, 8)} ·{" "}
                    {(
                      {
                        pending: "รอส่ง / รอส่งใหม่",
                        sending: "กำลังส่ง",
                        sent: "ส่งเข้า LINE แล้ว",
                        failed: "ส่งไม่สำเร็จ กรุณาตรวจคีย์/โควต้า แล้วกดส่งที่ค้าง",
                        skipped: "จัดส่งสินค้าแล้ว ไม่ต้องแจ้ง",
                      } as Record<string, string>
                    )[j.status] || j.status}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </details>
  );
}
