import type {Activity} from './api';
export type Mode='online'|'offline';
export type Labels=Record<string,Mode>;
// The first bracket is the attendance mode; the second is the lecture category.
// Never treat words such as “线上” in the actual lecture name as mode metadata.
export function parseTitle(title:string):{mode?:Mode;category?:string;name:string} {
  const first=/^\s*[【\[]([^】\]]+)[】\]]\s*(.*)$/s.exec(title);
  if(!first)return{name:title.trim()};
  const second=/^[【\[]([^】\]]+)[】\]]\s*(.*)$/s.exec(first[2]);
  const mode=first[1].trim()==='线上'?'online':first[1].trim()==='线下'?'offline':undefined;
  if(second)return{mode,category:second[1].trim(),name:second[2].trim()};
  return mode?{mode,name:first[2].trim()}:{category:first[1].trim(),name:first[2].trim()};
}
export function mode(activity:Activity,labels:Labels={}):Mode|undefined {
  return labels[activity.id]??parseTitle(activity.title).mode;
}
const titleKey=(title:string)=>{const parsed=parseTitle(title);return JSON.stringify([parsed.category??'',parsed.name.replace(/\s/g,'')]);};
export function findCandidates(activity:Activity,available:Activity[]):Activity[] {
  if(!activity.eventStart || !activity.eventEnd)return[activity];
  const matches=available.filter(a=>a.id!==activity.id && a.eventStart===activity.eventStart && a.eventEnd===activity.eventEnd && titleKey(a.title)===titleKey(activity.title));
  // Never arbitrarily choose one of several same-title locations.
  return matches.length===1?[activity,matches[0]]:[activity];
}
export function ordered(candidates:Activity[],preferred:Mode,labels:Labels={}):Activity[] {
  return [...candidates].sort((a,b)=>Number(mode(b,labels)===preferred)-Number(mode(a,labels)===preferred));
}
export function classified(candidates:Activity[],labels:Labels={}) {
  return candidates.length===1 || candidates.length===2 && new Set(candidates.map(a=>mode(a,labels))).size===2 && candidates.every(a=>mode(a,labels));
}
