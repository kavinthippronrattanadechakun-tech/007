"use client";
import { useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { supabaseUrl } from "../../../lib/supabase-config";
export default function ResetPassword() {
  const [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [message, setMessage] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8 || password !== confirm) {
      setMessage("กรอกรหัสผ่านอย่างน้อย 8 ตัวอักษร และยืนยันให้ตรงกัน");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const client = createClient(
        supabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL!),
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { detectSessionInUrl: false } },
      );
      const { data, error: userError } = await client.auth.getUser();
      if (userError || !data.user) throw Error("session");
      const { error } = await client.auth.updateUser({ password });
      if (error) {
        setMessage(
          "เปลี่ยนรหัสผ่านไม่สำเร็จ กรุณาใช้รหัสใหม่ที่ต่างจากเดิม หรือลองขอลิงก์ใหม่",
        );
        return;
      }
      sessionStorage.removeItem("password-recovery-pending");
      await client.auth.signOut({ scope: "local" });
      setDone(true);
    } catch {
      setMessage("ลิงก์หรือเซสชันหมดอายุ กรุณาขอลิงก์รีเซ็ตใหม่");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="confirmation-page">
      <section className="panel confirmation-panel">
        <h1>{done ? "เปลี่ยนรหัสผ่านสำเร็จ" : "ตั้งรหัสผ่านใหม่"}</h1>
        {done ? (
          <>
            <p>ใช้รหัสผ่านใหม่เพื่อเข้าสู่ระบบได้เลย</p>
            <a className="confirmation-link" href="/">
              กลับไปเข้าสู่ระบบ
            </a>
          </>
        ) : (
          <>
            <form onSubmit={save}>
              <label>
                รหัสผ่านใหม่
                <input
                  type="password"
                  required
                  minLength={8}
                  maxLength={128}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <label>
                ยืนยันรหัสผ่านใหม่
                <input
                  type="password"
                  required
                  minLength={8}
                  maxLength={128}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </label>
              <button disabled={busy}>
                {busy ? "กำลังบันทึก…" : "บันทึกรหัสผ่านใหม่"}
              </button>
            </form>
            {message && <p role="alert">{message}</p>}
            <p>
              <a href="/auth/forgot">ขอลิงก์รีเซ็ตใหม่</a>
            </p>
          </>
        )}
      </section>
    </main>
  );
}
