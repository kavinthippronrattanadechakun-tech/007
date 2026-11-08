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
test("Thai dates use Bangkok timezone, Buddhist year and full date/time across year boundary", () => {
  const start = formatOrderDate(order.created_at),
    end = formatOrderDate(order.expires_at);
  assert.match(start, /1 มกราคม พ.ศ. 2570/);
  assert.match(start, /06:30:00/);
  assert.match(end, /2 มกราคม พ.ศ. 2570/);
  assert.match(end, /06:30:00/);
  assert.match(end, /เวลาไทย/);
});
test("copy text contains purchase, exact duration, expiry and delivery data together", () => {
  const text = orderCopyText(order);
  for (const part of [
    "คำสั่งซื้อ: order-1",
    "วันที่ซื้อ:",
    "1 วัน (24 ชั่วโมง)",
    "วันหมดอายุ:",
    "Mail: member@example.com",
    "Password: secret",
  ])
    assert(text.includes(part));
  assert(
    orderCopyText({ ...order, duration_days: 30 }).includes(
      "30 วัน (720 ชั่วโมง)",
    ),
  );
});
test("unknown durations never invent expiry and processing orders can copy dates", () => {
  const text = orderCopyText({
    ...order,
    duration_days: null,
    expires_at: null,
    delivery: null,
  });
  assert(text.includes("วันหมดอายุ: ไม่กำหนด"));
  assert(!text.includes("null"));
  assert(!text.includes("undefined"));
});
