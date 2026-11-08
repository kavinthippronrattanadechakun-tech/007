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
    p.setDefaultTimeout(12000);
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
      return r.fulfill({
        json: path.includes("/auth/v1/user")
          ? user
          : path.includes("/profiles")
            ? { balance: 100, is_admin: true }
            : path.includes("/store_settings")
              ? { id: true, brand_name: "Test", hero_title: "Test" }
              : [],
      });
    });
    await p.route("**/api/topup", (r) =>
      r.fulfill({ json: { mode: "manual" } }),
    );
    await p.route("**/api/catalog", (r) => r.fulfill({ json: { stock: [] } }));
    await p.route("**/api/admin", (r) => r.fulfill({ json: { rows: [] } }));
    let sent = false,
      calls = 0,
      statuses = [];
    const common = {
      user_id: "buyer",
      user_email: "buyer@example.com",
      customer_email: "delivery@example.com",
      price: 25,
      delivery: null,
      duration_days: 7,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      inventory_action: null,
      fulfillment_type: "manual",
    };
    const pending = {
        ...common,
        id: "22222222-2222-4222-8222-222222222222",
        product_title: "Manual pending",
        status: "processing",
        delivered_at: null,
      },
      delivered = {
        ...common,
        id: "33333333-3333-4333-8333-333333333333",
        product_title: "Already delivered",
        status: "delivered",
        delivered_at: new Date().toISOString(),
      };
    await p.route("**/api/admin/orders?**", (r) => {
      const status = new URL(r.request().url()).searchParams.get("status");
      statuses.push(status);
      const current = sent
        ? {
            ...pending,
            status: "delivered",
            delivery: "Mail: next@example.com",
            delivered_at: new Date().toISOString(),
          }
        : pending;
      const rows =
        status === "manual_pending"
          ? sent
            ? []
            : [current]
          : status === "manual_delivered"
            ? sent
              ? [current, delivered]
              : [delivered]
            : [current, delivered];
      return r.fulfill({ json: { rows, hasMore: false } });
    });
    await p.route("**/api/admin/orders/fulfill", (r) => {
      const body = r.request().postDataJSON();
      assert.equal(body.orderId, pending.id);
      assert.equal(body.delivery, "Mail: next@example.com");
      calls++;
      sent = true;
      return r.fulfill({
        json: {
          data: {
            ok: true,
            already_delivered: false,
            delivered_at: new Date().toISOString(),
          },
        },
      });
    });
    await p.goto(process.env.TEST_URL || "http://127.0.0.1:3023");
    await p.getByRole("button", { name: "หลังบ้าน", exact: true }).click();
    await p.getByRole("button", { name: "จัดส่งเอง", exact: true }).click();
    await p
      .getByRole("heading", { name: "รายการจัดส่งเอง", exact: true })
      .waitFor();
    await p.locator(".order-manual-pending").waitFor();
    assert.equal(statuses.at(-1), "manual_pending");
    assert.equal(
      await p
        .locator(".order-manual-pending")
        .evaluate((e) => getComputedStyle(e).backgroundColor),
      "rgb(255, 241, 241)",
    );
    await p.getByRole("button", { name: "ทั้งหมด", exact: true }).click();
    await p.locator(".order-manual-delivered").waitFor();
    assert.equal(
      await p
        .locator(".order-manual-delivered")
        .evaluate((e) => getComputedStyle(e).backgroundColor),
      "rgb(237, 255, 242)",
    );
    await p
      .locator(".order-manual-pending")
      .getByLabel("ข้อมูลส่งให้ลูกค้า (ถ้ามี)", { exact: true })
      .fill("Mail: next@example.com");
    await p.getByLabel("ติ๊กเมื่อจัดส่งแล้ว", { exact: true }).click();
    await p
      .getByRole("status")
      .filter({ hasText: "บันทึกว่าจัดส่งแล้วเรียบร้อย" })
      .waitFor();
    const completed = p.locator(".order").filter({ hasText: "Manual pending" });
    await completed.getByText("จัดส่งแล้ว", { exact: true }).first().waitFor();
    assert(await completed.locator("input[type=checkbox]").isChecked());
    assert(await completed.locator("input[type=checkbox]").isDisabled());
    assert.equal(await p.locator(".order-manual-pending").count(), 0);
    assert.equal(await p.locator(".order-manual-delivered").count(), 2);
    assert.equal(calls, 1);
    await p
      .getByRole("button", { name: "ยังไม่ได้จัดส่ง", exact: true })
      .click();
    await p.getByText("ไม่มีรายการรอจัดส่ง", { exact: true }).waitFor();
    await p.getByRole("button", { name: "จัดส่งแล้ว", exact: true }).click();
    await p.getByText("Manual pending · ฿25", { exact: true }).waitFor();
    await p.setViewportSize({ width: 390, height: 844 });
    assert(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: dedicated manual queue, immediate pending/delivered/all filters, red/green cards, optional delivery text, completion checkbox, persisted completed view, no duplicate submit and mobile width",
    );
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
