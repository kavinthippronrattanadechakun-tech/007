const fs = require("node:fs"),
  ts = require("typescript"),
  assert = require("node:assert/strict"),
  { test } = require("node:test"),
  { createHmac } = require("node:crypto"),
  Module = require("node:module");
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
const helper = require("../lib/line-notifications.ts"),
  webhook = require("../app/api/line/webhook/route.ts"),
  config = require("../app/api/admin/line/route.ts");
const uid = "11111111-1111-4111-8111-111111111111",
  oid = "22222222-2222-4222-8222-222222222222",
  dest = "C" + "a".repeat(32);
const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
async function withEnv(fn) {
  const old = { ...process.env },
    fetch = global.fetch;
  Object.assign(process.env, {
    NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "public",
    SUPABASE_SERVICE_ROLE_KEY: "server-test",
    LINE_CHANNEL_ACCESS_TOKEN: "line-test",
    LINE_CHANNEL_SECRET: "secret-test",
  });
  try {
    await fn();
  } finally {
    global.fetch = fetch;
    for (const k of Object.keys(process.env))
      if (!(k in old)) delete process.env[k];
    Object.assign(process.env, old);
  }
}
test("LINE retry key is stable; only accepted duplicate 409 succeeds; errors never expose secrets", () =>
  withEnv(async () => {
    for (const [status, headers, ok, retryable] of [
      [200, {}, true, false],
      [409, { "x-line-accepted-request-id": "accepted" }, true, false],
      [409, {}, false, false],
      [401, {}, false, false],
      [429, {}, false, true],
      [500, {}, false, true],
    ]) {
      global.fetch = async (url, opts) => {
        assert.equal(url, "https://api.line.me/v2/bot/message/push");
        assert.equal(opts.headers["X-Line-Retry-Key"], oid);
        assert.equal(JSON.parse(opts.body).to, dest);
        return json({ message: "private-token" }, status, headers);
      };
      const r = await helper.pushLine(dest, "message", oid);
      assert.equal(r.ok, ok);
      assert.equal(r.retryable, retryable);
      assert(!JSON.stringify(r).includes("private-token"));
    }
    global.fetch = async () => {
      throw Error("token private");
    };
    assert.deepEqual(await helper.pushLine(dest, "message", oid), {
      ok: false,
      error: "network_error",
      retryable: true,
    });
  }));
test("webhook verifies exact raw HMAC before touching database and records destinations without chat contents", () =>
  withEnv(async () => {
    let writes = [];
    global.fetch = async (url, opts) => {
      assert(String(url).includes("/line_destinations"));
      writes.push(JSON.parse(opts.body));
      return json([]);
    };
    const body = JSON.stringify({
      events: [
        {
          type: "message",
          source: { type: "group", groupId: dest },
          message: { text: "never-store-me" },
        },
        { type: "message", source: { type: "user", userId: dest } },
      ],
    });
    const req = (raw, sig) =>
      new Request("https://shop/api/line/webhook", {
        method: "POST",
        headers: { "x-line-signature": sig },
        body: raw,
      });
    const sig = createHmac("sha256", "secret-test")
      .update(body)
      .digest("base64");
    assert.equal((await webhook.POST(req(body, sig))).status, 200);
    assert.equal(writes[0].length, 1);
    assert.equal(writes[0][0].id, dest);
    assert(!JSON.stringify(writes).includes("never-store-me"));
    assert.equal((await webhook.POST(req(body + " ", sig))).status, 401);
    assert.equal((await webhook.POST(req(body, "é".repeat(44)))).status, 401);
    assert.equal(writes.length, 1);
    delete process.env.LINE_CHANNEL_SECRET;
    assert.equal((await webhook.POST(req(body, sig))).status, 503);
  }));
test("dispatcher claims a lease, persists outcomes and never sends when not configured", () =>
  withEnv(async () => {
    const calls = [];
    let claimed = false;
    global.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      calls.push({ url: String(url), body });
      if (String(url).includes("/claim_line_order_notification"))
        return json(
          claimed
            ? null
            : ((claimed = true),
              {
                id: oid,
                order_id: oid,
                text: "order message",
                to: dest,
                retry_key: oid,
                lease_token: uid,
              }),
        );
      if (String(url).includes("api.line.me")) return json({}, 503);
      if (String(url).includes("/finish_line_order_notification"))
        return json(true);
      throw Error("unexpected");
    };
    assert.deepEqual(await helper.dispatchLineOrders(oid, 1), {
      sent: 0,
      failed: 1,
      configured: true,
    });
    assert.equal(calls[2].body.p_lease, uid);
    assert.equal(calls[2].body.p_retryable, true);
    assert.equal(calls[2].body.p_success, false);
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    assert.equal((await helper.dispatchLineOrders()).configured, false);
    assert.equal(calls.length, 3);
  }));
