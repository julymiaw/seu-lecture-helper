import {test, expect, type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
const raw = JSON.parse(readFileSync('tests/fixtures/activities.json','utf8'));
const html=readFileSync('tests/fixtures/list.html','utf8');
const detailHtml=readFileSync('tests/fixtures/detail.html','utf8');
const script=readFileSync('dist/seu-lecture-helper.user.js','utf8');
const assets:Record<string,{path:string}>=JSON.parse(readFileSync('src/ocr-assets.json','utf8'));
const ID=raw.datas.hdlbList[0].WID;
const ORIGIN='https://lecture.test';
async function setup(page:Page, options:{future?:boolean;timeout?:boolean;captchaError?:boolean;detail?:boolean;full?:boolean;rejectFull?:boolean}={}) {
  let booked=false, writes=0, nativeClicks=0, image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVAAAAABJRU5ErkJggg==';
  const calls:string[]=[];
  let full=Boolean(options.full);
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    // School calls and fixed OCR resources are fulfilled locally; no real outbound requests.
    if(url.origin!==ORIGIN) {
      const asset=Object.entries(assets).find(([,a])=>url.pathname.endsWith('/'+a.path));
      if(!asset||!['https://cdn.jsdelivr.net','https://unpkg.com'].includes(url.origin))throw new Error('Offline test blocked outbound request: '+url.origin);
      return route.fulfill({contentType:'application/octet-stream',headers:{'Access-Control-Allow-Origin':'*'},body:readFileSync('.cache/ocr/'+asset[0])});
    }
    const name=url.pathname.split('/').pop()!;
    if(!url.pathname.includes('/modules/hdyy/')) return route.fulfill({contentType:'text/html',body:options.detail?detailHtml:html});
    calls.push(name);
    const data=structuredClone(raw);
    const now=Date.now();
    const stamp=(ms:number)=>new Date(ms+8*3600000).toISOString().slice(0,19).replace('T',' ');
    data.datas.xtdqsj=stamp(now);
    data.datas.hdlbList[0].YYKSSJ=stamp(options.future?now+3600000:now-3600000);
    data.datas.hdlbList[0].YYJSSJ=stamp(now+7200000);
    data.datas.xsxxList=booked?[{WID:ID,YY_WID:'fixture-id',SFDK:'0',SFWY:'0'}]:[];
    data.datas.hdrsList.find((row:{HD_WID:string})=>row.HD_WID===ID)!.YYRS=full?Number(data.datas.hdlbList[0].HDZRS):149;
    let result:unknown;
    if(name==='queryActivityList.do') result=data;
    else if(name==='vcode.do') result={code:0,datas:image};
    else if(name==='addReservation.do') {
      writes++;
      expect(new URLSearchParams(route.request().postData()!).get('wid')).toBe(ID);
      if(options.rejectFull&&writes===1) {full=true;result={code:-1,datas:null,msg:'当前活动预约人数已满，请重新选择'};}
      else if(options.captchaError&&writes===1) result={code:-1,datas:null,msg:'验证码错误，请重试'};
      else {booked=true;if(options.timeout) return route.abort('failed'); result={code:0,datas:1};}
    } else if(name==='queryMyActivityList.do') result={code:0,datas:{wdhdList:booked?[{HD_WID:ID,YY_WID:'fixture-id',FBZT:'1'}]:[]}};
    else throw new Error('Unexpected endpoint: '+name);
    await route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.goto(ORIGIN+'/index.do'+(options.detail?'#/hdxq?WID='+ID:'#/hdyy'));
  await page.evaluate(()=>localStorage.setItem('seu-lecture-helper-input-mode','manual'));
  image=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=100;c.height=36;const ctx=c.getContext('2d')!;ctx.fillStyle='white';ctx.fillRect(0,0,100,36);ctx.fillStyle='black';ctx.font='bold 26px serif';ctx.fillText('3253',8,27);return c.toDataURL('image/jpeg');});
  await page.exposeFunction('nativeCardClick',()=>nativeClicks++);
  await page.evaluate(()=>document.querySelector('.activity-container')?.addEventListener('click',()=>{void (window as unknown as {nativeCardClick:()=>void}).nativeCardClick();}));
  await page.addScriptTag({content:script});
  return {calls, writes:()=>writes, nativeClicks:()=>nativeClicks, releaseSeat:()=>{full=false;}};
}
test('built userscript: input, Enter submission, result verification without native UI', async ({page},testInfo)=>{
  const state=await setup(page);
  await page.getByRole('button',{name:'预约助手'}).first().click();await page.locator('#start').click();
  await expect(page.getByLabel('验证码',{exact:true})).toBeFocused();
  await expect(page.getByAltText('预约验证码')).toBeVisible();
  await page.setViewportSize({width:375,height:700});
  const bounds=await page.locator('dialog').boundingBox();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.width).toBeLessThanOrEqual(375);
  await page.screenshot({path:testInfo.outputPath('captcha-mobile.png')});
  await page.getByLabel('验证码',{exact:true}).fill('TEST');
  await page.getByLabel('验证码',{exact:true}).press('Enter');
  await expect(page.getByRole('status')).toContainText('已核验');
  await expect(page.locator('.seu-lecture-helper-button').first()).toHaveText('已预约');
  await expect(page.getByRole('button',{name:'刷新学校页面'})).toBeVisible();
  expect(state.writes()).toBe(1);expect(state.nativeClicks()).toBe(0);
  expect(state.calls).not.toContain('appiontCheck.do');
  await page.getByRole('button',{name:'关闭',exact:true}).click();
  await expect(page.locator('#seu-lecture-helper-dialog')).toHaveCount(0);
});
test('a failed connection after writing is verified, not resubmitted', async ({page})=>{
  const state=await setup(page,{timeout:true});await page.getByRole('button',{name:'预约助手'}).first().click();await page.locator('#start').click();
  await page.getByLabel('验证码',{exact:true}).fill('TEST');await page.getByRole('button',{name:'提交预约'}).click();
  await expect(page.getByRole('status')).toContainText('已核验');expect(state.writes()).toBe(1);
});
test('wrong captcha obtains a fresh challenge and focuses cleared input', async ({page})=>{
  const state=await setup(page,{captchaError:true}); await page.getByRole('button',{name:'预约助手'}).first().click();await page.locator('#start').click();
  const input=page.getByLabel('验证码',{exact:true});await input.fill('no');await input.press('Enter');
  await expect(page.getByRole('status')).toContainText('已更新验证码');await expect(input).toHaveValue('');await expect(input).toBeFocused();expect(state.writes()).toBe(1);
  await input.fill('TEST');await input.press('Enter');await expect(page.getByRole('status')).toContainText('已核验');expect(state.writes()).toBe(2);
});
test('countdown closes without fetching captcha and fits a narrow screen', async ({page},testInfo)=>{
  await page.setViewportSize({width:375,height:700});const state=await setup(page,{future:true});
  await page.getByRole('button',{name:'预约助手'}).first().click();await page.locator('#start').click();await expect(page.getByRole('status')).toContainText('等待预约开放');
  const bounds=await page.locator('dialog').boundingBox();expect(bounds!.width).toBeLessThanOrEqual(375);expect(bounds!.x).toBeGreaterThanOrEqual(0);
  await page.screenshot({path:testInfo.outputPath('countdown-mobile.png')});
  expect(state.calls).not.toContain('vcode.do');await page.getByRole('button',{name:'关闭',exact:true}).click();expect(state.writes()).toBe(0);
});
test('detail footer uses the hash WID', async ({page})=>{
  const state=await setup(page,{detail:true});await page.getByRole('button',{name:'预约助手'}).click();await page.locator('#start').click();await expect(page.getByLabel('验证码',{exact:true})).toBeFocused();
  expect(state.calls).toContain('vcode.do');expect(state.writes()).toBe(0);
});
test('a second tab cannot acquire a captcha while the first owns the task', async ({context})=>{
  const first=await context.newPage();await setup(first,{future:true});await first.getByRole('button',{name:'预约助手'}).first().click();await first.locator('#start').click();await expect(first.getByRole('status')).toContainText('等待预约开放');
  const second=await context.newPage();const state=await setup(second);await second.getByRole('button',{name:'预约助手'}).first().click();await expect(second.getByRole('status')).toContainText('另一个标签页');expect(state.calls).not.toContain('vcode.do');
  await first.close();await second.getByRole('button',{name:'预约助手'}).first().click();await second.locator('#start').click();await expect(second.getByLabel('验证码',{exact:true})).toBeFocused();
});

