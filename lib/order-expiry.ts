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
    }).format(date) + " น."
  );
}
export function orderCopyText(o: OrderTiming, productTitle: string) {
  const date = o.expires_at ? new Date(o.expires_at) : null;
  const valid = date && Number.isFinite(date.getTime());
  return [
    `สินค้า: ${productTitle}`,
    o.duration_days ? `ระยะเวลา: ${o.duration_days} วัน` : "ระยะเวลา: ไม่กำหนด",
    o.delivery,
    valid
      ? `วันหมดอายุ: ${new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "long", year: "numeric", era: "short" }).format(date)}`
      : "วันหมดอายุ: ไม่กำหนด",
    valid
      ? `เวลาหมดอายุ: ${new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hour12: false }).format(date)} น.`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}
