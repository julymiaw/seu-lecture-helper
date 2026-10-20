import {test, expect, type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
const assets:Record<string,{path:string}>=JSON.parse(readFileSync('src/ocr-assets.json','utf8'));
const raw=JSON.parse(readFileSync('tests/fixtures/activities.json','utf8'));
const html=readFileSync('tests/fixtures/list.html','utf8');
const script=readFileSync('dist/seu-lecture-helper.user.js','utf8');
const ORIGIN='https://lecture.test';
const stamp=(ms:number)=>new Date(ms+8*3600000).toISOString().slice(0,19).replace('T',' ');
const fixtureStyle=`<style>
body{font:16px system-ui;background:#edf5ef;margin:0;padding:20px}.activity-container{background:white;padding:20px;margin:0 0 18px;border-radius:14px}.activity-name{font-weight:600;margin:12px 0}.activity-text{font-size:14px;color:#67766c}.ydd-inline-flex{display:flex;justify-content:flex-end;align-items:center;margin:14px 0}.ydd-button-small{font:14px/18px system-ui;padding:4px 12px;border:1px solid #999;border-radius:20px;background:white}.button-warning{color:#e85e32;border-color:#e85e32}.activity-time{background:#e4f2e6;font-size:13px;padding:5px;text-align:center}
</style>`;
async function setup(page:Page, options:{expireSubmitOnce?:boolean;resumeStatus?:number;failResumeOnce?:boolean;bookedInitially?:boolean;pair?:boolean;unlabelled?:boolean;unknownPrimary?:boolean;declinePair?:boolean;expireBackupOnce?:boolean;allFull?:boolean;expireProbeOnce?:boolean;notOpenOnce?:boolean;future?:boolean;blocked?:boolean;rejectCode?:boolean|'three';fullOnRejection?:boolean}={}) {
  const initialTime=Date.now();
  let resumeFailures=0,expiredWrite=false;
  let booked=Boolean(options.bookedInitially),bookedId=raw.datas.hdlbList[0].WID,writes=0,captchaCalls=0,assetCalls=0;
  const targets:string[]=[];const events:string[]=[];
  const codes:string[]=[];
  const failures:string[]=[];
  let image='';
  let full=false;
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==ORIGIN) {
      const asset=Object.entries(assets).find(([,a])=>url.pathname.endsWith('/'+a.path));
      if(!asset || !['https://cdn.jsdelivr.net','https://unpkg.com'].includes(url.origin)) {failures.push(url.href); return route.abort();}
      assetCalls++;
      expect(request.method()).toBe('GET');
      expect(request.headers()['cookie']).toBeUndefined();
      expect(request.headers()['referer']).toBeUndefined();
      if(options.blocked) return route.fulfill({status:503,headers:{'Access-Control-Allow-Origin':'*'},body:'offline'});
      return route.fulfill({contentType:'application/octet-stream',headers:{'Access-Control-Allow-Origin':'*'},body:readFileSync('.cache/ocr/'+asset[0])});
    }
    const name=url.pathname.split('/').pop();
    if(!url.pathname.includes('/modules/hdyy/')) return route.fulfill({contentType:'text/html',body:html.replace('</body>',fixtureStyle+'</body>')});
    const now=await page.evaluate(()=>Date.now()),data=structuredClone(raw);
    data.datas.xtdqsj=stamp(now); data.datas.hdlbList[0].YYKSSJ=stamp(initialTime+(options.future?3600000:-3600000)); data.datas.hdlbList[0].YYJSSJ=stamp(now+7200000); data.datas.xsxxList=[];
    data.datas.hdrsList.find((row:{HD_WID:string})=>row.HD_WID===data.datas.hdlbList[0].WID)!.YYRS=full?Number(data.datas.hdlbList[0].HDZRS):149;
    let result;
    if(options.pair){const first=data.datas.hdlbList[0];first.JZMC=options.unlabelled?'【艺术】同一讲座':'【线上】【艺术】同一讲座';first.JZDD='腾讯会议';const second={...first,WID:'offline-fixture',JZMC:options.unlabelled?'【艺术】同一讲座':'【线下】【艺术】同一讲座',JZDD:'九龙湖报告厅'};data.datas.hdlbList=[first,second];data.datas.hdrsList=[{HD_WID:first.WID,YYRS:0},{HD_WID:second.WID,YYRS:0}];}
    if(name==='queryActivityList.do') {if(options.failResumeOnce&&captchaCalls>0&&resumeFailures++===0)return route.fulfill({status:options.resumeStatus??401,body:'unavailable'});result=data;}
    else if(name==='vcode.do') {captchaCalls++;events.push('captcha');if(options.expireBackupOnce&&captchaCalls===2)return route.fulfill({status:401,body:'unauthorized'});if(options.expireProbeOnce&&captchaCalls===1)return route.fulfill({status:401,body:'unauthorized'});result={code:0,datas:image};}
    else if(name==='addReservation.do') {
      writes++;const target=new URLSearchParams(request.postData()!).get('wid')!;targets.push(target);events.push('submit:'+target);codes.push(new URLSearchParams(request.postData()!).get('vcode')!);
      if(options.expireSubmitOnce&&!expiredWrite&&(!options.pair||target==='offline-fixture')){expiredWrite=true;booked=true;bookedId=target;return route.fulfill({status:401,body:'unauthorized'});}
      if(options.pair&&target!== 'offline-fixture'&&options.unknownPrimary)return route.abort();
      if(options.pair&&(target!=='offline-fixture'||options.allFull))result={code:-1,datas:null,msg:'当前活动预约人数已满，请重新选择'};
      else if(options.notOpenOnce&&writes===1) result={code:-1,datas:null,msg:'尚未开放预约'};
      else if(full)result={code:-1,datas:null,msg:'当前活动预约人数已满，请重新选择'};
      else if(options.rejectCode&&(writes===1||options.rejectCode==='three'&&writes<=3)){if(options.fullOnRejection&&writes>=2)full=true;result={code:-1,datas:null,msg:'验证码错误，请重试'};}
      else {booked=true;bookedId=target;result={code:0,datas:1};}
    } else if(name==='queryMyActivityList.do') result={code:0,datas:{wdhdList:booked?[{HD_WID:bookedId,YY_WID:'fixture-id',FBZT:'1'}]:[]}};
    else {failures.push(name!);return route.abort();}
    return route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.goto(ORIGIN+'/index.do#/hdyy');
  image=await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=100;canvas.height=36;
    const ctx=canvas.getContext('2d')!;ctx.fillStyle='white';ctx.fillRect(0,0,100,36);ctx.fillStyle='black';ctx.font='bold 26px serif';ctx.fillText('3253',8,27);return canvas.toDataURL('image/jpeg');
  });

  if(options.pair)await page.locator('.activity-container').first().evaluate((card,unlabelled)=>{
    card.querySelector('.activity-name')!.textContent=unlabelled?'【艺术】同一讲座':'【线上】【艺术】同一讲座';card.querySelectorAll('.activity-text')[2].querySelector('div')!.textContent='腾讯会议';Object.assign(card,{__vue__:{$props:{item:{WID:'9077433c420649399417b52eae7d5b50'}}}});
    const other=card.cloneNode(true) as HTMLElement;other.querySelector('.activity-name')!.textContent=unlabelled?'【艺术】同一讲座':'【线下】【艺术】同一讲座';other.querySelectorAll('.activity-text')[2].querySelector('div')!.textContent='九龙湖报告厅';Object.assign(other,{__vue__:{$props:{item:{WID:'offline-fixture'}}}});card.after(other);
  },options.unlabelled??false);
  await page.addScriptTag({content:script});
  return {targets,events,writes:()=>writes,captchaCalls:()=>captchaCalls,assetCalls:()=>assetCalls,codes,failures};
}

