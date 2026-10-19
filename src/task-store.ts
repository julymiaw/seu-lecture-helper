import type {State,Recovery} from './reservation';
const KEY='seu-lecture-pending-task';
export interface PendingTask extends Recovery {id:string;endsAt:number;version?:2}
export function saveTask(state:State,storage:Storage=sessionStorage) {
  if(!state.activity || ['loading','ready','closed'].includes(state.phase))return;
  try {
    if(['success','failed'].includes(state.phase)){storage.removeItem(KEY);return;}
    if(state.armed || ['submitting','verifying','unknown'].includes(state.phase)){
      const task:PendingTask={id:state.activity.id,leadSeconds:state.leadSeconds??30,endsAt:state.activity.endsAt,verify:Boolean(state.verifyAfterLogin || ['submitting','verifying','unknown'].includes(state.phase))};
      if((state.candidates?.length??0)>1)Object.assign(task,{version:2,ids:state.candidates!.map(a=>a.id),index:state.candidateIndex??0,preferred:state.preferred??'online',labels:state.labels});
      storage.setItem(KEY,JSON.stringify(task));
    }
  }catch{/* Recovery storage is optional; never block the active task. */}
}
export function readTask(storage:Storage=sessionStorage):PendingTask|undefined {
  try{const task=JSON.parse(storage.getItem(KEY)??'null');if(task && typeof task.id==='string' && [10,20,30,60].includes(task.leadSeconds) && typeof task.verify==='boolean' && Number.isFinite(task.endsAt) && task.endsAt>Date.now()){
    if(task.version===undefined && task.ids===undefined)return task;
    if(task.version===2 && Array.isArray(task.ids) && task.ids.length===2 && task.ids.every((id:unknown)=>typeof id==='string'&&id.length>0) && new Set(task.ids).size===2 && Number.isInteger(task.index) && task.index>=0 && task.index<2 && task.ids[task.index]===task.id && ['online','offline'].includes(task.preferred) && (task.labels===undefined || task.labels && typeof task.labels==='object' && !Array.isArray(task.labels) && Object.entries(task.labels).every(([id,m])=>task.ids.includes(id) && ['online','offline'].includes(String(m)))))return task;
  }storage.removeItem(KEY);}catch{}
}
export function clearTask(storage:Storage=sessionStorage){try{storage.removeItem(KEY);}catch{}}
