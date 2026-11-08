const { chromium } = require("playwright"),
  assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const base = process.env.TEST_URL || "http://127.0.0.1:3012",
      context = await browser.newContext(),
      p = await context.newPage();
    p.setDefaultTimeout(10000);
    let recoverCalls = 0,
      updates = 0,
      failUpdate = false;
    const user = {
        id: "11111111-1111-4111-8111-111111111111",
        email: "reset@example.com",
        email_confirmed_at: new Date().toISOString(),
        aud: "authenticated",
        role: "authenticated",
        app_metadata: {},
        user_metadata: {},
        created_at: new Date().toISOString(),
      },
      enc = (v) => Buffer.from(JSON.stringify(v)).toString("base64url"),
      token =
        enc({ alg: "HS256" }) +
        "." +
        enc({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 }) +
        ".test";
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.route("https://*.supabase.co/auth/v1/**", (r) => {
      const req = r.request(),
        url = new URL(req.url());
      if (url.pathname.endsWith("/recover")) {
        recoverCalls++;
        assert.equal(req.postDataJSON().email, "reset@example.com");
        assert.equal(
          url.searchParams.get("redirect_to"),
          base + "/auth/confirm",
        );
        return r.fulfill({ json: {} });
      }
      if (url.pathname.endsWith("/user") && req.method() === "PUT") {
        updates++;
        assert.equal(req.postDataJSON().password, "NewPass123!");
        return failUpdate
          ? r.fulfill({
              status: 400,
              json: { message: "same password", error_code: "same_password" },
            })
          : r.fulfill({ json: user });
      }
      if (url.pathname.endsWith("/logout")) return r.fulfill({ json: {} });
      return r.fulfill({ json: user });
    });
    await p.goto(base + "/auth/forgot");
    await p
      .getByLabel("อีเมลสำหรับรีเซ็ตรหัสผ่าน", { exact: true })
      .fill(user.email);
    await p
      .getByRole("button", { name: "ส่งลิงก์รีเซ็ตรหัสผ่าน", exact: true })
      .click();
    await p
      .getByRole("status")
      .filter({ hasText: "หากมีบัญชีอีเมลนี้" })
      .waitFor();
    assert.equal(recoverCalls, 1);
    await p.goto(
      base +
        "/auth/confirm#access_token=" +
        token +
        "&refresh_token=test-refresh&type=recovery",
    );
    await p
      .getByRole("heading", { name: "ตั้งรหัสผ่านใหม่", exact: true })
      .waitFor();
    assert.equal(new URL(p.url()).hash, "");
    await p.reload();
    await p
      .getByRole("heading", { name: "ตั้งรหัสผ่านใหม่", exact: true })
      .waitFor();
    await p.getByLabel("รหัสผ่านใหม่", { exact: true }).fill("NewPass123!");
    await p
      .getByLabel("ยืนยันรหัสผ่านใหม่", { exact: true })
      .fill("Mismatch123!");
    await p
      .getByRole("button", { name: "บันทึกรหัสผ่านใหม่", exact: true })
      .click();
    await p.getByRole("alert").filter({ hasText: "ยืนยันให้ตรงกัน" }).waitFor();
    assert.equal(updates, 0);
    await p
      .getByLabel("ยืนยันรหัสผ่านใหม่", { exact: true })
      .fill("NewPass123!");
    failUpdate = true;
    await p
      .getByRole("button", { name: "บันทึกรหัสผ่านใหม่", exact: true })
      .click();
    await p
      .getByRole("alert")
      .filter({ hasText: "เปลี่ยนรหัสผ่านไม่สำเร็จ" })
      .waitFor();
    assert.equal(
      await p
        .getByRole("heading", { name: "เปลี่ยนรหัสผ่านสำเร็จ", exact: true })
        .count(),
      0,
    );
    failUpdate = false;
    await p
      .getByRole("button", { name: "บันทึกรหัสผ่านใหม่", exact: true })
      .click();
    await p
      .getByRole("heading", { name: "เปลี่ยนรหัสผ่านสำเร็จ", exact: true })
      .waitFor();
    assert.equal(updates, 2);
    assert.equal(
      await p.evaluate(() =>
        sessionStorage.getItem("password-recovery-pending"),
      ),
      null,
    );
    await p.goto(
      base +
        "/auth/confirm#error=access_denied&error_code=otp_expired&type=recovery",
    );
    await p
      .getByRole("link", { name: "ขอลิงก์รีเซ็ตรหัสผ่านใหม่", exact: true })
      .waitFor();
    assert.equal(
      await p.getByLabel("รหัสผ่านใหม่", { exact: true }).count(),
      0,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: recovery email request, valid recovery link and reload, mismatched passwords blocked, failed update not successful, password saved/signout, expired recovery link",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
