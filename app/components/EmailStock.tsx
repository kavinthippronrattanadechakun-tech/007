"use client";
import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  emptyStock,
  validateStock,
  type StockDraft,
} from "../../lib/structured-stock";
type Batch = StockDraft & { id: string; sold: number };
function Fields({
  value,
  onChange,
  editing = false,
}: {
  value: StockDraft;
  onChange: (v: StockDraft) => void;
  editing?: boolean;
}) {
  return (
    <div className="stock-fields">
      <label>
        Mail
        <input
          type="email"
          required
          maxLength={320}
          value={value.email}
          onChange={(e) => onChange({ ...value, email: e.target.value })}
        />
      </label>
      <label>
        สต็อกจำนวน
        <input
          type="number"
          required
          min={editing ? 0 : 1}
          max={value.has_screen ? 1 : 100000}
          step={1}
          value={value.remaining}
          onChange={(e) =>
            onChange({ ...value, remaining: Number(e.target.value) })
          }
        />
      </label>
      <label>
        Password
        <input
          type="text"
          required={!editing}
          maxLength={1000}
          autoComplete="off"
          value={value.password}
          onChange={(e) => onChange({ ...value, password: e.target.value })}
        />
      </label>
      <label>
        รูปแบบสต็อก
        <select
          aria-label="รูปแบบสต็อก"
          value={value.has_screen ? "screen" : "account"}
          onChange={(e) =>
            onChange({
              ...value,
              has_screen: e.target.value === "screen",
              screen: "",
              pin: "",
              remaining:
                e.target.value === "screen"
                  ? Math.min(value.remaining, 1)
                  : value.remaining,
            })
          }
        >
          <option value="account">ไม่มีจอ (Mail / Password)</option>
          <option value="screen">มี Screen / Pin เช่น Netflix</option>
        </select>
      </label>
      {value.has_screen && (
        <>
          <label>
            Screen
            <input
              required
              maxLength={80}
              value={value.screen}
              onChange={(e) => onChange({ ...value, screen: e.target.value })}
            />
          </label>
          <label>
            Pin (ถ้ามี)
            <input
              maxLength={20}
              value={value.pin}
              onChange={(e) => onChange({ ...value, pin: e.target.value })}
            />
          </label>
          <p>
            หนึ่งจอต่อหนึ่งรายการ ตั้งสต็อกได้ 1
            เพื่อไม่ส่งจอเดียวให้ลูกค้าหลายคน
          </p>
        </>
      )}
      <label>
        ข้อมูลเพิ่มเติม (ถ้ามี)
        <textarea
          maxLength={16384}
          value={value.delivery_info}
          onChange={(e) =>
            onChange({ ...value, delivery_info: e.target.value })
          }
        />
      </label>
    </div>
  );
}
export default function EmailStock({
  db,
  productId,
  onChanged,
}: {
  db: SupabaseClient;
  productId: string;
  onChanged?: () => Promise<void>;
}) {
  const [rows, setRows] = useState<Batch[]>([]),
    [drafts, setDrafts] = useState<StockDraft[]>([emptyStock()]),
    [edit, setEdit] = useState<Batch | null>(null),
    [original, setOriginal] = useState<Batch | null>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [message, setMessage] = useState(""),
    [page, setPage] = useState(0),
    [count, setCount] = useState(0),
    [totals, setTotals] = useState({ available: 0, sold: 0 });
  async function load() {
    const [r, t] = await Promise.all([
      db
        .from("email_stock_batches")
        .select(
          "id,email,delivery_info,remaining,sold,password,has_screen,screen,pin",
          { count: "exact" },
        )
        .eq("product_id", productId)
        .order("created_at")
        .order("id")
        .range(page * 50, page * 50 + 49),
      db.rpc("email_stock_totals", { p_product_id: productId }),
    ]);
    if (r.error) throw r.error;
    if (t.error) throw t.error;
    return {
      rows: (r.data || []).map((r) => ({ ...emptyStock(), ...r })),
      count: r.count || 0,
      totals: t.data?.[0] || { available: 0, sold: 0 },
    };
  }
  function apply(r: Awaited<ReturnType<typeof load>>) {
    setRows(r.rows);
    setCount(r.count);
    setTotals(r.totals);
  }
  useEffect(() => {
    let live = true;
    setLoading(true);
    load()
      .then((r) => {
        if (live) apply(r);
      })
      .catch((e) => live && setMessage(e.message))
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
      apply(await load());
      await onChanged?.();
      setMessage("บันทึกสต็อกอีเมลเรียบร้อยแล้ว");
    } catch (e) {
      const err = e as { code?: string; message: string };
      setMessage(
        err.code === "23505"
          ? "Mail และ Screen นี้มีอยู่แล้ว กรุณาแก้ไขรายการเดิม"
          : err.message || "บันทึกไม่สำเร็จ",
      );
    } finally {
      setBusy(false);
    }
  }
  async function add(e: React.FormEvent) {
    e.preventDefault();
    await run(async () => {
      const data = drafts.map((d) => ({
        ...validateStock(d),
        product_id: productId,
      }));
      const keys = data.map((d) => d.email + "|" + d.screen.toLowerCase());
      if (new Set(keys).size !== keys.length)
        throw Error("มี Mail และ Screen ซ้ำในรายการที่กรอก");
      const r = await db.from("email_stock_batches").insert(data);
      if (r.error) throw r.error;
      setDrafts([emptyStock()]);
    });
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!edit || !original) return;
    await run(async () => {
      const d = validateStock(edit, true);
      const { id, sold, ...values } = d as Batch;
      const r = await db
        .from("email_stock_batches")
        .update(values)
        .eq("id", edit.id)
        .eq("remaining", original.remaining)
        .eq("sold", original.sold)
        .eq("password", original.password)
        .eq("screen", original.screen)
        .eq("delivery_info", original.delivery_info)
        .select("id")
        .single();
      if (r.error)
        throw Error(
          r.error.code === "23505"
            ? "Mail และ Screen ซ้ำ"
            : "ข้อมูลเปลี่ยนจากการซื้อหรือการแก้ไข กรุณารีเฟรชแล้วลองใหม่",
        );
      setEdit(null);
      setOriginal(null);
    });
  }
  return (
    <section className="email-stock">
      <h3>สต็อก Mail / Password</h3>
      <p>
        คงเหลือ <strong>{totals.available}</strong> สิทธิ์ · ขายแล้ว{" "}
        <strong>{totals.sold}</strong> สิทธิ์
      </p>
      <p>
        แบบไม่มีจอขายได้ตามจำนวนที่ตั้งไว้ แบบมีจอให้เพิ่มแยกแต่ละ Screen
        ข้อมูลที่เว้นว่างจะไม่แสดงให้ลูกค้า
      </p>
      {message && (
        <div className="notice" role="status">
          {message}
        </div>
      )}
      <fieldset disabled={busy || loading} className="admin-fieldset">
        <form onSubmit={add}>
          {drafts.map((d, i) => (
            <fieldset className="stock-entry" key={i}>
              <legend>รายการที่ {i + 1}</legend>
              <Fields
                value={d}
                onChange={(v) =>
                  setDrafts((ds) => ds.map((x, j) => (j === i ? v : x)))
                }
              />
              {drafts.length > 1 && (
                <button
                  type="button"
                  className="outline"
                  onClick={() =>
                    setDrafts((ds) => ds.filter((_, j) => j !== i))
                  }
                >
                  ลบรายการที่ {i + 1}
                </button>
              )}
            </fieldset>
          ))}
          <div className="actions">
            <button
              type="button"
              className="outline"
              disabled={drafts.length >= 200}
              onClick={() => setDrafts((ds) => [...ds, emptyStock()])}
            >
              + เพิ่ม Mail / จออีกรายการ
            </button>
            <button>บันทึกสต็อก Mail</button>
          </div>
        </form>
        {edit && (
          <form onSubmit={save}>
            <h4>แก้ไขสต็อก Mail</h4>
            <Fields
              value={edit}
              editing
              onChange={(v) => setEdit({ ...edit, ...v })}
            />
            <p>
              ข้อมูลใหม่มีผลกับการซื้อครั้งต่อไป ประวัติที่ส่งแล้วจะไม่เปลี่ยน
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
              {row.has_screen && ` · Screen ${row.screen}`}
            </span>
            <details>
              <summary>ดูข้อมูลส่งมอบ</summary>
              <div className="secret">
                {row.password && <div>Password: {row.password}</div>}
                {row.has_screen && <div>Screen: {row.screen}</div>}
                {row.has_screen && row.pin && <div>Pin: {row.pin}</div>}
                {row.delivery_info && (
                  <div>ข้อมูลเพิ่มเติม: {row.delivery_info}</div>
                )}
              </div>
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
                <button
                  className="outline"
                  onClick={() => {
                    if (confirm("ลบสต็อกที่ยังไม่เคยขายรายการนี้?"))
                      run(async () => {
                        const r = await db
                          .from("email_stock_batches")
                          .delete()
                          .eq("id", row.id)
                          .eq("sold", 0)
                          .select("id")
                          .single();
                        if (r.error)
                          throw Error("ลบไม่สำเร็จ รายการอาจขายแล้ว");
                      });
                  }}
                >
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
            disabled={!page}
            onClick={() => setPage(page - 1)}
          >
            อีเมลหน้าก่อน
          </button>
          <span>
            หน้า {page + 1} · {count} รายการ
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
