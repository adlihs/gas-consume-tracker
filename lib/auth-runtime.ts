import {env} from 'cloudflare:workers';
import {database} from '@/db/raw';
import {createAuth} from './auth';
export const auth=createAuth(database,()=>env);