test('full events select monitoring without starting; minimize/reopen, pause/resume and stop share one task',async({page},testInfo)=>{
  await page.clock.install();const state=await setup(page,{full:true});
  await page.getByRole('button',{name:'预约助手'}).first().click();
  await expect(page.getByRole('radio',{name:'余位监测'})).toBeChecked();expect(state.calls).not.toContain('vcode.do');
  await expect(page.getByRole('radio',{name:'定时预约'})).toBeDisabled();
  await expect(page.getByRole('radio',{name:'余位监测'})).toBeEnabled();
  await expect(page.getByRole('button',{name:'提交预约'})).not.toBeVisible();
  await page.getByLabel('检查间隔').selectOption('30');await page.getByRole('button',{name:'开始监测'}).click();
  await expect(page.getByRole('status')).toContainText('等待空余名额');
  await page.setViewportSize({width:1280,height:720});
  const desktop=await page.locator('dialog').boundingBox();expect(desktop!.width).toBe(680);expect(desktop!.height).toBeLessThan(340);
  const groups=page.locator('.controls fieldset');const first=await groups.nth(0).boundingBox(),second=await groups.nth(1).boundingBox();expect(first!.y).toBe(second!.y);
  await page.screenshot({path:testInfo.outputPath('monitor-desktop.png')});
  await page.setViewportSize({width:599,height:709});await page.screenshot({path:testInfo.outputPath('monitor-compact.png')});
  const compact=await page.locator('dialog').boundingBox();expect(compact!.height).toBeLessThan(380);
  await page.setViewportSize({width:375,height:700});await page.screenshot({path:testInfo.outputPath('monitor-mobile.png')});
  const check=await page.getByRole('button',{name:'立即检查'}).boundingBox(),stop=await page.getByRole('button',{name:'停止监测'}).boundingBox();
  expect(check!.y).toBe(stop!.y);expect(check!.x+check!.width).toBeLessThan(stop!.x);
  const panel=await page.locator('dialog').boundingBox();expect(panel!.x).toBeGreaterThanOrEqual(0);expect(panel!.y).toBeGreaterThanOrEqual(0);expect(panel!.height).toBeLessThan(420);expect(panel!.y+panel!.height).toBeLessThanOrEqual(700);
  expect(await page.locator('dialog').evaluate(el=>el.scrollHeight<=el.clientHeight)).toBe(true);
  await page.getByRole('button',{name:'收起',exact:true}).click();await expect(page.locator('dialog')).not.toBeVisible();
  const queries=state.calls.length;await page.getByRole('button',{name:'监测中',exact:true}).first().click();
  await expect(page.locator('dialog')).toBeVisible();expect(state.calls).toHaveLength(queries);
  await page.getByRole('button',{name:'暂停监测'}).click();await page.clock.fastForward(180000);expect(state.calls).toHaveLength(queries);
  await expect(page.locator('.seu-lecture-helper-button').first()).toHaveText('已暂停');
  await page.getByRole('button',{name:'继续监测'}).click();await expect(page.getByRole('status')).toContainText('等待空余名额');
  await page.getByRole('button',{name:'停止监测'}).click();const stopped=state.calls.length;await page.clock.fastForward(180000);
  expect(state.calls).toHaveLength(stopped);expect(state.writes()).toBe(0);await expect(page.locator('.seu-lecture-helper-button').first()).toHaveText('预约助手');
});

