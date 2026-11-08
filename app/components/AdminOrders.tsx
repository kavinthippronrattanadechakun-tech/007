"use client";
import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import OrderDetails from "./OrderDetails";
import { formatOrderDate } from "../../lib/order-expiry";
type Row = {
  id: string;
  user_id: string;
  user_email: string;
  customer_email: string | null;
  product_title: string;
  price: number;
  status: string;
  created_at: string;
  delivery: string | null;
  duration_days: number | null;
  expires_at: string | null;
};
export default function AdminOrders({ db }: { db: SupabaseClient }) {
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState(""),
    [filter, setFilter] = useState({ q: "", status: "" }),
    [page, setPage] = useState(0),
    [rows, setRows] = useState<Row[]>([]),
    [more, setMore] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let live = true;
    setBusy(true);
    setError("");
    (async () => {
      const { data } = await db.auth.getSession();
      if (!data.session) throw Error("กรุณาเข้าสู่ระบบใหม่");
      const p = new URLSearchParams({ ...filter, page: String(page) }),
        r = await fetch("/api/admin/orders?" + p, {
          headers: { Authorization: "Bearer " + data.session.access_token },
        }),
        result = await r.json();
      if (!r.ok) throw Error(result.error || "โหลดคำสั่งซื้อไม่สำเร็จ");
      if (live) {
        setRows(result.rows);
        setMore(result.hasMore);
      }
    })()
      .catch((e) => live && setError(e.message))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [db, filter, page, refresh]);
  return (
    <section>
      <h3>คำสั่งซื้อของลูกค้า</h3>
      <form
        className="order-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(0);
          setFilter({ q: query.trim(), status });
        }}
      >
        <label>
          ค้นหาอีเมล / เลขคำสั่งซื้อ / สินค้า
          <input
            value={query}
            maxLength={320}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label>
          สถานะคำสั่งซื้อ
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">ทั้งหมด</option>
            <option value="processing">รอดำเนินการ</option>
            <option value="delivered">ส่งสินค้าแล้ว</option>
          </select>
        </label>
        <div className="actions">
          <button disabled={busy}>ค้นหาคำสั่งซื้อ</button>
          <button
            type="button"
            disabled={busy}
            className="outline"
            onClick={() => setRefresh((n) => n + 1)}
          >
            รีเฟรชคำสั่งซื้อ
          </button>
        </div>
      </form>
      {error && <p role="alert">{error}</p>}
      {busy ? (
        <p>กำลังโหลดคำสั่งซื้อ…</p>
      ) : (
        rows.map((o) => (
          <article className="order" key={o.id}>
            <strong>
              {o.product_title} · ฿{o.price}
            </strong>
            <span>
              {o.status === "delivered" ? "ส่งสินค้าแล้ว" : "รอดำเนินการ"}
            </span>
            <span>บัญชีลูกค้า: {o.user_email}</span>
            {o.customer_email && (
              <span>อีเมลสำหรับรับสินค้า: {o.customer_email}</span>
            )}
            <small>
              คำสั่งซื้อ {o.id} ·{" "}
              {new Date(o.created_at).toLocaleString("th-TH", {
                timeZone: "Asia/Bangkok",
              })}
            </small>
            <span>
              วันหมดอายุ:{" "}
              {o.expires_at ? formatOrderDate(o.expires_at) : "ไม่กำหนด"}
            </span>
            {
              <details>
                <summary>ดูข้อมูลที่ส่งให้ลูกค้า</summary>
                <OrderDetails order={o} />
              </details>
            }
          </article>
        ))
      )}
      {!busy && !error && !rows.length && <p>ไม่พบคำสั่งซื้อ</p>}
      <div className="actions">
        <button
          className="outline"
          disabled={busy || !page}
          onClick={() => setPage(page - 1)}
        >
          คำสั่งซื้อหน้าก่อน
        </button>
        <span>หน้า {page + 1}</span>
        <button
          className="outline"
          disabled={busy || !more}
          onClick={() => setPage(page + 1)}
        >
          คำสั่งซื้อหน้าถัดไป
        </button>
      </div>
    </section>
  );
}
