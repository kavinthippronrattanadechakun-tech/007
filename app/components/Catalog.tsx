"use client";
import { useEffect, useState } from "react";
import type { Product, Category } from "../../lib/store";
export default function Catalog({
  products,
  categories,
  user,
  busy,
  onBuy,
  email,
  onEmail,
}: {
  products: Product[];
  categories: Category[];
  user: boolean;
  busy: boolean;
  onBuy: (p: Product) => void;
  email: string;
  onEmail: (v: string) => void;
}) {
  const [path, setPath] = useState<string[]>([]),
    [stock, setStock] = useState<Record<string, number>>({});
  useEffect(() => {
    const sync = () => {
      const parts = window.location.hash.slice(1).split("/");
      setPath(
        parts[0] === "catalog" ? parts.slice(1).map(decodeURIComponent) : [],
      );
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  useEffect(() => {
    let live = true;
    fetch("/api/catalog")
      .then((r) => (r.ok ? r.json() : null))
      .then((r) => {
        if (live && r?.stock)
          setStock(
            Object.fromEntries(
              r.stock.map((s: { product_id: string; available: number }) => [
                s.product_id,
                Number(s.available),
              ]),
            ),
          );
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [products]);
  const groups = [
    ...categories,
    ...(products.some((p) => !p.category_id)
      ? [
          {
            id: "uncategorized",
            name: "สินค้าอื่น ๆ",
            sort_order: 100001,
            description: "แพ็กเกจเพิ่มเติมจากร้าน",
            image_url: "",
          },
        ]
      : []),
  ];
  const selected = groups.find((c) => c.id === path[0]),
    product = products.find(
      (p) =>
        p.id === path[1] && (p.category_id || "uncategorized") === selected?.id,
    );
  const items = selected
    ? products.filter((p) => (p.category_id || "uncategorized") === selected.id)
    : [];
  const link = (c: string, p?: string) =>
    "#catalog/" +
    encodeURIComponent(c) +
    (p ? "/" + encodeURIComponent(p) : "");
  function availability(p: Product) {
    return !p.active
      ? "ยังไม่เปิดขาย"
      : p.delivery_type !== "code"
        ? "จัดส่งโดยร้าน"
        : stock[p.id] === undefined
          ? "กำลังตรวจจำนวนคงเหลือ"
          : `คงเหลือ ${stock[p.id]} สิทธิ์`;
  }
  return (
    <section className="catalog">
      <nav className="catalog-breadcrumb" aria-label="เส้นทางสินค้า">
        <a href="#catalog">หมวดหมู่สินค้า</a>
        {selected && (
          <>
            <span>/</span>
            <a href={link(selected.id)}>{selected.name}</a>
          </>
        )}
        {product && (
          <>
            <span>/</span>
            <span>{product.title}</span>
          </>
        )}
      </nav>
      {!selected ? (
        <>
          <div className="section-title">
            <h2>เลือกแอปที่ต้องการ</h2>
            <p>เลือกหมวดหมู่ เพื่อดูแพ็กเกจ ราคา และรายละเอียดสินค้า</p>
          </div>
          <div className="grid category-grid">
            {groups.map((c) => {
              const ps = products.filter(
                (p) => (p.category_id || "uncategorized") === c.id,
              );
              const image =
                c.image_url || ps.find((p) => p.image_url)?.image_url;
              return (
                <a className="panel category-card" key={c.id} href={link(c.id)}>
                  {image ? (
                    <img className="category-image" src={image} alt="" />
                  ) : (
                    <span className="category-symbol">
                      {c.name.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  <div>
                    <h3>{c.name}</h3>
                    <p>
                      {c.description || `เลือกแพ็กเกจ ${c.name} ที่เหมาะกับคุณ`}
                    </p>
                    <small>
                      {ps.length} แพ็กเกจ
                      {ps.length > 0 &&
                        ` · เริ่มต้น ฿${Math.min(...ps.map((p) => p.price))}`}
                    </small>
                  </div>
                  <span className="catalog-cta">ดูแพ็กเกจ →</span>
                </a>
              );
            })}
          </div>
          {groups.length === 0 && (
            <p>ร้านกำลังเตรียมสินค้า กรุณากลับมาอีกครั้ง</p>
          )}
        </>
      ) : product ? (
        <>
          <a className="catalog-back" href={link(selected.id)}>
            ← กลับไปเลือกแพ็กเกจ {selected.name}
          </a>
          <article className="panel product-detail">
            {product.image_url && (
              <img
                className="detail-image"
                src={product.image_url}
                alt={product.title}
              />
            )}
            <div>
              <span className="status">{availability(product)}</span>
              <h2>{product.title}</h2>
              <p className="product-description">
                {product.description ||
                  "ติดต่อร้านเพื่อสอบถามรายละเอียดเพิ่มเติม"}
              </p>
              <p>
                {product.delivery_type === "code"
                  ? "ส่งข้อมูลสินค้าอัตโนมัติหลังซื้อสำเร็จ"
                  : "ร้านดำเนินการส่งสินค้าให้หลังซื้อสำเร็จ"}
              </p>
              <strong className="detail-price">฿{product.price}</strong>
              {user && (
                <label className="email-label">
                  อีเมลลูกค้าสำหรับรายการที่ต้องใช้เมล
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => onEmail(e.target.value)}
                    placeholder="customer@gmail.com"
                  />
                </label>
              )}
              <div className="actions">
                <button
                  disabled={
                    !user ||
                    busy ||
                    !product.active ||
                    (product.delivery_type === "code" &&
                      stock[product.id] === 0)
                  }
                  onClick={() => onBuy(product)}
                >
                  {!product.active
                    ? "ยังไม่เปิดขาย"
                    : product.delivery_type === "code" &&
                        stock[product.id] === 0
                      ? "สินค้าหมด"
                      : "ซื้อแพ็กเกจนี้"}
                </button>
              </div>
              {!user && <p>กรุณาเข้าสู่ระบบก่อนสั่งซื้อ</p>}
            </div>
          </article>
        </>
      ) : (
        <>
          <a className="catalog-back" href="#catalog">
            ← หมวดหมู่ทั้งหมด
          </a>
          <div className="section-title">
            <h2>{selected.name}</h2>
            <p className="product-description">
              {selected.description ||
                "เลือกแพ็กเกจเพื่อดูรายละเอียดและสั่งซื้อ"}
            </p>
          </div>
          <div className="grid">
            {items.map((p) => (
              <article className="panel product" key={p.id}>
                {p.image_url && (
                  <img
                    className="product-image"
                    src={p.image_url}
                    alt={p.title}
                    loading="lazy"
                  />
                )}
                <span className="status">{availability(p)}</span>
                <h3>{p.title}</h3>
                <p className="product-summary">{p.description}</p>
                <div className="product-bottom">
                  <strong>฿{p.price}</strong>
                  <a className="catalog-cta" href={link(selected.id, p.id)}>
                    ดูรายละเอียด
                  </a>
                </div>
              </article>
            ))}
          </div>
          {items.length === 0 && <p>ยังไม่มีสินค้าในหมวดนี้</p>}
        </>
      )}
    </section>
  );
}
