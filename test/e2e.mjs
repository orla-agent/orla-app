import { Miniflare } from 'miniflare';
import { privateKeyToAccount } from 'viem/accounts';
const H=3600000;
const mkK=(start,end)=>{const out=[];let p=60000;for(let t=Math.ceil(start/H)*H;t<end;t+=H){p*=1+Math.sin(t/H/30)*0.003+(Math.sin(t/7e6)*0.004);out.push([t,''+p,''+p,''+p,''+p,'1',t+H-1,'1',1,'1','1','0'])}return out};
const mf = new Miniflare({
  scriptPath: 'dist/worker.js', modules: true, compatibilityDate: '2024-11-01',
  d1Databases: ['DB'], bindings: { ADMIN_ADDRESS: '0x0' },
  outboundService: async (req) => {
    const u = new URL(req.url);
    if (u.host.includes('binance')) {
      if (u.pathname.endsWith('/klines')) { const s=+u.searchParams.get('startTime'), e=+u.searchParams.get('endTime'); return Response.json(mkK(s,e).slice(0,1000)); }
      if (u.pathname.endsWith('/24hr')) { const syms = JSON.parse(u.searchParams.get('symbols')||'["BTCUSDT"]'); return Response.json(syms.map(s=>({symbol:s,lastPrice:'100',openPrice:'98',quoteVolume:'1000'}))); }
    }
    if (u.host.includes('hyperliquid')) {
      const b = await req.json();
      if (b.type==='metaAndAssetCtxs') return Response.json([{universe:[{name:'BTC',szDecimals:5},{name:'ETH',szDecimals:4}]},[{markPx:'64000',prevDayPx:'63000',dayNtlVlm:'1',funding:'0.0000125',openInterest:'10'},{markPx:'1800',prevDayPx:'1810',dayNtlVlm:'1',funding:'0.00001',openInterest:'10'}]]);
      if (b.type==='candleSnapshot') return Response.json(mkK(b.req.startTime,b.req.endTime).map(k=>({t:k[0],T:k[6],c:k[4],o:k[1]})));
      if (b.type==='fundingHistory') return Response.json([]);
    }
    return new Response('blocked', { status: 503 });
  },
});
const acct = privateKeyToAccount('0x'+'11'.repeat(32));
const f = (p, o={}) => mf.dispatchFetch('https://orla.test'+p, o);
let r = await f('/api/stats'); console.log('stats', await r.text());
r = await f('/api/auth/nonce',{method:'POST',body:JSON.stringify({address:acct.address})}); const {message}=await r.json();
const signature = await acct.signMessage({message});
r = await f('/api/auth/verify',{method:'POST',body:JSON.stringify({address:acct.address,message,signature})}); const ck=r.headers.get('set-cookie').split(';')[0]; console.log('verify', r.status, await r.text());
const H2={cookie:ck,'content-type':'application/json'};
for (const [name,strategy,market,params] of [['Alpha One','momentum','crypto:BTC',{}],['Perp Short','custom','perp:BTC',{side:'short',leverage:2,fast:6,slow:24}],['Dippy','dip','crypto:ETH',{}]]) {
  r = await f('/api/me/agents',{method:'POST',headers:H2,body:JSON.stringify({name,strategy,market,mode:'paper',params})}); const j=await r.json(); console.log('create', r.status, j.error||[j.agent.name,j.agent.returnPct,j.agent.backtest]);
}
r = await f('/api/me/agents',{headers:H2}); const mine=(await r.json()).agents; console.log('mine', mine.length);
await mf.getDatabase? null:null;
// make agents due and run cron
const db = await mf.getD1Database('DB'); await db.prepare('UPDATE agents SET next_run_at = 0, created_at = created_at - 200000000').run();
await (await mf.getWorker()).scheduled({ scheduledTime: Date.now(), cron:'*/5 * * * *' });
r = await f('/api/health'); console.log('health', await r.text());
r = await f('/api/agents/leaderboard?minTrades=0&age=0'); console.log('lb', (await r.json()).agents.map(a=>[a.name,a.trades,a.returnPct.toFixed(2)]));
r = await f('/api/agents/'+mine[0].id); const d=(await r.json()).agent; console.log('detail', d.decisions.length, d.curve.length, d.decisions[0]);
r = await f('/api/agents/feed?limit=3'); console.log('feed', (await r.text()).slice(0,200));
r = await f('/api/agents/top'); console.log('top', (await r.text()).slice(0,150));
r = await f('/api/me/agents/'+mine[0].id,{method:'POST',headers:H2,body:JSON.stringify({action:'edit',params:{trail:7}})}); console.log('edit', await r.text());
r = await f('/og/agent/'+mine[0].id); console.log('og', r.status, (await r.text()).length);
r = await f('/agent/?id='+mine[0].id); const html=await r.text(); console.log('agentpage', r.status, html.match(/<title>[^<]+/)[0]);
r = await f('/api/candles?market=stock:AAPL&hours=200'); console.log('stock candles', r.status, (await r.text()).slice(0,100));
r = await f('/api/markets?kind=stock'); console.log('stock tick', (await r.text()).slice(0,100));
await mf.dispose();
