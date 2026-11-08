import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "KingkeawLnwza | ร้านบริการดิจิทัล",
  description: "ร้านรวมบริการดิจิทัลและแพ็กเกจพรีเมียม",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
