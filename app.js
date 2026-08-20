const BASE="https://fapi.binance.com";

const FIXED={
  HYPEUSDT:{
    name:"HYPE",
    arch:"FIXED",
    threshold:0.536
  },
  PENDLEUSDT:{
    name:"PENDLE",
    arch:"FIXED",
    threshold:0.8454635976569357
  },
  POPCATUSDT:{
    name:"POPCAT",
    arch:"EXPANDING80"
  }
};

let selected="HYPEUSDT";
let popcatHistory=null;

const $=id=>document.getElementById(id);

function fmtMoney(x){
  if(x==null||!isFinite(x)) return "—";
  if(x>=1e9) return "$"+(x/1e9).toFixed(2)+"B";
  if(x>=1e6) return "$"+(x/1e6).toFixed(2)+"M";
  if(x>=1e3) return "$"+(x/1e3).toFixed(1)+"K";
  return "$"+x.toFixed(2);
}

function q(arr,p){
  const a=arr.filter(Number.isFinite).slice().sort((x,y)=>x-y);
  if(!a.length) return NaN;

  const i=(a.length-1)*p;
  const lo=Math.floor(i);
  const hi=Math.ceil(i);

  return lo===hi
    ? a[lo]
    : a[lo]+(a[hi]-a[lo])*(i-lo);
}

