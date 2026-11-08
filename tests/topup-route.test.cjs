// Exercise the server route with real Supabase SDK requests and mocked external HTTP.
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
const route = require("../app/api/topup/route.ts");
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR2kAAAAASUVORK5CYII=",
  "base64",
);
const account = {
  bank_name: "ไทยพาณิชย์ SCB",
  bank_account_name: "นาย ทดสอบ",
  bank_account_number: "0012345678",
};
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
async function scenario(kind) {
  const originalFetch = globalThis.fetch,
    saved = { ...process.env };
  let providerCalls = 0,
    credits = 0,
    rejected = 0;
  try {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-public";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service";
    process.env.EASYSLIP_API_KEY = "test-provider";
    delete process.env.SLIP_AUTO_VERIFY_ENABLED;
    delete process.env.EASYSLIP_RECEIVER_BANK_CODE;
    if (kind === "manual") delete process.env.EASYSLIP_API_KEY;
    globalThis.fetch = async (input, options = {}) => {
      const url = String(input);
      if (url.includes("/auth/v1/user"))
        return json({
          id: "11111111-1111-4111-8111-111111111111",
          created_at: new Date(Date.now() - 86400000).toISOString(),
        });
      if (url.includes("/rest/v1/store_settings")) return json(account);
      if (url.includes("/rest/v1/rpc/reserve_topup"))
        return kind === "quota"
          ? json({ code: "P0001", message: "Too many topups" }, 400)
          : kind === "hash-duplicate"
            ? json({ code: "23505", message: "duplicate" }, 409)
            : json(JSON.parse(options.body).p_id);
      if (url.includes("/storage/v1/object/slips/"))
        return json({ Key: "slips/test.png" });
      if (url === "https://api.easyslip.com/v2/verify/bank") {
        providerCalls++;
        if (kind === "offline") throw Error("offline");
        return json({
          success: true,
          data: {
            isDuplicate: kind === "duplicate",
            isAmountMatched: true,
            amountInSlip: kind === "wrong-amount" ? 999 : 100,
            matchedAccount: {
              bankNumber:
                kind === "wrong-receiver" ? "9999999999" : "0012345678",
              bank: { code: "014" },
              nameTh: "นาย ทดสอบ",
            },
            rawSlip: {
              transRef: "TESTREF123",
              date: new Date(Date.now() - 60000).toISOString(),
              countryCode: "TH",
              amount: { amount: 100, local: { currency: "THB" } },
              receiver: { bank: { id: "014" } },
            },
          },
        });
      }
      if (url.includes("/rest/v1/rpc/credit_verified_topup")) {
        if (kind === "reference-duplicate")
          return json({ code: "23505", message: "duplicate reference" }, 409);
        credits++;
        assert.equal(JSON.parse(options.body).p_reference, "TESTREF123");
        return json({ ok: true });
      }
      if (url.includes("/rest/v1/topups") && options.method === "PATCH") {
        rejected++;
        return json(null);
      }
      throw Error("Unexpected external request: " + new URL(url).pathname);
    };
    const form = new FormData();
    form.append("amount", "100");
    form.append(
      "slip",
      new File(
        [kind === "fake-image" ? Buffer.from("fake") : png],
        "slip.png",
        { type: "image/png" },
      ),
    );
    const request = new Request("https://store.example/api/topup", {
      method: "POST",
      headers:
        kind === "unauthenticated"
          ? {}
          : { Authorization: "Bearer user-token" },
      body: form,
    });
    const response = await route.POST(request),
      body = await response.json();
    return { status: response.status, body, providerCalls, credits, rejected };
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env))
      if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}
test("verified slip credits once via the privileged RPC", async () => {
  const r = await scenario("valid");
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "approved");
  assert.equal(r.providerCalls, 1);
  assert.equal(r.credits, 1);
});
test("duplicates, wrong amount and recipient never reach credit RPC", async () => {
  for (const kind of ["duplicate", "wrong-amount", "wrong-receiver"]) {
    const r = await scenario(kind);
    assert.equal(r.body.status, "rejected", kind);
    assert.equal(r.credits, 0, kind);
  }
});
test("reference duplicates and offline verification never approve", async () => {
  const duplicate = await scenario("reference-duplicate");
  assert.equal(duplicate.status, 400);
  assert.equal(duplicate.credits, 0);
  const offline = await scenario("offline");
  assert.equal(offline.body.status, "pending");
  assert.equal(offline.credits, 0);
});
test("unauthenticated, invalid image, rate-limit and duplicate-file requests do not incur a provider call", async () => {
  for (const [kind, status] of [
    ["unauthenticated", 401],
    ["fake-image", 400],
    ["quota", 429],
    ["hash-duplicate", 400],
  ]) {
    const r = await scenario(kind);
    assert.equal(r.status, status, kind);
    assert.equal(r.providerCalls, 0, kind);
    assert.equal(r.credits, 0, kind);
  }
});
test("without a provider key the existing manual workflow stays explicit", async () => {
  const r = await scenario("manual");
  assert.equal(r.body.status, "pending");
  assert.equal(r.providerCalls, 0);
  assert.equal(r.credits, 0);
});
