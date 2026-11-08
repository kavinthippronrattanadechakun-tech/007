import { admin, user, isAdmin, fail } from "../../../../lib/server";
import { slipOKConfig, getSlipOKQuota } from "../../../../lib/slipok";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const u = await user(req);
    if (!u || !(await isAdmin(u.id))) return fail("ไม่มีสิทธิ์", 403);
    const config = slipOKConfig(),
      day = config?.day || Number(process.env.SLIPOK_CYCLE_DAY || 8);
    const { data: usage, error } = await admin().rpc("slipok_usage_status", {
      p_day: day,
    });
    if (error) throw error;
    let providerRemaining: number | null = null,
      providerError = false;
    if (config)
      try {
        providerRemaining = await getSlipOKQuota(config);
      } catch {
        providerError = true;
      }
    return Response.json(
      {
        configured: !!config,
        usage,
        providerRemaining,
        providerError,
        cycleDay: day,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return fail("โหลดโควต้าไม่สำเร็จ", 503);
  }
}