test('a released seat reopens a minimized monitor, automatically books, verifies and stops polling',async({page})=>{
  await page.clock.install();const state=await setup(page,{full:true});await page.getByRole('button',{name:'预约助手'}).first().click();
  await page.getByLabel('检查间隔').selectOption('30');await page.getByRole('button',{name:'开始监测'}).click();await expect(page.getByRole('status')).toContainText('等待空余名额');
  await page.getByRole('button',{name:'收起',exact:true}).click();state.releaseSeat();await page.clock.fastForward(34000);
  await expect(page.getByRole('status')).toContainText('已核验',{timeout:20000});const calls=state.calls.length;
  await page.clock.fastForward(180000);expect(state.calls).toHaveLength(calls);expect(state.writes()).toBe(1);expect(state.nativeClicks()).toBe(0);
});

test('scheduled booking transitions to monitoring only when follow-up was selected',async({page})=>{
  await page.clock.install();const state=await setup(page,{rejectFull:true});await page.getByRole('button',{name:'预约助手'}).first().click();
  await page.getByLabel('未抢到时继续监测余位').check();await page.getByLabel('检查间隔').selectOption('30');await page.locator('#start').click();
  await page.getByLabel('验证码',{exact:true}).fill('TEST');await page.getByLabel('验证码',{exact:true}).press('Enter');
  await expect(page.getByRole('status')).toContainText('继续等待空余名额');expect(state.writes()).toBe(1);
  await page.clock.fastForward(34000);await expect(page.getByRole('status')).toContainText('等待空余名额');expect(state.writes()).toBe(1);
  state.releaseSeat();await page.clock.fastForward(34000);await expect(page.getByRole('status')).toContainText('已核验',{timeout:20000});expect(state.writes()).toBe(2);
});

