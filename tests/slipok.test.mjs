import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseSlipOK,
  accountMatches,
  bankCode,
  verifySlipOK,
  getSlipOKQuota,
  SlipOKError,
  slipOKConfig,
  slipOKSetup,
} from "../lib/slipok.ts";
const now = Date.parse("2026-11-08T08:00:00Z"),
  expected = {
    amount: 100,
    bankCode: "014",
    accountNumber: "0012345678",
    now,
    earliestDate: now - 3600000,
  };
function valid() {
  return {
    success: true,
    data: {
      success: true,
      amount: 100,
      countryCode: "TH",
      receivingBank: "014",
      transRef: "TESTREF123",
      transDate: "20261108",
      transTime: "14:50:00",
      receiver: {
        displayName: "ทดสอบ ร**",
        account: { type: "BANKAC", value: "xxx-x-x4567-x" },
      },
    },
  };
}
test("logged SlipOK response has matching amount, receiver and Bangkok timestamp", () => {
  assert.equal(bankCode("ไทยพาณิชย์ SCB"), "014");
  assert.deepEqual(parseSlipOK(valid(), expected), {
    reference: "TESTREF123",
    amount: 100,
    transferAt: "2026-11-08T07:50:00.000Z",
  });
  assert(accountMatches("xxx-x-x4567-x", "001-234-5678"));
  assert(!accountMatches("xxx-x-x4560-x", "0012345678"));
  assert(!accountMatches("xxxxxxxxxx", "0012345678"));
  assert(!accountMatches("5678", "0012345678"));
});
test("HTTP error payloads with valid nested QR data never approve", () => {
  for (const code of [1012, 1013, 1014, 1002, 1003, 1004, 1009, 1010]) {
    const body = valid();
    delete body.success;
    body.code = code;
    assert.throws(() => parseSlipOK(body, expected), SlipOKError);
  }
});
test("wrong/malformed amount, bank, date and reference are not creditable", () => {
  for (const mutate of [
    (v) => (v.data.amount = 200),
    (v) => (v.data.amount = "100"),
    (v) => (v.data.receivingBank = "004"),
    (v) => (v.data.transDate = "20200101"),
    (v) => (v.data.transTime = "bad"),
    (v) => (v.data.transRef = ""),
    (v) => (v.data.receiver.account.value = "xxx-x-x9999-x"),
  ]) {
    const v = valid();
    mutate(v);
    assert.throws(() => parseSlipOK(v, expected), SlipOKError);
  }
});
test("request always enables recipient and duplicate checks and reads actual amount before comparing locally", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "https://api.slipok.com/api/line/apikey/123");
      assert.equal(options.headers["x-authorization"], "test-key");
      assert.equal(options.body.get("log"), "true");
      assert.equal(options.body.get("amount"), null);
      assert(options.body.get("files") instanceof File);
      assert.equal(options.redirect, "error");
      return new Response(JSON.stringify(valid()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    assert.equal(
      (
        await verifySlipOK(
          new File(["image"], "slip.png", { type: "image/png" }),
          expected,
          { key: "test-key", branch: "123", day: 8 },
        )
      ).reference,
      "TESTREF123",
    );
    globalThis.fetch = async () => {
      throw Error("timeout");
    };
    await assert.rejects(
      verifySlipOK(new File(["image"], "slip.png"), expected, {
        key: "test",
        branch: "123",
        day: 8,
      }),
      (e) => e.retryable && e.uncertain,
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("quota errors and overage fail closed before slip verification", async () => {
  const original = globalThis.fetch;
  try {
    for (const [body, remaining] of [
      [{ success: true, data: { quota: 99, overQuota: 0 } }, 99],
      [{ success: true, data: { quota: 0, overQuota: 0 } }, 0],
      [{ success: true, data: { quota: 2, overQuota: 1 } }, 0],
    ]) {
      globalThis.fetch = async () => new Response(JSON.stringify(body));
      assert.equal(
        await getSlipOKQuota({ key: "test", branch: "123", day: 8 }),
        remaining,
      );
    }
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ success: false, code: 1002 }), {
        status: 401,
      });
    await assert.rejects(
      getSlipOKQuota({ key: "test", branch: "123", day: 8 }),
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("configuration accepts copied official endpoint URLs and quoted values without revealing credentials", () => {
  const saved = {
    key: process.env.SLIPOK_API_KEY,
    branch: process.env.SLIPOK_BRANCH_ID,
    day: process.env.SLIPOK_CYCLE_DAY,
  };
  try {
    process.env.SLIPOK_API_KEY = '"test-key"';
    process.env.SLIPOK_CYCLE_DAY = "8";
    for (const value of [
      "123",
      "https://api.slipok.com/api/line/apikey/123",
      "/api/line/apikey/123/quota",
      'SLIPOK_BRANCH_ID="123"',
    ]) {
      process.env.SLIPOK_BRANCH_ID = value;
      assert.deepEqual(slipOKConfig(), {
        key: "test-key",
        branch: "123",
        day: 8,
      });
      assert(!JSON.stringify(slipOKSetup()).includes("test-key"));
    }
    process.env.SLIPOK_BRANCH_ID =
      "https://untrusted.example/api/line/apikey/123";
    assert.equal(slipOKConfig(), null);
  } finally {
    for (const [key, value] of [
      ["SLIPOK_API_KEY", saved.key],
      ["SLIPOK_BRANCH_ID", saved.branch],
      ["SLIPOK_CYCLE_DAY", saved.day],
    ])
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
});

test("verified actual amount can be cached before declared amount comparison", () => {
  const v = valid();
  v.data.amount = 50;
  assert.throws(() => parseSlipOK(v, expected), SlipOKError);
  assert.equal(parseSlipOK(v, expected, false).amount, 50);
  const duplicate = valid();
  duplicate.success = false;
  duplicate.code = 1012;
  assert.throws(
    () => parseSlipOK(duplicate, expected, false),
    (e) => e.providerCode === 1012 && e.reference === "TESTREF123",
  );
});
