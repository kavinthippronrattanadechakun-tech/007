const fs = require("node:fs"),
  ts = require("typescript"),
  assert = require("node:assert/strict"),
  { test } = require("node:test");
require.extensions[".ts"] = (module, filename) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    filename,
  );
const route = require("../app/api/topup/route.ts"),
  json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR2kAAAAASUVORK5CYII=",
  "base64",
);
async function scenario(kind) {
  const original = globalThis.fetch,
    saved = { ...process.env };
  let checks = 0,
    quotaReads = 0,
    credits = 0,
    consumed = 0,
    finish = null;
  try {
    Object.assign(process.env, {
      NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-public",
      SUPABASE_SERVICE_ROLE_KEY: "test-service",
      SLIPOK_API_KEY: "test-key",
      SLIPOK_BRANCH_ID: "123",
      SLIPOK_CYCLE_DAY: "8",
    });
    if (kind === "unconfigured") delete process.env.SLIPOK_API_KEY;
    globalThis.fetch = async (input, options = {}) => {
      const url = String(input);
      if (url.includes("/auth/v1/user"))
        return json({
          id: "11111111-1111-4111-8111-111111111111",
          created_at: new Date(Date.now() - 86400000).toISOString(),
        });
      if (url.includes("/rest/v1/store_settings"))
        return json({
          bank_name: "ไทยพาณิชย์ SCB",
          bank_account_name: "นาย ทดสอบ",
          bank_account_number: "0012345678",
        });
      if (url.includes("/rpc/reserve_topup"))
        return kind === "hash-duplicate"
          ? json({ code: "23505", message: "duplicate" }, 409)
          : json(JSON.parse(options.body).p_id);
      if (url.includes("/storage/v1/object/slips/"))
        return json({ Key: "slips/test.png" });
      if (url.includes("/rpc/slipok_usage_status"))
        return json({ used: 99, paused: false });
      if (url.includes("/rpc/lock_slipok_check"))
        return json(
          ["cap", "busy"].includes(kind)
            ? { allowed: false, reason: kind === "cap" ? "quota" : "busy" }
            : { allowed: true },
        );
      if (url.includes("/rpc/consume_slipok_check")) {
        consumed++;
        return json({ allowed: kind !== "consume-denied", used: 99 });
      }
      if (url.includes("/rpc/finish_slipok_check")) {
        finish = JSON.parse(options.body);
        return json(null);
      }
      if (url === "https://api.slipok.com/api/line/apikey/123/quota") {
        quotaReads++;
        if (kind === "quota-offline") throw Error("offline");
        return json({
          success: true,
          data: { quota: kind === "provider-exhausted" ? 0 : 99, overQuota: 0 },
        });
      }
      if (url === "https://api.slipok.com/api/line/apikey/123") {
        checks++;
        if (kind === "offline") throw Error("offline");
        const data = {
          success: true,
          amount: kind === "amount" ? 200 : 100,
          countryCode: "TH",
          receivingBank: "014",
          transRef: "TESTREF123",
          transTimestamp: new Date(Date.now() - 60000).toISOString(),
          receiver: {
            displayName: "นาย ทดสอบ",
            account: { type: "BANKAC", value: "xxx-x-x4567-x" },
          },
        };
        return kind === "duplicate"
          ? json({ code: 1012, data }, 400)
          : kind === "receiver"
            ? json({ code: 1014, data }, 400)
            : json({ success: true, data });
      }
      if (url.includes("/rpc/credit_verified_topup")) {
        credits++;
        return json({ ok: true });
      }
      if (url.includes("/rest/v1/topups") && options.method === "PATCH")
        return kind === "audit-error"
          ? json({ code: "PGRST116", message: "not pending" }, 406)
          : json({ id: "test-topup" });
      throw Error("Unexpected HTTP: " + new URL(url).pathname);
    };
    let response;
    if (kind === "metadata-cap") response = await route.GET();
    else {
      const form = new FormData();
      form.append("amount", "100");
      form.append("slip", new File([png], "slip.png", { type: "image/png" }));
      response = await route.POST(
        new Request("https://store.example/api/topup", {
          method: "POST",
          headers:
            kind === "unauthenticated"
              ? {}
              : { Authorization: "Bearer test-user" },
          body: form,
        }),
      );
    }
    return {
      status: response.status,
      body: await response.json(),
      checks,
      quotaReads,
      credits,
      consumed,
      finish,
    };
  } finally {
    globalThis.fetch = original;
    for (const key of Object.keys(process.env))
      if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}
test("99th allowed check can approve and release its lease", async () => {
  const r = await scenario("valid");
  assert.equal(r.body.status, "approved");
  assert.equal(r.checks, 1);
  assert.equal(r.credits, 1);
  assert.equal(r.consumed, 1);
  assert.equal(r.finish.p_hold, false);
});
test("local cap, busy gate and duplicate files never call SlipOK", async () => {
  for (const kind of [
    "cap",
    "busy",
    "hash-duplicate",
    "unconfigured",
    "unauthenticated",
  ]) {
    const r = await scenario(kind);
    assert.equal(r.checks, 0, kind);
    assert.equal(r.quotaReads, 0, kind);
    assert.equal(r.credits, 0, kind);
    if (["cap", "busy", "unconfigured"].includes(kind))
      assert.equal(r.body.status, "pending");
  }
});
test("provider quota zero, quota failure or consume denial never send a slip", async () => {
  for (const kind of [
    "provider-exhausted",
    "quota-offline",
    "consume-denied",
  ]) {
    const r = await scenario(kind);
    assert.equal(r.body.status, "pending", kind);
    assert.equal(r.checks, 0, kind);
    assert.equal(r.credits, 0, kind);
  }
  assert.equal((await scenario("provider-exhausted")).finish.p_pause, true);
});
test("duplicate/error data cannot auto-credit; network uncertainty goes to manual review", async () => {
  for (const kind of ["duplicate", "receiver", "amount"]) {
    const r = await scenario(kind);
    assert.equal(r.body.status, "rejected");
    assert.equal(r.credits, 0);
  }
  const r = await scenario("offline");
  assert.equal(r.body.status, "pending");
  assert.equal(r.credits, 0);
  assert.equal(r.finish.p_hold, true);
});
test("public status after 99 returns manual without any provider request", async () => {
  const r = await scenario("metadata-cap");
  assert.equal(r.body.mode, "manual");
  assert.equal(r.body.reason, "quota");
  assert.equal(r.quotaReads, 0);
  assert.equal(r.checks, 0);
});

test("an already reviewed or unrecordable upload never consumes a check", async () => {
  const r = await scenario("audit-error");
  assert.equal(r.body.status, "pending");
  assert.equal(r.consumed, 0);
  assert.equal(r.checks, 0);
  assert.equal(r.credits, 0);
});
