"use client";
import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Category } from "../../lib/store";
export default function AdminCategories({
  db,
  categories,
  onChanged,
}: {
  db: SupabaseClient;
  categories: Category[];
  onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState(""),
    [sort, setSort] = useState(0),
    [description, setDescription] = useState(""),
    [imageUrl, setImageUrl] = useState(""),
    [image, setImage] = useState<File | null>(null),
    [id, setId] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (!name.trim() || !Number.isInteger(sort) || sort < 0 || sort > 100000)
        throw Error("กรอกชื่อหมวดและลำดับให้ถูกต้อง");
      let url = imageUrl.trim();
      if (url && !/^https:\/\//i.test(url))
        throw Error("ลิงก์รูปต้องขึ้นต้นด้วย https://");
      if (image) {
        if (
          !["image/jpeg", "image/png", "image/webp"].includes(image.type) ||
          image.size < 1 ||
          image.size > 5000000
        )
          throw Error("เลือกรูป JPG, PNG หรือ WEBP ไม่เกิน 5 MB");
        const path = crypto.randomUUID() + "." + image.type.split("/")[1];
        const uploaded = await db.storage
          .from("product-images")
          .upload(path, image, { contentType: image.type, upsert: false });
        if (uploaded.error) throw uploaded.error;
        url = db.storage.from("product-images").getPublicUrl(path)
          .data.publicUrl;
      }
      const values = {
        name: name.trim(),
        sort_order: sort,
        description,
        image_url: url,
      };
      const r = id
        ? await db
            .from("product_categories")
            .update(values)
            .eq("id", id)
            .select("id")
            .single()
        : await db
            .from("product_categories")
            .insert(values)
            .select("id")
            .single();
      if (r.error) throw r.error;
      await onChanged();
      setName("");
      setDescription("");
      setImageUrl("");
      setImage(null);
      setSort(0);
      setId(null);
      setMessage("บันทึกหมวดหมู่เรียบร้อยแล้ว");
    } catch (e) {
      const error = e as { code?: string; message: string };
      setMessage(
        error.code === "23505"
          ? "มีชื่อหมวดนี้แล้ว"
          : error.message || "บันทึกไม่สำเร็จ",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h3>หมวดหมู่สินค้า</h3>
      <p>
        สร้างการ์ดแอปหน้าร้าน เช่น Netflix แล้วเพิ่มแพ็กเกจแต่ละระยะเวลาใน
        “สินค้าและราคา” โดยเลือกหมวดนี้
      </p>
      {message && (
        <div className="notice" role="status">
          {message}
        </div>
      )}
      <fieldset disabled={busy} className="admin-fieldset">
        <form onSubmit={save}>
          <label>
            ชื่อหมวดหมู่
            <input
              required
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="เช่น Netflix, ChatGPT, Gemini"
            />
          </label>
          <label>
            คำอธิบายหมวดหมู่
            <textarea
              maxLength={5000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label>
            ลิงก์รูปหมวดหมู่ (https://)
            <input
              type="url"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
            />
          </label>
          {imageUrl && (
            <img
              className="admin-preview"
              src={imageUrl}
              alt="รูปหมวดหมู่ปัจจุบัน"
            />
          )}
          <label>
            อัปโหลดรูปหมวดหมู่ (ไม่เกิน 5 MB)
            <input
              key={id || "new"}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => setImage(e.target.files?.[0] || null)}
            />
          </label>
          <label>
            ลำดับหมวดหมู่
            <input
              type="number"
              min={0}
              max={100000}
              step={1}
              required
              value={sort}
              onChange={(e) => setSort(Number(e.target.value))}
            />
          </label>
          <div className="actions">
            <button>{id ? "บันทึกหมวดหมู่" : "เพิ่มหมวดหมู่"}</button>
            {id && (
              <button
                type="button"
                className="outline"
                onClick={() => {
                  setId(null);
                  setName("");
                  setDescription("");
                  setImageUrl("");
                  setImage(null);
                  setSort(0);
                }}
              >
                ยกเลิกแก้ไขหมวด
              </button>
            )}
          </div>
        </form>
        {categories.map((c) => (
          <div className="admin-product" key={c.id}>
            <div>
              <strong>{c.name}</strong>
              <small>ลำดับ {c.sort_order}</small>
            </div>
            <button
              className="outline"
              onClick={() => {
                setId(c.id);
                setName(c.name);
                setDescription(c.description || "");
                setImageUrl(c.image_url || "");
                setImage(null);
                setSort(c.sort_order);
              }}
            >
              แก้หมวด {c.name}
            </button>
          </div>
        ))}
      </fieldset>
    </section>
  );
}
