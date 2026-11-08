export class SlipCheckError extends Error {
  retryable: boolean;
  constructor(message: string, retryable = false) {
    super(message);
    this.retryable = retryable;
  }
}
const banks: [string, string[]][] = [
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
  ["034", ["ธ.ก.ส", "เพื่อการเกษตร", "BAAC"]],
  ["035", ["ส่งออกและนำเข้า", "EXIM"]],
  ["067", ["ทิสโก้", "TISCO"]],
  ["069", ["เกียรตินาคิน", "KKP"]],
  ["070", ["ไอซีบีซี", "ICBC"]],
  ["071", ["ไทยเครดิต", "TCD"]],
  ["073", ["แลนด์แอนด์เฮ้าส์", "LHFG"]],
  ["088", ["คลิกซ์", "CLICX"]],
  ["098", ["พัฒนาวิสาหกิจ", "SME"]],
];
export function bankCodeForName(name: string) {
  const text = name.toUpperCase().replace(/\s/g, "");
  const found = banks.filter(([, aliases]) =>
    aliases.some((v) => text.includes(v.toUpperCase().replace(/\s/g, ""))),
  );
  return found.length === 1 ? found[0][0] : null;
}
const digits = (value: unknown) =>
  typeof value === "string" ? value.replace(/[ -]/g, "") : "";
const normalized = (value: unknown) =>
  typeof value === "string"
    ? value
        .normalize("NFKC")
        .replace(/[\s.\-]/g, "")
        .toLowerCase()
    : "";
export type SlipExpectation = {
  amount: number;
  bankName: string;
  accountName: string;
  accountNumber: string;
  bankCode: string;
  now?: number;
  earliestDate?: number;
};
export function validateEasySlip(value: unknown, expected: SlipExpectation) {
  const body = value as any;
  const data = body?.data,
    raw = data?.rawSlip,
    matched = data?.matchedAccount;
  if (body?.success !== true) {
    const code = body?.error?.code;
    if (code === "SLIP_NOT_FOUND" || code === "INVALID_IMAGE_FORMAT")
      throw new SlipCheckError(
        "ไม่พบธุรกรรมที่ยืนยันได้จากสลิปนี้ กรุณาตรวจรูปและ QR Code",
      );
    throw new SlipCheckError(
      "บริการตรวจสลิปยังยืนยันรายการไม่ได้ กรุณารอหรือติดต่อร้านค้า",
      true,
    );
  }
  if (data?.isDuplicate !== false)
    throw new SlipCheckError(
      data?.isDuplicate === true
        ? "สลิปนี้เคยถูกใช้แล้ว"
        : "ผลตรวจรายการซ้ำไม่ครบถ้วน กรุณาติดต่อร้านค้า",
      data?.isDuplicate !== true,
    );
  if (
    data.isAmountMatched !== true ||
    data.amountInSlip !== expected.amount ||
    raw?.amount?.amount !== expected.amount
  )
    throw new SlipCheckError("ยอดโอนในธุรกรรมไม่ตรงกับยอดเติมเงิน");
  if (
    raw.countryCode !== "TH" ||
    (raw.amount.local?.currency && raw.amount.local.currency !== "THB")
  )
    throw new SlipCheckError("รองรับเฉพาะธุรกรรมเงินบาทในประเทศไทย");
  const account = digits(expected.accountNumber);
  if (
    !/^[0-9]{5,40}$/.test(account) ||
    !matched ||
    digits(matched.bankNumber) !== account ||
    matched.bank?.code !== expected.bankCode ||
    raw.receiver?.bank?.id !== expected.bankCode ||
    ![matched.nameTh, matched.nameEn].some(
      (name) =>
        normalized(name) &&
        normalized(name) === normalized(expected.accountName),
    )
  )
    throw new SlipCheckError("บัญชีผู้รับเงินไม่ตรงกับบัญชีร้านค้า");
  const reference = raw.transRef;
  if (
    typeof reference !== "string" ||
    !/^[a-zA-Z0-9_-]{6,200}$/.test(reference)
  )
    throw new SlipCheckError(
      "เลขอ้างอิงธุรกรรมไม่ครบถ้วน กรุณาติดต่อร้านค้า",
      true,
    );
  const date = Date.parse(raw.date),
    now = expected.now ?? Date.now(),
    earliest = Math.max(now - 86400000, expected.earliestDate ?? 0);
  if (!Number.isFinite(date) || date > now + 300000 || date < earliest)
    throw new SlipCheckError(
      "วันที่โอนไม่อยู่ในช่วงที่รับเติมเงิน กรุณาใช้สลิปโอนใหม่ภายใน 24 ชั่วโมง",
    );
  return {
    reference: reference.toUpperCase(),
    amount: expected.amount,
    transferAt: new Date(date).toISOString(),
  };
}
export async function verifySlip(
  file: File,
  expected: SlipExpectation,
  apiKey: string,
) {
  const body = new FormData();
  body.append("image", file);
  body.append("matchAccount", "true");
  body.append("matchAmount", String(expected.amount));
  body.append("checkDuplicate", "true");
  try {
    const response = await fetch("https://api.easyslip.com/v2/verify/bank", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body,
      signal: AbortSignal.timeout(20000),
      redirect: "error",
    });
    const result = await response.json();
    if (!response.ok && result?.success === true)
      throw new SlipCheckError("บริการตรวจสลิปตอบกลับไม่สมบูรณ์", true);
    return validateEasySlip(result, expected);
  } catch (e) {
    if (e instanceof SlipCheckError) throw e;
    throw new SlipCheckError(
      "ติดต่อบริการตรวจสลิปไม่ได้ รายการยังไม่ได้เพิ่มยอด กรุณาติดต่อร้านค้า",
      true,
    );
  }
}
export function isSlipImage(bytes: Uint8Array, type: string) {
  return type === "image/jpeg"
    ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : type === "image/png"
      ? [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n)
      : type === "image/webp"
        ? String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
          String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
        : false;
}
