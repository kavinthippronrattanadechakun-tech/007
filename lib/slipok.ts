export class SlipOKError extends Error {
  retryable: boolean;
  quota: boolean;
  uncertain: boolean;
  constructor(
    message: string,
    { retryable = false, quota = false, uncertain = false } = {},
  ) {
    super(message);
    this.retryable = retryable;
    this.quota = quota;
    this.uncertain = uncertain;
  }
}
export function slipOKConfig() {
  const key = process.env.SLIPOK_API_KEY?.trim(),
    branch = process.env.SLIPOK_BRANCH_ID?.trim(),
    day = Number(process.env.SLIPOK_CYCLE_DAY || 8);
  return key &&
    branch &&
    /^\d+$/.test(branch) &&
    Number.isInteger(day) &&
    day >= 1 &&
    day <= 31
    ? { key, branch, day }
    : null;
}
const aliases: [string, string[]][] = [
  ["002", ["กรุงเทพ", "BBL"]],
  ["004", ["กสิกร", "KBANK"]],
  ["006", ["กรุงไทย", "KTB"]],
  ["011", ["ทหารไทยธนชาต", "TTB"]],
  ["014", ["ไทยพาณิชย์", "SCB"]],
  ["022", ["ซีไอเอ็มบี", "CIMB"]],
  ["024", ["ยูโอบี", "UOB"]],
  ["025", ["กรุงศรี", "BAY"]],
  ["030", ["ออมสิน", "GSB"]],
  ["033", ["อาคารสงเคราะห์", "GHB"]],
  ["034", ["เพื่อการเกษตร", "ธ.ก.ส", "BAAC"]],
  ["067", ["ทิสโก้", "TISCO"]],
  ["069", ["เกียรตินาคิน", "KKP"]],
  ["070", ["ไอซีบีซี", "ICBC"]],
  ["071", ["ไทยเครดิต", "TCD"]],
  ["073", ["แลนด์แอนด์เฮ้าส์", "LHFG"]],
];
export function bankCode(name: string) {
  const n = name.toUpperCase().replace(/\s/g, "");
  const matches = aliases.filter(([, list]) =>
    list.some((s) => n.includes(s.toUpperCase().replace(/\s/g, ""))),
  );
  return matches.length === 1 ? matches[0][0] : null;
}
export function accountMatches(mask: unknown, expected: string) {
  if (typeof mask !== "string") return false;
  const m = mask.replace(/[ -]/g, ""),
    account = expected.replace(/[ -]/g, "");
  return (
    /^[0-9]{5,40}$/.test(account) &&
    /^[0-9xX*•]+$/.test(m) &&
    m.length === account.length &&
    (m.match(/[0-9]/g) || []).length >= 4 &&
    [...m].every((v, i) => /[xX*•]/.test(v) || v === account[i])
  );
}
export type ExpectedSlip = {
  amount: number;
  bankCode: string;
  accountNumber: string;
  earliestDate?: number;
  now?: number;
};
export function parseSlipOK(value: unknown, expected: ExpectedSlip) {
  const body = value as any,
    data = body?.data;
  if (body?.success !== true || data?.success !== true || body?.code) {
    const code = Number(body?.code);
    if (code === 1012)
      throw new SlipOKError("สลิปนี้เคยใช้แล้ว ไม่สามารถใช้เติมเงินซ้ำได้");
    if (code === 1013)
      throw new SlipOKError("ยอดโอนในสลิปไม่ตรงกับยอดเติมเงิน");
    if (code === 1014) throw new SlipOKError("ผู้รับเงินไม่ตรงกับบัญชีร้าน");
    if ([1005, 1006, 1007, 1008, 1011].includes(code))
      throw new SlipOKError(
        "ไม่พบธุรกรรมที่ตรวจสอบได้จากสลิปนี้ กรุณาตรวจรูปและ QR Code",
      );
    throw new SlipOKError(
      "บริการยังยืนยันสลิปไม่ได้ ส่งรายการให้แอดมินตรวจสอบต่อ",
      { retryable: true, quota: code === 1003 || code === 1004 },
    );
  }
  if (typeof data.amount !== "number")
    throw new SlipOKError("ผลตรวจยอดเงินไม่ครบ ส่งให้แอดมินตรวจสอบต่อ", {
      retryable: true,
    });
  if (data.amount !== expected.amount)
    throw new SlipOKError("ยอดโอนในสลิปไม่ตรงกับยอดเติมเงิน");
  // log:true makes SlipOK validate the receiver against its registered branch account.
  // The returned masked number is only an additional consistency check, not identity proof by itself.
  if (
    data.countryCode !== "TH" ||
    data.receivingBank !== expected.bankCode ||
    !accountMatches(data.receiver?.account?.value, expected.accountNumber) ||
    !(data.receiver?.displayName || data.receiver?.name)
  )
    throw new SlipOKError(
      "ข้อมูลผู้รับจากผลตรวจไม่สอดคล้องกับบัญชีร้าน ส่งให้แอดมินตรวจสอบต่อ",
      { retryable: true },
    );
  if (
    typeof data.transRef !== "string" ||
    !/^[A-Za-z0-9_-]{6,200}$/.test(data.transRef)
  )
    throw new SlipOKError("เลขอ้างอิงไม่ครบถ้วน ส่งให้แอดมินตรวจสอบต่อ", {
      retryable: true,
    });
  let date: number;
  if (
    typeof data.transTimestamp === "string" &&
    /(Z|[+-]\d{2}:?\d{2})$/i.test(data.transTimestamp)
  )
    date = Date.parse(data.transTimestamp);
  else if (
    /^\d{8}$/.test(data.transDate) &&
    /^\d{2}:\d{2}:\d{2}$/.test(data.transTime)
  )
    date = Date.parse(
      `${data.transDate.slice(0, 4)}-${data.transDate.slice(4, 6)}-${data.transDate.slice(6, 8)}T${data.transTime}+07:00`,
    );
  else date = NaN;
  const now = expected.now ?? Date.now();
  if (!Number.isFinite(date))
    throw new SlipOKError("ผลตรวจวันเวลาไม่ครบ ส่งให้แอดมินตรวจสอบต่อ", {
      retryable: true,
    });
  if (
    date > now + 300000 ||
    date < Math.max(now - 86400000, expected.earliestDate ?? 0)
  )
    throw new SlipOKError(
      "กรุณาใช้สลิปโอนใหม่ภายใน 24 ชั่วโมง หรือติดต่อร้านค้า",
    );
  return {
    reference: data.transRef.toUpperCase(),
    amount: expected.amount,
    transferAt: new Date(date).toISOString(),
  };
}
export async function getSlipOKQuota(
  config: NonNullable<ReturnType<typeof slipOKConfig>>,
) {
  const r = await fetch(
    `https://api.slipok.com/api/line/apikey/${config.branch}/quota`,
    {
      headers: { "x-authorization": config.key },
      signal: AbortSignal.timeout(8000),
      redirect: "error",
      cache: "no-store",
    },
  );
  const body = await r.json();
  if (
    !r.ok ||
    body.success !== true ||
    !Number.isFinite(body.data?.quota) ||
    body.data.quota < 0 ||
    !Number.isFinite(body.data.overQuota)
  )
    throw new SlipOKError("ตรวจโควต้า SlipOK ไม่สำเร็จ", { retryable: true });
  return body.data.overQuota > 0 ? 0 : Math.floor(body.data.quota);
}
export async function verifySlipOK(
  file: File,
  expected: ExpectedSlip,
  config: NonNullable<ReturnType<typeof slipOKConfig>>,
) {
  const form = new FormData();
  form.append("files", file);
  form.append("log", "true");
  form.append("amount", String(expected.amount));
  try {
    const r = await fetch(
      `https://api.slipok.com/api/line/apikey/${config.branch}`,
      {
        method: "POST",
        headers: { "x-authorization": config.key },
        body: form,
        signal: AbortSignal.timeout(30000),
        redirect: "error",
      },
    );
    const body = await r.json();
    if (!r.ok && body?.success === true)
      throw new SlipOKError("ผลตรวจไม่สมบูรณ์ ส่งให้แอดมินตรวจสอบต่อ", {
        retryable: true,
      });
    return parseSlipOK(body, expected);
  } catch (e) {
    if (e instanceof SlipOKError) throw e;
    throw new SlipOKError("บริการตรวจสลิปขัดข้อง ส่งให้แอดมินตรวจสอบต่อ", {
      retryable: true,
      uncertain: true,
    });
  }
}
export function validSlipImage(bytes: Uint8Array, type: string) {
  return type === "image/jpeg"
    ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : type === "image/png"
      ? [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)
      : type === "image/webp"
        ? String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
          String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
        : false;
}
