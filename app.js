const BASE="https://fapi.binance.com";
const DAY=86400000;
const PENDLE_REGIME_THRESHOLD=0.0125388259225173;
const PENDLE_REGIME_RULE_VERSION="PENDLE_FAIRY_REGIME_V1_FROZEN";

const FIXED={
  HYPEUSDT:{
    name:"HYPE",
    arch:"FIXED",
    threshold:0.536,
    htfRule:"NONE"
  },
  PENDLEUSDT:{
    name:"PENDLE",
    arch:"FIXED",
    threshold:0.8454635976569357,
    htfRule:"WR5"
  },
  POPCATUSDT:{
    name:"POPCAT",
    arch:"EXPANDING80",
    htfRule:"R40"
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

function fmtPrice(x){
  if(x==null||!isFinite(x)) return "—";
  if(x>=100) return x.toFixed(3);
  if(x>=1) return x.toFixed(5);
  return x.toFixed(7);
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

async function livePrice(symbol){
  const x=await jget(
    `${BASE}/fapi/v1/ticker/price?symbol=${symbol}`
  );
  const price=Number(x.price);
  if(!Number.isFinite(price)||price<=0){
    throw new Error("Нет live price");
  }
  return price;
}

async function loadSeed(){
  if(popcatHistory){
    return popcatHistory;
  }

  const response=await fetch(
    "popcat_ratio_history.csv",
    {cache:"no-store"}
  );

  if(!response.ok){
    throw new Error(`POPCAT history HTTP ${response.status}`);
  }

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

async function checkFairy(symbol,now){
  const c=FIXED[symbol];

  const [oi,turn]=await Promise.all([
    latestOI(symbol,now),
    turnover24(symbol,now)
  ]);

  if(oi.age>10){
    throw new Error(
      `OI устарел: ${oi.age.toFixed(1)} мин`
    );
  }

  const ratio=oi.value/turn;
  let threshold;
  let history=null;

  if(symbol==="POPCATUSDT"){
    history=await popcatThreshold(
      oi.ts,
      now
    );
    threshold=history.threshold;
  }else{
    threshold=c.threshold;
  }

  if(!Number.isFinite(threshold)){
    throw new Error(
      "Не удалось рассчитать Fairy threshold"
    );
  }

  return {
    allow:ratio<=threshold,
    ratio,
    threshold,
    oi,
    turn,
    history
  };
}


// ============================================================
// PENDLE MONTHLY FAIRY REGIME — frozen V1
// Static state is refreshed by GitHub Actions from exact Binance Vision D-1/D-8 metrics.
// If state is unavailable/invalid, fail safe = Fairy ON.
// ============================================================

function utcMonthId(ms){
  const d=new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}`;
}

function utcDateId(ms){
  const d=new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
}

function pendleRegimeExpected(now){
  const d=new Date(now);
  const monthStart=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1);
  return {
    period:utcMonthId(monthStart),
    d1:utcDateId(monthStart-DAY),
    d8:utcDateId(monthStart-8*DAY),
    nextMonth:utcMonthId(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1))
  };
}

function pendleRegimeFailsafe(now,reason){
  const e=pendleRegimeExpected(now);
  return {
    fairyOn:true,
    dataOk:false,
    failsafe:true,
    period:e.period,
    d1:e.d1,
    d8:e.d8,
    nextMonth:e.nextMonth,
    chg7:null,
    ratioD1:null,
    ratioD8:null,
    threshold:PENDLE_REGIME_THRESHOLD,
    source:"FAILSAFE",
    reason
  };
}

async function checkPendleRegime(now){
  const e=pendleRegimeExpected(now);
  try{
    const r=await fetch(
      `pendle_regime_state.json?v=${encodeURIComponent(e.period)}`,
      {cache:"no-store"}
    );
    if(!r.ok){
      return pendleRegimeFailsafe(now,`state HTTP ${r.status}`);
    }

    const x=await r.json();
    const ratioD1=Number(x.ratio_d1);
    const ratioD8=Number(x.ratio_d8);
    const chg7=Number(x.chg7 ?? x.strict_chg7);
    const threshold=Number(x.threshold);

    const valid=
      x.rule_version===PENDLE_REGIME_RULE_VERSION &&
      x.period===e.period &&
      x.d1===e.d1 &&
      x.d8===e.d8 &&
      x.data_ok===true &&
      Number.isFinite(ratioD1) && ratioD1>0 &&
      Number.isFinite(ratioD8) && ratioD8>0 &&
      Number.isFinite(chg7) &&
      Number.isFinite(threshold) &&
      Math.abs(threshold-PENDLE_REGIME_THRESHOLD)<1e-12 &&
      Math.abs((ratioD1/ratioD8-1)-chg7)<1e-8;

    if(!valid){
      return pendleRegimeFailsafe(now,"state validation failed");
    }

    const expectedOn=chg7<PENDLE_REGIME_THRESHOLD;
    const state=String(x.fairy_state||x.state||"").toUpperCase();
    const declaredOn=state==="ON" || state==="FAIRY_ON";
    const declaredOff=state==="OFF" || state==="FAIRY_OFF";

    if((expectedOn&&!declaredOn)||(!expectedOn&&!declaredOff)){
      return pendleRegimeFailsafe(now,"state/metric mismatch");
    }

    return {
      fairyOn:expectedOn,
      dataOk:true,
      failsafe:false,
      period:e.period,
      d1:e.d1,
      d8:e.d8,
      nextMonth:e.nextMonth,
      chg7,
      ratioD1,
      ratioD8,
      threshold:PENDLE_REGIME_THRESHOLD,
      source:String(x.source||"Binance Vision daily metrics"),
      reason:null
    };
  }catch(err){
    return pendleRegimeFailsafe(now,String(err?.message||err));
  }
}

// ============================================================
// HTF LONG — frozen WR5 / R40
// Causal structure only; current reference price is live.
// ============================================================

function utcDayStart(ms){
  const d=new Date(ms);
  return Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate()
  );
}

function mondayStart(ms){
  const d=new Date(ms);
  const day=d.getUTCDay(); // Sun=0 ... Sat=6
  const back=(day+6)%7;    // Mon -> 0, Sun -> 6
  return utcDayStart(ms)-back*DAY;
}

async function closedDaily(symbol,now,limit=500){
  const rows=await jget(
    `${BASE}/fapi/v1/klines?symbol=${symbol}&interval=1d&limit=${limit}`
  );

  return rows
    .filter(x=>Number(x[6])<now)
    .map(x=>({
      ot:Number(x[0]),
      ct:Number(x[6]),
      high:Number(x[2]),
      low:Number(x[3]),
      close:Number(x[4])
    }))
    .filter(x=>
      Number.isFinite(x.ot)&&
      Number.isFinite(x.high)&&
      Number.isFinite(x.low)&&
      Number.isFinite(x.close)
    )
    .sort((a,b)=>a.ot-b.ot);
}

function completeWeeksFromDaily(days){
  const groups=new Map();

  for(const d of days){
    const ws=mondayStart(d.ot);
    if(!groups.has(ws)){
      groups.set(ws,[]);
    }
    groups.get(ws).push(d);
  }

  const weeks=[];

  for(const [ws,g0] of groups.entries()){
    const g=g0.slice().sort((a,b)=>a.ot-b.ot);

    if(g.length!==7){
      continue;
    }

    let contiguous=true;
    for(let i=0;i<7;i++){
      if(g[i].ot!==ws+i*DAY){
        contiguous=false;
        break;
      }
    }
    if(!contiguous){
      continue;
    }

    weeks.push({
      weekStart:ws,
      weekEndSunday:ws+6*DAY,
      high:Math.max(...g.map(x=>x.high)),
      low:Math.min(...g.map(x=>x.low)),
      close:g[6].close
    });
  }

  return weeks.sort(
    (a,b)=>a.weekEndSunday-b.weekEndSunday
  );
}

function confirmedWeeklyPivots(weeks,now){
  const out=[];

  for(let k=2;k<weeks.length-2;k++){
    const w=weeks[k];

    const isHi=
      w.high>=weeks[k-1].high &&
      w.high>=weeks[k-2].high &&
      w.high>weeks[k+1].high &&
      w.high>weeks[k+2].high;

    const isLo=
      w.low<=weeks[k-1].low &&
      w.low<=weeks[k-2].low &&
      w.low<weeks[k+1].low &&
      w.low<weeks[k+2].low;

    // Backtest semantics:
    // W-SUN label + 15 days, i.e. only after both right weeks fully close.
    const availableFrom=
      w.weekEndSunday+15*DAY;

    if(availableFrom>now){
      continue;
    }

    if(isHi){
      out.push({
        kind:"RESISTANCE",
        level:w.high,
        pivotWeek:w.weekEndSunday,
        availableFrom
      });
    }

    if(isLo){
      out.push({
        kind:"SUPPORT",
        level:w.low,
        pivotWeek:w.weekEndSunday,
        availableFrom
      });
    }
  }

  return out;
}

async function pendleHTF(now,price){
  const days=await closedDaily(
    "PENDLEUSDT",
    now,
    500
  );

  if(days.length<400){
    throw new Error(
      `PENDLE HTF: мало complete daily bars (${days.length})`
    );
  }

  const weeks=completeWeeksFromDaily(days);

  if(weeks.length<54){
    throw new Error(
      `PENDLE HTF: мало complete weeks (${weeks.length})`
    );
  }

  const pivots=confirmedWeeklyPivots(
    weeks,
    now
  );

  const cutoff=now-365*DAY;

  const resistance=pivots
    .filter(x=>
      x.kind==="RESISTANCE" &&
      x.pivotWeek>=cutoff &&
      x.level>=price
    )
    .sort((a,b)=>a.level-b.level)[0];

  if(!resistance){
    return {
      allow:true,
      rule:"WR5",
      price,
      metric:"Нет confirmed weekly resistance сверху в окне 365d",
      reason:"HTF ALLOW",
      resistance:null,
      distPct:null,
      weeks:weeks.length,
      pivots:pivots.length
    };
  }

  const distPct=
    (resistance.level/price-1)*100;

  const allow=distPct>5.0;

  return {
    allow,
    rule:"WR5",
    price,
    metric:
      `Resistance ${fmtPrice(resistance.level)} • +${distPct.toFixed(2)}%`,
    reason:allow
      ? "Дальше 5% → ALLOW"
      : "≤5% сверху → BLOCK",
    resistance:resistance.level,
    distPct,
    weeks:weeks.length,
    pivots:pivots.length
  };
}

async function popcatHTF(now,price){
  const days=await closedDaily(
    "POPCATUSDT",
    now,
    220
  );

  if(days.length<180){
    throw new Error(
      `POPCAT HTF: мало complete daily bars (${days.length})`
    );
  }

  const last180=days.slice(-180);
  const high180=Math.max(
    ...last180.map(x=>x.high)
  );
  const low180=Math.min(
    ...last180.map(x=>x.low)
  );

  if(
    !Number.isFinite(high180) ||
    !Number.isFinite(low180) ||
    high180<=low180
  ){
    throw new Error(
      "POPCAT HTF: некорректный prior 180d range"
    );
  }

  const pos=
    (price-low180)/(high180-low180);

  const block=
    pos>0.40 && pos<=1.00;

  let zone;
  if(pos>1.00){
    zone="breakout > prior 180d high";
  }else if(pos<0){
    zone="below prior 180d low";
  }else{
    zone=`range position ${(pos*100).toFixed(1)}%`;
  }

  return {
    allow:!block,
    rule:"R40",
    price,
    pos,
    high180,
    low180,
    metric:
      `${zone} • low ${fmtPrice(low180)} / high ${fmtPrice(high180)}`,
    reason:block
      ? "0.40 < position ≤ 1.00 → BLOCK"
      : "R40 → ALLOW"
  };
}

async function checkHTF(symbol,now){
  const price=await livePrice(symbol);

  if(symbol==="HYPEUSDT"){
    return {
      allow:true,
      rule:"NONE",
      price,
      metric:"HYPE HTF не фильтруется",
      reason:"HTF ALLOW"
    };
  }

  if(symbol==="PENDLEUSDT"){
    return pendleHTF(
      now,
      price
    );
  }

  if(symbol==="POPCATUSDT"){
    return popcatHTF(
      now,
      price
    );
  }

  throw new Error(
    `Неизвестный symbol ${symbol}`
  );
}

function drawMeta(){
  const c=FIXED[selected];

  $("dSymbol").textContent=c.name;
  $("dArch").textContent=c.arch;
  $("dHtfRule").textContent=c.htfRule;

  $("dThreshold").textContent=
    selected==="POPCATUSDT"
      ? "dynamic"
      : c.threshold.toFixed(6);

  $("historyRow").hidden=
    selected!=="POPCATUSDT";

  const isPendle=selected==="PENDLEUSDT";
  $("regimeBox").hidden=!isPendle;
  document.querySelectorAll(".pendle-regime-row").forEach(x=>x.hidden=!isPendle);

  $("dRatio").textContent="—";
  $("dOi").textContent="—";
  $("dTurn").textContent="—";
  $("dAge").textContent="—";
  $("dHistory").textContent="—";
  $("dHtfPrice").textContent="—";
  $("dHtfContext").textContent="—";
  $("dRegimeState").textContent="—";
  $("dRegimeMetric").textContent="—";
  $("dRegimeDates").textContent="—";
  $("dRegimeSource").textContent="—";
  $("dChecked").textContent="—";
}

function resetStates(){
  $("state").className="state neutral";
  $("state").textContent="⚪ Нажми «Проверить вход»";
  $("reason").textContent="Статус ещё не рассчитан.";

  $("fairyState").className="gate-state neutral";
  $("fairyState").textContent="⚪ —";
  $("fairyReason").textContent="—";

  $("htfState").className="gate-state neutral";
  $("htfState").textContent="⚪ —";
  $("htfReason").textContent="—";

  $("regimeState").className="gate-state neutral";
  $("regimeState").textContent="⚪ —";
  $("regimeReason").textContent="—";
}

async function check(){
  const btn=$("checkBtn");

  btn.disabled=true;
  btn.textContent="Проверяю…";

  $("state").className="state neutral";
  $("state").textContent="⚪ Проверяю Binance…";
  $("reason").textContent="Fairy + causal HTF LONG";

  $("fairyState").className="gate-state neutral";
  $("fairyState").textContent="⚪ считаю…";
  $("fairyReason").textContent="—";

  $("htfState").className="gate-state neutral";
  $("htfState").textContent="⚪ считаю…";
  $("htfReason").textContent="—";

  if(selected==="PENDLEUSDT"){
    $("regimeState").className="gate-state neutral";
    $("regimeState").textContent="⚪ считаю…";
    $("regimeReason").textContent="—";
  }

  try{
    const now=await serverTime();

    const [fairy,htf,regime]=await Promise.all([
      checkFairy(selected,now),
      checkHTF(selected,now),
      selected==="PENDLEUSDT"
        ? checkPendleRegime(now)
        : Promise.resolve(null)
    ]);

    const pendleBypass=
      selected==="PENDLEUSDT" && regime && !regime.fairyOn;

    $("fairyState").className=
      "gate-state "+(fairy.allow?"green":"red");

    $("fairyState").textContent=
      (fairy.allow ? "🟢 ALLOW" : "🔴 BLOCK")+
      (pendleBypass ? " • BYPASS" : "");

    $("fairyReason").textContent=
      `${fairy.ratio.toFixed(6)} `+
      `${fairy.allow?"≤":">"} `+
      `${fairy.threshold.toFixed(6)}`+
      (pendleBypass ? " • игнорируется REGIME" : "");

    $("htfState").className=
      "gate-state "+(htf.allow?"green":"red");

    $("htfState").textContent=
      htf.allow
        ? "🟢 ALLOW"
        : "🔴 BLOCK";

    $("htfReason").textContent=
      `${htf.rule} • ${htf.reason}`;

    if(selected==="PENDLEUSDT"){
      if(regime.failsafe){
        $("regimeState").className="gate-state error";
        $("regimeState").textContent="🟠 FAILSAFE • ФЕЯ ON";
        $("regimeReason").textContent=
          `${regime.reason} • stale substitute запрещён`;
      }else if(regime.fairyOn){
        $("regimeState").className="gate-state green";
        $("regimeState").textContent="🟢 ФЕЯ ON";
        $("regimeReason").textContent=
          `${(regime.chg7*100).toFixed(3)}% < ${(regime.threshold*100).toFixed(3)}%`;
      }else{
        $("regimeState").className="gate-state bypass";
        $("regimeState").textContent="🟡 ФЕЯ OFF • BYPASS";
        $("regimeReason").textContent=
          `${(regime.chg7*100).toFixed(3)}% ≥ ${(regime.threshold*100).toFixed(3)}% • до ${regime.nextMonth}`;
      }
    }

    const effectiveFairyAllow=
      selected==="PENDLEUSDT" && regime && !regime.fairyOn
        ? true
        : fairy.allow;

    const finalAllow=
      effectiveFairyAllow && htf.allow;

    $("state").className=
      "state "+(finalAllow?"green":"red");

    $("state").textContent=
      finalAllow
        ? "🟢 ENTRY1 РАЗРЕШЁН"
        : "🔴 ENTRY1 ЗАПРЕЩЁН";

    const blockers=[];
    if(!effectiveFairyAllow) blockers.push("Фея");
    if(!htf.allow) blockers.push("HTF");

    if(selected==="PENDLEUSDT" && regime && !regime.fairyOn){
      $("reason").textContent=
        finalAllow
          ? "REGIME: Фея BYPASS • HTF ALLOW"
          : `BLOCK: ${blockers.join(" + ")} • Фея BYPASS`;
    }else if(selected==="PENDLEUSDT" && regime && regime.failsafe){
      $("reason").textContent=
        finalAllow
          ? "FAILSAFE: Фея ALLOW + HTF ALLOW"
          : `FAILSAFE BLOCK: ${blockers.join(" + ")}`;
    }else{
      $("reason").textContent=
        finalAllow
          ? "Фея ALLOW + HTF ALLOW"
          : `BLOCK: ${blockers.join(" + ")}`;
    }

    $("dRatio").textContent=
      fairy.ratio.toFixed(6);

    $("dThreshold").textContent=
      fairy.threshold.toFixed(6);

    $("dOi").textContent=
      fmtMoney(fairy.oi.value);

    $("dTurn").textContent=
      fmtMoney(fairy.turn);

    $("dAge").textContent=
      fairy.oi.age.toFixed(1)+" мин";

    if(
      selected==="POPCATUSDT" &&
      fairy.history
    ){
      $("dHistory").textContent=
        `${fairy.history.count.toLocaleString()} causal точек • `+
        `с ${fairy.history.start.slice(0,10)}`;
    }

    $("dHtfPrice").textContent=
      fmtPrice(htf.price);

    $("dHtfContext").textContent=
      htf.metric;

    if(selected==="PENDLEUSDT" && regime){
      $("dRegimeState").textContent=
        regime.failsafe
          ? "FAIRY ON • FAILSAFE"
          : (regime.fairyOn ? "FAIRY ON" : "FAIRY OFF / BYPASS");
      $("dRegimeMetric").textContent=
        regime.chg7==null
          ? "—"
          : `${(regime.chg7*100).toFixed(3)}% / ${(regime.threshold*100).toFixed(3)}%`;
      $("dRegimeDates").textContent=
        `${regime.d8} → ${regime.d1}`;
      $("dRegimeSource").textContent=regime.source;
    }

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

    // Fail closed. We do not pretend an unavailable gate is ALLOW.
    if(
      $("fairyState").textContent.includes("считаю")
    ){
      $("fairyState").className=
        "gate-state error";
      $("fairyState").textContent=
        "🟠 ERROR";
    }

    if(
      $("htfState").textContent.includes("считаю")
    ){
      $("htfState").className=
        "gate-state error";
      $("htfState").textContent=
        "🟠 ERROR";
    }

    if(
      selected==="PENDLEUSDT" &&
      $("regimeState").textContent.includes("считаю")
    ){
      $("regimeState").className="gate-state error";
      $("regimeState").textContent="🟠 ERROR";
    }

  }finally{
    btn.disabled=false;
    btn.textContent="Проверить вход";
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
      resetStates();
    };
  });

$("checkBtn").onclick=check;

drawMeta();
resetStates();
