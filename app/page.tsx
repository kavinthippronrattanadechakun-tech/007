import Storefront from "./Storefront";
import { getPublicStore } from "../lib/public-store";
export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const data = await getPublicStore();
  return {
    title:
      (data?.settings.brand_name || "KingkeawLnwza") + " | ร้านบริการดิจิทัล",
  };
}
export default async function Page() {
  return <Storefront initialData={await getPublicStore()} />;
}
