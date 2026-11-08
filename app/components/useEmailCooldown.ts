"use client";
import { useEffect, useState } from "react";
const key = "auth-email-retry-after";
export default function useEmailCooldown() {
  const [until, setUntil] = useState(0),
    [now, setNow] = useState(Date.now());
  useEffect(() => {
    const sync = () => {
      try {
        const saved = Number(localStorage.getItem(key));
        setUntil(Number.isFinite(saved) ? saved : 0);
        setNow(Date.now());
      } catch {}
    };
    sync();
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  useEffect(() => {
    if (until <= Date.now()) return;
    const timer = setInterval(() => {
      const time = Date.now();
      setNow(time);
      if (time >= until) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [until]);
  function start() {
    const next = Date.now() + 60000;
    setUntil(next);
    setNow(Date.now());
    try {
      localStorage.setItem(key, String(next));
    } catch {}
  }
  return { remaining: Math.max(0, Math.ceil((until - now) / 1000)), start };
}
