import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyStock, validateStock } from "../lib/structured-stock.ts";
const draft = () => ({
  ...emptyStock(),
  email: "USER@example.com",
  password: "p@ss",
  remaining: 4,
});
test("account stock keeps quantity and permits empty optional information", () => {
  assert.deepEqual(validateStock(draft()), {
    ...draft(),
    email: "user@example.com",
  });
  assert.equal(
    validateStock({ ...draft(), screen: "hidden", pin: "secret" }).pin,
    "",
  );
});
test("screen stock requires one unit per named screen; pin optional and leading zero preserved", () => {
  const d = {
    ...draft(),
    has_screen: true,
    remaining: 1,
    screen: "1",
    pin: "0123",
  };
  assert.equal(validateStock(d).pin, "0123");
  assert.throws(() => validateStock({ ...d, remaining: 2 }));
  assert.throws(() => validateStock({ ...d, screen: "" }));
  assert.equal(validateStock({ ...d, pin: "" }).pin, "");
});
test("new stock requires password; legacy rows can retain existing delivery text", () => {
  assert.throws(() => validateStock({ ...draft(), password: "" }));
  assert.equal(
    validateStock(
      { ...draft(), password: "", remaining: 0, delivery_info: "legacy" },
      true,
    ).delivery_info,
    "legacy",
  );
  for (const d of [
    { ...draft(), remaining: -1 },
    { ...draft(), email: "bad" },
    { ...draft(), password: "x\ny" },
  ])
    assert.throws(() => validateStock(d));
});
