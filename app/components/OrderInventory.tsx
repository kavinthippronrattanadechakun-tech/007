"use client";
import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
type Source = {
  kind: "account" | "code" | "manual";
  email?: string;
  screen?: string;
  has_screen?: boolean;
  remaining?: number;
  active_others: number;
  action: string | null;
  can_restock: boolean;
  requires_early_confirmation?: boolean;
  secret?: string;
};
export default function OrderInventory({
  db,
  orderId,
  onChanged,
}: {
  db: SupabaseClient;
  orderId: string;
  onChanged: () => Promise<void>;
}) {
  const [source, setSource] = useState<Source | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [action, setAction] = useState(""),
    [editPassword, setEditPassword] = useState(false),
    [password, setPassword] = useState(""),
    [secret, setSecret] = useState("");
  async function api(method: string, body?: object) {
    const { data } = await db.auth.getSession();
    if (!data.session) throw Error("กรุณาเข้าสู่ระบบใหม่");
    const r = await fetch(
      "/api/admin/orders/inventory" +
        (method === "GET" ? "?orderId=" + orderId : ""),
      {
        method,
        headers: {
          Authorization: "Bearer " + data.session.access_token,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    );
    const result = await r.json();
    if (!r.ok) throw Error(result.error || "ทำรายการไม่สำเร็จ");
    return result.data;
  }
  async function open() {
    setBusy(true);
    setMessage("");
    try {
      const data = await api("GET");
      setSource(data);
      setSecret(data.secret || "");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!action) return;
    if (
      !confirm(
        action === "restock"
          ? source?.requires_early_confirmation
            ? "รายการนี้ยังไม่หมดอายุหรือไม่ได้กำหนดวันหมดอายุ ยืนยันจบการใช้งานเดิมและคืน 1 สิทธิ์เข้าสต็อกก่อนกำหนด?"
            : "ยืนยันคืนสินค้า 1 สิทธิ์เข้าสต็อกสำหรับขายครั้งถัดไป?"
          : "ยืนยันเอาสินค้าจากคำสั่งซื้อนี้ออก โดยไม่นำสิทธิ์นี้กลับเข้าสต็อก?",
      )
    )
      return;
    setBusy(true);
    setMessage("");
    try {
      const data = await api("POST", {
        orderId,
        action,
        allowEarly:
          action === "restock" && !!source?.requires_early_confirmation,
        password: action === "restock" && editPassword ? password : "",
        secret: action === "restock" && source?.kind === "code" ? secret : "",
      });
      setMessage(
        data.already_processed
          ? "รายการนี้จัดการแล้ว ไม่เพิ่มสต็อกซ้ำ"
          : action === "restock"
            ? "คืนสต็อก 1 สิทธิ์แล้ว"
            : "นำสินค้ารายการนี้ออกแล้ว",
      );
      setSource((s) => (s ? { ...s, action } : s));
      setPassword("");
      await onChanged();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="inventory-control">
      {!source && (
        <button className="outline" disabled={busy} onClick={open}>
          รีสต็อก / นำสินค้าออก
        </button>
      )}
      {message && <p role="status">{message}</p>}
      {source &&
        (source.action ? (
          <p>
            {source.action === "restock" ? "คืนสต็อกแล้ว" : "นำออกแล้ว"} ·
            เก็บประวัติคำสั่งซื้อเดิม
          </p>
        ) : (
          <form onSubmit={save}>
            <h4>จัดการสินค้าที่ส่งแล้ว</h4>
            {source.email && (
              <p>
                Mail: {source.email}
                {source.has_screen && ` · Screen: ${source.screen}`}
              </p>
            )}
            <p>
              เก็บประวัติและข้อมูลที่ส่งให้ลูกค้าเดิมไว้
              การจัดการนี้ไม่เปลี่ยนยอดเงินของลูกค้า
            </p>
            <fieldset disabled={busy} className="admin-fieldset">
              <label>
                การจัดการสต็อก
                <select
                  required
                  aria-label="การจัดการสต็อก"
                  value={action}
                  onChange={(e) => setAction(e.target.value)}
                >
                  <option value="">เลือกการจัดการ</option>
                  <option value="restock" disabled={!source.can_restock}>
                    คืนสินค้า 1 สิทธิ์เข้าสต็อก
                  </option>
                  <option value="remove">
                    เอาสินค้ารายการนี้ออก / ไม่คืนสต็อก
                  </option>
                </select>
              </label>
              {!source.can_restock && (
                <p>รายการนี้ไม่มีสต็อกต้นทางให้คืน กรุณาตรวจสอบข้อมูล</p>
              )}
              {action === "restock" && source.requires_early_confirmation && (
                <p className="early-restock-notice">
                  คืนก่อนหมดอายุ: ยืนยันว่าพร้อมนำสิทธิ์นี้กลับขายแล้ว
                  ประวัติวันหมดอายุเดิมจะยังคงอยู่
                </p>
              )}
              {action === "restock" && source.kind === "account" && (
                <>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={editPassword}
                      disabled={source.active_others > 0}
                      onChange={(e) => setEditPassword(e.target.checked)}
                    />
                    แก้ไขรหัสผ่านก่อนคืนสต็อก
                  </label>
                  {source.active_others > 0 && (
                    <p>
                      มีลูกค้าอื่นใช้อีเมลนี้อยู่ {source.active_others} ราย
                      จึงยังแก้รหัสผ่านไม่ได้
                    </p>
                  )}
                  {editPassword && (
                    <>
                      <label>
                        รหัสผ่านสำหรับผู้ซื้อครั้งถัดไป
                        <input
                          required
                          maxLength={1000}
                          autoComplete="off"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                        />
                      </label>
                      <p>
                        บันทึกรหัสสำหรับส่งให้ผู้ซื้อครั้งถัดไป
                        โปรดเปลี่ยนรหัสที่แอปต้นทางให้ตรงกันด้วย
                      </p>
                    </>
                  )}
                </>
              )}
              {action === "restock" && source.kind === "code" && (
                <label>
                  ข้อมูลสต็อก / รหัสผ่านสำหรับขายครั้งถัดไป
                  <textarea
                    required
                    maxLength={16384}
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                  />
                </label>
              )}
              <div className="actions">
                <button disabled={!action}>ยืนยันจัดการสต็อก</button>
                <button
                  type="button"
                  className="outline"
                  onClick={() => setSource(null)}
                >
                  ปิด
                </button>
              </div>
            </fieldset>
          </form>
        ))}
    </div>
  );
}
