export type StockDraft = {
  email: string;
  remaining: number;
  password: string;
  delivery_info: string;
  has_screen: boolean;
  screen: string;
  pin: string;
};
export const emptyStock = (): StockDraft => ({
  email: "",
  remaining: 1,
  password: "",
  delivery_info: "",
  has_screen: false,
  screen: "",
  pin: "",
});
export function validateStock(d: StockDraft, legacy = false): StockDraft {
  const email = d.email.trim().toLowerCase(),
    screen = d.has_screen ? d.screen.trim() : "",
    pin = d.has_screen ? d.pin.trim() : "";
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw Error("กรอก Mail ให้ถูกต้อง");
  if (
    !Number.isSafeInteger(d.remaining) ||
    d.remaining < (legacy ? 0 : 1) ||
    d.remaining > 100000
  )
    throw Error("จำนวนสต็อกไม่ถูกต้อง");
  if (
    (!legacy && !d.password.trim()) ||
    d.password.length > 1000 ||
    /[\r\n]/.test(d.password)
  )
    throw Error("กรอก Password ไม่เกิน 1000 ตัวอักษรและไม่มีการขึ้นบรรทัดใหม่");
  if (d.delivery_info.length > 16384)
    throw Error("ข้อมูลเพิ่มเติมยาวเกินกำหนด");
  if (
    d.has_screen &&
    (!screen ||
      screen.length > 80 ||
      pin.length > 20 ||
      /[\r\n]/.test(screen + pin) ||
      d.remaining > 1)
  )
    throw Error("แบบมีจอ: ระบุ Screen และตั้งจำนวนไม่เกิน 1 ต่อจอ");
  return { ...d, email, screen, pin, delivery_info: d.delivery_info.trim() };
}
