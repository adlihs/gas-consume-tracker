import handler from 'vinext/server/fetch-handler';
export default {
 async fetch(request:Request,env:Cloudflare.Env,ctx:ExecutionContext){
  // The public Worker never trusts the identity headers used by the old Sites deployment.
  const headers=new Headers(request.headers);
  for(const name of [...headers.keys()])if(name.startsWith('oai-authenticated-user-'))headers.delete(name);
  const response=await handler.fetch(new Request(request,{headers}),env,ctx);
  const safe=new Response(response.body,response);
  safe.headers.set('X-Content-Type-Options','nosniff');
  safe.headers.set('Referrer-Policy','strict-origin-when-cross-origin');
  safe.headers.set('X-Frame-Options','DENY');
  safe.headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  if(new URL(request.url).protocol==='https:')safe.headers.set('Strict-Transport-Security','max-age=31536000');
  return safe;
 }
};
