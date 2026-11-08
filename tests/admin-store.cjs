const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const defaults = {
  bank_name: "",
  bank_account_name: "",
  bank_account_number: "",
  brand_name: "PREMIUM HUB",
  hero_title: "พรีเมียมในแบบที่คุณเลือก",
  hero_description: "รายละเอียด",
  announcement: "ประกาศ",
  contact_text: "",
  footer_text: "ท้ายเว็บ",
};
(async () => {
  const b = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const p = await b.newPage();
  p.setDefaultTimeout(10000);
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  const u = {
    id: "11111111-1111-4111-8111-111111111111",
    email: "admin@example.com",
    aud: "authenticated",
    role: "authenticated",
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
  };
  const enc = (x) => Buffer.from(JSON.stringify(x)).toString("base64url");
  const token =
    enc({ alg: "HS256" }) +
    "." +
    enc({ sub: u.id, exp: Math.floor(Date.now() / 1000) + 3600 }) +
    ".test";
  await p.addInitScript(
    ({ u, token }) =>
      localStorage.setItem(
        "sb-ycnqqhrsfmrnaxkmmkut-auth-token",
        JSON.stringify({
          access_token: token,
          refresh_token: "test",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          token_type: "bearer",
          user: u,
        }),
      ),
    { u, token },
  );
  let categories = [
    { id: "cat-netflix", name: "Netflix", sort_order: 10 },
    { id: "cat-chatgpt", name: "ChatGPT", sort_order: 20 },
    { id: "cat-gemini", name: "Gemini", sort_order: 30 },
  ];
  let products = [
      {
        id: "test",
        category_id: "cat-netflix",
        title: "สินค้าทดสอบ",
        description: "รายละเอียดสินค้า",
        price: 10,
        active: false,
        delivery_type: "code",
        image_url: "",
      },
    ],
    settings = { id: true, ...defaults },
    stock = [],
    batches = [],
    uploaded = false;
  await p.route("https://*.supabase.co/**", async (r) => {
    const req = r.request(),
      url = new URL(req.url()),
      path = url.pathname,
      method = req.method();
    let data = [];
    const body = () => req.postDataJSON();
    if (path.includes("/auth/v1/user")) data = u;
    else if (path.includes("/storage/v1/object/") && method === "POST") {
      uploaded = true;
      data = { Key: "product-images/test.png" };
    } else if (path.includes("/storage/v1/object/public/"))
      return r.fulfill({
        status: 200,
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR2kAAAAASUVORK5CYII=",
          "base64",
        ),
      });
    else if (path.includes("/orders"))
      data = [
        {
          id: "customer-order",
          product_id: "test",
          price: 25,
          status: "delivered",
          delivery: "Mail: buyer@example.com\nPassword: secret",
          created_at: "2026-11-08T13:00:00Z",
          duration_days: 7,
          expires_at: "2026-11-15T13:00:00Z",
        },
      ];
    else if (path.includes("/profiles"))
      data = { balance: 100, is_admin: true };
    else if (path.includes("/store_settings")) {
      if (method === "PATCH") settings = { ...settings, ...body() };
      data = settings;
    } else if (path.includes("/product_categories")) {
      if (method === "POST")
        categories.push({ ...body(), id: "cat-" + categories.length });
      if (method === "PATCH") {
        const id = url.searchParams.get("id")?.slice(3);
        categories = categories.map((c) =>
          c.id === id ? { ...c, ...body() } : c,
        );
      }
      data = method === "GET" ? categories : { id: categories.at(-1).id };
    } else if (path.includes("/products")) {
      if (method === "POST") products.push(body());
      if (method === "PATCH") {
        const id = url.searchParams.get("id")?.slice(3);
        products = products.map((p) => (p.id === id ? { ...p, ...body() } : p));
      }
      data = method === "GET" ? products : { id: products.at(-1).id };
    } else if (path.includes("/rpc/email_stock_totals"))
      data = [
        {
          available: batches.reduce((a, x) => a + x.remaining, 0),
          sold: batches.reduce((a, x) => a + x.sold, 0),
        },
      ];
    else if (path.includes("/email_stock_batches")) {
      if (method === "POST")
        batches.push(
          ...body().map((x, i) => ({
            ...x,
            id: "batch-" + (batches.length + i),
            sold: 0,
          })),
        );
      if (method === "PATCH") {
        const id = url.searchParams.get("id")?.slice(3);
        batches = batches.map((x) => (x.id === id ? { ...x, ...body() } : x));
        data = { id };
      } else if (method === "DELETE") {
        const id = url.searchParams.get("id")?.slice(3);
        batches = batches.filter((x) => x.id !== id);
        data = { id };
      } else data = batches;
    } else if (path.includes("/stock")) {
      if (method === "POST")
        stock.push(
          ...body().map((x, i) => ({
            ...x,
            id: "stock-" + (stock.length + i),
            order_id: null,
          })),
        );
      if (method === "PATCH") {
        const id = url.searchParams.get("id")?.slice(3);
        stock = stock.map((s) => (s.id === id ? { ...s, ...body() } : s));
        data = { id };
      } else if (method === "DELETE") {
        const id = url.searchParams.get("id")?.slice(3);
        stock = stock.filter((s) => s.id !== id);
        data = { id };
      } else data = stock;
      if (method === "HEAD")
        return r.fulfill({
          status: 200,
          headers: {
            "access-control-expose-headers": "content-range",
            "content-range": `0-0/${url.searchParams.get("order_id") === "not.is.null" ? 0 : stock.length}`,
          },
        });
    }
    return r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(data),
      headers: {
        "access-control-expose-headers": "content-range",
        "content-range": `0-0/${Array.isArray(data) ? data.length : 1}`,
      },
    });
  });
  await p.route("**/api/catalog", (r) =>
    r.fulfill({ json: { stock: [{ product_id: "test", available: 3 }] } }),
  );
  await p.route("**/api/admin", (r) => r.fulfill({ json: { rows: [] } }));
  await p.route("**/api/topup", (r) =>
    r.fulfill({ json: { mode: "manual", reason: "quota" } }),
  );
  await p.route("**/api/admin/slipok", (r) =>
    r.fulfill({
      json: {
        configured: true,
        cycleDay: 8,
        providerRemaining: 0,
        providerError: false,
        usage: {
          used: 99,
          limit: 99,
          remaining: 0,
          period_start: "2026-11-08",
          period_end: "2026-12-08",
          paused: false,
        },
      },
    }),
  );
  let creditCalls = 0,
    customerBalance = 100;
  await p.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text) => {
          window.__copied = text;
        },
      },
    }),
  );
  let inventoryCalls = 0;
  await p.route("**/api/admin/orders/inventory**", (r) => {
    if (r.request().method() === "POST") {
      const body = r.request().postDataJSON();
      assert.equal(body.orderId, "order-test");
      assert.equal(body.action, "restock");
      assert.equal(body.password, "next-password");
      inventoryCalls++;
      return r.fulfill({ json: { data: { ok: true, action: "restock" } } });
    }
    return r.fulfill({
      json: {
        data: {
          kind: "account",
          email: "buyer@example.com",
          remaining: 0,
          has_screen: false,
          active_others: 0,
          can_restock: true,
          action: null,
        },
      },
    });
  });
  await p.route("**/api/admin/orders?**", (r) =>
    r.fulfill({
      json: {
        rows: [
          {
            id: "order-test",
            user_id: "buyer",
            user_email: "buyer@example.com",
            product_title: "สินค้าลูกค้า",
            price: 25,
            status: "delivered",
            created_at: new Date().toISOString(),
            delivery: "Mail: buyer@example.com\nPassword: secret",
            duration_days: 7,
            expires_at: "2026-11-15T13:00:00Z",
          },
        ],
        hasMore: false,
      },
    }),
  );
  await p.route("**/api/admin/customers**", (r) => {
    if (r.request().method() === "POST") {
      const body = r.request().postDataJSON();
      assert(body.requestId);
      assert.equal(body.amount, creditCalls === 0 ? 50 : 100);
      assert.equal(body.reference, creditCalls === 0 ? "BANKREF123" : "");
      creditCalls++;
      customerBalance += body.amount;
      return r.fulfill({ json: { data: { ok: true } } });
    }
    return r.fulfill({
      json: {
        customer: {
          id: "22222222-2222-4222-8222-222222222222",
          email: "buyer@example.com",
          balance: customerBalance,
        },
        history: [],
      },
    });
  });
  await p.goto(process.env.TEST_URL || "http://127.0.0.1:3001");
  await p.getByRole("button", { name: "หลังบ้าน", exact: true }).click();
  await p.getByRole("heading", { name: "จัดการร้านค้า" }).waitFor();
  await p
    .getByRole("button", { name: "แก้ไข สินค้าทดสอบ", exact: true })
    .click();
  await p.getByLabel("ชื่อสินค้า", { exact: true }).fill("สินค้าแก้ไข");
  await p.getByLabel("ราคา (บาท)", { exact: true }).fill("25");
  await p.getByRole("button", { name: "7 วัน", exact: true }).click();
  await p.getByLabel("เปิดขายสินค้า", { exact: true }).check();
  await p
    .getByLabel("ให้ลูกค้ากรอกอีเมลตอนซื้อสินค้านี้", { exact: true })
    .check();
  await p.getByLabel("หมวดสินค้า", { exact: true }).selectOption("cat-chatgpt");
  await p
    .getByLabel("อัปโหลดรูปสินค้าใหม่ (ไม่เกิน 5 MB)", { exact: true })
    .setInputFiles({
      name: "product.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR2kAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  await p.getByRole("button", { name: "บันทึกสินค้า", exact: true }).click();
  await p
    .getByRole("status")
    .filter({ hasText: "บันทึกเรียบร้อยแล้ว" })
    .waitFor();
  assert.equal(products[0].price, 25);
  assert.equal(products[0].duration_days, 7);
  assert(uploaded);
  assert(
    products[0].image_url.includes("/storage/v1/object/public/product-images/"),
  );
  await p.getByRole("button", { name: "สต็อกสินค้า", exact: true }).click();
  await p
    .getByLabel("เติมสต็อก (1 โค้ดต่อบรรทัด สูงสุด 200 รายการ)", {
      exact: true,
    })
    .fill("CODE-1\nCODE-2");
  await p.getByRole("button", { name: "เติมสต็อก", exact: true }).click();
  await p.getByText("CODE-1", { exact: true }).waitFor();
  assert.equal(stock.length, 2);
  await p
    .getByRole("button", { name: "แก้ไขโค้ด", exact: true })
    .first()
    .click();
  await p.getByLabel("แก้ไขโค้ด", { exact: true }).fill("CODE-EDIT");
  await p.getByRole("button", { name: "บันทึกโค้ด", exact: true }).click();
  await p.getByText("CODE-EDIT", { exact: true }).waitFor();
  p.on("dialog", (d) => d.accept());
  await p.getByRole("button", { name: "ลบโค้ด", exact: true }).first().click();
  await p.waitForFunction(() => !document.body.innerText.includes("CODE-EDIT"));
  assert.equal(stock.length, 1);
  const entries = p.locator(".stock-entry");
  await entries
    .first()
    .getByLabel("Mail", { exact: true })
    .fill("one@example.com");
  await entries.first().getByLabel("สต็อกจำนวน", { exact: true }).fill("4");
  await entries
    .first()
    .getByLabel("Password", { exact: true })
    .fill("pass-one");
  await p
    .getByRole("button", { name: "+ เพิ่ม Mail / จออีกรายการ", exact: true })
    .click();
  await entries
    .nth(1)
    .getByLabel("Mail", { exact: true })
    .fill("two@example.com");
  await entries.nth(1).getByLabel("Password", { exact: true }).fill("pass-two");
  await entries
    .nth(1)
    .getByLabel("รูปแบบสต็อก", { exact: true })
    .selectOption("screen");
  await entries.nth(1).getByLabel("Screen", { exact: true }).fill("2");
  await entries.nth(1).getByLabel("Pin (ถ้ามี)", { exact: true }).fill("0123");
  assert.equal(
    await entries
      .nth(1)
      .getByLabel("สต็อกจำนวน", { exact: true })
      .getAttribute("max"),
    "1",
  );
  await p
    .getByRole("button", { name: "บันทึกสต็อก Mail", exact: true })
    .click();
  await p.getByText("one@example.com", { exact: true }).waitFor();
  assert.equal(batches.length, 2);
  assert.equal(
    batches.reduce((n, x) => n + x.remaining, 0),
    5,
  );
  assert.equal(batches[1].pin, "0123");
  assert.equal(batches[1].delivery_info, "");
  await p
    .getByRole("button", { name: "แก้ไขอีเมลและจำนวน", exact: true })
    .first()
    .click();
  const editForm = p.locator("form").filter({
    has: p.getByRole("heading", { name: "แก้ไขสต็อก Mail", exact: true }),
  });
  await editForm.getByLabel("สต็อกจำนวน", { exact: true }).fill("2");
  await editForm
    .getByLabel("ข้อมูลเพิ่มเติม (ถ้ามี)", { exact: true })
    .fill("updated-delivery");
  await p
    .getByRole("button", { name: "บันทึกอีเมลและจำนวน", exact: true })
    .click();
  await p
    .getByRole("status")
    .filter({ hasText: "บันทึกสต็อกอีเมลเรียบร้อยแล้ว" })
    .waitFor();
  assert.equal(batches[0].remaining, 2);
  assert.equal(batches[0].delivery_info, "updated-delivery");
  await p.getByRole("button", { name: "ลบอีเมล", exact: true }).last().click();
  await p.waitForFunction(
    () => !document.body.innerText.includes("two@example.com"),
  );
  assert.equal(batches.length, 1);
  await p
    .getByRole("button", { name: "คำสั่งซื้อลูกค้า", exact: true })
    .click();
  await p
    .getByText("บัญชีลูกค้า: buyer@example.com", { exact: true })
    .waitFor();
  await p.getByText("ดูข้อมูลที่ส่งให้ลูกค้า", { exact: true }).click();
  await p
    .getByRole("button", { name: "คัดลอกข้อมูลทั้งหมด", exact: true })
    .click();
  await p.getByText("คัดลอกแล้ว", { exact: true }).waitFor();
  assert.match(
    await p.evaluate(() => window.__copied),
    /Mail: buyer@example.com\nPassword: secret/,
  );
  assert.match(await p.evaluate(() => window.__copied), /วันหมดอายุ:/);
  await p
    .getByRole("button", { name: "รีสต็อก / นำสินค้าออก", exact: true })
    .click();
  await p.getByLabel("การจัดการสต็อก", { exact: true }).selectOption("restock");
  await p.getByLabel("แก้ไขรหัสผ่านก่อนคืนสต็อก", { exact: true }).check();
  await p
    .getByLabel("รหัสผ่านสำหรับผู้ซื้อครั้งถัดไป", { exact: true })
    .fill("next-password");
  await p
    .getByRole("button", { name: "ยืนยันจัดการสต็อก", exact: true })
    .click();
  await p.waitForFunction(
    () => !document.body.innerText.includes("ยืนยันจัดการสต็อก"),
  );
  assert.equal(inventoryCalls, 1);
  await p
    .getByLabel("ค้นหาอีเมล / เลขคำสั่งซื้อ / สินค้า", { exact: true })
    .fill("buyer@example.com");
  await p.getByRole("button", { name: "ค้นหาคำสั่งซื้อ", exact: true }).click();
  await p
    .getByRole("button", { name: "ลูกค้าและเติมเงิน", exact: true })
    .click();
  await p
    .getByLabel("อีเมลบัญชีลูกค้า", { exact: true })
    .fill("buyer@example.com");
  await p.getByRole("button", { name: "ค้นหาลูกค้า", exact: true }).click();
  await p.getByText("ยอดเงินปัจจุบัน ฿100", { exact: true }).waitFor();
  await p
    .getByLabel("จำนวนเงินที่แอดมินเติม (บาท)", { exact: true })
    .fill("50");
  await p
    .getByText("เลขอ้างอิง / หมายเหตุ (ไม่บังคับ)", { exact: true })
    .click();
  await p
    .getByLabel("เลขอ้างอิงธุรกรรมธนาคาร", { exact: true })
    .fill("BANKREF123");
  await p
    .getByLabel("เหตุผล / หมายเหตุ", { exact: true })
    .fill("ลูกค้าอัปสลิปไม่ได้");
  await p
    .getByRole("button", { name: "เติมเงินให้ลูกค้า", exact: true })
    .click();
  await p.getByText("ยอดเงินปัจจุบัน ฿150", { exact: true }).waitFor();
  assert.equal(creditCalls, 1);
  await p.getByRole("button", { name: "฿100", exact: true }).click();
  await p
    .getByRole("button", { name: "เติมเงินให้ลูกค้า", exact: true })
    .click();
  await p.getByText("ยอดเงินปัจจุบัน ฿250", { exact: true }).waitFor();
  assert.equal(creditCalls, 2);
  await p.getByRole("button", { name: "ข้อความหน้าร้าน", exact: true }).click();
  await p.getByLabel("หัวข้อหน้าร้าน", { exact: true }).fill("ร้านใหม่ของเรา");
  await p.getByLabel("ช่องทางติดต่อ", { exact: true }).fill("LINE @test");
  await p
    .getByRole("button", { name: "บันทึกข้อความหน้าร้าน", exact: true })
    .click();
  await p
    .getByRole("heading", { name: "ร้านใหม่ของเรา", exact: true })
    .waitFor();
  assert.equal(settings.contact_text, "LINE @test");
  assert.equal(errors.length, 0, errors.join("\n"));
  await p.getByRole("button", { name: "บัญชีธนาคาร", exact: true }).click();
  await p.getByText("99 / 99", { exact: true }).waitFor();
  await p.getByText("ใช้การตรวจโดยแอดมินในรอบนี้", { exact: true }).waitFor();
  await p.getByLabel("ชื่อธนาคาร", { exact: true }).fill("ธนาคารทดสอบ");
  await p
    .getByRole("button", { name: "บันทึกบัญชีธนาคาร", exact: true })
    .click();
  await p
    .getByRole("status")
    .filter({ hasText: "กรุณากรอกข้อมูลบัญชีธนาคารให้ครบ" })
    .waitFor();
  await p.getByLabel("ชื่อบัญชี", { exact: true }).fill("ชื่อบัญชีทดสอบ");
  await p.getByLabel("เลขบัญชี", { exact: true }).fill("001-234-5678");
  await p
    .getByLabel("หมายเหตุหน้าเติมเงิน", { exact: true })
    .fill("กรุณาตรวจชื่อบัญชีก่อนโอน\nโอนแล้วแนบสลิปที่นี่");
  await p
    .getByRole("button", { name: "บันทึกบัญชีธนาคาร", exact: true })
    .click();
  await p
    .getByRole("status")
    .filter({ hasText: "บันทึกเรียบร้อยแล้ว" })
    .waitFor();
  await p.getByRole("button", { name: "เติมเงิน", exact: true }).click();
  await p.locator(".bank").filter({ hasText: "001-234-5678" }).waitFor();
  await p
    .getByText("โควต้าตรวจอัตโนมัติรอบนี้หมดแล้ว", { exact: false })
    .waitFor();
  assert.equal(settings.bank_account_number, "001-234-5678");
  assert.equal(
    await p.locator(".topup-note").innerText(),
    "กรุณาตรวจชื่อบัญชีก่อนโอน\nโอนแล้วแนบสลิปที่นี่",
  );
  assert.equal(
    settings.bank_topup_note,
    "กรุณาตรวจชื่อบัญชีก่อนโอน\nโอนแล้วแนบสลิปที่นี่",
  );
  await p.getByRole("button", { name: "หลังบ้าน", exact: true }).click();
  await p.getByRole("button", { name: "หมวดหมู่สินค้า", exact: true }).click();
  await p.getByLabel("ชื่อหมวดหมู่", { exact: true }).fill("แอปอื่น");
  await p.getByRole("button", { name: "เพิ่มหมวดหมู่", exact: true }).click();
  await p.getByRole("button", { name: "แก้หมวด แอปอื่น", exact: true }).click();
  await p.getByLabel("ชื่อหมวดหมู่", { exact: true }).fill("แอปเพิ่มเติม");
  await p
    .getByLabel("คำอธิบายหมวดหมู่", { exact: true })
    .fill("เลือกแพ็กเกจตามระยะเวลาที่ต้องการ");
  await p
    .getByLabel("ลิงก์รูปหมวดหมู่ (https://)", { exact: true })
    .fill("https://example.com/category.png");
  await p.getByRole("button", { name: "บันทึกหมวดหมู่", exact: true }).click();
  await p
    .getByRole("button", { name: "แก้หมวด แอปเพิ่มเติม", exact: true })
    .waitFor();
  await p.getByRole("button", { name: "สินค้าและราคา", exact: true }).click();
  await p
    .getByRole("button", { name: "แก้ไข สินค้าแก้ไข", exact: true })
    .click();
  await p
    .getByLabel("หมวดสินค้า", { exact: true })
    .selectOption(categories.find((c) => c.name === "แอปเพิ่มเติม").id);
  await p.getByRole("button", { name: "บันทึกสินค้า", exact: true }).click();
  await p
    .getByRole("status")
    .filter({ hasText: "บันทึกเรียบร้อยแล้ว" })
    .waitFor();
  await p.getByRole("button", { name: "สินค้า", exact: true }).click();
  await p.locator(".category-card").filter({ hasText: "แอปเพิ่มเติม" }).click();
  await p.getByRole("heading", { name: "สินค้าแก้ไข", exact: true }).waitFor();
  await p.getByRole("link", { name: "ดูรายละเอียด", exact: true }).click();
  await p.getByRole("heading", { name: "สินค้าแก้ไข", exact: true }).waitFor();
  await p.getByText("คงเหลือ 3 สิทธิ์", { exact: true }).waitFor();
  await p
    .getByLabel("อีเมลลูกค้าสำหรับรายการที่ต้องใช้เมล", { exact: true })
    .waitFor();
  await p.getByText("รายละเอียดสินค้า", { exact: true }).waitFor();
  await p.reload();
  await p.getByRole("heading", { name: "สินค้าแก้ไข", exact: true }).waitFor();
  await p.getByRole("link", { name: "หมวดหมู่สินค้า", exact: true }).click();
  await p.locator(".category-card").filter({ hasText: "Netflix" }).click();
  await p.getByText("ยังไม่มีสินค้าในหมวดนี้", { exact: true }).waitFor();
  await p.setViewportSize({ width: 390, height: 844 });
  assert(
    await p.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  assert.equal(
    categories.find((c) => c.name === "แอปเพิ่มเติม").description,
    "เลือกแพ็กเกจตามระยะเวลาที่ต้องการ",
  );
  assert.equal(errors.length, 0, errors.join("\n"));
  await p.getByRole("link", { name: "หมวดหมู่สินค้า", exact: true }).click();
  assert(
    await p.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  await p.locator(".category-card").filter({ hasText: "แอปเพิ่มเติม" }).click();
  await p.getByRole("link", { name: "ดูรายละเอียด", exact: true }).click();
  await p.getByRole("heading", { name: "สินค้าแก้ไข", exact: true }).waitFor();
  assert(
    await p.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  await p.screenshot({ path: "/tmp/catalog-mobile.png", fullPage: true });
  await p.getByRole("button", { name: "หลังบ้าน", exact: true }).click();
  await p
    .getByRole("button", { name: "แก้ไข สินค้าแก้ไข", exact: true })
    .click();
  await p
    .getByLabel("ให้ลูกค้ากรอกอีเมลตอนซื้อสินค้านี้", { exact: true })
    .uncheck();
  await p.getByRole("button", { name: "บันทึกสินค้า", exact: true }).click();
  await p
    .getByRole("status")
    .filter({ hasText: "บันทึกเรียบร้อยแล้ว" })
    .waitFor();
  assert.equal(products[0].requires_customer_email, false);
  await p.getByRole("button", { name: "สินค้า", exact: true }).click();
  await p.getByRole("heading", { name: "สินค้าแก้ไข", exact: true }).waitFor();
  assert.equal(
    await p
      .getByLabel("อีเมลลูกค้าสำหรับรายการที่ต้องใช้เมล", { exact: true })
      .count(),
    0,
  );
  await p.getByRole("button", { name: "คำสั่งซื้อ", exact: true }).click();
  await p
    .getByText(
      "วันหมดอายุ: 15 พฤศจิกายน พ.ศ. 2569 เวลา 20:00:00 น. (เวลาไทย)",
      { exact: false },
    )
    .waitFor();
  await p
    .getByRole("button", { name: "คัดลอกข้อมูลทั้งหมด", exact: true })
    .click();
  assert.match(await p.evaluate(() => window.__copied), /15 พฤศจิกายน/);
  assert.match(
    await p.evaluate(() => window.__copied),
    /7 วัน \(168 ชั่วโมง\)/,
  );
  await p.getByRole("button", { name: "หลังบ้าน", exact: true }).click();
  await p
    .getByRole("button", { name: "แก้ไข สินค้าแก้ไข", exact: true })
    .click();
  await p
    .getByLabel("หมวดย่อย ChatGPT", { exact: true })
    .selectOption("private");
  await p.getByRole("button", { name: "บันทึกสินค้า", exact: true }).click();
  await p
    .getByRole("status")
    .filter({ hasText: "บันทึกเรียบร้อยแล้ว" })
    .waitFor();
  assert.equal(products[0].subcategory, "private");
  await p
    .getByRole("button", { name: "แก้ไข สินค้าแก้ไข", exact: true })
    .click();
  assert.equal(
    await p.getByLabel("หมวดย่อย ChatGPT", { exact: true }).inputValue(),
    "private",
  );
  console.log(
    "PASS: category cards, package drilldown, detail refresh, aggregate stock display, editable category metadata;  SlipOK 99-limit UI and manual fallback; category add/rename/product assignment/storefront filtering; multi-email quantities and delivery add/edit/delete; edit product + price + uploaded image; add/edit/delete stock; save storefront text and render immediately; validate and save bank account and show on topup; mobile width; no browser exceptions",
  );
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