const progress=(page:Page)=>page.locator('#candidates li[data-current="true"] .candidate-status:visible, #status:visible');

async function openHelper(page:Page,include=true){await page.getByRole('button',{name:'预约助手'}).first().click();await page.locator('#start:visible, #join:visible').first().waitFor({state:'visible'});if(await page.locator('#join').isVisible())await page.getByRole('button',{name:include?'加入':'取消',exact:true}).click();}

test('installed bundle uses real WASM/model to recognize and submit, with safe diagnostics',async({page,context})=>{
  const logs:string[]=[];page.on('console',msg=>{logs.push(msg.text());});
  await context.addCookies([{name:'cdn-test-cookie',value:'must-not-be-sent',url:'https://cdn.jsdelivr.net'}]);
  const state=await setup(page);await openHelper(page);await page.locator('#start').click();
  await expect(progress(page)).toContainText('预约成功',{timeout:20000});
  expect(state.writes()).toBe(1);expect(state.codes).toEqual(['3253']);expect(state.assetCalls()).toBe(3);expect(state.failures).toEqual([]);
  expect(logs.join('\n')).toContain('SEU预约助手');expect(logs.join('\n')).not.toContain('data:image');
  expect(logs.join('\n')).not.toContain('VerifyOutputSizes');
  expect(logs.join('\n')).not.toContain('Expected shape from model');
});
test('OCR preparation is invisible and submitted automatically at opening',async({page},testInfo)=>{
  await page.clock.install();const state=await setup(page,{future:true});await openHelper(page);await page.locator('#start').click();
  await expect(page.locator('#seu-lecture-helper-dialog')).toHaveAttribute('data-ocr','ready',{timeout:20000});expect(state.captchaCalls()).toBe(0);
  await page.clock.fastForward(3571000);
  await expect(page.locator('#seu-lecture-helper-dialog')).toHaveAttribute('data-phase','prepared',{timeout:20000});expect(state.writes()).toBe(0);
  await expect(page.locator('#seu-lecture-helper-dialog img, #seu-lecture-helper-dialog output, #seu-lecture-helper-dialog input')).toHaveCount(0);
  await expect(page.locator('#seu-lecture-helper-dialog input')).toHaveCount(0);await expect(page.getByRole('button',{name:'提交预约',exact:true})).toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath('prepared-captcha.png')});
  await page.clock.fastForward(30000);await expect(progress(page)).toContainText('预约成功');expect(state.codes).toEqual(['3253']);expect(state.captchaCalls()).toBe(1);
});
test('prefetched captcha rejected by server refreshes automatically and succeeds',async({page})=>{
  await page.clock.install();const state=await setup(page,{future:true,rejectCode:true});await openHelper(page);await page.locator('#start').click();
  await expect(page.locator('#seu-lecture-helper-dialog')).toHaveAttribute('data-ocr','ready',{timeout:20000});await page.clock.fastForward(3571000);
  await expect(page.locator('#seu-lecture-helper-dialog')).toHaveAttribute('data-phase','prepared',{timeout:20000});await page.clock.fastForward(30000);
  await expect(progress(page)).toContainText('预约成功',{timeout:20000});expect(state.writes()).toBe(2);expect(state.captchaCalls()).toBe(2);
});
test('cached resources survive a new page; no removed mode or monitoring controls',async({page})=>{
  const state=await setup(page,{future:true});await openHelper(page);
  await expect(page.locator('#seu-lecture-helper-dialog')).toHaveAttribute('data-ocr','ready',{timeout:20000});
  await expect(page.getByRole('radio')).toHaveCount(0);await expect(page.getByRole('button',{name:'开始监测'})).toHaveCount(0);
  expect(state.captchaCalls()).toBe(0);await page.getByRole('button',{name:'关闭',exact:true}).click();await page.reload();await page.addScriptTag({content:script});await openHelper(page);
  await expect(page.locator('#seu-lecture-helper-dialog')).toHaveAttribute('data-ocr','ready',{timeout:20000});expect(state.assetCalls()).toBe(3);
});
test('unavailable model stops with diagnostics and no manual fallback',async({page})=>{
  const state=await setup(page,{blocked:true});await openHelper(page);await expect(page.locator('#seu-lecture-helper-dialog')).toHaveAttribute('data-ocr','failed',{timeout:20000});await page.locator('#start').click();
  await expect(progress(page)).toContainText('OCR 引擎准备失败',{timeout:20000});expect(state.writes()).toBe(0);await expect(page.locator('#seu-lecture-helper-dialog input')).toHaveCount(0);await expect(page.getByRole('button',{name:'提交预约',exact:true})).toHaveCount(0);
});
test('retry stops when capacity becomes full; no ongoing monitoring',async({page})=>{
  await page.clock.install();const state=await setup(page,{rejectCode:'three',fullOnRejection:true});await openHelper(page);await page.locator('#start').click();
  await expect(progress(page)).toContainText('已满',{timeout:20000});const count=state.captchaCalls();await page.clock.fastForward(120000);expect(state.captchaCalls()).toBe(count);expect(state.writes()).toBe(3);
});
test('compact dialog fits a narrow viewport and reopen retains automatic preparation',async({page},testInfo)=>{
  await page.clock.install();const state=await setup(page,{future:true});await page.setViewportSize({width:375,height:700});await openHelper(page);await page.locator('#start').click();
  await expect(page.locator('#seu-lecture-helper-dialog')).toHaveAttribute('data-ocr','ready',{timeout:20000});await page.clock.fastForward(3571000);await expect(page.locator('#seu-lecture-helper-dialog')).toHaveAttribute('data-phase','prepared',{timeout:20000});
  await page.getByRole('button',{name:'收起',exact:true}).click();await page.getByRole('button',{name:'预约中'}).first().click();await expect(page.locator('#seu-lecture-helper-dialog')).toHaveAttribute('data-phase','prepared');
  const fits=await page.locator('#seu-lecture-helper-dialog').locator('dialog').evaluate(el=>el.scrollHeight<=el.clientHeight && el.scrollWidth<=el.clientWidth);expect(fits).toBe(true);
  await page.screenshot({path:testInfo.outputPath('prepared-mobile.png')});expect(state.writes()).toBe(0);
});

