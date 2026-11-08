const { chromium } = require("playwright"),
  assert = require("node:assert/strict");
(async () => {
  const b = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const p = await b.newPage();
    p.setDefaultTimeout(15000);
    await p.clock.install();
    let signups = 0,
      recoveries = 0;
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.route("https://*.supabase.co/auth/v1/**", (r) => {
      const path = new URL(r.request().url()).pathname;
      if (path.endsWith("/signup")) signups++;
      if (path.endsWith("/recover")) recoveries++;
      return r.fulfill({
        status: 429,
        json: {
          code: "over_email_send_rate_limit",
          msg: "email rate limit exceeded",
        },
      });
    });
    await p.route("**/api/topup", (r) =>
      r.fulfill({ json: { mode: "manual" } }),
    );
    await p.route("**/api/catalog", (r) => r.fulfill({ json: { stock: [] } }));
    const base = process.env.TEST_URL || "http://127.0.0.1:3022";
    await p.goto(base);
    await p.getByLabel("อีเมล", { exact: true }).fill("test@example.com");
    await p.getByLabel("รหัสผ่าน", { exact: true }).fill("test-password");
    await p.getByRole("button", { name: "สมัครสมาชิก", exact: true }).click();
    await p
      .getByRole("status")
      .filter({ hasText: "ระบบส่งอีเมลถึงโควต้าชั่วคราว" })
      .waitFor();
    assert.equal(signups, 1);
    assert.equal(
      await p.getByRole("button", { name: /รอก่อนส่งอีกครั้ง/ }).isDisabled(),
      true,
    );
    assert.equal(
      await p
        .getByRole("button", { name: "เข้าสู่ระบบ", exact: true })
        .isEnabled(),
      true,
    );
    await p.reload();
    await p.getByLabel("อีเมล", { exact: true }).waitFor();
    assert.equal(
      await p.getByRole("button", { name: /รอก่อนส่งอีกครั้ง/ }).isDisabled(),
      true,
    );
    assert.equal(signups, 1);
    await p.clock.fastForward(61000);
    await p.getByRole("button", { name: "สมัครสมาชิก", exact: true }).waitFor();
    assert.equal(
      await p
        .getByRole("button", { name: "สมัครสมาชิก", exact: true })
        .isEnabled(),
      true,
    );
    await p.goto(base + "/auth/forgot");
    await p
      .getByLabel("อีเมลสำหรับรีเซ็ตรหัสผ่าน", { exact: true })
      .fill("test@example.com");
    await p
      .getByRole("button", { name: "ส่งลิงก์รีเซ็ตรหัสผ่าน", exact: true })
      .click();
    await p
      .getByRole("status")
      .filter({ hasText: "ระบบส่งอีเมลถึงโควต้าชั่วคราว" })
      .waitFor();
    assert.equal(recoveries, 1);
    assert.equal(
      await p.getByRole("button", { name: /รอก่อนส่งอีกครั้ง/ }).isDisabled(),
      true,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: Thai provider email-rate-limit errors, blocked repeat sends across reload, login remains available, signup retry timer and password-recovery quota handling; all email requests mocked",
    );
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
