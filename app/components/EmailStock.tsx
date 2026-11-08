"use client";
import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseEmailStock } from "../../lib/email-stock";
type Batch = {
  id: string;
  email: string;
  delivery_info: string;
  remaining: number;
  sold: number;
};
export default function EmailStock({
  db,
  productId,
}: {
  db: SupabaseClient;
  productId: string;
}) {
  const [rows, setRows] = useState<Batch[]>([]),
    [text, setText] = useState(""),
    [edit, setEdit] = useState<Batch | null>(null),
    [original, setOriginal] = useState<Batch | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [page, setPage] = useState(0),
    [count, setCount] = useState(0),
    [totals, setTotals] = useState({ available: 0, sold: 0 }),
    [loading, setLoading] = useState(true);
  async function fetchRows() {
    const [r, t] = await Promise.all([
      db
        .from("email_stock_batches")
        .select("id,email,delivery_info,remaining,sold", { count: "exact" })
        .eq("product_id", productId)
        .order("created_at")
        .order("id")
        .range(page * 50, page * 50 + 49),
      db.rpc("email_stock_totals", { p_product_id: productId }),
    ]);
    if (r.error) throw r.error;
    if (t.error) throw t.error;
    return {
      rows: r.data || [],
      count: r.count || 0,
      totals: t.data?.[0] || { available: 0, sold: 0 },
    };
  }
  function apply(r: Awaited<ReturnType<typeof fetchRows>>) {
    setRows(r.rows);
    setCount(r.count);
    setTotals(r.totals);
  }
  useEffect(() => {
    let live = true;
    setLoading(true);
    setEdit(null);
    fetchRows()
      .then((r) => {
        if (live) apply(r);
      })
      .catch((e) => live && setMessage("โหลดสต็อกอีเมลไม่สำเร็จ: " + e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [db, productId, page]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      apply(await fetchRows());
      setMessage("บันทึกสต็อกอีเมลเรียบร้อยแล้ว");
    } catch (e) {
      const error = e as { code?: string; message: string };
      setMessage(
        error.code === "23505"
          ? "อีเมลนี้มีในสินค้านี้แล้ว ให้แก้จำนวนคงเหลือของรายการเดิม"
          : error.message || "บันทึกไม่สำเร็จ",
      );
    } finally {
      setBusy(false);
    }
  }
  async function add(e: React.FormEvent) {
    e.preventDefault();
    await run(async () => {
      const data = parseEmailStock(text);
      const r = await db
        .from("email_stock_batches")
        .insert(data.map((v) => ({ ...v, product_id: productId })));
      if (r.error) throw r.error;
      setText("");
    });
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!edit || !original) return;
    await run(async () => {
      if (
        !Number.isSafeInteger(edit.remaining) ||
        edit.remaining < 0 ||
        edit.remaining > 100000
      )
        throw Error("จำนวนคงเหลือต้องเป็นจำนวนเต็ม 0–100000");
      const email = edit.email.trim().toLowerCase(),
        delivery_info = edit.delivery_info.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !delivery_info)
        throw Error("กรุณาระบุอีเมลและข้อมูลส่งมอบให้ถูกต้อง");
      const r = await db
        .from("email_stock_batches")
        .update({ email, delivery_info, remaining: edit.remaining })
        .eq("id", edit.id)
        .eq("remaining", original.remaining)
        .eq("sold", original.sold)
        .select("id")
        .single();
      if (r.error)
        throw Error(
          r.error.code === "23505"
            ? "อีเมลซ้ำกับรายการเดิม"
            : "บันทึกไม่สำเร็จ จำนวนอาจเปลี่ยนจากการซื้อ กรุณารีเฟรชรายการแล้วลองใหม่",
        );
      setEdit(null);
      setOriginal(null);
    });
  }
  async function remove(row: Batch) {
    if (!confirm("ลบอีเมลที่ยังไม่เคยขายรายการนี้?")) return;
    await run(async () => {
      const r = await db
        .from("email_stock_batches")
        .delete()
        .eq("id", row.id)
        .eq("sold", 0)
        .select("id")
        .single();
      if (r.error) throw Error("ลบไม่สำเร็จ รายการอาจถูกขายแล้ว");
    });
  }
  return (
    <section className="email-stock">
      <h3>สต็อกอีเมลพร้อมข้อมูลส่งมอบ</h3>
      <p>
        อีเมลคงเหลือ <strong>{totals.available}</strong> สิทธิ์ · ขายแล้ว{" "}
        <strong>{totals.sold}</strong> สิทธิ์
      </p>
      <p>
        จำนวนของแต่ละอีเมลคือสิทธิ์ที่ขายได้
        อีเมลเดียวกันจะถูกส่งพร้อมข้อมูลส่งมอบให้ลูกค้าได้ตามจำนวนที่ตั้งไว้
        โดยตัดครั้งละ 1 สิทธิ์
      </p>
      {message && (
        <div className="notice" role="status">
          {message}
        </div>
      )}
      <fieldset className="admin-fieldset" disabled={busy || loading}>
        <form onSubmit={add}>
          <label>
            เติมหลายอีเมล (อีเมล | จำนวน | ข้อมูลส่งมอบ)
            <textarea
              aria-label="เติมหลายอีเมล"
              required
              rows={6}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                "member1@example.com | 4 | ข้อมูลส่งมอบสำหรับอีเมลแรก\nmember2@example.com | 3 | ข้อมูลส่งมอบสำหรับอีเมลที่สอง"
              }
            />
          </label>
          <p>
            1 อีเมลต่อบรรทัด สูงสุด 200 อีเมลต่อครั้ง ใช้ \n
            หากต้องการขึ้นบรรทัดใหม่ในข้อมูลส่งมอบ
          </p>
          <button>บันทึกหลายอีเมล</button>
        </form>
        {edit && (
          <form onSubmit={save}>
            <h4>แก้ไขสต็อกอีเมล</h4>
            <label>
              อีเมลในสต็อก
              <input
                type="email"
                required
                maxLength={320}
                value={edit.email}
                onChange={(e) => setEdit({ ...edit, email: e.target.value })}
              />
            </label>
            <label>
              จำนวนสิทธิ์คงเหลือ
              <input
                type="number"
                required
                min={0}
                max={100000}
                step={1}
                value={edit.remaining}
                onChange={(e) =>
                  setEdit({ ...edit, remaining: Number(e.target.value) })
                }
              />
            </label>
            <label>
              ข้อมูลส่งมอบ
              <textarea
                aria-label="ข้อมูลส่งมอบ"
                required
                maxLength={16384}
                value={edit.delivery_info}
                onChange={(e) =>
                  setEdit({ ...edit, delivery_info: e.target.value })
                }
              />
            </label>
            <p>
              การเปลี่ยนข้อมูลมีผลกับการซื้อครั้งต่อไป
              ประวัติที่ส่งให้ลูกค้าแล้วจะคงเดิม ตั้งคงเหลือเป็น 0
              เพื่อหยุดขายอีเมลนี้
            </p>
            <div className="actions">
              <button>บันทึกอีเมลและจำนวน</button>
              <button
                type="button"
                className="outline"
                onClick={() => setEdit(null)}
              >
                ยกเลิกแก้ไขอีเมล
              </button>
            </div>
          </form>
        )}
        <div className="actions">
          <button className="outline" onClick={() => run(async () => {})}>
            รีเฟรชสต็อกอีเมล
          </button>
        </div>
        {rows.map((row) => (
          <div className="order" key={row.id}>
            <strong>{row.email}</strong>
            <span>
              เหลือ {row.remaining} สิทธิ์ · ขายแล้ว {row.sold} สิทธิ์
            </span>
            <details>
              <summary>ดูข้อมูลส่งมอบ</summary>
              <div className="secret">{row.delivery_info}</div>
            </details>
            <div className="actions">
              <button
                className="outline"
                onClick={() => {
                  setEdit({ ...row });
                  setOriginal({ ...row });
                }}
              >
                แก้ไขอีเมลและจำนวน
              </button>
              {row.sold === 0 && (
                <button className="outline" onClick={() => remove(row)}>
                  ลบอีเมล
                </button>
              )}
            </div>
          </div>
        ))}
        {!loading && !rows.length && <p>ยังไม่มีสต็อกอีเมลในหน้านี้</p>}
        <div className="actions">
          <button
            className="outline"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            อีเมลหน้าก่อน
          </button>
          <span>
            หน้า {page + 1} · {count} อีเมล
          </span>
          <button
            className="outline"
            disabled={(page + 1) * 50 >= count}
            onClick={() => setPage(page + 1)}
          >
            อีเมลหน้าถัดไป
          </button>
        </div>
      </fieldset>
    </section>
  );
}
