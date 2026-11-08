import type { Metadata } from "next";
import ConfirmEmail from "./ConfirmEmail";
export const metadata: Metadata = {
  title: "ยืนยันอีเมล | KingkeawLnwza",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default function Page() {
  return <ConfirmEmail />;
}
