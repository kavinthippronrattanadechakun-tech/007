export type OrderTiming = {
  id: string;
  created_at: string;
  duration_days: number | null;
  expires_at: string | null;
  delivery: string | null;
};
export function formatOrderDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "ไม่พบข้อมูลเวลา";
  return (
    new Intl.DateTimeFormat("th-TH", {
      timeZone: "Asia/Bangkok",
      day: "numeric",
      month: "long",
      year: "numeric",
      era: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(date) + " น. (เวลาไทย)"
  );
}
export function orderCopyText(o: OrderTiming) {
  return [
    `คำสั่งซื้อ: ${o.id}`,
    `วันที่ซื้อ: ${formatOrderDate(o.created_at)}`,
    o.duration_days
      ? `ระยะเวลา: ${o.duration_days} วัน (${o.duration_days * 24} ชั่วโมง)`
      : "ระยะเวลา: ไม่กำหนด",
    o.expires_at
      ? `วันหมดอายุ: ${formatOrderDate(o.expires_at)}`
      : "วันหมดอายุ: ไม่กำหนด",
    o.delivery,
  ]
    .filter(Boolean)
    .join("\n");
}
