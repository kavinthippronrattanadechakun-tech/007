"use client";
import { useEffect, useState, useRef } from "react";
import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import { supabaseUrl, authErrorMessage } from "../lib/supabase-config";
import type { PublicStoreSnapshot } from "../lib/public-store";
import useEmailCooldown from "./components/useEmailCooldown";
import AdminStore from "./components/AdminStore";
import Catalog from "./components/Catalog";
import OrderDetails from "./components/OrderDetails";
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
  duration_days: number | null;
  expires_at: string | null;
};
type Pending = {
  id: string;
  amount: number;
  user_id: string;
  slip_url: string | null;
  created_at: string;
};
function within<T>(operation: PromiseLike<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("การเชื่อมต่อใช้เวลานาน")),
      12000,
    );
    Promise.resolve(operation).then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
let client: SupabaseClient | null = null;
function db() {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
      key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return null;
    try {
      client = createClient(supabaseUrl(url), key.trim(), {
        auth: { detectSessionInUrl: false },
      });
    } catch {
      return null;
    }
  }
  return client;
}
export default function Home({
  initialData,
}: {
  initialData: PublicStoreSnapshot | null;
}) {
  const emailCooldown = useEmailCooldown();
  const [storeReady, setStoreReady] = useState(!!initialData),
    [storeError, setStoreError] = useState(false),
    [authReady, setAuthReady] = useState(false),
    [authError, setAuthError] = useState(false);
  const currentUserId = useRef<string | null>(null),
    authVersion = useRef(0);

  const [user, setUser] = useState<User | null>(null),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [msg, setMsg] = useState(""),
    [balance, setBalance] = useState(0),
    [isAdmin, setAdmin] = useState(false),
    [products, setProducts] = useState<Product[]>(initialData?.products || []),
    [topups, setTopups] = useState<Topup[]>([]),
    [orders, setOrders] = useState<Order[]>([]),
    [pending, setPending] = useState<Pending[]>([]),
    [amount, setAmount] = useState(""),
    [slip, setSlip] = useState<File | null>(null),
    [customerEmail, setCustomerEmail] = useState(""),
    [busy, setBusy] = useState(false),
    [bank, setBank] = useState({
      bank: initialData?.settings.bank_name || "",
      name: initialData?.settings.bank_account_name || "",
      number: initialData?.settings.bank_account_number || "",
    }),
    [tab, setTab] = useState("shop");
  const [slipMode, setSlipMode] = useState({
    mode: "manual",
    reason: "not_configured",
  });
  const [categories, setCategories] = useState<Category[]>(
    initialData?.categories || [],
  );
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
  const [settings, setSettings] = useState<StoreSettings>(
    initialData?.settings || defaultSettings,
  );
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
      setStoreReady(true);
      setStoreError(false);
      setBank({
        bank: values.bank_name || "",
        name: values.bank_account_name || "",
        number: values.bank_account_number || "",
      });
    } else if (!initialData) {
      setStoreError(true);
    }
  }
  const ready = !!db();
  async function load(u: User) {
    const s = db();
    if (!s) return;
    const [{ data: p }, { data: t }, { data: o }, { data: profile }] =
      await within(
        Promise.all([
          s.from("products").select("*").order("price"),
          s
            .from("topups")
            .select("id,amount,status,created_at")
            .order("created_at", { ascending: false }),
          s
            .from("orders")
            .select(
              "id,product_id,price,status,delivery,created_at,duration_days,expires_at",
            )
            .order("created_at", { ascending: false }),
          s.from("profiles").select("balance,is_admin").eq("id", u.id).single(),
        ]),
      );
    if (currentUserId.current !== u.id) return;
    if (!profile) throw Error("โหลดข้อมูลบัญชีไม่สำเร็จ");
    if (p) setProducts(p);
    if (t) setTopups(t);
    if (o) setOrders(o);
    setBalance(profile.balance);
    setAdmin(profile?.is_admin || false);
  }
  useEffect(() => {
    const query = new URLSearchParams(window.location.search),
      hash = new URLSearchParams(window.location.hash.slice(1));
    if (
      query.has("code") ||
      query.has("token_hash") ||
      query.has("error") ||
      query.has("error_code") ||
      hash.has("access_token") ||
      hash.has("error_code") ||
      hash.has("error")
    ) {
      window.location.replace(
        "/auth/confirm" + window.location.search + window.location.hash,
      );
      return;
    }
    loadSettings();
    loadCategories();
    fetch("/api/topup")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setSlipMode(data);
      })
      .catch(() => {});
    const s = db();
    if (!s) {
      setAuthReady(true);
      return;
    }
    let live = true;
    async function applyAuth(u: User | null, version: number) {
      if (!live || version !== authVersion.current) return;
      if (currentUserId.current !== u?.id) setAuthReady(false);
      currentUserId.current = u?.id || null;
      setUser(u);
      setAuthError(false);
      if (!u) {
        setBalance(0);
        setAdmin(false);
        setOrders([]);
        setTopups([]);
        setAuthReady(true);
        return;
      }
      try {
        await load(u);
        if (live && version === authVersion.current) setAuthReady(true);
      } catch {
        if (live && version === authVersion.current) {
          setAuthError(true);
          setAuthReady(false);
        }
      }
    }
    const initialVersion = ++authVersion.current;
    within(s.auth.getUser())
      .then(({ data, error }) => {
        if (!live || initialVersion !== authVersion.current) return;
        if (error && error.name !== "AuthSessionMissingError") {
          setAuthError(true);
          return;
        }
        void applyAuth(data.user, initialVersion);
        if (!data.user && !initialData)
          s.from("products")
            .select("*")
            .order("price")
            .then(({ data }) => {
              if (live && data) setProducts(data);
            });
      })
      .catch(() => {
        if (live) setAuthError(true);
      });
    const { data: sub } = s.auth.onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION") return;
      const version = ++authVersion.current;
      setTimeout(() => void applyAuth(session?.user || null, version), 0);
    });
    return () => {
      live = false;
      sub.subscription.unsubscribe();
    };
  }, []);
  async function auth(mode: "signup" | "signin") {
    if (busy) return;
    if (mode === "signup" && emailCooldown.remaining > 0) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || !password) {
      setMsg("กรุณากรอกอีเมลและรหัสผ่านให้ถูกต้อง");
      return;
    }
    if (mode === "signup" && password.length < 6) {
      setMsg("รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร");
      return;
    }
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
          ? await s.auth.signUp({
              ...credentials,
              options: {
                emailRedirectTo: window.location.origin + "/auth/confirm",
              },
            })
          : await s.auth.signInWithPassword(credentials);
      if (
        mode === "signup" &&
        (!result.error ||
          result.error.status === 429 ||
          result.error.code === "over_email_send_rate_limit")
      )
        emailCooldown.start();
      setMsg(
        result.error
          ? authErrorMessage(result.error.message, result.error.code)
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
      if (
        result.status === "rejected" &&
        Number.isSafeInteger(result.correctAmount) &&
        result.correctAmount > 0
      ) {
        setAmount(String(result.correctAmount));
      } else {
        setSlip(null);
        setAmount("");
      }
      if (user) await load(user);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function buy(p: Product) {
    if (
      p.requires_customer_email &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail.trim())
    ) {
      setMsg("กรุณากรอกอีเมลสำหรับสินค้านี้ให้ถูกต้อง");
      return;
    }
    if (!confirm(`ยืนยันซื้อ ${p.title} ราคา ฿${p.price}?`)) return;
    setBusy(true);
    try {
      const r = await api("/api/orders", {
        productId: p.id,
        email: p.requires_customer_email ? customerEmail.trim() : null,
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
  if (!storeReady)
    return (
      <main className="store-loading" aria-busy={!storeError}>
        <strong>KingkeawLnwza</strong>
        <p role="status">
          {storeError
            ? "โหลดร้านค้าไม่สำเร็จ กรุณาลองใหม่"
            : "กำลังโหลดร้านค้า…"}
        </p>
        {storeError && (
          <button onClick={() => window.location.reload()}>ลองใหม่</button>
        )}
      </main>
    );
  return (
    <main>
      <header className="header">
        <div className="wrap nav">
          <a href="/" className="brand">
            {settings.brand_name}
          </a>
          <span className="tag">ร้านบริการดิจิทัล</span>
          <div className="grow" />
          {authReady && user && (
            <button
              className="ghost"
              onClick={() => {
                db()?.auth.signOut();
                currentUserId.current = null;
                ++authVersion.current;
                setAuthReady(true);
                setUser(null);
                setAdmin(false);
                setOrders([]);
                setTopups([]);
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
        {!authReady && (
          <section className="panel account-loading" aria-busy={!authError}>
            <p role="status">
              {authError
                ? "ตรวจสอบบัญชีไม่สำเร็จ กรุณาลองใหม่"
                : "กำลังตรวจสอบบัญชี…"}
            </p>
            {authError && (
              <button
                className="outline"
                onClick={() => window.location.reload()}
              >
                ลองตรวจสอบบัญชีอีกครั้ง
              </button>
            )}
          </section>
        )}
        {authReady && !user && (
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
                disabled={!ready || busy || emailCooldown.remaining > 0}
                onClick={() => auth("signup")}
              >
                {emailCooldown.remaining > 0
                  ? `รอก่อนส่งอีกครั้ง (${emailCooldown.remaining} วินาที)`
                  : "สมัครสมาชิก"}
              </button>
            </div>
            <p>
              <a href="/auth/forgot">ลืมรหัสผ่าน / รีเซ็ตรหัสผ่าน</a>
            </p>
          </section>
        )}
        {authReady && user && (
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
                    if (id === "orders" && user) void load(user);
                  }}
                >
                  {label}
                </button>
              ))}
            </nav>
          </>
        )}
        {(!user || tab === "shop") && (
          <Catalog
            products={products}
            categories={categories}
            user={authReady && !!user}
            authChecking={!authReady}
            busy={busy}
            onBuy={buy}
            email={customerEmail}
            onEmail={setCustomerEmail}
          />
        )}
        {authReady && user && tab === "topup" && (
          <section className="panel">
            <h2>
              <Upload size={22} /> เติมเงินผ่านธนาคาร
            </h2>
            <p className="topup-note">
              {settings.bank_topup_note?.trim()
                ? settings.bank_topup_note
                : slipMode.mode === "automatic"
                  ? "โอนเข้าบัญชีร้านแล้วส่งสลิป ระบบตรวจยอด ผู้รับ และสลิปซ้ำก่อนเพิ่มเงินอัตโนมัติ ใช้สลิปโอนใหม่ภายใน 24 ชั่วโมง"
                  : slipMode.reason === "quota"
                    ? "โควต้าตรวจอัตโนมัติรอบนี้หมดแล้ว ส่งสลิปเพื่อให้แอดมินตรวจจากรายการโอนจริงและเพิ่มยอด"
                    : "โอนเข้าบัญชีร้านแล้วส่งสลิป รอผู้ดูแลตรวจสอบธุรกรรมจริงก่อนเพิ่มยอด"}
            </p>
            {settings.bank_topup_note?.trim() &&
              slipMode.mode !== "automatic" &&
              slipMode.reason === "quota" && (
                <p className="notice">
                  โควต้าตรวจอัตโนมัติรอบนี้หมดแล้ว
                  ส่งสลิปเพื่อให้แอดมินตรวจจากรายการโอนจริงและเพิ่มยอด
                </p>
              )}
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
                รูปสลิป (JPG, PNG, WEBP ไม่เกิน 4 MB)
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  required
                  onChange={(e) => setSlip(e.target.files?.[0] || null)}
                />
              </label>
              <button disabled={busy || !ready}>
                {slipMode.mode === "automatic"
                  ? "ตรวจสลิปและเติมเงิน"
                  : "ส่งสลิปให้แอดมินตรวจสอบ"}
              </button>
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
        {authReady && user && tab === "orders" && (
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
                <OrderDetails order={o} />
              </div>
            ))}
          </section>
        )}
        {authReady && user && isAdmin && tab === "admin" && (
          <AdminStore
            db={db()!}
            onChanged={async () => {
              await Promise.all([load(user), loadSettings(), loadCategories()]);
            }}
          />
        )}
        {authReady && user && isAdmin && tab === "admin" && (
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
