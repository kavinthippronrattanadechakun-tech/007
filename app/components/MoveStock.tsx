"use client";
import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Product } from "../../lib/store";
export default function MoveStock({
  db,
  stockId,
  kind,
  fromProductId,
  remaining,
  products,
  onChanged,
}: {
  db: SupabaseClient;
  stockId: string;
  kind: "account" | "code";
  fromProductId: string;
  remaining: number;
  products: Product[];
  onChanged: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [target, setTarget] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function move() {
    if (!target || busy) return;
    if (
      !confirm(
        `ยืนยันย้ายสต็อกที่เหลือ ${remaining} สิทธิ์ ไป ${products.find((p) => p.id === target)?.title}?`,
      )
    )
      return;
    setBusy(true);
    setMessage("");
    try {
      const { data } = await db.auth.getSession();
      if (!data.session) throw Error("กรุณาเข้าสู่ระบบใหม่");
      const r = await fetch("/api/admin/stock/move", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + data.session.access_token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            stockId,
            kind,
            fromProductId,
            targetProductId: target,
            expectedRemaining: remaining,
          }),
        }),
        result = await r.json();
      if (!r.ok) throw Error(result.error || "ย้ายไม่สำเร็จ");
      setOpen(false);
      setMessage(`ย้าย ${result.data.quantity} สิทธิ์แล้ว`);
      await onChanged();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="move-stock">
      {!open ? (
        <button type="button" className="outline" onClick={() => setOpen(true)}>
          ย้ายสต็อกไปสินค้าอื่น
        </button>
      ) : (
        <fieldset className="stock-entry" disabled={busy}>
          <legend>ย้ายสต็อก</legend>
          <p>ย้ายจำนวนที่พร้อมขาย {remaining} สิทธิ์ ประวัติที่ขายแล้วคงเดิม</p>
          <label>
            สินค้า / แพ็กเกจปลายทาง
            <select aria-label="สินค้า / แพ็กเกจปลายทาง" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">เลือกสินค้าปลายทาง</option>
              {products
                .filter(
                  (p) => p.id !== fromProductId && p.delivery_type === "code",
                )
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                    {!p.active ? " (ยังไม่เปิดขาย)" : ""}
                  </option>
                ))}
            </select>
          </label>
          <div className="actions">
            <button type="button" onClick={move} disabled={!target}>
              ยืนยันย้ายสต็อก
            </button>
            <button
              type="button"
              className="outline"
              onClick={() => setOpen(false)}
            >
              ยกเลิกย้าย
            </button>
          </div>
        </fieldset>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
