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
    ),
    db = createClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { auth: { persistSession: false } },
    ),
    [s, ps, cs] = await Promise.all([
      db.from("store_settings").select("*").eq("id", true).single(),
      db.from("products").select("*"),
      db.from("product_categories").select("*"),
    ]);
  assert(!s.error && !ps.error && !cs.error);
  const products = ps.data,
    categories = cs.data,
    category = categories.find(
      (c) => c.name.trim().toLowerCase() === "chatgpt",
    );
  assert(category);
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const p = await browser.newPage();
    p.setDefaultTimeout(12000);
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.route("https://*.supabase.co/**", (r) => {
      const path = new URL(r.request().url()).pathname;
      return r.fulfill({
        json: path.includes("/store_settings")
          ? s.data
          : path.includes("/product_categories")
            ? categories
            : path.includes("/products")
              ? products
              : [],
      });
    });
    await p.route("**/api/catalog", (r) => r.fulfill({ json: { stock: [] } }));
    await p.route("**/api/topup", (r) =>
      r.fulfill({ json: { mode: "manual" } }),
    );
    const base = process.env.TEST_URL || "http://127.0.0.1:3020";
    await p.goto(base + "/#catalog/" + category.id);
    await p
      .getByRole("heading", { name: "ChatGPT · เลือกประเภท", exact: true })
      .waitFor();
    assert.deepEqual(
      await p.locator(".subcategory-card h3").allTextContents(),
      ["หาร 4", "หาร 3", "ส่วนตัว"],
    );
    for (const [id, name] of [
      ["share4", "หาร 4"],
      ["share3", "หาร 3"],
      ["private", "ส่วนตัว"],
    ]) {
      await p
        .locator(".subcategory-card")
        .filter({ has: p.getByRole("heading", { name, exact: true }) })
        .click();
      await p
        .getByRole("heading", { name: "ChatGPT · " + name, exact: true })
        .waitFor();
      const expected = products.filter(
        (p) => p.category_id === category.id && p.subcategory === id,
      );
      assert.deepEqual(
        (await p.locator(".product h3").allTextContents()).sort(),
        expected.map((p) => p.title).sort(),
      );
      await p.reload();
      await p
        .getByRole("heading", { name: "ChatGPT · " + name, exact: true })
        .waitFor();
      await p
        .getByRole("link", { name: "ดูรายละเอียด", exact: true })
        .first()
        .click();
      await p.locator(".product-detail h2").waitFor();
      await p.getByRole("link", { name, exact: true }).click();
      await p
        .getByRole("heading", { name: "ChatGPT · " + name, exact: true })
        .waitFor();
      await p.getByRole("link", { name: "ChatGPT", exact: true }).click();
      await p
        .getByRole("heading", { name: "ChatGPT · เลือกประเภท", exact: true })
        .waitFor();
    }
    const legacy = products.find((p) => p.category_id === category.id);
    await p.goto(base + "/#catalog/" + category.id + "/" + legacy.id);
    await p.getByRole("heading", { name: legacy.title, exact: true }).waitFor();
    assert.equal(await p.locator(".product-detail").count(), 1);
    await p.setViewportSize({ width: 390, height: 844 });
    await p.getByRole("link", { name: "ChatGPT", exact: true }).click();
    assert(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    const other = categories.find((c) => c.name === "Netflix");
    if (other) {
      await p.goto(base + "/#catalog/" + other.id);
      await p.getByRole("heading", { name: "Netflix", exact: true }).waitFor();
      assert.equal(await p.locator(".subcategory-card").count(), 0);
    }
    assert.deepEqual(errors, []);
    console.log(
      "PASS: three ChatGPT subcategory cards, exact package filtering, refresh/detail/back navigation, old direct product links, mobile width and unchanged Netflix browsing",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