test('a full rejection without follow-up offers an enabled monitor instead of a terminal dead end',async({page})=>{
  await page.clock.install();const state=await setup(page,{rejectFull:true});
  await page.getByRole('button',{name:'预约助手'}).first().click();await page.locator('#start').click();
  await page.getByLabel('验证码',{exact:true}).fill('TEST');await page.getByLabel('验证码',{exact:true}).press('Enter');
  await expect(page.getByRole('status')).toContainText('当前活动预约人数已满，请重新选择');
  await expect(page.getByRole('radio',{name:'余位监测'})).toBeChecked();
  await expect(page.getByRole('radio',{name:'余位监测'})).toBeEnabled();
  await expect(page.getByRole('radio',{name:'定时预约'})).toBeDisabled();
  await expect(page.getByAltText('预约验证码')).not.toBeVisible();
  await expect(page.getByRole('button',{name:'提交预约'})).not.toBeVisible();
  await expect(page.getByRole('button',{name:'开始监测'})).toBeEnabled();
  const queries=state.calls.length;await page.clock.fastForward(180000);expect(state.calls).toHaveLength(queries);
  await page.getByRole('button',{name:'开始监测'}).click();await expect(page.getByRole('status')).toContainText('等待空余名额');
  expect(state.writes()).toBe(1);expect(state.calls.filter(x=>x==='vcode.do')).toHaveLength(1);
});

test('changing task mode discards a manual challenge and requires explicit restart',async({page})=>{
  const state=await setup(page);await page.getByRole('button',{name:'预约助手'}).first().click();await page.locator('#start').click();
  await page.getByLabel('验证码',{exact:true}).fill('TEST');
  await page.getByRole('radio',{name:'余位监测'}).check();
  await expect(page.getByRole('button',{name:'开始监测'})).toBeEnabled();
  await expect(page.getByAltText('预约验证码')).not.toBeVisible();
  expect(state.writes()).toBe(0);expect(state.calls.filter(x=>x==='vcode.do')).toHaveLength(1);
  await page.getByRole('radio',{name:'定时预约'}).check();await page.locator('#start').click();
  await expect(page.getByLabel('验证码',{exact:true})).toHaveValue('');
  expect(state.calls.filter(x=>x==='vcode.do')).toHaveLength(2);expect(state.writes()).toBe(0);
});

test('check-now resets the timer, interval edits keep this deadline, and in-flight checks are disabled',async({page})=>{
  const clockStart=new Date();await page.clock.install({time:clockStart});await page.clock.pauseAt(clockStart);
  const state=await setup(page,{full:true});await page.evaluate(()=>{Math.random=()=>0.5;});
  await page.getByRole('button',{name:'预约助手'}).first().click();
  await expect(page.getByRole('radio',{name:'自动识别'})).toBeChecked();await expect(page.getByRole('radio',{name:'手动输入'})).toBeDisabled();
  await page.getByRole('button',{name:'开始监测'}).click();await expect(page.getByRole('button',{name:'立即检查'})).toBeEnabled();
  const button=page.getByRole('button',{name:'立即检查'}),stop=page.getByRole('button',{name:'停止监测'});
  const a=await button.boundingBox(),b=await stop.boundingBox();expect(a!.x+a!.width).toBeLessThan(b!.x);expect(a!.y).toBe(b!.y);
  await page.clock.fastForward(50000);await page.getByLabel('检查间隔').selectOption('30');await expect(page.locator('.clock')).toHaveText('00:00:10');
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/queryActivityList.do',async route=>{await gate;await route.fallback();});
  const before=state.calls.filter(x=>x==='queryActivityList.do').length;
  await button.click();await expect(button).toBeDisabled();await page.clock.fastForward(10000);
  expect(state.calls.filter(x=>x==='queryActivityList.do')).toHaveLength(before);
  release();await expect(button).toBeEnabled();await expect(page.locator('.clock')).toHaveText(/00:00:(27|28|29|30|31|32|33)/);
  await button.click();await expect(button).toBeEnabled();expect(state.calls.filter(x=>x==='queryActivityList.do')).toHaveLength(before+2);
  await page.clock.fastForward(34000);await expect(button).toBeEnabled();expect(state.calls.filter(x=>x==='queryActivityList.do')).toHaveLength(before+3);
  expect(state.writes()).toBe(0);
});
