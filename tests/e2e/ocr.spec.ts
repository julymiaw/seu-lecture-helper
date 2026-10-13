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
async function setup(page:Page, options:{future?:boolean;blocked?:boolean;rejectCode?:boolean|'three';badFirst?:boolean;rejectFull?:boolean;mode?:'manual'|'ocr';full?:boolean}={}) {
  let booked=false,writes=0,captchaCalls=0,assetCalls=0;
  const codes:string[]=[];
  const failures:string[]=[];
  let image='',blank='';
  let full=Boolean(options.full);
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
    const now=Date.now(),data=structuredClone(raw);
    data.datas.xtdqsj=stamp(now); data.datas.hdlbList[0].YYKSSJ=stamp(now+(options.future?3600000:-3600000)); data.datas.hdlbList[0].YYJSSJ=stamp(now+7200000); data.datas.xsxxList=[];
    data.datas.hdrsList.find((row:{HD_WID:string})=>row.HD_WID===data.datas.hdlbList[0].WID)!.YYRS=full?Number(data.datas.hdlbList[0].HDZRS):149;
    let result;
    if(name==='queryActivityList.do') result=data;
    else if(name==='vcode.do') {captchaCalls++;result={code:0,datas:options.badFirst&&captchaCalls===1?blank:image};}
    else if(name==='addReservation.do') {
      writes++; codes.push(new URLSearchParams(request.postData()!).get('vcode')!);
      if(options.rejectFull&&writes===1) {full=true;result={code:-1,datas:null,msg:'当前活动预约人数已满，请重新选择'};}
      else if(options.rejectCode&&(writes===1||options.rejectCode==='three'&&writes<=3)) result={code:-1,datas:null,msg:'验证码错误，请重试'};
      else {booked=true;result={code:0,datas:1};}
    } else if(name==='queryMyActivityList.do') result={code:0,datas:{wdhdList:booked?[{HD_WID:raw.datas.hdlbList[0].WID,YY_WID:'fixture-id',FBZT:'1'}]:[]}};
    else {failures.push(name!);return route.abort();}
    return route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.goto(ORIGIN+'/index.do#/hdyy');
  image=await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=100;canvas.height=36;
    const ctx=canvas.getContext('2d')!;ctx.fillStyle='white';ctx.fillRect(0,0,100,36);ctx.fillStyle='black';ctx.font='bold 26px serif';ctx.fillText('3253',8,27);return canvas.toDataURL('image/jpeg');
  });
  blank=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=100;c.height=36;const x=c.getContext('2d')!;x.fillStyle='white';x.fillRect(0,0,100,36);return c.toDataURL();});
  if(options.mode) await page.evaluate(mode=>localStorage.setItem('seu-lecture-helper-input-mode',mode),options.mode);
  await page.addScriptTag({content:script});
  return {writes:()=>writes,captchaCalls:()=>captchaCalls,assetCalls:()=>assetCalls,codes,failures,releaseSeat:()=>{full=false;}};
}

test('installed bundle uses real WASM/model to recognize and submit once; no external JS or school UI clicks',async({page,context})=>{
  await context.addCookies([{name:'cdn-test-cookie',value:'must-not-be-sent',url:'https://cdn.jsdelivr.net'}]);
  const state=await setup(page);
  await page.getByRole('button',{name:'预约助手'}).first().click();await page.locator('#start').click();
  await expect(page.getByRole('status')).toContainText('已核验',{timeout:20000});
  expect(state.writes()).toBe(1); expect(state.codes).toEqual(['3253']); expect(state.assetCalls()).toBe(3); expect(state.failures).toEqual([]);
});

