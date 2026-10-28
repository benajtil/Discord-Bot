const { DAY, TIME_ZONE } = require('../constants');
function getManilaDayKey(timestamp = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function getManilaTodayLabel() { return new Intl.DateTimeFormat('en-PH', { timeZone: TIME_ZONE, year: 'numeric', month: 'long', day: 'numeric' }).format(new Date()); }
function previousDayKey(dayKey) {
  const [y, m, d] = dayKey.split('-').map(Number); const date = new Date(Date.UTC(y, m - 1, d - 1));
  return [date.getUTCFullYear(), String(date.getUTCMonth()+1).padStart(2,'0'), String(date.getUTCDate()).padStart(2,'0')].join('-');
}
function getManilaMinuteOfDay(timestamp = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(timestamp));
  const v = Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value])); return Number(v.hour)*60+Number(v.minute);
}
function parseClockTime(value) {
  const m = String(value || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i); if (!m) return null;
  let h=Number(m[1]); const min=Number(m[2]||0); const p=m[3]?.toUpperCase(); if(min>59) return null;
  if(p){ if(h<1||h>12)return null; h%=12; if(p==='PM')h+=12; } else if(h>23)return null;
  return h*60+min;
}
function formatClockTime(n) { n=((Number(n)%1440)+1440)%1440; const h=Math.floor(n/60), m=n%60; return `${h%12||12}:${String(m).padStart(2,'0')} ${h>=12?'PM':'AM'}`; }
function isWithinKeywordWindow(s, timestamp=Date.now()) {
  const now=getManilaMinuteOfDay(timestamp), start=Number(s.creditStartMinute), end=Number(s.creditEndMinute);
  if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||start>=1440||end<0||end>=1440||start===end)return false;
  return start<end ? now>=start&&now<end : now>=start||now<end;
}
function parseDuration(value) {
  const m=String(value||'').trim().toLowerCase().match(/^(\d+)\s*(m|min|h|hr|d|day|w|week|month|mo)$/); if(!m)return null;
  const amount=Number(m[1]), mult={m:60000,min:60000,h:3600000,hr:3600000,d:DAY,day:DAY,w:7*DAY,week:7*DAY,mo:30*DAY,month:30*DAY};
  return !amount||amount>1000 ? null : amount*mult[m[2]];
}
function formatDuration(ms) { if(ms%(7*DAY)===0)return `${ms/(7*DAY)}w`; if(ms%DAY===0)return `${ms/DAY}d`; if(ms%3600000===0)return `${ms/3600000}h`; if(ms%60000===0)return `${ms/60000}m`; return `${Math.round(ms/1000)}s`; }
module.exports={getManilaDayKey,getManilaTodayLabel,previousDayKey,getManilaMinuteOfDay,parseClockTime,formatClockTime,isWithinKeywordWindow,parseDuration,formatDuration};