test('not-open boundary refreshes captcha before submitting again',async({page})=>{
  const state=await setup(page,{notOpenOnce:true});await openHelper(page);await page.locator('#start').click();
  await expect(progress(page)).toContainText('预约成功',{timeout:20000});expect(state.writes()).toBe(2);expect(state.captchaCalls()).toBe(2);expect(state.failures).toEqual([]);
});

test('refresh restores the waiting task without another start click',async({page})=>{
  await page.clock.install();const state=await setup(page,{future:true});await openHelper(page);await page.locator('#start').click();
  await expect(page.locator('#seu-lecture-helper-dialog')).toHaveAttribute('data-ocr','ready',{timeout:20000});
  await page.reload();await page.addScriptTag({content:script});await expect(page.locator('#seu-lecture-helper-dialog')).toBeAttached();await expect(page.locator('#start')).toBeHidden();
  await expect(page.locator('#seu-lecture-helper-dialog')).toHaveAttribute('data-ocr','ready',{timeout:20000});await page.clock.fastForward(3601000);
  await expect(progress(page)).toContainText('预约成功',{timeout:20000});expect(state.writes()).toBe(1);
});
test('expired session pauses, refresh returns to the saved task, and fresh captcha completes booking',async({page})=>{
  await page.clock.install();const state=await setup(page,{future:true,expireProbeOnce:true});await openHelper(page);await page.locator('#start').click();
  await page.clock.fastForward(61000);await expect(progress(page)).toContainText('登录已失效');expect(state.writes()).toBe(0);
  await expect(page.getByRole('button',{name:'重新登录',exact:true})).toBeVisible();await page.reload();await page.addScriptTag({content:script});
  await expect(page.locator('#start')).toBeHidden();await expect(page.locator('#seu-lecture-helper-dialog')).toHaveAttribute('data-ocr','ready',{timeout:20000});await page.clock.fastForward(3540000);
  await expect(progress(page)).toContainText('预约成功',{timeout:20000});expect(state.writes()).toBe(1);
});


