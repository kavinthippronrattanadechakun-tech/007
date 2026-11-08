export async function GET(){return Response.json({bank:process.env.BANK_NAME||'',name:process.env.BANK_ACCOUNT_NAME||'',number:process.env.BANK_ACCOUNT_NUMBER||''})}
