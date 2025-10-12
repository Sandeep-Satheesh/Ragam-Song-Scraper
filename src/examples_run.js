const { discover } = require('./discover'); (async ()=>{ const r = await discover('Kalyani', 2); console.log('found', r.length, 'urls'); console.log(r.slice(0,30)); })();
