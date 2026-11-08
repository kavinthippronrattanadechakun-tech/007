"use client";
import { useState } from "react";
export default function CopyDelivery({ text }: { text: string }) {
  const [message, setMessage] = useState("");
  return (
    <div>
      <div className="secret">{text}</div>
      <div className="actions">
        <button
          className="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setMessage("คัดลอกแล้ว");
            } catch {
              setMessage(
                "คัดลอกอัตโนมัติไม่ได้ กรุณาเลือกข้อความด้านบนเพื่อคัดลอก",
              );
            }
          }}
        >
          คัดลอกข้อมูลทั้งหมด
        </button>
        <small role="status">{message}</small>
      </div>
    </div>
  );
}