test("only admins can configure or send notifications; destination is verified by server", () =>
  withEnv(async () => {
    let count = 0;
    global.fetch = async (url) => {
      count++;
      if (String(url).includes("/auth/v1/user")) return json({ id: uid });
      if (String(url).includes("/profiles")) return json({ is_admin: false });
      throw Error("unexpected");
    };
    const req = new Request("https://shop/api/admin/line", {
      method: "POST",
      headers: {
        Authorization: "Bearer user",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "test", targetId: dest }),
    });
    assert.equal((await config.POST(req)).status, 403);
    assert.equal(count, 2);
    count = 0;
    assert.equal(
      (await config.GET(new Request("https://shop/api/admin/line"))).status,
      403,
    );
    assert.equal(count, 0);
  }));
test("purchase returns success even if LINE is unavailable; no alert scheduled for failed or automatic purchases", () =>
  withEnv(async () => {
    const scheduled = [],
      load = Module._load;
    Module._load = function (id, parent, ...rest) {
      if (id === "next/server") return { after: (fn) => scheduled.push(fn) };
      return load.call(this, id, parent, ...rest);
    };
    let purchase;
    try {
      purchase = require("../app/api/orders/route.ts");
    } finally {
      Module._load = load;
    }
    let failBuy = false,
      automatic = false;
    global.fetch = async (url) => {
      url = String(url);
      if (url.includes("/auth/v1/user")) return json({ id: uid });
      if (url.includes("/buy_product"))
        return failBuy
          ? json({ message: "Out of stock" }, 400)
          : json({
              order_id: oid,
              status: automatic ? "delivered" : "processing",
            });
      if (url.includes("/claim_line_order_notification")) return json(null);
      throw Error("unexpected " + url);
    };
    const req = () =>
      new Request("https://shop/api/orders", {
        method: "POST",
        headers: {
          Authorization: "Bearer user",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ productId: "manual" }),
      });
    assert.equal((await purchase.POST(req())).status, 200);
    assert.equal(scheduled.length, 1);
    await scheduled[0]();
    failBuy = true;
    assert.equal((await purchase.POST(req())).status, 400);
    assert.equal(scheduled.length, 1);
    failBuy = false;
    automatic = true;
    assert.equal((await purchase.POST(req())).status, 200);
    assert.equal(scheduled.length, 1);
  }));
test("manual delivery omits empty fields and preserves delivery password", () => {
  const { manualDeliveryText } = require("../lib/manual-delivery.ts");
  assert.equal(manualDeliveryText("", "", "note"), "note");
  assert.equal(
    manualDeliveryText(" a@example.com ", "pass", "note"),
    "Mail: a@example.com\nPassword: pass\nnote",
  );
  assert.equal(manualDeliveryText("", "", ""), "");
});
test("admin test sends only to saved destination and cannot enable an unregistered chat", () =>
  withEnv(async () => {
    let pushes = 0;
    global.fetch = async (url, opts = {}) => {
      url = String(url);
      if (url.includes("/auth/v1/user")) return json({ id: uid });
      if (url.includes("/profiles")) return json({ is_admin: true });
      if (url.includes("/line_settings"))
        return json({ enabled: true, target_id: dest });
      if (url.includes("/line_destinations"))
        return json({ message: "not found" }, 406);
      if (url.includes("api.line.me")) {
        pushes++;
        assert.equal(JSON.parse(opts.body).to, dest);
        return json({});
      }
      throw Error("unexpected " + url);
    };
    const req = (body) =>
      new Request("https://shop/api/admin/line", {
        method: "POST",
        headers: {
          Authorization: "Bearer user",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    assert.equal(
      (
        await config.POST(
          req({ action: "test", targetId: "U" + "b".repeat(32) }),
        )
      ).status,
      200,
    );
    assert.equal(pushes, 1);
    assert.equal(
      (
        await config.POST(
          req({
            action: "save",
            enabled: true,
            targetId: "U" + "b".repeat(32),
          }),
        )
      ).status,
      400,
    );
    assert.equal(pushes, 1);
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    assert.equal(
      (
        await config.POST(
          req({ action: "save", enabled: true, targetId: dest }),
        )
      ).status,
      400,
    );
  }));
