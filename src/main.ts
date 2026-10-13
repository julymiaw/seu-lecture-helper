import {Api} from './api';
import {Dialog} from './dialog';
import {acquireTask} from './lock';
import {Mount} from './mount';
import {message, Reservation} from './reservation';
import {BrowserOcr, savedMode, saveMode} from './ocr';
// Also prevents duplicate injection in one document.
if (!document.documentElement.hasAttribute('data-seu-lecture-helper')) {
  document.documentElement.setAttribute('data-seu-lecture-helper', '0.3.6');
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
  function close() {
    if (current?.task.close()) {current.dialog.destroy(); current.release(); current = undefined;}
  }
  async function open(id: string) {
    if (current?.task.state.activity?.id === id) {current.dialog.show(); return;}
    if (opening || current) {notice('请先完成或关闭当前预约任务'); return;}
    opening = true;
    let release: (() => void) | null = null;
    try {
      release = await acquireTask();
      if (!release) {notice('另一个标签页正在进行预约，请先关闭那里的任务'); return;}
      const task = new Reservation(api, state => {
        if (state.activity && state.phase !== 'closed') mount.setReserved(state.activity.id, state.activity.reserved);
        const label = state.phase === 'monitoring' ? '监测中' : state.phase === 'paused' ? '已暂停' : state.phase === 'waiting' ? '等待中' : ['captcha-loading', 'recognizing', 'input', 'submitting', 'verifying'].includes(state.phase) ? '预约中' : '';
        mount.setActive(label ? state.activity?.id : undefined, label);
        current?.dialog.render(state);
      }, Date.now, () => true, ocr, savedMode());
      const dialog = new Dialog({submit: code => {void task.submit(code);}, refresh: () => {void task.loadCaptcha();}, verify: () => {void task.verify();}, close, mode: mode => {task.setMode(mode); if (task.state.taskMode !== 'monitor') saveMode(task.state.mode!);}, reload: () => location.reload(),
        start: () => task.start(), pause: () => task.pause(), checkNow: () => task.checkNow(), configure: options => task.configure(options), hide: () => dialog.hide()});
      current = {task, dialog, release};
      void task.open(id, false);
    } catch (error) {release?.(); notice(message(error));}
    finally {opening = false;}
  }
  const mount = new Mount(api, id => {void open(id);}, close);
  mount.start();
  window.addEventListener('pagehide', () => {mount.stop(); close();});
  window.addEventListener('pageshow', event => {if (event.persisted) mount.start();});
}
