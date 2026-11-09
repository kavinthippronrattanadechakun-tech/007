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
  fulfillment_type: "manual" | "code";
  delivered_at: string | null;
};
export default function AdminOrders({
  db,
  onChanged,
  mode = "orders",
}: {
  db: SupabaseClient;
  onChanged?: () => Promise<void>;
  mode?: "orders" | "restock" | "manual";
}) {
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState(
      mode === "restock"
        ? "expired"
        : mode === "manual"
          ? "manual_pending"
          : "",
    ),
    [filter, setFilter] = useState({
      q: "",
      status:
        mode === "restock"
          ? "expired"
          : mode === "manual"
            ? "manual_pending"
            : "",
    }),
    [page, setPage] = useState(0),
    [rows, setRows] = useState<Row[]>([]),
    [more, setMore] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0),
    [clock, setClock] = useState(Date.now()),
    [sending, setSending] = useState<string | null>(null),
    [deliveryDrafts, setDeliveryDrafts] = useState<Record<string, string>>({}),
    [notice, setNotice] = useState("");
  async function markDelivered(o: Row) {
    if (sending) return;
    setSending(o.id);
    setNotice("");
    try {
      const { data } = await db.auth.getSession();
      if (!data.session) throw Error("กรุณาเข้าสู่ระบบใหม่");
      const r = await fetch("/api/admin/orders/fulfill", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + data.session.access_token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            orderId: o.id,
            delivery: deliveryDrafts[o.id] ?? o.delivery ?? "",
          }),
        }),
        result = await r.json();
      if (!r.ok) throw Error(result.error || "บันทึกไม่สำเร็จ");
      setNotice(
        result.data.already_delivered
          ? "รายการนี้จัดส่งแล้ว"
          : "บันทึกว่าจัดส่งแล้วเรียบร้อย",
      );
      setRows((old) =>
        old.map((row) =>
          row.id === o.id
            ? {
                ...row,
                status: "delivered",
                delivered_at: result.data.delivered_at,
                delivery: deliveryDrafts[o.id] ?? row.delivery,
              }
            : row,
        ),
      );
      setRefresh((n) => n + 1);
      await onChanged?.();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setSending(null);
    }
  }

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
        {mode === "manual"
          ? "รายการจัดส่งเอง"
          : mode === "restock"
            ? "รอรีสต็อกและจัดการสินค้า"
            : "คำสั่งซื้อของลูกค้า"}
      </h3>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {mode === "manual" && (
        <>
          <p>
            สีแดง = ยังไม่ได้จัดส่ง · สีเขียว = จัดส่งแล้ว
            ติ๊กเมื่อดำเนินการส่งให้ลูกค้าเรียบร้อย
          </p>
          <nav className="tabs" aria-label="รายการจัดส่งเอง">
            {[
              ["manual_pending", "ยังไม่ได้จัดส่ง"],
              ["manual_delivered", "จัดส่งแล้ว"],
              ["manual_all", "ทั้งหมด"],
            ].map(([id, label]) => (
              <button
                type="button"
                key={id}
                className={status === id ? "selected" : ""}
                onClick={() => selectStatus(id)}
              >
                {label}
              </button>
            ))}
          </nav>
        </>
      )}
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
            <option value="manual_pending">จัดส่งเอง: ยังไม่ได้จัดส่ง</option>
            <option value="manual_delivered">จัดส่งเอง: จัดส่งแล้ว</option>
            <option value="manual_all">จัดส่งเองทั้งหมด</option>
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
              (mode === "manual"
                ? o.status === "delivered"
                  ? "order-manual-delivered"
                  : "order-manual-pending"
                : !o.inventory_action &&
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
            <span className={mode === "manual" ? "manual-status" : undefined}>
              {mode === "manual"
                ? o.status === "delivered"
                  ? "จัดส่งแล้ว"
                  : "ยังไม่ได้จัดส่ง"
                : o.status === "delivered"
                  ? "ส่งสินค้าแล้ว"
                  : "รอดำเนินการ"}
            </span>
            {mode !== "manual" &&
              !o.inventory_action &&
              o.status === "delivered" &&
              o.expires_at &&
              Date.parse(o.expires_at) <= clock && (
                <strong className="expired-label">
                  หมดอายุแล้ว · รอรีสต็อก
                </strong>
              )}
            {mode === "manual" && (
              <div className="manual-delivery-control">
                {o.status !== "delivered" && (
                  <label>
                    ข้อมูลส่งให้ลูกค้า (ถ้ามี)
                    <textarea
                      maxLength={16384}
                      value={deliveryDrafts[o.id] ?? o.delivery ?? ""}
                      onChange={(e) =>
                        setDeliveryDrafts((old) => ({
                          ...old,
                          [o.id]: e.target.value,
                        }))
                      }
                      disabled={sending === o.id}
                    />
                  </label>
                )}
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={o.status === "delivered" || sending === o.id}
                    disabled={!!sending || o.status === "delivered"}
                    onChange={(e) => {
                      if (e.target.checked) void markDelivered(o);
                    }}
                  />
                  {o.status === "delivered"
                    ? "จัดส่งแล้ว"
                    : "ติ๊กเมื่อจัดส่งแล้ว"}
                </label>
                {o.delivered_at && (
                  <small>เวลาจัดส่ง: {formatOrderDate(o.delivered_at)}</small>
                )}
              </div>
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
            {mode !== "manual" &&
              o.status === "delivered" &&
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
                <OrderDetails order={o} productTitle={o.product_title} />
              </details>
            }
          </article>
        ))
      )}
      {!busy && !error && !rows.length && (
        <p>
          {status === "manual_pending"
            ? "ไม่มีรายการรอจัดส่ง"
            : status === "expired"
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
