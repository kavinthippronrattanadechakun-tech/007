import { admin } from "./server";
export function lineCredentialsReady() {
  return (
    !!process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim() &&
    !!process.env.LINE_CHANNEL_SECRET?.trim()
  );
}
export async function pushLine(to: string, text: string, retryKey: string) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
  if (!token) return { ok: false, error: "not_configured", retryable: false };
  try {
    const response = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Line-Retry-Key": retryKey,
      },
      body: JSON.stringify({ to, messages: [{ type: "text", text }] }),
      signal: AbortSignal.timeout(5000),
    });
    // Only this specific 409 means LINE already accepted the same retry key.
    const ok =
      response.ok ||
      (response.status === 409 &&
        !!response.headers.get("x-line-accepted-request-id"));
    return {
      ok,
      error: ok ? null : `line_http_${response.status}`,
      retryable: response.status === 429 || response.status >= 500,
    };
  } catch {
    return { ok: false, error: "network_error", retryable: true };
  }
}
export async function dispatchLineOrders(
  orderId: string | null = null,
  limit = 3,
) {
  if (!lineCredentialsReady()) return { sent: 0, failed: 0, configured: false };
  const db = admin();
  let sent = 0,
    failed = 0;
  for (let i = 0; i < limit; i++) {
    const { data: job, error } = await db.rpc("claim_line_order_notification", {
      p_order: orderId,
    });
    if (error) throw Error("line_queue_unavailable");
    if (!job) break;
    const result = await pushLine(job.to, job.text, job.retry_key);
    const { data: finished, error: finishError } = await db.rpc(
      "finish_line_order_notification",
      {
        p_id: job.id,
        p_lease: job.lease_token,
        p_success: result.ok,
        p_error: result.error,
        p_retryable: result.retryable,
      },
    );
    if (finishError || !finished) throw Error("line_queue_update_failed");
    if (result.ok) sent++;
    else failed++;
  }
  return { sent, failed, configured: true };
}
