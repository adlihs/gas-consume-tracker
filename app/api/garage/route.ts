import {env} from 'cloudflare:workers';
import {auth} from '@/lib/auth-runtime';
import {database} from '@/db/raw';
import {createGarageAPI} from '@/lib/garage-api';
export const dynamic='force-dynamic';
const api=createGarageAPI(database,auth.owner,()=>env);
export const GET=api.GET;
export const PUT=api.PUT;
