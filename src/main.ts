import {Api} from './api';
import {VERSION} from './diagnostics';
import {downloadLogs,logStore} from './log-store';
import {Dialog} from './dialog';
import {acquireTask} from './lock';
import {Mount} from './mount';
import {message, Reservation} from './reservation';
import {BrowserOcr} from './ocr';
import {saveTask,readTask,clearTask,type PendingTask} from './task-store';
// Also prevents duplicate injection in one document.
if (!document.documentElement.hasAttribute('data-seu-lecture-helper')) {
  document.documentElement.setAttribute('data-seu-lecture-helper', VERSION);
  const api = new Api();
  const ocr = new BrowserOcr();
  let current: {task: Reservation; dialog: Dialog; release: () => void} | undefined;
  let opening = false;
  let restoreRequested = false;
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
        if (state.verifiedId) mount.setReserved(state.verifiedId,true);
        else if (state.activity && state.phase !== 'closed') mount.setReserved(state.activity.id, state.activity.reserved);
        const label = state.phase === 'waiting' ? '等待中' : ['captcha-loading', 'recognizing', 'prepared', 'submitting', 'verifying'].includes(state.phase) ? '预约中' : '';
        mount.setActive((state.candidates ?? (state.activity ? [state.activity] : [])).map(activity => activity.id), label);
        current?.dialog.render(state);
      }, Date.now, ocr);
      const dialog = new Dialog({choosePair:include=>task.choosePair(include),prefer:preferred=>task.prefer(preferred),verify: () => {void task.verify();}, resume: () => {void task.resume();}, login: () => {location.reload();}, close: () => close(), reload: () => location.reload(),
        exportLogs: async()=>{try{const warning=await downloadLogs();if(warning)notice(warning);}catch(error){notice('日志导出失败：'+message(error));}},start: () => task.start(), hide: () => dialog.hide()});
      current = {task, dialog, release};
      await task.open(id,recovery);
      if(!recovery)task.requestPairChoice(id);
      if(recovery && task.state.phase!=='login-required'){if(recovery.verify)await task.restoreVerification();else if(task.state.phase==='ready')task.start();}
    } catch (error) {release?.(); notice(message(error));}
    finally {opening = false;if(restoreRequested){restoreRequested=false;restore();}}
  }
  const mount = new Mount(api, id => {void open(id);});
  mount.start();
  function restore() {
    if(opening){restoreRequested=true;return;}
    const pending=readTask();if(pending&&!current)void open(pending.id,pending);
  }
  restore();
  window.addEventListener('pagehide', () => {mount.stop(); close(false);void logStore.flush();});
  window.addEventListener('pageshow', event => {if (event.persisted) {mount.start();restore();}});
}
