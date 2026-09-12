import {database} from '@/db/raw';
import {createGarageAPI} from '@/lib/garage-api';
export const dynamic='force-dynamic';
const api=createGarageAPI(database);
export const GET=api.GET;
export const PUT=api.PUT;
