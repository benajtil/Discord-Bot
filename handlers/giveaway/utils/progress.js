function getProgressDetails(current,target,size=12){const s=Math.max(1,Math.floor(Number(size)||12)),t=Math.max(1,Number(target)||1),c=Math.max(0,Math.min(t,Number(current)||0)),percentage=Math.round(c/t*100),filled=Math.max(0,Math.min(s,Math.round(percentage/100*s)));return{bar:'▰'.repeat(filled)+'▱'.repeat(s-filled),percentage,current:c,target:t,complete:percentage>=100};}
function makeProgressBar(current,target,size=12){return getProgressDetails(current,target,size).bar;}
function progressLine(label,current,target,complete=false){const p=getProgressDetails(current,target);return [`${p.complete||complete?'🟢':'🔹'} **${label}**`,`\`${p.bar}\` **${p.percentage}%**`,`\`${p.current}/${p.target}\` completed`].join('\n');}
module.exports={getProgressDetails,makeProgressBar,progressLine};
