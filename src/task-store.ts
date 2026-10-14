import type {State} from './reservation';
const KEY='seu-lecture-pending-task';
export interface PendingTask {id:string;leadSeconds:number;endsAt:number;verify:boolean}
export function saveTask(state:State,storage:Storage=sessionStorage) {
  if(!state.activity || ['loading','ready','closed'].includes(state.phase))return;
  try {
    if(['success','failed'].includes(state.phase)){storage.removeItem(KEY);return;}
    if(state.armed || ['submitting','verifying','unknown'].includes(state.phase))storage.setItem(KEY,JSON.stringify({id:state.activity.id,leadSeconds:state.leadSeconds??30,endsAt:state.activity.endsAt,verify:Boolean(state.verifyAfterLogin || ['submitting','verifying','unknown'].includes(state.phase))}));
  }catch{/* Recovery storage is optional; never block the active task. */}
}
export function readTask(storage:Storage=sessionStorage):PendingTask|undefined {
  try{const task=JSON.parse(storage.getItem(KEY)??'null');if(task && typeof task.id==='string' && [10,20,30,60].includes(task.leadSeconds) && typeof task.verify==='boolean' && Number.isFinite(task.endsAt) && task.endsAt>Date.now())return task;storage.removeItem(KEY);}catch{}
}
export function clearTask(storage:Storage=sessionStorage){try{storage.removeItem(KEY);}catch{}}