test('countdown preloads OCR, mode can change, and cached assets survive a new page',async({page},testInfo)=>{
  const state=await setup(page,{future:true});
  await page.getByRole('button',{name:'预约助手'}).first().click();await page.locator('#start').click();
  await expect(page.locator('#seu-lecture-helper-dialog').locator('#preparation')).toContainText('已就绪',{timeout:20000});
  expect(state.captchaCalls()).toBe(0); expect(state.writes()).toBe(0);
  const card=page.locator('.activity-container').first();
  const native=await card.locator('button').first().boundingBox(),added=await card.locator('.seu-lecture-helper-button').boundingBox();
  expect(added!.height).toBeCloseTo(native!.height,1); expect(added!.width).toBeCloseTo(native!.width,1);
  await page.setViewportSize({width:375,height:850});
  await page.screenshot({path:testInfo.outputPath('ocr-countdown-mobile.png')});
  await page.getByRole('radio',{name:'手动输入'}).check();
  await expect(page.getByRole('radio',{name:'手动输入'})).toBeChecked();
  await page.getByRole('radio',{name:'自动识别'}).check();
  await page.getByRole('button',{name:'关闭',exact:true}).click();
  await page.reload();await page.addScriptTag({content:script});
  await page.getByRole('button',{name:'预约助手'}).first().click();await page.locator('#start').click();
  await expect(page.locator('#seu-lecture-helper-dialog').locator('#preparation')).toContainText('已就绪',{timeout:20000});
  expect(state.assetCalls()).toBe(3); expect(state.failures).toEqual([]);
});

test('a prepared OCR task obtains the challenge at the deadline and then submits',async({page})=>{
  await page.clock.install();
  const state=await setup(page,{future:true});await page.getByRole('button',{name:'预约助手'}).first().click();await page.locator('#start').click();
  await expect(page.locator('#seu-lecture-helper-dialog').locator('#preparation')).toContainText('已就绪',{timeout:20000});
  expect(state.captchaCalls()).toBe(0);expect(state.writes()).toBe(0);
  await page.clock.fastForward(3601000);
  await expect(page.getByRole('status')).toContainText('已核验',{timeout:20000});
  expect(state.captchaCalls()).toBe(1);expect(state.writes()).toBe(1);expect(state.codes).toEqual(['3253']);
});

test('unavailable OCR falls back to focused manual input and retains the challenge',async({page},testInfo)=>{
  const state=await setup(page,{blocked:true});
  await page.getByRole('button',{name:'预约助手'}).first().click();await page.locator('#start').click();
  await expect(page.getByRole('radio',{name:'手动输入'})).toBeChecked();
  await expect(page.getByLabel('验证码',{exact:true})).toBeFocused();
  await page.setViewportSize({width:375,height:850});
  await page.screenshot({path:testInfo.outputPath('manual-fallback-mobile.png')});
  const input=page.getByLabel('验证码',{exact:true});await input.fill('3253');await input.press('Enter');
  await expect(page.getByRole('status')).toContainText('已核验'); expect(state.writes()).toBe(1); expect(state.captchaCalls()).toBe(1); expect(state.failures).toEqual([]);
});

test('OCR captcha rejection replaces the image and completes automatically',async({page})=>{
  const state=await setup(page,{rejectCode:true});await page.getByRole('button',{name:'预约助手'}).first().click();await page.locator('#start').click();
  await expect(page.getByRole('status')).toContainText('已核验',{timeout:20000});
  expect(state.writes()).toBe(2);expect(state.captchaCalls()).toBe(2);expect(state.failures).toEqual([]);
});

for(const mode of ['scheduled','monitor'] as const)test(`unattended ${mode} replaces an unreadable challenge and books automatically`,async({page})=>{
  const state=await setup(page,{badFirst:true});await page.getByRole('button',{name:'预约助手'}).first().click();
  if(mode==='monitor')await page.getByRole('radio',{name:'余位监测'}).check();
  await page.locator('#start').click();await expect(page.getByRole('status')).toContainText('已核验',{timeout:20000});
  expect(state.writes()).toBe(1);expect(state.captchaCalls()).toBe(2);expect(state.codes).toEqual(['3253']);expect(state.failures).toEqual([]);
});

