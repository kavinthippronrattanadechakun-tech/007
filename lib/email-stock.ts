export type EmailBatchInput = {
  email: string;
  remaining: number;
  delivery_info: string;
};
export function parseEmailStock(text: string): EmailBatchInput[] {
  const lines = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!lines.length || lines.length > 200)
    throw Error("กรอกอีเมล 1–200 รายการ ครั้งละ 1 อีเมลต่อบรรทัด");
  const seen = new Set<string>();
  return lines.map((line, index) => {
    const [rawEmail, rawQuantity, ...rest] = line.split("|");
    const email = rawEmail?.trim().toLowerCase(),
      quantity = rawQuantity?.trim(),
      delivery_info = rest.join("|").trim().replace(/\\n/g, "\n");
    if (
      !email ||
      email.length > 320 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    )
      throw Error(`บรรทัด ${index + 1}: อีเมลไม่ถูกต้อง`);
    if (
      !quantity ||
      !/^\d+$/.test(quantity) ||
      Number(quantity) < 1 ||
      Number(quantity) > 100000
    )
      throw Error(`บรรทัด ${index + 1}: จำนวนต้องเป็นจำนวนเต็ม 1–100000`);
    if (!delivery_info || delivery_info.length > 16384)
      throw Error(
        `บรรทัด ${index + 1}: กรุณาระบุข้อมูลส่งมอบไม่เกิน 16384 ตัวอักษร`,
      );
    if (seen.has(email))
      throw Error(`บรรทัด ${index + 1}: อีเมลซ้ำในรายการที่กรอก`);
    seen.add(email);
    return { email, remaining: Number(quantity), delivery_info };
  });
}
