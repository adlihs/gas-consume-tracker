import {env} from 'cloudflare:workers';
export function database(){if(!env.DB)throw Error('Base de datos no disponible.');return env.DB;}
