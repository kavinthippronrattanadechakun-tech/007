import { cache } from "react";
import { createClient } from "@supabase/supabase-js";
import { supabaseUrl } from "./supabase-config";
import {
  defaultSettings,
  type StoreSettings,
  type Product,
  type Category,
} from "./store";
export type PublicStoreSnapshot = {
  settings: StoreSettings;
  products: Product[];
  categories: Category[];
};
// Per-request public data only. Never read user sessions or wallet/stock secrets here.
export const getPublicStore = cache(
  async (): Promise<PublicStoreSnapshot | null> => {
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
        key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !key) return null;
      const db = createClient(supabaseUrl(url), key.trim(), {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
        global: {
          fetch: (input, init) =>
            fetch(input, {
              ...init,
              cache: "no-store",
              signal: AbortSignal.timeout(6000),
            }),
        },
      });
      const [settings, products, categories] = await Promise.all([
        db.from("store_settings").select("*").eq("id", true).single(),
        db.from("products").select("*").order("price"),
        db
          .from("product_categories")
          .select("*")
          .order("sort_order")
          .order("name"),
      ]);
      if (
        settings.error ||
        products.error ||
        categories.error ||
        !settings.data
      )
        return null;
      const { id, ...values } = settings.data;
      return {
        settings: { ...defaultSettings, ...values },
        products: products.data || [],
        categories: categories.data || [],
      };
    } catch {
      return null;
    }
  },
);
