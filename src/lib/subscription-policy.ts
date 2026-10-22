/** KLYVONA quota policy — pure functions, not a database enforcement layer. */
export type Plan = "trial" | "monthly";
export type Status = "trial" | "active" | "awaiting_billing" | "past_due" | "cancelled";
export const RULES = { trial: { total: 22, daily: 1, days: 22, priceIls: 0 }, monthly: { total: 44, daily: 2, days: 22, priceIls: 600 } } as const;
const valid = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s+"T12:00:00Z")) && new Date(s+"T12:00:00Z").toISOString().slice(0,10) === s;
const day = (s: string) => new Date(s+"T12:00:00Z").getUTCDay();
export const isWorkday = (s: string) => valid(s) && day(s) !== 5 && day(s) !== 6;
const next = (s: string) => { const d = new Date(s+"T12:00:00Z"); d.setUTCDate(d.getUTCDate()+1); return d.toISOString().slice(0,10); };
export function postingWindow(start: string, count=22): {first:string;last:string}|null {
  if(!valid(start)||!Number.isInteger(count)||count<1||count>366)return null;
  let d=start; while(!isWorkday(d))d=next(d);
  const first=d; let n=1; while(n<count){d=next(d);if(isWorkday(d))n++;}
  return {first,last:d};
}
export type Snapshot={plan:Plan;status:Status;start:string;today:string;consumed:number;reserved:number;todayConsumed:number;todayReserved:number};
export type Decision={ok:true;remaining:number;dailyRemaining:number}|{ok:false;reason:"invalid"|"subscription"|"expired"|"weekend"|"quota"|"daily"};
export function checkQuota(s:Snapshot):Decision{
  const r=RULES[s.plan];if(!r||!valid(s.start)||!valid(s.today)||![s.consumed,s.reserved,s.todayConsumed,s.todayReserved].every(n=>Number.isSafeInteger(n)&&n>=0))return {ok:false,reason:"invalid"};
  if(!((s.plan==="trial"&&s.status==="trial")||(s.plan==="monthly"&&s.status==="active")))return {ok:false,reason:"subscription"};
  const w=postingWindow(s.start,r.days)!;
  if(s.today<w.first||s.today>w.last)return {ok:false,reason:"expired"};
  if(!isWorkday(s.today))return {ok:false,reason:"weekend"};
  const remaining=Math.max(0,r.total-s.consumed-s.reserved),dailyRemaining=Math.max(0,r.daily-s.todayConsumed-s.todayReserved);
  if(!remaining)return {ok:false,reason:"quota"};
  if(!dailyRemaining)return {ok:false,reason:"daily"};
  return {ok:true,remaining,dailyRemaining};
}
/** Rejected generated photos consume quota; they incurred a generation cost. */
export const consumesQuota=(status:string)=>status==="generated";
/** Never start a paid period without independently confirmed payment. */
export const paidPeriodAllowed=(paymentConfirmed:boolean)=>paymentConfirmed;
