"use client";
import { useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { supabaseUrl } from "../../../lib/supabase-config";
export default function Forgot() {
  const [email, setEmail] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const client = createClient(
        supabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL!),
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { detectSessionInUrl: false, flowType: "implicit" } },
      );
      const { error } = await client.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: window.location.origin + "/auth/confirm",
      });
      if (error) throw error;
      setMessage(
        "หากมีบัญชีอีเมลนี้ ระบบจะส่งลิงก์ตั้งรหัสผ่านใหม่ กรุณาตรวจกล่องจดหมายและสแปม",
      );
    } catch {
      setMessage("ส่งลิงก์ไม่สำเร็จ หากเพิ่งขอลิงก์ กรุณารอสักครู่แล้วลองใหม่");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="confirmation-page">
      <section className="panel confirmation-panel">
        <h1>รีเซ็ตรหัสผ่าน</h1>
        <p>กรอกอีเมลที่ใช้สมัคร เพื่อรับลิงก์ตั้งรหัสผ่านใหม่</p>
        <form onSubmit={submit}>
          <label>
            อีเมลสำหรับรีเซ็ตรหัสผ่าน
            <input
              type="email"
              required
              maxLength={320}
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <button disabled={busy}>
            {busy ? "กำลังส่งลิงก์…" : "ส่งลิงก์รีเซ็ตรหัสผ่าน"}
          </button>
        </form>
        {message && <p role="status">{message}</p>}
        <p>
          <a href="/">กลับไปเข้าสู่ระบบ</a>
        </p>
      </section>
    </main>
  );
}
