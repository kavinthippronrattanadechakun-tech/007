const { chromium } = require("playwright"),
  { createClient } = require("@supabase/supabase-js"),
  fs = require("node:fs"),
  assert = require("node:assert/strict");
(async () => {
  const env = Object.fromEntries(
    fs
      .readFileSync(".env.local", "utf8")
      .split("\n")
      .filter((l) => l.startsWith("NEXT_PUBLIC_"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i), l.slice(i + 1)];
      }),
  );
  const db = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false } },
  );
  const [s, ps, cs] = await Promise.all([
    db.from("store_settings").select("*").eq("id", true).single(),
    db.from("products").select("*").order("price"),
    db.from("product_categories").select("*").order("sort_order"),
  ]);
  assert(!s.error && !ps.error && !cs.error);
  const settings = s.data,
    products = ps.data,
    categories = cs.data,
    product = products.find(
      (p) => p.category_id && categories.some((c) => c.id === p.category_id),
    );
  assert(product);
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const base = process.env.TEST_URL || "http://127.0.0.1:3018";
    const staticContext = await browser.newContext({
        javaScriptEnabled: false,
      }),
      staticPage = await staticContext.newPage();
    await staticPage.goto(base);
    assert.equal(
      await staticPage.locator("header .brand").innerText(),
      settings.brand_name,
    );
    assert.equal(
      await staticPage.locator(".hero h1").innerText(),
      settings.hero_title,
    );
    assert.equal(await staticPage.locator(".auth").count(), 0);
    assert.equal(await staticPage.locator(".category-card").count(), 0);
    assert.equal(
      await staticPage.title(),
      settings.brand_name + " | ร้านบริการดิจิทัล",
    );
    await staticContext.close();
    const context = await browser.newContext(),
      p = await context.newPage();
    p.setDefaultTimeout(12000);
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    const user = {
        id: "11111111-1111-4111-8111-111111111111",
        email: "test@example.com",
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
      ({ user, token }) => {
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
        );
        window.__flashes = [];
        new MutationObserver(() => {
          if (document.querySelector(".auth")) window.__flashes.push("login");
          if (document.querySelector(".wallet strong")?.textContent === "฿0")
            window.__flashes.push("zero-wallet");
          if (document.querySelector(".category-card"))
            window.__flashes.push("wrong-catalog");
          if (
            document.querySelector("header .brand")?.textContent ===
            "PREMIUM HUB"
          )
            window.__flashes.push("old-brand");
        }).observe(document, {
          subtree: true,
          childList: true,
          characterData: true,
        });
      },
      { user, token },
    );
    let releaseAuth,
      releaseProfile,
      authGate,
      profileGate,
      failProfile = false;
    function resetGates() {
      authGate = new Promise((r) => (releaseAuth = r));
      profileGate = new Promise((r) => (releaseProfile = r));
    }
    resetGates();
    await p.route("https://*.supabase.co/**", async (r) => {
      const path = new URL(r.request().url()).pathname;
      let data = [];
      if (path.includes("/auth/v1/user")) {
        await authGate;
        data = user;
      } else if (path.includes("/profiles")) {
        await profileGate;
        if (failProfile)
          return r.fulfill({ status: 503, json: { message: "offline" } });
        data = { balance: 250, is_admin: false };
      } else if (path.includes("/store_settings"))
        return r.fulfill({
          status: 503,
          json: { message: "public refresh offline" },
        });
      else if (path.includes("/product_categories")) data = categories;
      else if (path.includes("/products")) data = products;
      return r.fulfill({ json: data });
    });
    await p.route("**/api/catalog", (r) => r.fulfill({ json: { stock: [] } }));
    await p.route("**/api/topup", (r) =>
      r.fulfill({ json: { mode: "manual" } }),
    );
    const url = base + "/#catalog/" + product.category_id + "/" + product.id;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt === 0) await p.goto(url);
      else {
        resetGates();
        await p.reload();
      }
      await p.locator(".product-detail h2").waitFor();
      assert.equal(
        await p.locator("header .brand").innerText(),
        settings.brand_name,
      );
      assert.equal(
        await p.locator(".hero h1").innerText(),
        settings.hero_title,
      );
      assert.equal(await p.locator(".auth").count(), 0);
      assert.equal(await p.locator(".wallet").count(), 0);
      releaseAuth();
      await p
        .getByText("กำลังตรวจสอบบัญชี…", { exact: true })
        .first()
        .waitFor();
      assert.equal(await p.locator(".wallet").count(), 0);
      releaseProfile();
      await p.locator(".wallet strong").filter({ hasText: "฿250" }).waitFor();
      assert.deepEqual(await p.evaluate(() => window.__flashes), []);
    }
    failProfile = true;
    resetGates();
    releaseAuth();
    releaseProfile();
    await p.reload();
    await p
      .getByText("ตรวจสอบบัญชีไม่สำเร็จ กรุณาลองใหม่", { exact: true })
      .waitFor();
    assert.equal(await p.locator(".auth").count(), 0);
    assert.equal(await p.locator(".wallet").count(), 0);
    assert.equal(
      await p.locator("header .brand").innerText(),
      settings.brand_name,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: real public branding in HTML without JavaScript, stable deep link, delayed auth/profile without login or zero-wallet flashes across reload, preserved server settings on client refresh failure, explicit profile failure/retry state",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