test('online-full fallback is serial, uses a fresh captcha, and retains the reason',async({page})=>{
  const state=await setup(page,{pair:true});await openHelper(page);
  await expect(page.getByRole('button',{name:'线上优先',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.locator('#start').click();await expect(progress(page)).toContainText('预约成功',{timeout:20000});
  expect(state.targets).toEqual([raw.datas.hdlbList[0].WID,'offline-fixture']);expect(state.events).toEqual(['captcha','submit:'+raw.datas.hdlbList[0].WID,'captcha','submit:offline-fixture']);
  await expect(page.locator('ol li').nth(0)).toContainText('已满');await expect(page.locator('ol li').nth(1)).toContainText('预约成功');await expect(page.locator('#failure')).toBeHidden();await expect(page.getByRole('button',{name:'提交预约',exact:true})).toBeHidden();await expect(page.getByRole('button',{name:'换一张',exact:true})).toBeHidden();expect(state.failures).toEqual([]);
});
test('one order control chooses offline first; successful first choice never submits the other',async({page})=>{
  const state=await setup(page,{pair:true});await openHelper(page);await page.getByRole('button',{name:'线下优先',exact:true}).click();
  await expect(page.locator('#labels')).toHaveCount(0);await page.locator('#start').click();
  await expect(progress(page)).toContainText('预约成功',{timeout:20000});expect(state.targets).toEqual(['offline-fixture']);
});
test('paired waiting layout fits mobile and preserves order across reload',async({page},testInfo)=>{
  await page.clock.install();await setup(page,{pair:true,future:true});await page.setViewportSize({width:375,height:700});
  await openHelper(page);await page.getByRole('button',{name:'线下优先',exact:true}).click();await page.locator('#start').click();
  await expect(page.locator('#seu-lecture-helper-dialog')).toHaveAttribute('data-ocr','ready',{timeout:20000});
  await page.reload();await page.addScriptTag({content:script});await expect(page.getByRole('button',{name:'线下优先',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.locator('#start')).toBeHidden();
  await expect(page.locator('#seu-lecture-helper-dialog').locator('dialog')).toBeVisible();
  expect(await page.locator('#seu-lecture-helper-dialog').locator('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth&&el.scrollHeight<=el.clientHeight)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('candidate-mobile.png')});
  await page.clock.fastForward(3571000);await expect(page.locator('#seu-lecture-helper-dialog')).toHaveAttribute('data-phase','prepared',{timeout:20000});
  expect(await page.locator('#seu-lecture-helper-dialog').locator('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth&&el.scrollHeight<=el.clientHeight)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('candidate-prepared-mobile.png')});
  await page.setViewportSize({width:1280,height:800});await page.screenshot({path:testInfo.outputPath('candidate-prepared-desktop.png')});
});
test('unknown primary result never starts the fallback',async({page})=>{
  const state=await setup(page,{pair:true,unknownPrimary:true});await openHelper(page);await page.locator('#start').click();
  await expect(progress(page)).toContainText('结果待确认',{timeout:20000});
  expect(state.targets).toEqual([raw.datas.hdlbList[0].WID]);expect(state.captchaCalls()).toBe(1);
});
test('unclassified titles keep only the clicked target without pairing or manual labels',async({page})=>{
  const state=await setup(page,{pair:true,unlabelled:true});await openHelper(page);await expect(page.locator('#start')).toBeEnabled();
  await expect(page.locator('#labels, #annotate, select')).toHaveCount(0);await expect(page.locator('#candidates li')).toHaveCount(1);await expect(page.getByRole('group',{name:'候选顺序'})).toBeHidden();
  await page.locator('#start').click();await expect(progress(page)).toContainText('已满',{timeout:20000});expect(state.targets).toEqual([raw.datas.hdlbList[0].WID]);await expect(page.locator('#status')).toBeHidden();
});
test('reload after backup captcha auth failure resumes the backup, not the exhausted primary',async({page})=>{
  const state=await setup(page,{pair:true,expireBackupOnce:true});await openHelper(page);await page.locator('#start').click();
  await expect(progress(page)).toContainText('登录已失效',{timeout:20000});expect(state.targets).toEqual([raw.datas.hdlbList[0].WID]);
  await page.reload();await page.addScriptTag({content:script});await expect(progress(page)).toContainText('预约成功',{timeout:20000});expect(state.targets).toEqual([raw.datas.hdlbList[0].WID,'offline-fixture']);await expect(page.locator('ol li').nth(0)).toContainText('已满');await expect(page.locator('ol li').nth(1)).toContainText('预约成功');
});

test('declining counterpart confirmation keeps a single target and hides the order setting',async({page})=>{
  const state=await setup(page,{pair:true,declinePair:true});await openHelper(page,false);await expect(page.getByRole('group',{name:'候选顺序'})).toBeHidden();
  await page.locator('#start').click();await expect(progress(page)).toContainText('已满',{timeout:20000});expect(state.targets).toEqual([raw.datas.hdlbList[0].WID]);
});

test('both variant buttons reopen the same waiting dialog without starting another task',async({page})=>{
  const state=await setup(page,{pair:true,future:true});await page.locator('[data-activity-id="offline-fixture"]').click();await page.getByRole('button',{name:'加入',exact:true}).click();await expect(page.getByRole('button',{name:'线上优先',exact:true})).toHaveAttribute('aria-pressed','true');await page.locator('#start').click();
  await page.getByRole('button',{name:'收起',exact:true}).click();await page.locator('[data-activity-id="'+raw.datas.hdlbList[0].WID+'"]').click();await expect(page.locator('#start')).toBeHidden();expect(await page.locator('#seu-lecture-helper-dialog').count()).toBe(1);expect(state.captchaCalls()).toBe(0);
});
test('pair confirmation stays themed and concise without native browser dialogs',async({page},testInfo)=>{
  let dialogs=0;page.on('dialog',dialog=>{dialogs++;void dialog.dismiss();});
  await setup(page,{pair:true});await page.getByRole('button',{name:'预约助手'}).first().click();
  await expect(page.locator('#pair-question')).toHaveText('是否将同一讲座的另一场次也加入候选？');await expect(page.locator('#title')).toHaveText('【线下】【艺术】同一讲座');
  await expect(page.locator('#start')).toBeHidden();await expect(page.locator('#candidates')).toBeHidden();
  const buttons=page.locator('#seu-lecture-helper-dialog').getByRole('button');await expect(buttons).toHaveCount(2);
  await page.screenshot({path:testInfo.outputPath('pair-confirmation.png')});
  await page.getByRole('button',{name:'加入',exact:true}).click();await expect(page.locator('#start')).toBeVisible();expect(dialogs).toBe(0);
});

test('both variants full ends with a clear failure and no submit or refresh controls',async({page})=>{
  let dialogs=0;page.on('dialog',dialog=>{dialogs++;void dialog.dismiss();});
  const state=await setup(page,{pair:true,allFull:true});await openHelper(page);await page.locator('#start').click();
  await expect(progress(page)).toContainText('已满，预约失败',{timeout:20000});
  await expect(page.locator('ol li.full')).toHaveCount(2);await expect(page.locator('#failure')).toBeHidden();
  await expect(page.getByRole('button',{name:'提交预约',exact:true})).toBeHidden();await expect(page.getByRole('button',{name:'换一张',exact:true})).toBeHidden();
  expect(state.targets).toEqual([raw.datas.hdlbList[0].WID,'offline-fixture']);expect(dialogs).toBe(0);
});


test('failed login restore followed by reload retains the whole offline-first group',async({page})=>{
  await page.clock.install();const state=await setup(page,{pair:true,future:true,expireProbeOnce:true,failResumeOnce:true});await openHelper(page);await page.getByRole('button',{name:'线下优先',exact:true}).click();await page.locator('#start').click();
  await page.clock.fastForward(61000);await expect(progress(page)).toContainText('登录已失效');
  const before=await page.evaluate(()=>sessionStorage.getItem('seu-lecture-pending-task'));
  await page.getByRole('button',{name:'登录后恢复',exact:true}).click();await expect(progress(page)).toContainText('登录已失效');
  expect(await page.evaluate(()=>sessionStorage.getItem('seu-lecture-pending-task'))).toBe(before);
  await page.reload();await page.addScriptTag({content:script});await expect(page.locator('#candidates li')).toHaveCount(2);await expect(page.getByRole('button',{name:'线下优先',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.clock.fastForward(3540000);await expect(progress(page)).toContainText('预约成功',{timeout:20000});expect(state.targets).toEqual(['offline-fixture']);
});
test('expired pending submission restores verification without preparing OCR or writing again',async({page})=>{
  const state=await setup(page,{bookedInitially:true});
  await page.evaluate(id=>sessionStorage.setItem('seu-lecture-pending-task',JSON.stringify({id,endsAt:Date.now()-60000,leadSeconds:30,verify:true})),raw.datas.hdlbList[0].WID);
  await page.reload();await page.addScriptTag({content:script});await expect(progress(page)).toContainText('预约成功');
  expect(state.assetCalls()).toBe(0);expect(state.captchaCalls()).toBe(0);expect(state.writes()).toBe(0);expect(await page.evaluate(()=>sessionStorage.getItem('seu-lecture-pending-task'))).toBeNull();await expect(page.locator('[data-activity-id="'+raw.datas.hdlbList[0].WID+'"]')).toHaveText('已预约');
});

test('same-page login recovery preserves candidate outcomes and updates the booked button',async({page})=>{
  const state=await setup(page,{pair:true,expireSubmitOnce:true});await openHelper(page);await page.locator('#start').click();await expect(progress(page)).toContainText('登录已失效',{timeout:20000});
  expect(state.writes()).toBe(2);await page.getByRole('button',{name:'登录后恢复',exact:true}).click();await expect(progress(page)).toContainText('预约成功');
  await expect(page.locator('#title')).toHaveText('【线下】【艺术】同一讲座');await expect(page.locator('#candidates li').first()).toContainText('已满');await expect(page.locator('#candidates li').nth(1)).toContainText('预约成功');await expect(page.locator('[data-activity-id="offline-fixture"]')).toHaveText('已预约');
  expect(state.writes()).toBe(2);expect(state.captchaCalls()).toBe(2);await expect(page.locator('#failure')).toBeHidden();
});
test('temporary metadata failure on recovery retains the pending group for reload',async({page})=>{
  await page.clock.install();const state=await setup(page,{pair:true,future:true,expireProbeOnce:true,failResumeOnce:true,resumeStatus:502});await openHelper(page);await page.locator('#start').click();await page.clock.fastForward(61000);await expect(progress(page)).toContainText('登录已失效');
  const before=await page.evaluate(()=>sessionStorage.getItem('seu-lecture-pending-task'));await page.getByRole('button',{name:'登录后恢复',exact:true}).click();await expect(progress(page)).toContainText('502');expect(await page.evaluate(()=>sessionStorage.getItem('seu-lecture-pending-task'))).toBe(before);
  await page.reload();await page.addScriptTag({content:script});await expect(page.locator('#candidates li')).toHaveCount(2);await page.clock.fastForward(3540000);await expect(progress(page)).toContainText('预约成功',{timeout:20000});expect(state.targets).toEqual([raw.datas.hdlbList[0].WID,'offline-fixture']);
});

test('exports persistent JSON after reload without needing Console and centers the countdown',async({page})=>{
  await page.clock.install();const state=await setup(page,{future:true});await openHelper(page);await expect(page.locator('#lead')).toHaveCount(0);
  const centered=await page.locator('.clock').evaluate(el=>{const a=el.getBoundingClientRect(),b=el.parentElement!.getBoundingClientRect();return Math.abs(a.x+a.width/2-b.x-b.width/2)<1;});expect(centered).toBe(true);
  await page.locator('#start').click();const saved=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('seu-lecture-pending-task')!));expect(saved).not.toHaveProperty('leadSeconds');expect(saved.runId).toBeTruthy();
  // Export flushes buffered records; the subsequent reload must read persisted history.
  const firstDownload=page.waitForEvent('download');await page.locator('#export').click();await firstDownload;
  await page.reload();await page.addScriptTag({content:script});await expect(page.locator('#seu-lecture-helper-dialog')).toHaveAttribute('data-ocr','ready',{timeout:20000});await page.clock.fastForward(3601000);await expect(progress(page)).toContainText('预约成功',{timeout:20000});
  const downloading=page.waitForEvent('download');await page.locator('#export').click();const download=await downloading,report=JSON.parse(readFileSync((await download.path())!,'utf8'));
  expect(report.storageWarning).toBeUndefined();expect(report.runs).toHaveLength(1);expect(report.runs[0].run).toBe(saved.runId);expect(Object.keys(report.runs[0].segments).length).toBeGreaterThanOrEqual(2);expect(report.runs[0].summary.phase).toBe('success');
  expect(report.runs[0].events.some((row:{event:string})=>row.event==='提交时机')).toBe(true);const serialized=JSON.stringify(report);expect(serialized).not.toContain('data:image');expect(serialized).not.toContain('3253');expect(state.writes()).toBe(1);
  expect(await page.evaluate(()=>caches.keys())).toEqual(expect.arrayContaining(['seu-lecture-ocr-v1','seu-lecture-diagnostics-v1']));
});
test('log-cache failure does not block booking and export includes memory with a warning',async({page})=>{
  const state=await setup(page);await page.evaluate(()=>{const original=caches.open.bind(caches);caches.open=async name=>{if(name==='seu-lecture-diagnostics-v1')throw new Error('simulated storage unavailable');return original(name);};});await openHelper(page);await page.locator('#start').click();await expect(progress(page)).toContainText('预约成功',{timeout:20000});
  const downloading=page.waitForEvent('download');await page.locator('#export').click();const download=await downloading,report=JSON.parse(readFileSync((await download.path())!,'utf8'));expect(report.storageWarning).toBeTruthy();expect(report.runs[0].summary.phase).toBe('success');expect(state.writes()).toBe(1);
});

test('single candidate has the same row-based progress and no duplicate status or error panels',async({page})=>{
  await page.clock.install();const state=await setup(page,{future:true});await openHelper(page);await expect(page.locator('#candidates li')).toHaveCount(1);await expect(page.getByRole('group',{name:'候选顺序'})).toBeHidden();await expect(progress(page)).toHaveText('待开始');
  await page.locator('#start').click();await expect(progress(page)).toHaveText('等待开放');await expect(page.locator('#seu-lecture-helper-dialog')).toHaveAttribute('data-ocr','ready',{timeout:20000});await page.clock.fastForward(3571000);await expect(page.locator('#seu-lecture-helper-dialog')).toHaveAttribute('data-phase','prepared',{timeout:20000});
  await expect(progress(page)).toHaveText('等待开放');await expect(page.locator('#status')).toBeHidden();await expect(page.locator('#failure, #preparation, #labels, select')).toHaveCount(0);await page.clock.fastForward(30000);await expect(progress(page)).toHaveText('预约成功');expect(state.writes()).toBe(1);
  const aligned=await page.locator('.actions').evaluate(el=>{const a=el.getBoundingClientRect(),exportButton=el.querySelector('#export')!.getBoundingClientRect(),close=el.querySelector('#close')!.getBoundingClientRect();return Math.abs(exportButton.left-a.left)<1&&Math.abs(close.right-a.right)<1;});expect(aligned).toBe(true);
});
