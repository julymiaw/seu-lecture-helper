import {Api} from './api';
import {VERSION} from './diagnostics';
import {Dialog} from './dialog';
import {acquireTask} from './lock';
import {Mount} from './mount';
import {message, Reservation} from './reservation';
import {mode,type Labels} from './candidates';
import {BrowserOcr} from './ocr';
import {saveTask,readTask,clearTask,type PendingTask} from './task-store';
// Also prevents duplicate injection in one document.
if (!document.documentElement.hasAttribute('data-seu-lecture-helper')) {
  document.documentElement.setAttribute('data-seu-lecture-helper', VERSION);
  const api = new Api();
  const ocr = new BrowserOcr();
  let current: {task: Reservation; dialog: Dialog; release: () => void} | undefined;
  let opening = false;
  function notice(text: string) {
    document.getElementById('seu-lecture-helper-notice')?.remove();
    const item = document.createElement('div'); item.id = 'seu-lecture-helper-notice'; item.setAttribute('role', 'status'); item.textContent = text;
    item.style.cssText = 'position:fixed;bottom:30px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#234d35;color:white;padding:14px;border-radius:10px;max-width:80vw';
    document.body.append(item); setTimeout(() => item.remove(), 6000);
  }
  function close(clear=true) {
    if (current?.task.close()) {current.dialog.destroy(); current.release(); current = undefined;if(clear)clearTask();}
  }
  async function open(id: string,recovery?:PendingTask) {
    if (current?.task.state.candidates?.some(a=>a.id===id)) {current.dialog.show(); return;}
    if (opening || current) {notice('请先完成或关闭当前预约任务'); return;}
    opening = true;
    let release: (() => void) | null = null;
    try {
      release = await acquireTask();
      if (!release) {notice('另一个标签页正在进行预约，请先关闭那里的任务'); return;}
      const task = new Reservation(api, state => {
        saveTask(state);
        if (state.activity && state.phase !== 'closed') mount.setReserved(state.activity.id, state.activity.reserved);
        const label = state.phase === 'waiting' ? '等待中' : ['captcha-loading', 'recognizing', 'input', 'submitting', 'verifying'].includes(state.phase) ? '预约中' : '';
        mount.setActive(label ? state.activity?.id : undefined, label);
        current?.dialog.render(state);
      }, Date.now, ocr);
      const annotate=()=>{const labels:Labels={...task.state.labels};for(const item of task.state.candidates??[]){const answer=window.prompt('请标注场次：'+item.title+'\n地点：'+item.place+'\n输入“线上”或“线下”',mode(item,labels)==='online'?'线上':mode(item,labels)==='offline'?'线下':'');if(answer===null)return;if(answer.trim()!=='线上'&&answer.trim()!=='线下'){notice('请输入“线上”或“线下”，未启动预约');return;}labels[item.id]=answer.trim()==='线上'?'online':'offline';}task.prefer(task.state.preferred??'online',labels);};
      const dialog = new Dialog({prefer:preferred=>task.prefer(preferred),annotate,submit: () => {void task.submit();}, edit: code => task.editCode(code), refresh: () => {void task.loadCaptcha();}, verify: () => {void task.verify();}, resume: () => {void task.resume();}, login: () => {location.reload();}, close: () => close(), reload: () => location.reload(),
        start: () => task.start(), configure: seconds => task.configure(seconds), hide: () => dialog.hide()});
      current = {task, dialog, release};
      await task.open(id,recovery);
      if(!recovery && task.state.phase==='ready' && task.state.candidates?.length===2){
        const other=task.state.candidates.find(a=>a.id!==id)!;
        if(!window.confirm('发现同一讲座的另一场次：\n'+other.title+'\n'+other.place+'\n是否加入候选？按所选顺序预约，只有明确满员才转向另一场次，成功后结束。'))task.single(id);
      }
      if(recovery && task.state.phase!=='login-required'){if(recovery.verify)await task.restoreVerification();else if(task.state.phase==='ready'){task.configure(recovery.leadSeconds);task.start();}}
    } catch (error) {release?.(); notice(message(error));}
    finally {opening = false;}
  }
  const mount = new Mount(api, id => {void open(id);}, () => close());
  mount.start();
  const pending=readTask();if(pending)void open(pending.id,pending);
  window.addEventListener('pagehide', () => {mount.stop(); close(false);});
  window.addEventListener('pageshow', event => {if (event.persisted) mount.start();});
}
