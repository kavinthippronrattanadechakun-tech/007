/** The SDK needs the project origin, not the REST API endpoint. */
export function supabaseUrl(value: string): string {
  const url = new URL(value.trim());
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error("Invalid Supabase URL");
  }
  if (
    !["", "/", "/rest/v1", "/rest/v1/"].includes(url.pathname) ||
    url.search ||
    url.hash
  ) {
    throw new Error("Use the Supabase project URL");
  }
  return url.origin;
}

export function authErrorMessage(message: string, code?: string): string {
  if (
    /email.*rate.*limit|over_email_send_rate_limit/i.test(
      message + " " + (code || ""),
    )
  )
    return "ระบบส่งอีเมลถึงโควต้าชั่วคราว กรุณารอแล้วลองใหม่ หากมีบัญชีแล้วสามารถเข้าสู่ระบบได้เลย";
  if (/rate limit|over_request_rate_limit/i.test(message + " " + (code || "")))
    return "ทำรายการถี่เกินไป กรุณารอสักครู่แล้วลองใหม่";
  if (/invalid api key/i.test(message))
    return "ระบบเข้าสู่ระบบยังไม่พร้อมใช้งาน กรุณาติดต่อร้านค้า";
  if (/invalid login credentials/i.test(message))
    return "อีเมลหรือรหัสผ่านไม่ถูกต้อง";
  if (/email not confirmed/i.test(message))
    return "กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ";
  return message;
}
