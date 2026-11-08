export type Product = {
  id: string;
  title: string;
  description: string;
  price: number;
  active: boolean;
  delivery_type: string;
  image_url: string;
  category_id: string | null;
  subcategory: string;
  requires_customer_email: boolean;
  duration_days: number | null;
};
export const defaultSettings = {
  bank_name: "",
  bank_account_name: "",
  bank_account_number: "",
  brand_name: "KingkeawLnwza",
  hero_title: "พรีเมียมในแบบที่คุณเลือก",
  hero_description:
    "ร้านค้าออนไลน์ภาษาไทย • กระเป๋าเงิน • อัปโหลดหลักฐานการโอน • ติดตามคำสั่งซื้อ",
  announcement: "เปิดขายเฉพาะสินค้าที่มีสิทธิ์จำหน่ายอย่างถูกต้อง",
  contact_text: "",
  footer_text:
    "© KingkeawLnwza · ร้านอิสระ ไม่ได้เป็นตัวแทนอย่างเป็นทางการของแบรนด์ที่ระบุ · รับเคลมตามเงื่อนไขที่ประกาศ",
};
export type StoreSettings = typeof defaultSettings;

export type Category = {
  id: string;
  name: string;
  sort_order: number;
  description: string;
  image_url: string;
};

export const chatGPTSubcategories = [
  { id: "share4", name: "หาร 4" },
  { id: "share3", name: "หาร 3" },
  { id: "private", name: "ส่วนตัว" },
];
