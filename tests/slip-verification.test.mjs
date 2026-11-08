import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateEasySlip,
  verifySlip,
  bankCodeForName,
  isSlipImage,
  SlipCheckError,
} from "../lib/slip-verification.ts";
const now = Date.parse("2026-11-08T08:00:00Z");
const expected = {
  amount: 100,
  bankName: "ไทยพาณิชย์ SCB",
  accountName: "นาย ทดสอบ",
  accountNumber: "001-234-5678",
  bankCode: "014",
  now,
  earliestDate: now - 3600000,
};
function valid() {
  return {
    success: true,
    data: {
      isDuplicate: false,
      isAmountMatched: true,
      amountInSlip: 100,
      matchedAccount: {
        bankNumber: "0012345678",
        bank: { code: "014" },
        nameTh: "นาย ทดสอบ",
      },
      rawSlip: {
        transRef: "REAL-REF-123",
        date: "2026-11-08T14:50:00+07:00",
        countryCode: "TH",
        amount: { amount: 100, local: { currency: "THB" } },
        receiver: { bank: { id: "014" } },
      },
    },
  };
}
test("verified transaction retains exact amount and reference", () => {
  assert.deepEqual(validateEasySlip(valid(), expected), {
    reference: "REAL-REF-123",
    amount: 100,
    transferAt: "2026-11-08T07:50:00.000Z",
  });
  assert.equal(bankCodeForName("ไทยพาณิชย์ SCB"), "014");
  assert.equal(bankCodeForName("unknown"), null);
});
test("reject duplicate, altered amount, wrong receiver/bank/name, stale/future and malformed results", () => {
  const changes = [
    (v) => (v.data.isDuplicate = true),
    (v) => delete v.data.isDuplicate,
    (v) => (v.data.amountInSlip = 200),
    (v) => (v.data.rawSlip.amount.amount = 200),
    (v) => (v.data.isAmountMatched = false),
    (v) => (v.data.matchedAccount = null),
    (v) => (v.data.matchedAccount.bankNumber = "xxx-x-5678"),
    (v) => (v.data.matchedAccount.bank.code = "004"),
    (v) => (v.data.rawSlip.receiver.bank.id = "004"),
    (v) => (v.data.matchedAccount.nameTh = "บุคคลอื่น"),
    (v) => (v.data.rawSlip.countryCode = "US"),
    (v) => (v.data.rawSlip.date = "2020-01-01"),
    (v) => (v.data.rawSlip.date = "2027-01-01"),
    (v) => (v.data.rawSlip.transRef = ""),
    (v) => (v.data.rawSlip.date = "bad"),
  ];
  for (const change of changes) {
    const value = valid();
    change(value);
    assert.throws(() => validateEasySlip(value, expected), SlipCheckError);
  }
  assert.throws(() => validateEasySlip({}, expected));
});
test("provider uncertainty never produces a creditable result", () => {
  assert.throws(
    () =>
      validateEasySlip(
        { success: false, error: { code: "SLIP_PENDING" } },
        expected,
      ),
    (e) => e.retryable === true,
  );
  assert.throws(
    () =>
      validateEasySlip(
        { success: false, error: { code: "SLIP_NOT_FOUND" } },
        expected,
      ),
    (e) => e.retryable === false,
  );
});
test("image magic must match the declared MIME", () => {
  assert(
    isSlipImage(
      Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
      "image/png",
    ),
  );
  assert(!isSlipImage(new TextEncoder().encode("fake slip"), "image/png"));
  assert(!isSlipImage(Uint8Array.from([255, 216, 255]), "image/png"));
});
test("verification sends explicit duplicate, receiver and amount checks; network errors fail closed", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "https://api.easyslip.com/v2/verify/bank");
      assert.equal(options.body.get("checkDuplicate"), "true");
      assert.equal(options.body.get("matchAccount"), "true");
      assert.equal(options.body.get("matchAmount"), "100");
      assert.equal(options.redirect, "error");
      return new Response(JSON.stringify(valid()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    assert.equal(
      (
        await verifySlip(
          new File(["test"], "test.png", { type: "image/png" }),
          expected,
          "test-key",
        )
      ).reference,
      "REAL-REF-123",
    );
    globalThis.fetch = async () => {
      throw Error("offline");
    };
    await assert.rejects(
      verifySlip(
        new File(["test"], "test.png", { type: "image/png" }),
        expected,
        "test-key",
      ),
      (e) => e.retryable === true,
    );
  } finally {
    globalThis.fetch = original;
  }
});
