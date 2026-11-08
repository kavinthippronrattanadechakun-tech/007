"use client";
import { useEffect, useState } from "react";
import EmailStock from "./EmailStock";
import AdminOrders from "./AdminOrders";
import AdminCustomers from "./AdminCustomers";
import AdminCategories from "./AdminCategories";
import SlipOKQuota from "./SlipOKQuota";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  defaultSettings,
  type Product,
  type Category,
  type StoreSettings,
} from "../../lib/store";
type Stock = { id: string; secret: string; order_id: string | null };
const emptyProduct = (): Product => ({
  id: "",
  title: "",
  description: "",
  price: 1,
  active: false,
  delivery_type: "manual",
  image_url: "",
  category_id: null,
  subcategory: "",
  requires_customer_email: false,
  duration_days: null,
});
const labels: Record<keyof StoreSettings, string> = {
  bank_name: "ชื่อธนาคาร",
  bank_account_name: "ชื่อบัญชี",
  bank_account_number: "เลขบัญชี",
  bank_topup_note: "หมายเหตุหน้าเติมเงิน",
  brand_name: "ชื่อร้าน",
  hero_title: "หัวข้อหน้าร้าน",
  hero_description: "คำอธิบายหน้าร้าน",
  announcement: "ประกาศ",
  contact_text: "ช่องทางติดต่อ",
  footer_text: "ข้อความท้ายเว็บ",
};
export default function AdminStore({
  db,
  onChanged,
}: {
  db: SupabaseClient;
  onChanged: () => Promise<void>;
}) {
  const [section, setSection] = useState("products"),
    [filterCategory, setFilterCategory] = useState("all"),
    [products, setProducts] = useState<Product[]>([]),
    [categories, setCategories] = useState<Category[]>([]),
    [product, setProduct] = useState<Product>(emptyProduct),
    [editing, setEditing] = useState(false),
    [settings, setSettings] = useState<StoreSettings>(defaultSettings),
    [selected, setSelected] = useState(""),
    [stock, setStock] = useState<Stock[]>([]),
    [codes, setCodes] = useState(""),
    [stockEdit, setStockEdit] = useState<Stock | null>(null),
    [counts, setCounts] = useState({ available: 0, sold: 0 }),
    [page, setPage] = useState(0),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [message, setMessage] = useState(""),
    [image, setImage] = useState<File | null>(null);
  async function load() {
    const [p, s, c] = await Promise.all([
      db.from("products").select("*").order("title"),
      db.from("store_settings").select("*").eq("id", true).single(),
      db
        .from("product_categories")
        .select("*")
        .order("sort_order")
        .order("name"),
    ]);
    if (p.error) throw p.error;
    if (s.error) throw s.error;
    if (c.error) throw c.error;
    setCategories(c.data || []);
    setProducts(p.data || []);
    const { id, ...value } = s.data;
    setSettings({ ...defaultSettings, ...value });
    setSelected((old) => old || p.data?.[0]?.id || "");
  }
  async function loadStock(id: string, offset: number) {
    const [rows, a, s] = await Promise.all([
      db
        .from("stock")
        .select("id,secret,order_id")
        .eq("product_id", id)
        .order("id")
        .range(offset * 50, offset * 50 + 49),
      db
        .from("stock")
        .select("id", { count: "exact", head: true })
        .eq("product_id", id)
        .is("order_id", null),
      db
        .from("stock")
        .select("id", { count: "exact", head: true })
        .eq("product_id", id)
        .not("order_id", "is", null),
    ]);
    if (rows.error) throw rows.error;
    if (a.error) throw a.error;
    if (s.error) throw s.error;
    return {
      rows: rows.data || [],
      available: a.count || 0,
      sold: s.count || 0,
    };
  }
  useEffect(() => {
    let live = true;
    load()
      .catch((e) => live && setMessage("โหลดหลังบ้านไม่สำเร็จ: " + e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [db]);
  useEffect(() => {
    let live = true;
    setStock([]);
    setStockEdit(null);
    if (!selected) return;
    loadStock(selected, page)
      .then((r) => {
        if (live) {
          setStock(r.rows);
          setCounts(r);
        }
      })
      .catch((e) => live && setMessage("โหลดสต็อกไม่สำเร็จ: " + e.message));
    return () => {
      live = false;
    };
  }, [selected, page, db]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      setMessage("บันทึกเรียบร้อยแล้ว");
      await onChanged();
    } catch (e) {
      const error = e as { message: string; code?: string };
      setMessage(
        error.code === "23505"
          ? "พบโค้ดซ้ำในสินค้านี้ กรุณาตรวจสอบสต็อก"
          : error.message || "บันทึกไม่สำเร็จ",
      );
    } finally {
      setBusy(false);
    }
  }
  async function refreshStock() {
    if (selected) {
      const r = await loadStock(selected, page);
      setStock(r.rows);
      setCounts(r);
    }
  }
  async function saveProduct(e: React.FormEvent) {
    e.preventDefault();
    await run(async () => {
      const title = product.title.trim();
      if (
        !title ||
        !Number.isSafeInteger(product.price) ||
        product.price < 1 ||
        product.price > 2147483647
      )
        throw Error("กรุณาระบุชื่อและราคาเป็นจำนวนเต็มตั้งแต่ 1 บาท");
      if (
        product.duration_days != null &&
        (!Number.isInteger(product.duration_days) ||
          product.duration_days < 1 ||
          product.duration_days > 3650)
      )
        throw Error("ระยะเวลาต้องเป็นจำนวนเต็ม 1–3650 วัน");
      let imageUrl = product.image_url.trim();
      let uploaded: string | null = null;
      if (imageUrl && !/^https:\/\//i.test(imageUrl))
        throw Error("ลิงก์รูปต้องขึ้นต้นด้วย https://");
      if (image) {
        if (
          !["image/jpeg", "image/png", "image/webp"].includes(image.type) ||
          image.size > 5000000 ||
          image.size === 0
        )
          throw Error("เลือกรูป JPG, PNG หรือ WEBP ขนาดไม่เกิน 5 MB");
        const path = crypto.randomUUID() + "." + image.type.split("/")[1];
        const r = await db.storage
          .from("product-images")
          .upload(path, image, { upsert: false, contentType: image.type });
        if (r.error) throw r.error;
        uploaded = path;
        imageUrl = db.storage.from("product-images").getPublicUrl(path)
          .data.publicUrl;
      }
      const values = {
        title,
        description: product.description,
        price: product.price,
        active: product.active,
        delivery_type: product.delivery_type,
        image_url: imageUrl,
        category_id: product.category_id || null,
        subcategory: product.subcategory || "",
        requires_customer_email: !!product.requires_customer_email,
        duration_days: product.duration_days ?? null,
      };
      const result = editing
        ? await db
            .from("products")
            .update(values)
            .eq("id", product.id)
            .select("id")
            .single()
        : await db
            .from("products")
            .insert({ id: crypto.randomUUID(), ...values })
            .select("id")
            .single();
      if (result.error) {
        if (uploaded)
          await db.storage.from("product-images").remove([uploaded]);
        throw result.error;
      }
      setImage(null);
      setProduct(emptyProduct());
      setEditing(false);
      await load();
    });
  }
  async function addStock(e: React.FormEvent) {
    e.preventDefault();
    await run(async () => {
      const lines = codes
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (!selected || !lines.length || lines.length > 200)
        throw Error(
          "เลือกสินค้าและใส่โค้ด 1–200 รายการ ครั้งละ 1 โค้ดต่อบรรทัด",
        );
      if (new Set(lines).size !== lines.length)
        throw Error("มีโค้ดซ้ำในข้อความที่กรอก");
      if (lines.some((s) => s.length > 16384))
        throw Error("โค้ดแต่ละรายการยาวเกินกำหนด");
      const r = await db
        .from("stock")
        .insert(lines.map((secret) => ({ product_id: selected, secret })));
      if (r.error) throw r.error;
      setCodes("");
      await refreshStock();
    });
  }
  async function saveStock(e: React.FormEvent) {
    e.preventDefault();
    if (!stockEdit) return;
    await run(async () => {
      const secret = stockEdit.secret.trim();
      if (!secret) throw Error("กรุณากรอกโค้ด");
      const r = await db
        .from("stock")
        .update({ secret })
        .eq("id", stockEdit.id)
        .is("order_id", null)
        .select("id")
        .single();
      if (r.error) throw Error("แก้ไขไม่สำเร็จ: รายการอาจขายแล้ว หรือโค้ดซ้ำ");
      setStockEdit(null);
      await refreshStock();
    });
  }
  async function deleteStock(item: Stock) {
    if (!confirm("ลบโค้ดที่ยังไม่ขายรายการนี้?")) return;
    await run(async () => {
      const r = await db
        .from("stock")
        .delete()
        .eq("id", item.id)
        .is("order_id", null)
        .select("id")
        .single();
      if (r.error) throw Error("ลบไม่สำเร็จ รายการอาจขายแล้ว");
      await refreshStock();
    });
  }
  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    await run(async () => {
      if (section === "bank") {
        const fields = [
          settings.bank_name,
          settings.bank_account_name,
          settings.bank_account_number,
        ];
        if (fields.some((v) => v.trim()) && fields.some((v) => !v.trim()))
          throw Error(
            "กรุณากรอกข้อมูลบัญชีธนาคารให้ครบทั้ง 3 ช่อง หรือล้างทั้งหมดเพื่อปิดแสดงบัญชี",
          );
        if (
          settings.bank_account_number &&
          !/^[0-9 -]{5,40}$/.test(settings.bank_account_number)
        )
          throw Error("เลขบัญชีต้องเป็นตัวเลข 5–40 ตัว รวมขีดหรือช่องว่างได้");
      }
      const r = await db
        .from("store_settings")
        .update(
          Object.fromEntries(
            Object.entries(settings).filter(([key]) =>
              section === "bank"
                ? key.startsWith("bank_")
                : !key.startsWith("bank_"),
            ),
          ),
        )
        .eq("id", true)
        .select("id")
        .single();
      if (r.error) throw r.error;
    });
  }
  return (
    <section className="panel admin-store">
      <h2>จัดการร้านค้า</h2>
      <nav className="tabs" aria-label="จัดการร้านค้า">
        {[
          ["products", "สินค้าและราคา"],
          ["stock", "สต็อกสินค้า"],
          ["orders", "คำสั่งซื้อลูกค้า"],
          ["manual", "จัดส่งเอง"],
          ["restock", "รอรีสต็อก"],
          ["customers", "ลูกค้าและเติมเงิน"],
          ["categories", "หมวดหมู่สินค้า"],
          ["settings", "ข้อความหน้าร้าน"],
          ["bank", "บัญชีธนาคาร"],
        ].map(([id, name]) => (
          <button
            key={id}
            disabled={busy}
            className={section === id ? "selected" : ""}
            onClick={() => {
              setSection(id);
              setMessage("");
            }}
          >
            {name}
          </button>
        ))}
      </nav>
      {message && (
        <div className="notice" role="status">
          {message}
        </div>
      )}
      {loading ? (
        <p>กำลังโหลดหลังบ้าน…</p>
      ) : (
        <fieldset disabled={busy} className="admin-fieldset">
          {(section === "orders" ||
            section === "restock" ||
            section === "manual") && (
            <AdminOrders
              key={section}
              db={db}
              onChanged={onChanged}
              mode={
                section === "restock"
                  ? "restock"
                  : section === "manual"
                    ? "manual"
                    : "orders"
              }
            />
          )}
          {section === "customers" && (
            <AdminCustomers db={db} onChanged={onChanged} />
          )}
          {section === "categories" && (
            <AdminCategories
              db={db}
              categories={categories}
              onChanged={async () => {
                await load();
                await onChanged();
              }}
            />
          )}
          {section === "products" && (
            <div className="admin-columns">
              <div>
                <h3>รายการสินค้า ({products.length})</h3>
                <button
                  className="outline"
                  onClick={() => {
                    setProduct(emptyProduct());
                    setEditing(false);
                    setImage(null);
                  }}
                >
                  + เพิ่มสินค้าใหม่
                </button>
                <label>
                  แสดงสินค้าในหมวด
                  <select
                    value={filterCategory}
                    onChange={(e) => setFilterCategory(e.target.value)}
                  >
                    <option value="all">ทุกหมวดหมู่</option>
                    <option value="uncategorized">ยังไม่จัดหมวด</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <p>
                  หนึ่งสินค้า = หนึ่งแพ็กเกจ เช่น Netflix 1 เดือน และ Netflix 3
                  เดือน มีราคาและสต็อกแยกกัน
                </p>
                {products
                  .filter(
                    (p) =>
                      filterCategory === "all" ||
                      (p.category_id || "uncategorized") === filterCategory,
                  )
                  .map((p) => (
                    <div className="admin-product" key={p.id}>
                      {p.image_url && <img src={p.image_url} alt="" />}
                      <div>
                        <strong>{p.title}</strong>
                        <small>
                          {categories.find((c) => c.id === p.category_id)
                            ?.name || "ยังไม่จัดหมวด"}{" "}
                          · ฿{p.price} · {p.active ? "เปิดขาย" : "ปิดขาย"}
                        </small>
                      </div>
                      <button
                        className="outline"
                        onClick={() => {
                          setProduct(p);
                          setEditing(true);
                          setImage(null);
                        }}
                      >
                        แก้ไข {p.title}
                      </button>
                      <button
                        className="outline"
                        onClick={() => {
                          setSelected(p.id);
                          setPage(0);
                          setSection("stock");
                        }}
                      >
                        จัดการสต็อก {p.title}
                      </button>
                    </div>
                  ))}
              </div>
              <form onSubmit={saveProduct}>
                <h3>{editing ? "แก้ไขสินค้า" : "เพิ่มสินค้าใหม่"}</h3>
                <label>
                  ชื่อสินค้า
                  <input
                    required
                    maxLength={200}
                    value={product.title}
                    onChange={(e) =>
                      setProduct({ ...product, title: e.target.value })
                    }
                  />
                </label>
                <label>
                  รายละเอียดสินค้า
                  <textarea
                    aria-label="รายละเอียดสินค้า"
                    maxLength={5000}
                    value={product.description}
                    onChange={(e) =>
                      setProduct({ ...product, description: e.target.value })
                    }
                  />
                </label>
                <label>
                  ราคา (บาท)
                  <input
                    type="number"
                    required
                    min="1"
                    max="2147483647"
                    step="1"
                    value={product.price}
                    onChange={(e) =>
                      setProduct({ ...product, price: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  ระยะเวลาใช้งาน (วัน)
                  <input
                    type="number"
                    min={1}
                    max={3650}
                    step={1}
                    value={product.duration_days ?? ""}
                    onChange={(e) =>
                      setProduct({
                        ...product,
                        duration_days:
                          e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                </label>
                <div className="actions">
                  {[1, 7, 30].map((d) => (
                    <button
                      type="button"
                      className="outline"
                      key={d}
                      onClick={() =>
                        setProduct({ ...product, duration_days: d })
                      }
                    >
                      {d} วัน
                    </button>
                  ))}
                  <button
                    type="button"
                    className="outline"
                    onClick={() =>
                      setProduct({ ...product, duration_days: null })
                    }
                  >
                    ไม่กำหนดระยะเวลา
                  </button>
                </div>
                <p>
                  1 วัน = 24 ชั่วโมง เริ่มนับจากเวลาที่ซื้อ
                  การแก้ระยะเวลามีผลกับคำสั่งซื้อใหม่เท่านั้น
                </p>
                <label>
                  หมวดสินค้า
                  <select
                    aria-label="หมวดสินค้า"
                    value={product.category_id || ""}
                    onChange={(e) =>
                      setProduct({
                        ...product,
                        category_id: e.target.value || null,
                      })
                    }
                  >
                    <option value="">ยังไม่จัดหมวด</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  หมวดย่อย ChatGPT
                  <select
                    aria-label="หมวดย่อย ChatGPT"
                    value={product.subcategory || ""}
                    onChange={(e) =>
                      setProduct({ ...product, subcategory: e.target.value })
                    }
                  >
                    <option value="">ไม่แบ่งหมวดย่อย</option>
                    <option value="share4">หาร 4</option>
                    <option value="share3">หาร 3</option>
                    <option value="private">ส่วนตัว</option>
                  </select>
                </label>
                <p>
                  สินค้าที่เลือกหมวดย่อยจะแสดงให้ลูกค้ากดเลือกประเภทก่อนเลือกแพ็กเกจ
                </p>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={!!product.requires_customer_email}
                    onChange={(e) =>
                      setProduct({
                        ...product,
                        requires_customer_email: e.target.checked,
                      })
                    }
                  />
                  ให้ลูกค้ากรอกอีเมลตอนซื้อสินค้านี้
                </label>
                <label>
                  วิธีส่งสินค้า
                  <select
                    value={product.delivery_type}
                    onChange={(e) =>
                      setProduct({ ...product, delivery_type: e.target.value })
                    }
                  >
                    <option value="manual">ส่งสินค้าเอง</option>
                    <option value="code">ส่งโค้ด/อีเมลจากสต็อกอัตโนมัติ</option>
                  </select>
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={product.active}
                    onChange={(e) =>
                      setProduct({ ...product, active: e.target.checked })
                    }
                  />{" "}
                  เปิดขายสินค้า
                </label>
                <label>
                  ลิงก์รูปสินค้า (https://)
                  <input
                    type="url"
                    maxLength={2048}
                    value={product.image_url}
                    onChange={(e) =>
                      setProduct({ ...product, image_url: e.target.value })
                    }
                  />
                </label>
                {product.image_url && (
                  <img
                    className="admin-preview"
                    src={product.image_url}
                    alt="รูปสินค้าปัจจุบัน"
                  />
                )}
                <label>
                  อัปโหลดรูปสินค้าใหม่ (ไม่เกิน 5 MB)
                  <input
                    key={
                      product.id +
                      "-" +
                      editing +
                      "-" +
                      (image ? "selected" : "empty")
                    }
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => setImage(e.target.files?.[0] || null)}
                  />
                </label>
                {image && <p>รูปใหม่: {image.name}</p>}
                <button type="submit">
                  {busy ? "กำลังบันทึก…" : "บันทึกสินค้า"}
                </button>
              </form>
            </div>
          )}
          {section === "stock" && (
            <>
              <label>
                เลือกสินค้า
                <select
                  value={selected}
                  onChange={(e) => {
                    setSelected(e.target.value);
                    setPage(0);
                  }}
                >
                  <option value="">เลือกสินค้า</option>
                  {[
                    ...categories,
                    { id: "uncategorized", name: "ยังไม่จัดหมวด" },
                  ].map((c) => (
                    <optgroup key={c.id} label={c.name}>
                      {products
                        .filter(
                          (p) => (p.category_id || "uncategorized") === c.id,
                        )
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.title}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              {selected && (
                <>
                  <p>
                    คงเหลือ <b>{counts.available}</b> โค้ดเดิม · ขายแล้ว{" "}
                    <b>{counts.sold}</b> รายการ
                  </p>
                  <p>
                    ใช้โค้ดจากสต็อกอัตโนมัติเมื่อสินค้าตั้งวิธีส่งเป็น
                    “ส่งโค้ด/อีเมลจากสต็อกอัตโนมัติ”
                  </p>
                  <EmailStock
                    key={selected}
                    db={db}
                    productId={selected}
                    onChanged={onChanged}
                  />
                  <h3>สต็อกโค้ดแบบเดิม (1 โค้ดต่อการซื้อ)</h3>
                  <form onSubmit={addStock}>
                    <label>
                      เติมสต็อก (1 โค้ดต่อบรรทัด สูงสุด 200 รายการ)
                      <textarea
                        aria-label="เติมสต็อก (1 โค้ดต่อบรรทัด สูงสุด 200 รายการ)"
                        required
                        value={codes}
                        onChange={(e) => setCodes(e.target.value)}
                        rows={5}
                      />
                    </label>
                    <button>เติมสต็อก</button>
                  </form>
                  {stockEdit && (
                    <form onSubmit={saveStock}>
                      <label>
                        แก้ไขโค้ด
                        <textarea
                          aria-label="แก้ไขโค้ด"
                          required
                          maxLength={16384}
                          value={stockEdit.secret}
                          onChange={(e) =>
                            setStockEdit({
                              ...stockEdit,
                              secret: e.target.value,
                            })
                          }
                        />
                      </label>
                      <div className="actions">
                        <button>บันทึกโค้ด</button>
                        <button
                          type="button"
                          className="outline"
                          onClick={() => setStockEdit(null)}
                        >
                          ยกเลิก
                        </button>
                      </div>
                    </form>
                  )}
                  <h3>สต็อก · หน้า {page + 1}</h3>
                  {stock.length === 0 && <p>ไม่มีสต็อกในหน้านี้</p>}
                  {stock.map((item) => (
                    <div className="order" key={item.id}>
                      <code className="secret">{item.secret}</code>
                      <span>
                        {item.order_id ? "ขายแล้ว (เก็บประวัติ)" : "พร้อมขาย"}
                      </span>
                      {!item.order_id && (
                        <div className="actions">
                          <button
                            className="outline"
                            onClick={() => setStockEdit(item)}
                          >
                            แก้ไขโค้ด
                          </button>
                          <button
                            className="outline"
                            onClick={() => deleteStock(item)}
                          >
                            ลบโค้ด
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  <div className="actions">
                    <button
                      className="outline"
                      disabled={page === 0}
                      onClick={() => setPage(page - 1)}
                    >
                      หน้าก่อน
                    </button>
                    <button
                      className="outline"
                      disabled={
                        (page + 1) * 50 >= counts.available + counts.sold
                      }
                      onClick={() => setPage(page + 1)}
                    >
                      หน้าถัดไป
                    </button>
                  </div>
                </>
              )}
            </>
          )}
          {section === "bank" && <SlipOKQuota db={db} />}
          {(section === "settings" || section === "bank") && (
            <form onSubmit={saveSettings}>
              {section === "bank" && (
                <p>
                  ข้อมูลนี้จะแสดงให้ลูกค้าเห็นในหน้าเติมเงิน
                  ตรวจสอบชื่อและเลขบัญชีให้ถูกต้องก่อนบันทึก
                  หากต้องการปิดแสดงบัญชี ให้ล้างข้อมูลทั้ง 3 ช่องแล้วบันทึก
                </p>
              )}
              {(Object.keys(labels) as (keyof StoreSettings)[])
                .filter((key) =>
                  section === "bank"
                    ? key.startsWith("bank_")
                    : !key.startsWith("bank_"),
                )
                .map((key) => (
                  <label key={key}>
                    {labels[key]}
                    <textarea
                      aria-label={labels[key]}
                      required={key === "brand_name" || key === "hero_title"}
                      maxLength={
                        key === "bank_name"
                          ? 100
                          : key === "bank_account_name"
                            ? 120
                            : key === "bank_account_number"
                              ? 40
                              : key === "brand_name"
                                ? 80
                                : key === "hero_title"
                                  ? 200
                                  : key === "announcement" ||
                                      key === "contact_text"
                                    ? 1000
                                    : 2000
                      }
                      placeholder={
                        key === "bank_topup_note"
                          ? "ข้อความที่ให้ลูกค้าเห็นในหน้าเติมเงิน เว้นว่างเพื่อใช้คำแนะนำเดิม"
                          : undefined
                      }
                      value={settings[key]}
                      onChange={(e) =>
                        setSettings({ ...settings, [key]: e.target.value })
                      }
                    />
                  </label>
                ))}
              <button>
                {section === "bank"
                  ? "บันทึกบัญชีธนาคาร"
                  : "บันทึกข้อความหน้าร้าน"}
              </button>
            </form>
          )}
        </fieldset>
      )}
    </section>
  );
}
