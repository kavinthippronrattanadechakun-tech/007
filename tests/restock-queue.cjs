const { chromium } = require("playwright"),
  assert = require("node:assert/strict");
(async () => {
  const b = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const p = await b.newPage();
    p.setDefaultTimeout(10000);
    await p.clock.install();
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    const user = {
        id: "11111111-1111-4111-8111-111111111111",
        email: "admin@example.com",
        aud: "authenticated",
        role: "authenticated",
        app_metadata: {},
        user_metadata: {},
        created_at: new Date().toISOString(),
      },
      enc = (x) => Buffer.from(JSON.stringify(x)).toString("base64url"),
      token =
        enc({ alg: "HS256" }) +
        "." +
        enc({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 }) +
        ".test";
    await p.addInitScript(
      ({ user, token }) =>
        localStorage.setItem(
          "sb-ycnqqhrsfmrnaxkmmkut-auth-token",
          JSON.stringify({
            access_token: token,
            refresh_token: "test",
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            expires_in: 3600,
            token_type: "bearer",
            user,
          }),
        ),
      { user, token },
    );
    await p.route("https://*.supabase.co/**", (r) => {
      const path = new URL(r.request().url()).pathname;
      let data = [];
      if (path.includes("/auth/v1/user")) data = user;
      else if (path.includes("/profiles"))
        data = { balance: 0, is_admin: true };
      else if (path.includes("/store_settings"))
        data = {
          id: true,
          brand_name: "Test Shop",
          hero_title: "Store",
          hero_description: "",
          announcement: "",
          contact_text: "",
          footer_text: "",
          bank_name: "",
          bank_account_name: "",
          bank_account_number: "",
        };
      return r.fulfill({ json: data });
    });
    await p.route("**/api/topup", (r) =>
      r.fulfill({ json: { mode: "manual" } }),
    );
    await p.route("**/api/catalog", (r) => r.fulfill({ json: { stock: [] } }));
    await p.route("**/api/admin", (r) => r.fulfill({ json: { rows: [] } }));
    let completed = false,
      posts = 0,
      statuses = [],
      confirmed = "";
    const common = {
      user_id: "buyer",
      user_email: "buyer@example.com",
      price: 25,
      delivery: "Mail: buyer@example.com",
      duration_days: 1,
      created_at: new Date(Date.now() - 86400000 * 2).toISOString(),
      inventory_action: null,
    };
    const expired = {
        ...common,
        id: "22222222-2222-4222-8222-222222222222",
        product_title: "Expired package",
        status: "delivered",
        expires_at: new Date(Date.now() - 3600000).toISOString(),
      },
      active = {
        ...common,
        id: "33333333-3333-4333-8333-333333333333",
        product_title: "Active package",
        status: "delivered",
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      },
      processing = {
        ...common,
        id: "44444444-4444-4444-8444-444444444444",
        product_title: "Processing package",
        status: "processing",
        expires_at: null,
      };
    await p.route("**/api/admin/orders?**", (r) => {
      const status =
        new URL(r.request().url()).searchParams.get("status") || "";
      statuses.push(status);
      const list =
        status === "expired"
          ? [expired]
          : status === "active"
            ? completed
              ? []
              : [active]
            : status === "restocked"
              ? completed
                ? [{ ...active, inventory_action: "restock" }]
                : []
              : status === "processing"
                ? [processing]
                : status === "delivered"
                  ? [expired, active]
                  : [expired, active, processing];
      return r.fulfill({ json: { rows: list, hasMore: false } });
    });
    await p.route("**/api/admin/orders/inventory**", (r) => {
      if (r.request().method() === "POST") {
        const body = r.request().postDataJSON();
        assert.equal(body.allowEarly, true);
        assert.equal(body.orderId, active.id);
        posts++;
        completed = true;
        return r.fulfill({ json: { data: { ok: true, action: "restock" } } });
      }
      return r.fulfill({
        json: {
          data: {
            kind: "account",
            email: "buyer@example.com",
            active_others: 0,
            can_restock: true,
            requires_early_confirmation: true,
            action: null,
          },
        },
      });
    });
    p.on("dialog", (d) => {
      confirmed = d.message();
      d.accept();
    });
    await p.goto(process.env.TEST_URL || "http://127.0.0.1:3016");
    await p.getByRole("button", { name: "หลังบ้าน", exact: true }).click();
    await p
      .getByRole("button", { name: "คำสั่งซื้อลูกค้า", exact: true })
      .click();
    await p.getByText("Expired package · ฿25", { exact: true }).waitFor();
    await p
      .getByLabel("สถานะคำสั่งซื้อ", { exact: true })
      .selectOption("processing");
    await p.getByText("Processing package · ฿25", { exact: true }).waitFor();
    assert.equal(
      await p.getByText("Expired package · ฿25", { exact: true }).count(),
      0,
    );
    assert.equal(statuses.at(-1), "processing");
    await p.getByRole("button", { name: "รอรีสต็อก", exact: true }).click();
    await p
      .getByRole("heading", { name: "รอรีสต็อกและจัดการสินค้า", exact: true })
      .waitFor();
    await p.locator(".order-expired").waitFor();
    assert.equal(statuses.at(-1), "expired");
    assert.equal(
      await p.locator(".order-expired .expired-label").innerText(),
      "หมดอายุแล้ว · รอรีสต็อก",
    );
    assert.equal(
      await p
        .locator(".order-expired")
        .evaluate((e) => getComputedStyle(e).backgroundColor),
      "rgb(255, 241, 241)",
    );
    await p.getByRole("button", { name: "ยังไม่หมดอายุ", exact: true }).click();
    await p.getByText("Active package · ฿25", { exact: true }).waitFor();
    assert.equal(await p.locator(".order-expired").count(), 0);
    await p
      .getByRole("button", { name: "รีสต็อก / นำสินค้าออก", exact: true })
      .click();
    await p
      .getByLabel("การจัดการสต็อก", { exact: true })
      .selectOption("restock");
    await p.getByText("คืนก่อนหมดอายุ:", { exact: false }).waitFor();
    await p.getByLabel("แก้ไขรหัสผ่านก่อนคืนสต็อก", { exact: true }).check();
    await p
      .getByLabel("รหัสผ่านสำหรับผู้ซื้อครั้งถัดไป", { exact: true })
      .fill("draft-password");
    await Promise.all([
      p.waitForResponse(
        (r) =>
          r.url().includes("/api/admin/orders?") &&
          r.url().includes("status=active"),
      ),
      p.clock.fastForward(30000),
    ]);
    assert.equal(
      await p
        .getByLabel("รหัสผ่านสำหรับผู้ซื้อครั้งถัดไป", { exact: true })
        .inputValue(),
      "draft-password",
    );
    await p
      .getByRole("button", { name: "ยืนยันจัดการสต็อก", exact: true })
      .click();
    await p
      .getByText("ไม่พบคำสั่งซื้อที่ตรงกับสถานะนี้", { exact: true })
      .waitFor();
    assert.equal(posts, 1);
    assert(confirmed.includes("ก่อนกำหนด"));
    await p.getByRole("button", { name: "คืนสต็อกแล้ว", exact: true }).click();
    await p.getByText("Active package · ฿25", { exact: true }).waitFor();
    assert.equal(
      await p
        .getByRole("button", { name: "รีสต็อก / นำสินค้าออก", exact: true })
        .count(),
      0,
    );
    await p.setViewportSize({ width: 390, height: 844 });
    assert(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: immediate status filtering, dedicated restock tab, red expired rows, active early-return confirmation, refreshed queue and processed filter, mobile width",
    );
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
