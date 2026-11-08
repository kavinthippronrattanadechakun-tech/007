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
      const values = { name: name.trim(), sort_order: sort };
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
