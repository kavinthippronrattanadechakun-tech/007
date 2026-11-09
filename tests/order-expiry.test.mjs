import { test } from "node:test";
import assert from "node:assert/strict";
import { formatOrderDate, orderCopyText } from "../lib/order-expiry.ts";
const order = {
  id: "order-1",
  created_at: "2026-12-31T23:30:00Z",
  duration_days: 1,
  expires_at: "2027-01-01T23:30:00Z",
  delivery: "Mail: member@example.com\nPassword: secret",
};
test("date formatting keeps Bangkok dates but omits the timezone label", () => {
  const text = formatOrderDate(order.expires_at);
  assert.match(text, /2 มกราคม พ.ศ. 2570/);
  assert.match(text, /06:30:00/);
  assert(!text.includes("เวลาไทย"));
});
test("copy starts with product, shows days only and separates expiry date and time", () => {
  assert.equal(
    orderCopyText(order, "ChatGPT หาร 4 · 1 วัน"),
    "สินค้า: ChatGPT หาร 4 · 1 วัน\nระยะเวลา: 1 วัน\nMail: member@example.com\nPassword: secret\nวันหมดอายุ: 2 มกราคม พ.ศ. 2570\nเวลาหมดอายุ: 06:30 น.",
  );
  const text = orderCopyText({ ...order, duration_days: 30 }, "Netflix");
  assert(text.includes("ระยะเวลา: 30 วัน"));
  assert(!/order-1|คำสั่งซื้อ:|ชั่วโมง|เวลาไทย|วันที่ซื้อ:/.test(text));
});
test("orders without duration or delivery never invent a date or show null", () => {
  const text = orderCopyText(
    { ...order, duration_days: null, expires_at: null, delivery: null },
    "สินค้า",
  );
  assert(text.includes("วันหมดอายุ: ไม่กำหนด"));
  assert(!/null|undefined|เวลาหมดอายุ:/.test(text));
});
