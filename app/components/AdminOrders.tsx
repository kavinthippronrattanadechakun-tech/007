"use client";
import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import OrderDetails from "./OrderDetails";
import OrderInventory from "./OrderInventory";
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
  inventory_action: string | null;
};
export default function AdminOrders({
  db,
  onChanged,
  mode = "orders",
}: {
  db: SupabaseClient;
  onChanged?: () => Promise<void>;
  mode?: "orders" | "restock";
}) {
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState(mode === "restock" ? "expired" : ""),
    [filter, setFilter] = useState({
      q: "",
      status: mode === "restock" ? "expired" : "",
    }),
    [page, setPage] = useState(0),
    [rows, setRows] = useState<Row[]>([]),
    [more, setMore] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0),
    [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setClock(Date.now());
      setRefresh((n) => n + 1);
    }, 30000);
    return () => clearInterval(timer);
  }, []);
  function selectStatus(next: string) {
    setRows([]);
    setStatus(next);
    setPage(0);
    setFilter({ q: query.trim(), status: next });
  }

  useEffect(() => {
    let live = true;
    setBusy(true);
    setError("");
    (async () => {
      const { data } = await db.auth.getSession();
      if (!data.session) throw Error("กรุณาเข้าสู่ระบบใหม่");
      const p = new URLSearchParams({ ...filter, page: String(page) }),
        r = await fetch("/api/admin/orders?" + p, {
          cache: "no-store",
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
      <h3>
        {mode === "restock"
          ? "รอรีสต็อกและจัดการสินค้า"
          : "คำสั่งซื้อของลูกค้า"}
      </h3>
      {mode === "restock" && (
        <>
          <p>
            รายการหมดอายุจะแสดงสีแดง อัปเดตอัตโนมัติทุก 30 วินาที เลือก
            “ยังไม่หมดอายุ” เพื่อคืนสต็อกก่อนกำหนดได้
          </p>
          <nav className="tabs restock-tabs" aria-label="รายการรีสต็อก">
            {[
              ["expired", "หมดอายุแล้ว"],
              ["active", "ยังไม่หมดอายุ"],
              ["pending_restock", "รอจัดการทั้งหมด"],
              ["restocked", "คืนสต็อกแล้ว"],
              ["removed", "นำออกแล้ว"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={status === id ? "selected" : ""}
                onClick={() => selectStatus(id)}
              >
                {label}
              </button>
            ))}
          </nav>
        </>
      )}

      <form
        className="order-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setRows([]);
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
          <select
            aria-label="สถานะคำสั่งซื้อ"
            value={status}
            onChange={(e) => selectStatus(e.target.value)}
          >
            <option value="">ทั้งหมด</option>
            <option value="processing">รอดำเนินการ</option>
            <option value="delivered">ส่งสินค้าแล้ว</option>
            <option value="expired">หมดอายุและยังไม่ได้จัดการสต็อก</option>
            <option value="active">ยังไม่หมดอายุ รอจัดการ</option>
            <option value="pending_restock">
              ส่งแล้ว รอจัดการสต็อกทั้งหมด
            </option>
            <option value="restocked">คืนสต็อกแล้ว</option>
            <option value="removed">นำสินค้าออกแล้ว</option>
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
      {busy && rows.length === 0 ? (
        <p>กำลังโหลดคำสั่งซื้อ…</p>
      ) : (
        rows.map((o) => (
          <article
            className={
              "order " +
              (!o.inventory_action &&
              o.status === "delivered" &&
              o.expires_at &&
              Date.parse(o.expires_at) <= clock
                ? "order-expired"
                : "")
            }
            key={o.id}
          >
            <strong>
              {o.product_title} · ฿{o.price}
            </strong>
            <span>
              {o.status === "delivered" ? "ส่งสินค้าแล้ว" : "รอดำเนินการ"}
            </span>
            {!o.inventory_action &&
              o.status === "delivered" &&
              o.expires_at &&
              Date.parse(o.expires_at) <= clock && (
                <strong className="expired-label">
                  หมดอายุแล้ว · รอรีสต็อก
                </strong>
              )}
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
            {o.status === "delivered" &&
              (o.inventory_action ? (
                <span>
                  {o.inventory_action === "restock"
                    ? "คืนสต็อกแล้ว"
                    : "นำสินค้าออกแล้ว"}
                </span>
              ) : (
                <OrderInventory
                  db={db}
                  orderId={o.id}
                  onChanged={async () => {
                    setRefresh((n) => n + 1);
                    await onChanged?.();
                  }}
                />
              ))}
            {
              <details>
                <summary>ดูข้อมูลที่ส่งให้ลูกค้า</summary>
                <OrderDetails order={o} />
              </details>
            }
          </article>
        ))
      )}
      {!busy && !error && !rows.length && (
        <p>
          {status === "expired"
            ? "ไม่มีรายการหมดอายุรอรีสต็อก"
            : "ไม่พบคำสั่งซื้อที่ตรงกับสถานะนี้"}
        </p>
      )}
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