test('monitoring prewarms real OCR without a challenge, then books a released seat and stops',async({page})=>{
  await page.clock.install();const state=await setup(page,{full:true});await page.getByRole('button',{name:'预约助手'}).first().click();
  await page.getByLabel('检查间隔').selectOption('30');await page.getByRole('button',{name:'开始监测'}).click();
  await expect(page.locator('#preparation')).toContainText('已就绪',{timeout:20000});expect(state.captchaCalls()).toBe(0);expect(state.writes()).toBe(0);
  await page.getByRole('button',{name:'收起',exact:true}).click();state.releaseSeat();await page.clock.fastForward(34000);
  await expect(page.getByRole('status')).toContainText('已核验',{timeout:20000});expect(state.writes()).toBe(1);expect(state.codes).toEqual(['3253']);expect(state.captchaCalls()).toBe(1);
  await page.clock.fastForward(180000);expect(state.writes()).toBe(1);expect(state.captchaCalls()).toBe(1);expect(state.failures).toEqual([]);
});

test('manual-to-OCR full rejection clears the old challenge and remains recoverable',async({page})=>{
  await page.clock.install();const state=await setup(page,{mode:'manual',rejectFull:true});
  await page.getByRole('button',{name:'预约助手'}).first().click();await page.locator('#start').click();
  await expect(page.getByLabel('验证码',{exact:true})).toBeFocused();
  await page.getByRole('radio',{name:'自动识别'}).check();
  await expect(page.getByRole('button',{name:'开始监测'})).toBeEnabled({timeout:20000});
  await expect(page.getByRole('radio',{name:'定时预约'})).toBeDisabled();
  await expect(page.getByRole('radio',{name:'余位监测'})).toBeChecked();
  await expect(page.getByRole('radio',{name:'余位监测'})).toBeEnabled();
  await expect(page.getByAltText('预约验证码')).not.toBeVisible();
  await expect(page.getByRole('radio',{name:'手动输入'})).toBeDisabled();
  await page.clock.fastForward(180000);expect(state.writes()).toBe(1);expect(state.captchaCalls()).toBe(1);
  await page.getByLabel('检查间隔').selectOption('30');await page.getByRole('button',{name:'开始监测'}).click();
  await expect(page.getByRole('status')).toContainText('等待空余名额');
  await page.clock.fastForward(34000);await expect(page.getByRole('button',{name:'立即检查'})).toBeEnabled();expect(state.writes()).toBe(1);expect(state.captchaCalls()).toBe(1);
  state.releaseSeat();await page.clock.fastForward(34000);
  await expect(page.getByRole('status')).toContainText('已核验',{timeout:20000});
  expect(state.writes()).toBe(2);expect(state.captchaCalls()).toBe(2);expect(state.failures).toEqual([]);
});

for(const failure of ['resource','captcha'] as const)test(`monitoring unlocks manual input after ${failure} failure and can complete booking`,async({page})=>{
  const state=await setup(page,{mode:'manual',full:true,blocked:failure==='resource',rejectCode:failure==='captcha'?'three':false});
  await page.getByRole('button',{name:'预约助手'}).first().click();await page.getByRole('button',{name:'开始监测'}).click();
  await expect(page.getByRole('button',{name:'立即检查'})).toBeEnabled();
  if(failure==='captcha'){
    await expect(page.locator('#preparation')).toContainText('已就绪',{timeout:20000});
    await expect(page.getByRole('radio',{name:'自动识别'})).toBeChecked();await expect(page.getByRole('radio',{name:'手动输入'})).toBeDisabled();
  }
  state.releaseSeat();await page.getByRole('button',{name:'立即检查'}).click();
  await expect(page.getByRole('radio',{name:'手动输入'})).toBeChecked({timeout:20000});
  await expect(page.getByRole('radio',{name:'手动输入'})).toBeEnabled();await expect(page.getByLabel('验证码',{exact:true})).toBeFocused();
  await expect(page.getByRole('button',{name:'立即检查'})).not.toBeVisible();
  expect(state.writes()).toBe(failure==='captcha'?3:0);
  await page.getByLabel('验证码',{exact:true}).fill('3253');await page.getByLabel('验证码',{exact:true}).press('Enter');
  await expect(page.getByRole('status')).toContainText('已核验');expect(state.writes()).toBe(failure==='captcha'?4:1);expect(state.failures).toEqual([]);
});
