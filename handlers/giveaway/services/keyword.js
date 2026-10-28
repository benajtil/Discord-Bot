const {streakKey,getSettings}=require('../db');
const {getManilaDayKey,previousDayKey,isWithinKeywordWindow}=require('../utils/time');
function normalizeKeyword(text){return String(text||'').normalize('NFKC').toLocaleLowerCase('en').replace(/[\s\p{P}\p{S}_]+/gu,'');}
function containsGiveawayKeyword(content,keyword){const k=normalizeKeyword(keyword);return k.length>0&&normalizeKeyword(content).includes(k);}
async function getStreak(db,g,u){const s=await db.get(streakKey(g,u));if(!s||typeof s!=='object')return{lastDay:null,count:0,creditedDays:[]};return{lastDay:s.lastDay||null,count:Number(s.count)||0,creditedDays:Array.isArray(s.creditedDays)?s.creditedDays:[]};}
async function creditKeywordMessage(db,g,u,timestamp=Date.now()){
 const today=getManilaDayKey(timestamp),s=await getStreak(db,g,u); if(s.lastDay===today)return{credited:false,streak:s.count};
 const yesterday=previousDayKey(today); if(s.lastDay===yesterday)s.count+=1;else{s.count=1;s.creditedDays=[];}
 s.lastDay=today;s.creditedDays=[...new Set([...(s.creditedDays||[]),today])].slice(-60);await db.set(streakKey(g,u),s);return{credited:true,streak:s.count};
}
async function isKeywordEligible(db,guild,giveaway,userId){const settings=await getSettings(db,guild.id);if(!settings.enabled||!settings.targetUserId)return false;const s=await getStreak(db,guild.id,userId),today=getManilaDayKey(),required=Math.max(1,Number(settings.requiredDays)||3);if(s.lastDay!==today||s.count<required)return false;const days=new Set(s.creditedDays||[]);let day=today;for(let i=0;i<required;i++){if(!days.has(day))return false;day=previousDayKey(day);}return true;}
module.exports={normalizeKeyword,containsGiveawayKeyword,getStreak,creditKeywordMessage,isKeywordEligible,isWithinKeywordWindow};
