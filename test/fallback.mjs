import { Miniflare } from 'miniflare';
const H=3600000;
const mk=(s,e)=>{const o=[];for(let t=Math.ceil(s/H)*H;t<e;t+=H)o.push(t);return o};
for (const mode of ['hl','okx']) {
const mf = new Miniflare({ scriptPath: 'dist/worker.js', modules: true, compatibilityDate: '2024-11-01', d1Databases: ['DB'], bindings: { ADMIN_ADDRESS: '0x0' },
  outboundService: async (req) => { const u = new URL(req.url);
    if (u.host.includes('binance')) return new Response('restricted', { status: 451 });
    if (u.host.includes('okx') && mode==='okx') {
      if (u.pathname.endsWith('/tickers')) return Response.json({data:[{instId:'BTC-USDT',last:'90000',open24h:'88000',volCcy24h:'5'},{instId:'ETH-USDT',last:'3000',open24h:'3100',volCcy24h:'5'},{instId:'SOL-USDT',last:'150',open24h:'140',volCcy24h:'5'},{instId:'DOGE-USDT',last:'0.2',open24h:'0.2',volCcy24h:'5'},{instId:'XRP-USDT',last:'2',open24h:'2',volCcy24h:'5'}]});
      if (u.pathname.endsWith('/history-candles')) { const a=+u.searchParams.get('after'); return Response.json({data: mk(a-100*H,a).reverse().map(t=>[''+t,'1','1','1','90000','1','1','1','1'])}); }
    }
    if (u.host.includes('hyperliquid') && mode==='hl') { const b = await req.json();
      if (b.type==='metaAndAssetCtxs') return Response.json([{universe:['BTC','ETH','SOL','XRP','DOGE','kPEPE'].map(name=>({name}))}, Array(6).fill({markPx:'100',prevDayPx:'99',dayNtlVlm:'1',funding:'0',openInterest:'1'})]);
      if (b.type==='candleSnapshot') return Response.json(mk(b.req.startTime,b.req.endTime).map(t=>({t,T:t+H-1,c:'100'})));
    }
    return new Response('blocked', { status: 503 }); } });
let r = await mf.dispatchFetch('https://x/api/markets?kind=crypto'); const m = await r.json();
console.log(mode, 'markets', m.available, m.rows.length, m.rows.slice(0,2).map(x=>x.symbol+'='+x.price), m.error||'');
r = await mf.dispatchFetch('https://x/api/candles?market=crypto:BTC&hours=300'); const c = await r.json();
console.log(mode, 'candles', r.status, c.bars?.length, c.error||'');
await mf.dispose(); }
