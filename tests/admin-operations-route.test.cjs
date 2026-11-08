const fs = require("node:fs"),
  ts = require("typescript"),
  assert = require("node:assert/strict"),
  { test } = require("node:test");
require.extensions[".ts"] = (m, p) =>
  m._compile(
    ts.transpileModule(fs.readFileSync(p, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    p,
  );
const fulfill = require("../app/api/admin/orders/fulfill/route.ts");
const customers = require("../app/api/admin/customers/route.ts"),
  orders = require("../app/api/admin/orders/route.ts"),
  inventory = require("../app/api/admin/orders/inventory/route.ts");
const uid = "11111111-1111-4111-8111-111111111111",
  target = "22222222-2222-4222-8222-222222222222";
const json = (v, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: { "content-type": "application/json" },
  });
async function scenario(kind, route, method = "GET", body) {
  const saved = { ...process.env },
    original = fetch;
  let calls = [];
  try {
    Object.assign(process.env, {
      NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "public",
      SUPABASE_SERVICE_ROLE_KEY: "test",
    });
    global.fetch = async (input, opts = {}) => {
      const u = String(input);
      if (u.includes("/auth/v1/user"))
        return kind === "invalid-user"
          ? json({ message: "bad" }, 401)
          : json({ id: uid });
      if (u.includes("/profiles"))
        return json({ is_admin: kind !== "nonadmin" });
      if (u.includes("/rpc/")) {
        const name = u.split("/").pop(),
          payload = JSON.parse(opts.body);
        calls.push({ name, payload });
        if (name === "admin_credit_wallet")
          return kind === "duplicate"
            ? json({ code: "23505", message: "duplicate" }, 409)
            : json({ ok: true });
        if (name === "admin_customer_lookup")
          return json([
            { id: target, email: "buyer@example.com", balance: 100 },
          ]);
        if (name === "admin_fulfill_order")
          return json({ ok: true, already_delivered: false });
        if (name === "admin_order_inventory")
          return json({ kind: "account", can_restock: true });
        if (name === "admin_manage_order_inventory")
          return json({ ok: true, action: payload.p_action });
        if (name === "admin_order_list")
          return json(
            Array.from({ length: 51 }, (_, i) => ({ id: String(i) })),
          );
      }
      if (u.includes("/admin_wallet_credits")) return json([]);
      throw Error("unexpected " + u);
    };
    const req = new Request(
      "https://store.example/api/admin/" +
        route +
        (route === "inventory"
          ? "?orderId=" + target
          : route === "orders"
            ? "?page=2&q=buyer@example.com"
            : "?email=buyer@example.com"),
      {
        method,
        headers:
          kind === "unauth"
            ? {}
            : {
                Authorization: "Bearer user",
                "content-type": "application/json",
              },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    );
    const module =
      route === "fulfill"
        ? fulfill
        : route === "inventory"
          ? inventory
          : route === "orders"
            ? orders
            : customers;
    const r = await module[method](req);
    return { status: r.status, body: await r.json(), calls };
  } finally {
    global.fetch = original;
    for (const key of Object.keys(process.env))
      if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}
const payload = {
  requestId: "33333333-3333-4333-8333-333333333333",
  userId: target,
  amount: 50,
  reference: "BANKREF123",
  note: "slip upload failed",
  actor: "spoofed",
};
test("unauthenticated and nonadmin cannot read customers/orders or credit funds", async () => {
  for (const kind of ["unauth", "nonadmin", "invalid-user"])
    for (const [route, method, body] of [
      ["customers", "GET"],
      ["orders", "GET"],
      ["customers", "POST", payload],
    ]) {
      const r = await scenario(kind, route, method, body);
      assert.equal(r.status, 403);
      assert.equal(r.calls.length, 0);
    }
});
test("wallet actor comes from validated session; malformed amounts/references never reach credit RPC", async () => {
  const r = await scenario("ok", "customers", "POST", payload);
  assert.equal(r.status, 200);
  assert.equal(r.calls[0].payload.p_actor, uid);
  assert.equal(r.calls[0].payload.p_user, target);
  for (const bad of [
    { amount: 0 },
    { amount: 1.5 },
    { amount: 100001 },
    { reference: "bad" },
    { note: 123 },
    { requestId: "bad" },
  ]) {
    const r = await scenario("ok", "customers", "POST", { ...payload, ...bad });
    assert.equal(r.status, 400);
    assert.equal(r.calls.length, 0);
  }
});
test("duplicate bank reference is a conflict and orders paginate without exposing extra row", async () => {
  assert.equal(
    (await scenario("duplicate", "customers", "POST", payload)).status,
    409,
  );
  const r = await scenario("ok", "orders");
  assert.equal(r.body.rows.length, 50);
  assert.equal(r.body.hasMore, true);
  assert.equal(r.calls[0].payload.p_offset, 100);
  assert.equal(r.calls[0].payload.p_query, "buyer@example.com");
});

test("admin can credit using just customer, amount and request ID", async () => {
  const r = await scenario("ok", "customers", "POST", {
    requestId: payload.requestId,
    userId: target,
    amount: 50,
  });
  assert.equal(r.status, 200);
  assert.equal(r.calls[0].payload.p_reference, "");
  assert.equal(r.calls[0].payload.p_note, "");
});

test("inventory actions require admin and validate input before invoking privileged RPC", async () => {
  for (const kind of ["unauth", "nonadmin", "invalid-user"])
    for (const method of ["GET", "POST"]) {
      const r = await scenario(
        kind,
        "inventory",
        method,
        method === "POST" ? { orderId: target, action: "restock" } : undefined,
      );
      assert.equal(r.status, 403);
      assert.equal(r.calls.length, 0);
    }
  for (const payload of [
    { orderId: "bad", action: "restock" },
    { orderId: target, action: "delete" },
    { orderId: target, action: "restock", password: "bad\npassword" },
  ]) {
    const r = await scenario("ok", "inventory", "POST", payload);
    assert.equal(r.status, 400);
    assert.equal(r.calls.length, 0);
  }
  const r = await scenario("ok", "inventory", "POST", {
    orderId: target,
    action: "restock",
    password: "updated",
    allowEarly: true,
    actor: "spoofed",
  });
  assert.equal(r.status, 200);
  assert.equal(r.calls[0].payload.p_actor, uid);
  assert.equal(r.calls[0].payload.p_password, "updated");
  assert.equal(r.calls[0].payload.p_allow_early, true);
  assert.equal((await scenario("ok", "inventory")).status, 200);
});

test("manual fulfillment requires admin, validates payload and uses authenticated actor", async () => {
  for (const kind of ["unauth", "nonadmin", "invalid-user"]) {
    const r = await scenario(kind, "fulfill", "POST", { orderId: target });
    assert.equal(r.status, 403);
    assert.equal(r.calls.length, 0);
  }
  for (const body of [
    { orderId: "bad" },
    { orderId: target, delivery: 12 },
    { orderId: target, delivery: "x".repeat(16385) },
  ]) {
    const r = await scenario("ok", "fulfill", "POST", body);
    assert.equal(r.status, 400);
    assert.equal(r.calls.length, 0);
  }
  const r = await scenario("ok", "fulfill", "POST", {
    orderId: target,
    delivery: "delivery text",
    actor: "spoofed",
  });
  assert.equal(r.status, 200);
  assert.equal(r.calls[0].payload.p_actor, uid);
  assert.equal(r.calls[0].payload.p_delivery, "delivery text");
});
