import {supabaseUrl} from './supabase-config';
import {createClient} from '@supabase/supabase-js';
export function admin(){const url=process.env.NEXT_PUBLIC_SUPABASE_URL, key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw Error('Missing Supabase server configuration');return createClient(supabaseUrl(url),key.trim(),{auth:{persistSession:false}})}
export async function user(req:Request){const token=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'');if(!token)return null;const {data,error}=await admin().auth.getUser(token);return error?null:data.user}
export async function isAdmin(uid:string){const {data}=await admin().from('profiles').select('is_admin').eq('id',uid).single();return data?.is_admin===true}
export const fail=(message:string,status=400)=>Response.json({error:message},{status});
