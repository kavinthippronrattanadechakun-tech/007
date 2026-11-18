import { dispatchLineOrders } from "../../../../lib/line-notifications";
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return Response.json(await dispatchLineOrders(null, 3));
  } catch {
    return Response.json({ error: "LINE queue unavailable" }, { status: 503 });
  }
}
