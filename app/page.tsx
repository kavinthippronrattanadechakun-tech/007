"use client";
import { useEffect, useState } from "react";
import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import { supabaseUrl, authErrorMessage } from "../lib/supabase-config";
import AdminStore from "./components/AdminStore";
import {
  defaultSettings,
  type StoreSettings,
  type Product,
  type Category,
} from "../lib/store";
import {
  Wallet,
  ShieldCheck,
  ShoppingBag,
  LogOut,
  Upload,
  Settings,
  RefreshCw,
} from "lucide-react";
type Topup = { id: string; amount: number; status: string; created_at: string };
type Order = {
  id: string;
  product_id: string;
  price: number;
  status: string;
  delivery: string | null;
  created_at: string;
};
type Pending = {
  id: string;
  amount: number;
  user_id: string;
  slip_url: string | null;
  created_at: string;
};
let client: SupabaseClient | null = null;
function db() {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
      key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return null;
    try {
      client = createClient(supabaseUrl(url), key.trim());
    } catch {
      return null;
    }
  }
  return client;
}
export default function Home() {
  const [user, setUser] = useState<User | null>(null),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [msg, setMsg] = useState(""),
    [balance, setBalance] = useState(0),
    [isAdmin, setAdmin] = useState(false),
    [products, setProducts] = useState<Product[]>([]),
    [topups, setTopups] = useState<Topup[]>([]),
    [orders, setOrders] = useState<Order[]>([]),
    [pending, setPending] = useState<Pending[]>([]),
    [amount, setAmount] = useState(""),
    [slip, setSlip] = useState<File | null>(null),
    [customerEmail, setCustomerEmail] = useState(""),
    [busy, setBusy] = useState(false),
    [bank, setBank] = useState({ bank: "", name: "", number: "" }),
    [tab, setTab] = useState("shop");
  const [categories, setCategories] = useState<Category[]>([]),
    [category, setCategory] = useState("all");
  async function loadCategories() {
    const s = db();
    if (!s) return;
    const { data } = await s
      .from("product_categories")
      .select("*")
      .order("sort_order")
      .order("name");
    if (data) setCategories(data);
  }
  const [settings, setSettings] = useState<StoreSettings>(defaultSettings);
  async function loadSettings() {
    const s = db();
    if (!s) return;
    const { data } = await s
      .from("store_settings")
      .select("*")
      .eq("id", true)
      .single();
    if (data) {
      const { id, ...values } = data;
      setSettings({ ...defaultSettings, ...values });
      setBank({
        bank: values.bank_name || "",
        name: values.bank_account_name || "",
        number: values.bank_account_number || "",
      });
    }
  }
  const ready = !!db();
  async function load(u: User) {
    const s = db();
    if (!s) return;
    const [{ data: p }, { data: t }, { data: o }, { data: profile }] =
      await Promise.all([
        s.from("products").select("*").order("price"),
        s
          .from("topups")
          .select("id,amount,status,created_at")
          .order("created_at", { ascending: false }),
        s
          .from("orders")
          .select("id,product_id,price,status,delivery,created_at")
          .order("created_at", { ascending: false }),
        s.from("profiles").select("balance,is_admin").eq("id", u.id).single(),
      ]);
    setProducts(p || []);
    setTopups(t || []);
    setOrders(o || []);
    setBalance(profile?.balance || 0);
    setAdmin(profile?.is_admin || false);
  }
  useEffect(() => {
    loadSettings();
    loadCategories();
    const s = db();
    if (!s) return;
    s.auth.getUser().then(({ data }) => {
      setUser(data.user);
      if (data.user) load(data.user);
      else
        s.from("products")
          .select("*")
          .order("price")
          .then(({ data }) => setProducts(data || []));
    });
    const { data: sub } = s.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
      if (session?.user) setTimeout(() => load(session.user), 0);
    });
    return () => sub.subscription.unsubscribe();
  }, []);
  async function auth(mode: "signup" | "signin") {
    const s = db();
    if (!s) {
      setMsg("ระบบเข้าสู่ระบบยังไม่พร้อมใช้งาน กรุณาติดต่อร้านค้า");
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      const credentials = { email: email.trim(), password };
      const result =
        mode === "signup"
          ? await s.auth.signUp(credentials)
          : await s.auth.signInWithPassword(credentials);
      setMsg(
        result.error
          ? authErrorMessage(result.error.message)
          : mode === "signup"
            ? "สมัครสำเร็จ โปรดตรวจอีเมลเพื่อยืนยันบัญชี (ถ้าเปิดใช้งาน)"
            : "เข้าสู่ระบบสำเร็จ",
      );
    } catch {
      setMsg("เชื่อมต่อระบบไม่ได้ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setBusy(false);
    }
  }
  async function api(path: string, body: FormData | object, method = "POST") {
    const s = db();
    if (!s) throw Error("ยังไม่ได้ตั้งค่า Supabase");
    const { data } = await s.auth.getSession();
    if (!data.session) throw Error("กรุณาเข้าสู่ระบบ");
    const res = await fetch(path, {
      method,
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        ...(body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
      },
      ...(method === "GET"
        ? {}
        : { body: body instanceof FormData ? body : JSON.stringify(body) }),
    });
    const json = await res.json();
    if (!res.ok) throw Error(json.error || "เกิดข้อผิดพลาด");
    return json;
  }
  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!slip) return setMsg("กรุณาเลือกสลิป");
    setBusy(true);
    try {
      const f = new FormData();
      f.append("amount", amount);
      f.append("slip", slip);
      const result = await api("/api/topup", f);
      setMsg(result.message);
      setSlip(null);
      setAmount("");
      if (user) await load(user);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function buy(p: Product) {
    if (!confirm(`ยืนยันซื้อ ${p.title} ราคา ฿${p.price}?`)) return;
    setBusy(true);
    try {
      const r = await api("/api/orders", {
        productId: p.id,
        email: customerEmail,
      });
      setMsg(
        r.data.status === "delivered"
          ? "ซื้อสำเร็จ! ดูรหัสในประวัติคำสั่งซื้อ"
          : "สั่งซื้อสำเร็จ รอร้านดำเนินการ",
      );
      setTab("orders");
      if (user) await load(user);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function loadPending() {
    try {
      const r = await api("/api/admin", {}, "GET");
      setPending(r.rows);
    } catch (e) {
      setMsg((e as Error).message);
    }
  }
  async function review(t: Pending, approve: boolean) {
    const reference = approve
      ? prompt(
          "เลขอ้างอิงธุรกรรมจากธนาคาร (ตรวจยอด ผู้รับ และรายการซ้ำกับข้อมูลธนาคารก่อนอนุมัติ)",
        )
      : null;
    if (approve && !reference) return;
    setBusy(true);
    try {
      await api("/api/admin", {
        topupId: t.id,
        decision: approve ? "approve" : "reject",
        reference,
      });
      setMsg("บันทึกผลตรวจสอบแล้ว");
      await loadPending();
      if (user) await load(user);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main>
      <header className="header">
        <div className="wrap nav">
          <a href="/" className="brand">
            {settings.brand_name}
          </a>
          <span className="tag">ร้านบริการดิจิทัล</span>
          <div className="grow" />
          {user && (
            <button
              className="ghost"
              onClick={() => {
                db()?.auth.signOut();
                setUser(null);
                setBalance(0);
              }}
            >
              <LogOut size={16} /> ออกจากระบบ
            </button>
          )}
        </div>
      </header>
      <section className="hero">
        <div className="wrap">
          <div className="kicker">DIGITAL MEMBERSHIP STORE</div>
          <h1>{settings.hero_title}</h1>
          <p>{settings.hero_description}</p>
          <div className="hero-note">
            <ShieldCheck size={18} /> {settings.announcement}
          </div>
        </div>
      </section>
      <div className="wrap main">
        {!ready && (
          <div className="notice">
            ระบบเข้าสู่ระบบยังไม่พร้อมใช้งาน กรุณาติดต่อร้านค้า
          </div>
        )}
        {msg && (
          <div className="notice" role="status">
            {msg}
            <button onClick={() => setMsg("")}>×</button>
          </div>
        )}
        {!user && (
          <section className="panel auth">
            <h2>สมัครสมาชิก / เข้าสู่ระบบ</h2>
            <p>สร้างบัญชีเพื่อเติมเงินและติดตามสินค้า</p>
            <label>
              อีเมล
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </label>
            <label>
              รหัสผ่าน
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="อย่างน้อย 6 ตัวอักษร"
              />
            </label>
            <div className="actions">
              <button disabled={!ready || busy} onClick={() => auth("signin")}>
                เข้าสู่ระบบ
              </button>
              <button
                className="outline"
                disabled={!ready || busy}
                onClick={() => auth("signup")}
              >
                สมัครสมาชิก
              </button>
            </div>
          </section>
        )}
        {user && (
          <>
            <div className="wallet">
              <div>
                <div className="muted">ยอดเงินในกระเป๋า</div>
                <strong>฿{balance.toLocaleString("th-TH")}</strong>
                <small>{user.email}</small>
              </div>
              <Wallet size={42} />
            </div>
            <nav className="tabs">
              {[
                ["shop", "สินค้า"],
                ["topup", "เติมเงิน"],
                ["orders", "คำสั่งซื้อ"],
                ...(isAdmin ? [["admin", "หลังบ้าน"]] : []),
              ].map(([id, label]) => (
                <button
                  key={id}
                  className={tab === id ? "selected" : ""}
                  onClick={() => {
                    setTab(id);
                    if (id === "admin") loadPending();
                  }}
                >
                  {label}
                </button>
              ))}
            </nav>
          </>
        )}
        {(!user || tab === "shop") && (
          <section>
            <div className="section-title">
              <h2>
                <ShoppingBag size={22} /> สินค้าและแพ็กเกจ
              </h2>
              <p>แพ็กเกจจะเปิดขายหลังตรวจสอบสิทธิ์การจำหน่ายและตั้งค่าสต็อก</p>
            </div>
            <nav className="tabs category-tabs" aria-label="หมวดสินค้า">
              <button
                className={category === "all" ? "selected" : ""}
                onClick={() => setCategory("all")}
              >
                ทั้งหมด
              </button>
              {categories.map((c) => (
                <button
                  key={c.id}
                  className={category === c.id ? "selected" : ""}
                  onClick={() => setCategory(c.id)}
                >
                  {c.name}
                </button>
              ))}
            </nav>
            {category !== "all" &&
              !products.some((p) => p.category_id === category) && (
                <p>ยังไม่มีสินค้าในหมวดนี้</p>
              )}
            <div className="grid">
              {products
                .filter((p) => category === "all" || p.category_id === category)
                .map((p) => (
                  <article className="panel product" key={p.id}>
                    {p.image_url && (
                      <img
                        className="product-image"
                        src={p.image_url}
                        alt={p.title}
                        loading="lazy"
                      />
                    )}
                    <div className="product-top">
                      <span className="product-symbol">
                        {p.title.includes("Netflix")
                          ? "N"
                          : p.title.includes("Gemini")
                            ? "✦"
                            : "✳"}
                      </span>
                      <span className="status">
                        {p.active ? "พร้อมสั่งซื้อ" : "ยังไม่เปิดขาย"}
                      </span>
                    </div>
                    <h3>{p.title}</h3>
                    <p>{p.description}</p>
                    <div className="product-bottom">
                      <strong>฿{p.price}</strong>
                      <button
                        disabled={!user || !p.active || busy}
                        onClick={() => buy(p)}
                      >
                        {p.active ? "ซื้อเลย" : "ยังไม่เปิดขาย"}
                      </button>
                    </div>
                  </article>
                ))}
            </div>
            {user && (
              <label className="email-label">
                อีเมลลูกค้าสำหรับรายการที่ต้องใช้เมล
                <input
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  placeholder="customer@gmail.com"
                />
              </label>
            )}
          </section>
        )}
        {user && tab === "topup" && (
          <section className="panel">
            <h2>
              <Upload size={22} /> เติมเงินผ่านธนาคาร
            </h2>
            <p>
              โอนเงินตามข้อมูลบัญชีที่ร้านประกาศ แล้วอัปโหลดสลิป
              รอผู้ดูแลตรวจสอบธุรกรรมจริงก่อนเพิ่มยอดเงิน
            </p>
            <div className="bank">
              {bank.bank && bank.name && bank.number
                ? `${bank.bank} · ${bank.name} · ${bank.number}`
                : "ยังไม่ได้ตั้งค่าบัญชีธนาคาร ห้ามโอนเงินจนกว่าร้านจะประกาศข้อมูลครบ"}
            </div>
            <form onSubmit={upload}>
              <label>
                จำนวนเงินที่โอน (บาท)
                <input
                  type="number"
                  min="1"
                  max="100000"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              <label>
                รูปสลิป (JPG, PNG, WEBP ไม่เกิน 5 MB)
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  required
                  onChange={(e) => setSlip(e.target.files?.[0] || null)}
                />
              </label>
              <button disabled={busy || !ready}>ส่งสลิปเพื่อรอตรวจสอบ</button>
            </form>
            <h3>ประวัติเติมเงิน</h3>
            {topups.map((t) => (
              <div className="history" key={t.id}>
                ฿{t.amount}{" "}
                <span>
                  {t.status === "pending"
                    ? "รอตรวจ"
                    : t.status === "approved"
                      ? "อนุมัติแล้ว"
                      : "ไม่ผ่าน"}
                </span>
              </div>
            ))}
          </section>
        )}
        {user && tab === "orders" && (
          <section className="panel">
            <h2>ประวัติคำสั่งซื้อ</h2>
            {orders.length === 0 && <p>ยังไม่มีคำสั่งซื้อ</p>}
            {orders.map((o) => (
              <div className="order" key={o.id}>
                <b>
                  {products.find((p) => p.id === o.product_id)?.title ||
                    o.product_id}
                </b>
                <span>
                  ฿{o.price} ·{" "}
                  {o.status === "delivered" ? "ส่งสินค้าแล้ว" : "รอดำเนินการ"}
                </span>
                {o.delivery && (
                  <div className="secret">
                    ข้อมูลสินค้าที่ได้รับ: {o.delivery}
                  </div>
                )}
              </div>
            ))}
          </section>
        )}
        {user && isAdmin && tab === "admin" && (
          <AdminStore
            db={db()!}
            onChanged={async () => {
              await Promise.all([load(user), loadSettings(), loadCategories()]);
            }}
          />
        )}
        {user && isAdmin && tab === "admin" && (
          <section className="panel">
            <h2>
              <Settings size={22} /> หลังบ้าน · ตรวจสลิป
            </h2>
            <p>
              ต้องตรวจยอด ผู้รับ เวลา
              และเลขอ้างอิงจากข้อมูลธนาคารจริงก่อนอนุมัติ
              ภาพสลิปอย่างเดียวไม่รับประกันว่าเป็นของจริง
            </p>
            <button className="outline" onClick={loadPending}>
              <RefreshCw size={15} /> รีเฟรชรายการ
            </button>
            {pending.length === 0 && (
              <p>ไม่มีรายการรอตรวจ หรือกดรีเฟรชเพื่อโหลดรายการ</p>
            )}
            {pending.map((t) => (
              <div className="order" key={t.id}>
                <b>ยอด ฿{t.amount}</b>
                <small>ผู้ใช้: {t.user_id}</small>
                {t.slip_url && (
                  <a href={t.slip_url} target="_blank" rel="noreferrer">
                    ดูสลิป (ลิงก์ชั่วคราว)
                  </a>
                )}
                <div className="actions">
                  <button disabled={busy} onClick={() => review(t, true)}>
                    อนุมัติหลังตรวจธนาคาร
                  </button>
                  <button
                    className="outline"
                    disabled={busy}
                    onClick={() => review(t, false)}
                  >
                    ปฏิเสธ
                  </button>
                </div>
              </div>
            ))}
          </section>
        )}
      </div>
      <footer>
        {settings.contact_text && <p>{settings.contact_text}</p>}
        {settings.footer_text}
      </footer>
    </main>
  );
}
