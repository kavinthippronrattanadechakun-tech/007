const { chromium } = require("playwright");
const assert = require("node:assert/strict");
(async () => {
  const b = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const base = process.env.TEST_URL || "http://127.0.0.1:3004",
      user = {
        id: "11111111-1111-4111-8111-111111111111",
        email: "confirmed@example.com",
        email_confirmed_at: new Date().toISOString(),
        aud: "authenticated",
        role: "authenticated",
        app_metadata: {},
        user_metadata: {},
        created_at: new Date().toISOString(),
      };
    const enc = (x) => Buffer.from(JSON.stringify(x)).toString("base64url"),
      token =
        enc({ alg: "HS256" }) +
        "." +
        enc({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 }) +
        ".test";
    const context = await b.newContext(),
      p = await context.newPage();
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    let verifies = 0;
    await p.route("https://*.supabase.co/auth/v1/**", (r) => {
      if (r.request().url().includes("/verify")) {
        verifies++;
        assert.equal(r.request().postDataJSON().token_hash, "test-hash");
        return r.fulfill({
          json: {
            access_token: token,
            refresh_token: "test-refresh",
            expires_in: 3600,
            token_type: "bearer",
            user,
          },
        });
      }
      return r.fulfill({ json: user });
    });
    await p.goto(
      base +
        "/auth/confirm#access_token=" +
        token +
        "&refresh_token=test-refresh&type=signup",
    );
    await p
      .getByRole("heading", { name: "ยืนยันอีเมลสำเร็จ", exact: true })
      .waitFor();
    assert.equal(new URL(p.url()).hash, "");
    assert.equal(new URL(p.url()).search, "");
    assert(
      await p.evaluate(
        () => !!localStorage.getItem("sb-ycnqqhrsfmrnaxkmmkut-auth-token"),
      ),
    );
    await p.goto(
      base + "/auth/confirm?error_code=otp_expired#error=access_denied",
    );
    await p
      .getByText("ลิงก์หมดอายุหรือถูกใช้แล้ว", { exact: false })
      .waitFor();
    assert.equal(
      await p
        .getByRole("heading", { name: "ยืนยันอีเมลสำเร็จ", exact: true })
        .count(),
      0,
    );
    await p.goto(base + "/auth/confirm?token_hash=test-hash&type=email");
    await p
      .getByRole("heading", { name: "ยืนยันอีเมลสำเร็จ", exact: true })
      .waitFor();
    assert.equal(verifies, 1);
    assert.equal(new URL(p.url()).search, "");
    await p.goto(
      base +
        "/#access_token=" +
        token +
        "&refresh_token=test-refresh&type=signup",
    );
    await p
      .getByRole("heading", { name: "ยืนยันอีเมลสำเร็จ", exact: true })
      .waitFor();
    assert.equal(new URL(p.url()).pathname, "/auth/confirm");
    assert.equal(errors.length, 0, errors.join("\n"));
    const empty = await b.newPage();
    await empty.goto(base + "/auth/confirm");
    await empty.getByText("ไม่พบการยืนยันอีเมล", { exact: false }).waitFor();
    assert.equal(
      await empty
        .getByRole("heading", { name: "ยืนยันอีเมลสำเร็จ", exact: true })
        .count(),
      0,
    );
    console.log(
      "PASS: implicit and token-hash confirmation success, root callback forwarding, expired/missing links never show false success, token URL cleanup, session persistence",
    );
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