async function jget(url){
  const r=await fetch(url,{cache:"no-store"});
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function serverTime(){
  return Number(
    (await jget(`${BASE}/fapi/v1/time`)).serverTime
  );
}

async function latestOI(symbol,now){
  const rows=await jget(
    `${BASE}/futures/data/openInterestHist?symbol=${symbol}&period=5m&limit=10`
  );

  const use=rows
    .filter(x=>Number(x.timestamp)<=now)
    .sort((a,b)=>Number(a.timestamp)-Number(b.timestamp));

  if(!use.length){
    throw new Error("Нет causal OI");
  }

  const x=use[use.length-1];
  const ts=Number(x.timestamp);

  return {
    value:Number(x.sumOpenInterestValue),
    ts,
    age:(now-ts)/60000
  };
}

async function turnover24(symbol,now){
  const rows=await jget(
    `${BASE}/fapi/v1/klines?symbol=${symbol}&interval=1m&limit=1500`
  );

  const closed=rows.filter(
    x=>Number(x[6])<now
  );

  if(closed.length<1440){
    throw new Error("Недостаточно закрытых 1m свечей");
  }

  const last=closed.slice(-1440);

  return last.reduce(
    (s,x)=>s+Number(x[7]),
    0
  );
}

async function loadSeed(){
  if(popcatHistory){
    return popcatHistory;
  }

  const response=await fetch(
    "popcat_ratio_history.csv",
    {cache:"no-store"}
  );

  const txt=await response.text();

  popcatHistory=txt
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map(line=>{
      const k=line.lastIndexOf(",");

      return {
        ts:Date.parse(line.slice(0,k)),
        ratio:Number(line.slice(k+1))
      };
    })
    .filter(
      x=>Number.isFinite(x.ts)&&Number.isFinite(x.ratio)
    );

  return popcatHistory;
}

async function fetchOiRange(symbol,start,end){
  let out=[];
  let cursor=start;

  for(
    let guard=0;
    guard<30 && cursor<=end;
    guard++
  ){
    const url=
      `${BASE}/futures/data/openInterestHist`+
      `?symbol=${symbol}`+
      `&period=5m`+
      `&limit=500`+
      `&startTime=${cursor}`+
      `&endTime=${end}`;

    const rows=await jget(url);

    if(!rows.length){
      break;
    }

    for(const x of rows){
      const ts=Number(x.timestamp);

      if(ts>=start && ts<=end){
        out.push({
          ts,
          value:Number(x.sumOpenInterestValue)
        });
      }
    }

    let last=-Infinity;

    for(const x of rows){
      const v=Number(x.timestamp);

      if(v>last){
        last=v;
      }
    }

    const next=last+300000;

    if(next<=cursor){
      break;
    }

    cursor=next;

    if(rows.length<500){
      break;
    }
  }

  const m=new Map();

  for(const x of out){
    m.set(x.ts,x);
  }

  return [...m.values()]
    .sort((a,b)=>a.ts-b.ts);
}

async function klinesRange(symbol,start,end){
  let out=[];
  let cursor=start;

  for(
    let guard=0;
    guard<30 && cursor<=end;
    guard++
  ){
    const rows=await jget(
      `${BASE}/fapi/v1/klines`+
      `?symbol=${symbol}`+
      `&interval=1m`+
      `&limit=1500`+
      `&startTime=${cursor}`+
      `&endTime=${end}`
    );

    if(!rows.length){
      break;
    }

    for(const x of rows){
      out.push({
        ot:Number(x[0]),
        ct:Number(x[6]),
        qv:Number(x[7])
      });
    }

    let last=-Infinity;

    for(const x of rows){
      const v=Number(x[0]);

      if(v>last){
        last=v;
      }
    }

    const next=last+60000;

    if(next<=cursor){
      break;
    }

    cursor=next;

    if(rows.length<1500){
      break;
    }
  }

  const m=new Map();

  for(const x of out){
    m.set(x.ot,x);
  }

  return [...m.values()]
    .sort((a,b)=>a.ot-b.ot);
}

async function popcatThreshold(currentTs,now){
  const seed=await loadSeed();

  let lastSeed=-Infinity;

  for(const x of seed){
    if(x.ts>lastSeed){
      lastSeed=x.ts;
    }
  }

  let all=seed.filter(
    x=>x.ts<currentTs
  );

  if(lastSeed+300000<currentTs){

    const start=lastSeed+300000;

    const oi=await fetchOiRange(
      "POPCATUSDT",
      start,
      Math.min(now,currentTs-1)
    );

    if(oi.length){

      const k=await klinesRange(
        "POPCATUSDT",
        oi[0].ts-1445*60000,
        Math.min(
          now,
          oi[oi.length-1].ts+60000
        )
      );

      const map=new Map(
        k.map(
          x=>[x.ot,x.qv]
        )
      );

      for(const o of oi){

        let sum=0;
        let ok=true;

        for(let i=1440;i>=1;i--){

          const v=map.get(
            o.ts-i*60000
          );

          if(v==null){
            ok=false;
            break;
          }

          sum+=v;
        }

        if(
          ok &&
          sum>0 &&
          o.ts<currentTs
        ){
          all.push({
            ts:o.ts,
            ratio:o.value/sum
          });
        }
      }
    }
  }

  return {
    threshold:q(
      all.map(x=>x.ratio),
      0.80
    ),
    count:all.length,
    start:all.length
      ? new Date(all[0].ts).toISOString()
      : ""
  };
}

function drawMeta(){

  const c=FIXED[selected];

  $("dSymbol").textContent=c.name;
  $("dArch").textContent=c.arch;

  $("dThreshold").textContent=
    selected==="POPCATUSDT"
      ? "dynamic"
      : c.threshold.toFixed(6);

  $("historyRow").hidden=
    selected!=="POPCATUSDT";
}

async function check(){

  const c=FIXED[selected];
  const btn=$("checkBtn");

  btn.disabled=true;
  btn.textContent="Проверяю…";

  $("state").className=
    "state neutral";

  $("state").textContent=
    "⚪ Проверяю Binance…";

  try{

    const now=await serverTime();

    const [oi,turn]=await Promise.all([
      latestOI(selected,now),
      turnover24(selected,now)
    ]);

    if(oi.age>10){
      throw new Error(
        `OI устарел: ${oi.age.toFixed(1)} мин`
      );
    }

    const ratio=oi.value/turn;

    let threshold;

    if(selected==="POPCATUSDT"){

      const h=await popcatThreshold(
        oi.ts,
        now
      );

      threshold=h.threshold;

      $("dHistory").textContent=
        `${h.count.toLocaleString()} causal точек • `+
        `с ${h.start.slice(0,10)}`;

    }else{

      threshold=c.threshold;
    }

    if(!Number.isFinite(threshold)){
      throw new Error(
        "Не удалось рассчитать threshold"
      );
    }

    const on=
      ratio<=threshold;

    $("state").className=
      "state "+(on?"green":"red");

    $("state").textContent=
      on
        ? "🟢 ФЕЯ ON — Entry1 разрешён"
        : "🔴 ФЕЯ OFF — Entry1 запрещён";

    $("reason").textContent=
      `${ratio.toFixed(6)} `+
      `${on?"≤":">"} `+
      `${threshold.toFixed(6)}`;

    $("dRatio").textContent=
      ratio.toFixed(6);

    $("dThreshold").textContent=
      threshold.toFixed(6);

    $("dOi").textContent=
      fmtMoney(oi.value);

    $("dTurn").textContent=
      fmtMoney(turn);

    $("dAge").textContent=
      oi.age.toFixed(1)+" мин";

    $("dChecked").textContent=
      new Date(now)
        .toLocaleString("ru-RU");

  }catch(e){

    $("state").className=
      "state error";

    $("state").textContent=
      "🟠 ERROR — Entry1 OFF";

    $("reason").textContent=
      String(e.message||e);

  }finally{

    btn.disabled=false;

    btn.textContent=
      "Проверить Фею";
  }
}

document
  .querySelectorAll(".tab")
  .forEach(b=>{

    b.onclick=()=>{

      document
        .querySelectorAll(".tab")
        .forEach(
          x=>x.classList.remove("active")
        );

      b.classList.add("active");

      selected=b.dataset.symbol;

      drawMeta();

      $("state").className=
        "state neutral";

      $("state").textContent=
        "⚪ Нажми «Проверить Фею»";

      $("reason").textContent=
        "Статус ещё не рассчитан.";
    };
  });

$("checkBtn").onclick=check;

drawMeta();
