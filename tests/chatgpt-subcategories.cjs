const { chromium } = require("playwright"),
  { createClient } = require("@supabase/supabase-js"),
  fs = require("node:fs"),
  assert = require("node:assert/strict");
(async () => {
  const category={id:"cat-chatgpt",name:"ChatGPT",sort_order:1};
  const categories=[category,{id:"cat-netflix",name:"Netflix",sort_order:2}];
  const products=["share4","share3","private"].map((id,i)=>({id,category_id:category.id,subcategory:id,title:"Package "+id,price:10,active:true,delivery_type:"code",duration_days:1}));
  const s={data:{brand_name:"Test Shop",hero_title:"Shop",hero_description:"",announcement:"",contact_text:"",footer_text:""}};
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

    await p.route("https://*.supabase.co/**", (r) => {
      const path = new URL(r.request().url()).pathname;
      return r.fulfill({
        json: path.includes("/auth/v1/user") ? u : path.includes("/profiles") ? {balance:0,is_admin:false} : path.includes("/store_settings")
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
    await p.waitForFunction(()=>document.querySelectorAll(".subcategory-card").length===3);
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
    products.splice(0,products.length,...products.filter(p=>p.category_id!==category.id||p.subcategory==="share3"));
    await p.goto(base+"/#catalog/"+category.id);
    await p.reload();
    await p.waitForFunction(()=>document.querySelectorAll(".subcategory-card").length===1);
    assert.deepEqual(await p.locator(".subcategory-card h3").allTextContents(),["หาร 3"]);
    assert(await p.locator(".catalog-back svg").count()>0);
    assert(await p.locator(".catalog-back").first().evaluate(el=>el.getBoundingClientRect().height>=44));
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
