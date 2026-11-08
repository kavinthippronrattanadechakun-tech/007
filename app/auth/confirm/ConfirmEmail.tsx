"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { CheckCircle2, LoaderCircle, AlertCircle } from "lucide-react";
import { supabaseUrl } from "../../../lib/supabase-config";
export default function ConfirmEmail() {
  const [state, setState] = useState<"checking" | "success" | "error">(
      "checking",
    ),
    [message, setMessage] = useState("กำลังตรวจสอบการยืนยันอีเมล…");
  const operation = useRef<Promise<void> | null>(null);
  useEffect(() => {
    let live = true;
    async function verify() {
      const url = new URL(window.location.href),
        query = url.searchParams,
        hash = new URLSearchParams(url.hash.slice(1));
      const code = query.get("code"),
        token_hash = query.get("token_hash"),
        type = query.get("type") || hash.get("type") || "email",
        access_token = hash.get("access_token"),
        refresh_token = hash.get("refresh_token");
      window.history.replaceState({}, "", url.pathname);
      if (
        query.has("error") ||
        query.has("error_code") ||
        hash.has("error") ||
        hash.has("error_code")
      )
        throw Error(
          "ลิงก์ยืนยันอีเมลหมดอายุหรือถูกใช้แล้ว หากยืนยันบัญชีไปแล้ว สามารถกลับไปเข้าสู่ระบบได้เลย",
        );
      if (!["email", "signup"].includes(type))
        throw Error("ลิงก์นี้ไม่ใช่ลิงก์ยืนยันการสมัครสมาชิก");
      const client = createClient(
        supabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL!),
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { detectSessionInUrl: false } },
      );
      let error: Error | null = null;
      if (code) {
        ({ error } = await client.auth.exchangeCodeForSession(code));
      } else if (token_hash) {
        ({ error } = await client.auth.verifyOtp({
          token_hash,
          type: type as "email" | "signup",
        }));
      } else if (access_token && refresh_token) {
        ({ error } = await client.auth.setSession({
          access_token,
          refresh_token,
        }));
      } else if (access_token || refresh_token)
        throw Error("ลิงก์ยืนยันไม่ครบถ้วน กรุณาเปิดลิงก์จากอีเมลอีกครั้ง");
      if (error)
        throw Error(
          "ยืนยันลิงก์ไม่สำเร็จ ลิงก์อาจหมดอายุหรือถูกใช้แล้ว หากยืนยันบัญชีแล้วให้กลับไปเข้าสู่ระบบ",
        );
      const { data, error: userError } = await client.auth.getUser();
      if (userError || !data.user)
        throw Error(
          "ไม่พบการยืนยันอีเมล กรุณาเปิดลิงก์จากอีเมล หรือกลับไปเข้าสู่ระบบ",
        );
      if (!data.user.email_confirmed_at)
        throw Error("อีเมลนี้ยังไม่ได้ยืนยัน กรุณาเปิดลิงก์ยืนยันจากอีเมล");
    }
    if (!operation.current) {
      operation.current = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              Error(
                "การเชื่อมต่อใช้เวลานาน กรุณาลองเปิดลิงก์อีกครั้ง หรือกลับไปเข้าสู่ระบบ",
              ),
            ),
          15000,
        );
        verify()
          .then(resolve, reject)
          .finally(() => clearTimeout(timer));
      });
    }
    operation.current
      .then(() => {
        if (live) {
          setState("success");
          setMessage("ยืนยันอีเมลสำเร็จแล้ว บัญชีของคุณพร้อมใช้งาน");
        }
      })
      .catch((e) => {
        if (live) {
          setState("error");
          setMessage(
            e.message || "ไม่สามารถตรวจสอบการยืนยันอีเมลได้ กรุณาลองใหม่",
          );
        }
      });
    return () => {
      live = false;
    };
  }, []);
  return (
    <main className="confirmation-page">
      <section
        className="panel confirmation-panel"
        role="status"
        aria-live="polite"
      >
        {state === "success" ? (
          <CheckCircle2 size={56} color="#16803b" />
        ) : state === "error" ? (
          <AlertCircle size={56} />
        ) : (
          <LoaderCircle className="spin" size={56} />
        )}
        <h1>
          {state === "success"
            ? "ยืนยันอีเมลสำเร็จ"
            : state === "error"
              ? "ตรวจสอบลิงก์ยืนยันอีเมล"
              : "กำลังยืนยันอีเมล"}
        </h1>
        <p>{message}</p>
        <a className="confirmation-link" href="/">
          {state === "success" ? "ไปยังร้านค้า" : "กลับไปเข้าสู่ระบบ"}
        </a>
      </section>
    </main>
  );
}
