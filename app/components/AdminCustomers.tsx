"use client";
import { useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
type Customer = { id: string; email: string; balance: number };
export default function AdminCustomers({
  db,
  onChanged,
}: {
  db: SupabaseClient;
  onChanged: () => Promise<void>;
}) {
  const [email, setEmail] = useState(""),
    [customer, setCustomer] = useState<Customer | null>(null),
    [history, setHistory] = useState<any[]>([]),
    [amount, setAmount] = useState(""),
    [reference, setReference] = useState(""),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const request = useRef({ key: "", id: "" });
  async function api(method: string, body?: object) {
    const { data } = await db.auth.getSession();
    if (!data.session) throw Error("กรุณาเข้าสู่ระบบใหม่");
    const r = await fetch(
      "/api/admin/customers" +
        (method === "GET" ? "?email=" + encodeURIComponent(email.trim()) : ""),
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
    return result;
  }
  async function lookup() {
    const r = await api("GET");
    setCustomer(r.customer);
    setHistory(r.history);
    return r.customer;
  }
  async function search(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (!(await lookup())) setMessage("ไม่พบลูกค้าอีเมลนี้");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function credit(e: React.FormEvent) {
    e.preventDefault();
    if (!customer) return;
    const n = Number(amount);
    if (!Number.isSafeInteger(n) || n < 1 || n > 100000) {
      setMessage("จำนวนเงินต้องเป็นจำนวนเต็ม 1–100000 บาท");
      return;
    }
    if (!confirm(`ยืนยันเติม ฿${n} ให้ ${customer.email}?`)) return;
    setBusy(true);
    setMessage("");
    try {
      const payload = {
          userId: customer.id,
          amount: n,
          reference: reference.trim(),
          note: note.trim(),
        },
        key = JSON.stringify(payload);
      if (request.current.key !== key)
        request.current = { key, id: crypto.randomUUID() };
      const r = await api("POST", {
        ...payload,
        requestId: request.current.id,
      });
      setMessage(
        r.data.already_credited
          ? "รายการนี้เติมเงินแล้ว ไม่ได้เติมซ้ำ"
          : "เติมเงินให้ลูกค้าสำเร็จ",
      );
      setAmount("");
      setReference("");
      setNote("");
      request.current = { key: "", id: "" };
      await lookup();
      await onChanged();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h3>ลูกค้าและเติมเงิน</h3>
      <p>ค้นหาอีเมลลูกค้า เลือกจำนวนเงิน แล้วกดเติมเงินได้เลย</p>
      {message && (
        <div className="notice" role="status">
          {message}
        </div>
      )}
      <fieldset disabled={busy} className="admin-fieldset">
        <form onSubmit={search}>
          <label>
            อีเมลบัญชีลูกค้า
            <input
              type="email"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setCustomer(null);
                setHistory([]);
              }}
            />
          </label>
          <button>ค้นหาลูกค้า</button>
        </form>
        {customer && (
          <>
            <div className="bank">
              <strong>{customer.email}</strong>
              <div>ยอดเงินปัจจุบัน ฿{customer.balance}</div>
              <small>รหัสลูกค้า {customer.id}</small>
            </div>
            <form onSubmit={credit}>
              <label>
                จำนวนเงินที่แอดมินเติม (บาท)
                <input
                  required
                  type="number"
                  min={1}
                  max={100000}
                  step={1}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              <div className="actions">
                {[50, 100, 200, 500, 1000].map((n) => (
                  <button
                    type="button"
                    className="outline"
                    key={n}
                    onClick={() => setAmount(String(n))}
                  >
                    ฿{n}
                  </button>
                ))}
              </div>
              <details>
                <summary>เลขอ้างอิง / หมายเหตุ (ไม่บังคับ)</summary>
                <p>
                  หากเติมแทนรายการโอน
                  ให้ใส่เลขอ้างอิงธนาคารเพื่อกันใช้สลิปเดิมเติมซ้ำ
                </p>
                <label>
                  เลขอ้างอิงธุรกรรมธนาคาร
                  <input
                    minLength={6}
                    maxLength={200}
                    pattern="[A-Za-z0-9_-]+"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                </label>
                <label>
                  เหตุผล / หมายเหตุ
                  <textarea
                    maxLength={1000}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
              </details>
              <button>เติมเงินให้ลูกค้า</button>
            </form>
            <h4>ประวัติเติมโดยแอดมินล่าสุด</h4>
            {history.length === 0 && <p>ยังไม่มีรายการเติมโดยแอดมิน</p>}
            {history.map((h) => (
              <div className="order" key={h.id}>
                <b>฿{h.amount}</b>
                <small>
                  {new Date(h.created_at).toLocaleString("th-TH", {
                    timeZone: "Asia/Bangkok",
                  })}
                </small>
                {h.reference && <span>เลขอ้างอิง {h.reference}</span>}
                <p>{h.note}</p>
              </div>
            ))}
          </>
        )}
      </fieldset>
    </section>
  );
}
