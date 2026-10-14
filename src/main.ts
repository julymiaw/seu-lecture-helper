import {Api} from './api';
import {VERSION} from './diagnostics';
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
    if (current?.task.state.activity?.id === id) {current.dialog.show(); return;}
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
      const dialog = new Dialog({submit: () => {void task.submit();}, edit: code => task.editCode(code), refresh: () => {void task.loadCaptcha();}, verify: () => {void task.verify();}, resume: () => {void task.resume();}, login: () => {location.reload();}, close: () => close(), reload: () => location.reload(),
        start: () => task.start(), configure: seconds => task.configure(seconds), hide: () => dialog.hide()});
      current = {task, dialog, release};
      await task.open(id,recovery);
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
