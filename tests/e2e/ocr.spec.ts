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
async function setup(page:Page, options:{notOpenOnce?:boolean;future?:boolean;blocked?:boolean;rejectCode?:boolean|'three';fullOnRejection?:boolean}={}) {
  const initialTime=Date.now();
  let booked=false,writes=0,captchaCalls=0,assetCalls=0;
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
    if(name==='queryActivityList.do') result=data;
    else if(name==='vcode.do') {captchaCalls++;result={code:0,datas:image};}
    else if(name==='addReservation.do') {
      writes++; codes.push(new URLSearchParams(request.postData()!).get('vcode')!);
      if(options.notOpenOnce&&writes===1) result={code:-1,datas:null,msg:'尚未开放预约'};
      else if(full)result={code:-1,datas:null,msg:'当前活动预约人数已满，请重新选择'};
      else if(options.rejectCode&&(writes===1||options.rejectCode==='three'&&writes<=3)){if(options.fullOnRejection&&writes>=2)full=true;result={code:-1,datas:null,msg:'验证码错误，请重试'};}
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

  await page.addScriptTag({content:script});
  return {writes:()=>writes,captchaCalls:()=>captchaCalls,assetCalls:()=>assetCalls,codes,failures};
}

test('installed bundle uses real WASM/model to recognize and submit, with safe diagnostics',async({page,context})=>{
  const logs:string[]=[];page.on('console',msg=>{logs.push(msg.text());});
  await context.addCookies([{name:'cdn-test-cookie',value:'must-not-be-sent',url:'https://cdn.jsdelivr.net'}]);
  const state=await setup(page);await page.getByRole('button',{name:'预约助手'}).first().click();await page.locator('#start').click();
  await expect(page.getByRole('status')).toContainText('已核验',{timeout:20000});
  expect(state.writes()).toBe(1);expect(state.codes).toEqual(['3253']);expect(state.assetCalls()).toBe(3);expect(state.failures).toEqual([]);
  expect(logs.join('\n')).toContain('SEU预约助手');expect(logs.join('\n')).not.toContain('data:image');
  expect(logs.join('\n')).not.toContain('VerifyOutputSizes');
  expect(logs.join('\n')).not.toContain('Expected shape from model');
});
test('early image and OCR are editable; opening submits the correction, not the original OCR',async({page},testInfo)=>{
  await page.clock.install();const state=await setup(page,{future:true});await page.getByRole('button',{name:'预约助手'}).first().click();await page.locator('#start').click();
  await expect(page.locator('#seu-lecture-helper-dialog')).toHaveAttribute('data-ocr','ready',{timeout:20000});expect(state.captchaCalls()).toBe(0);
  await page.clock.fastForward(3571000);
  await expect(page.getByLabel('验证码',{exact:true})).toHaveValue('3253',{timeout:20000});expect(state.writes()).toBe(0);
  await expect(page.getByRole('img',{name:'预约验证码'})).toBeVisible();
  await page.getByLabel('验证码',{exact:true}).fill('0006');
  await page.screenshot({path:testInfo.outputPath('prepared-captcha.png')});
  await page.clock.fastForward(30000);await expect(page.getByRole('status')).toContainText('已核验');expect(state.codes).toEqual(['0006']);expect(state.captchaCalls()).toBe(1);
});
test('prefetched captcha rejected by server refreshes automatically and succeeds',async({page})=>{
  await page.clock.install();const state=await setup(page,{future:true,rejectCode:true});await page.getByRole('button',{name:'预约助手'}).first().click();await page.locator('#start').click();
  await expect(page.locator('#seu-lecture-helper-dialog')).toHaveAttribute('data-ocr','ready',{timeout:20000});await page.clock.fastForward(3571000);
  await expect(page.getByLabel('验证码',{exact:true})).toHaveValue('3253',{timeout:20000});await page.clock.fastForward(30000);
  await expect(page.getByRole('status')).toContainText('已核验',{timeout:20000});expect(state.writes()).toBe(2);expect(state.captchaCalls()).toBe(2);
});
test('cached resources survive a new page; no removed mode or monitoring controls',async({page})=>{
  const state=await setup(page,{future:true});await page.getByRole('button',{name:'预约助手'}).first().click();
  await expect(page.locator('#seu-lecture-helper-dialog')).toHaveAttribute('data-ocr','ready',{timeout:20000});
  await expect(page.getByRole('radio')).toHaveCount(0);await expect(page.getByRole('button',{name:'开始监测'})).toHaveCount(0);
  expect(state.captchaCalls()).toBe(0);await page.getByRole('button',{name:'关闭',exact:true}).click();await page.reload();await page.addScriptTag({content:script});await page.getByRole('button',{name:'预约助手'}).first().click();
  await expect(page.locator('#seu-lecture-helper-dialog')).toHaveAttribute('data-ocr','ready',{timeout:20000});expect(state.assetCalls()).toBe(3);
});
test('unavailable model keeps the image editable, with manual submission and no mode switch',async({page})=>{
  const state=await setup(page,{blocked:true});await page.getByRole('button',{name:'预约助手'}).first().click();
  await expect(page.locator('#seu-lecture-helper-dialog')).toHaveAttribute('data-ocr','failed',{timeout:20000});await page.locator('#start').click();
  await expect(page.getByLabel('验证码',{exact:true})).toBeFocused();await page.getByLabel('验证码',{exact:true}).fill('3253');await page.getByLabel('验证码',{exact:true}).press('Enter');
  await expect(page.getByRole('status')).toContainText('已核验');expect(state.codes).toEqual(['3253']);
});
test('retry stops when capacity becomes full; no ongoing monitoring',async({page})=>{
  await page.clock.install();const state=await setup(page,{rejectCode:'three',fullOnRejection:true});await page.getByRole('button',{name:'预约助手'}).first().click();await page.locator('#start').click();
  await expect(page.getByRole('status')).toContainText('人数已满',{timeout:20000});const count=state.captchaCalls();await page.clock.fastForward(120000);expect(state.captchaCalls()).toBe(count);expect(state.writes()).toBe(3);
});
test('compact dialog fits a narrow viewport and reopen retains the answer',async({page},testInfo)=>{
  await page.clock.install();const state=await setup(page,{future:true});await page.setViewportSize({width:375,height:700});await page.getByRole('button',{name:'预约助手'}).first().click();await page.locator('#start').click();
  await expect(page.locator('#seu-lecture-helper-dialog')).toHaveAttribute('data-ocr','ready',{timeout:20000});await page.clock.fastForward(3571000);await expect(page.getByLabel('验证码',{exact:true})).toHaveValue('3253',{timeout:20000});
  await page.getByRole('button',{name:'收起',exact:true}).click();await page.getByRole('button',{name:'预约中'}).first().click();await expect(page.getByLabel('验证码',{exact:true})).toHaveValue('3253');
  const fits=await page.locator('#seu-lecture-helper-dialog').locator('dialog').evaluate(el=>el.scrollHeight<=el.clientHeight && el.scrollWidth<=el.clientWidth);expect(fits).toBe(true);
  await page.screenshot({path:testInfo.outputPath('prepared-mobile.png')});expect(state.writes()).toBe(0);
});

test('not-open boundary refreshes captcha before submitting again',async({page})=>{
  const state=await setup(page,{notOpenOnce:true});await page.getByRole('button',{name:'预约助手'}).first().click();await page.locator('#start').click();
  await expect(page.getByRole('status')).toContainText('已核验',{timeout:20000});expect(state.writes()).toBe(2);expect(state.captchaCalls()).toBe(2);expect(state.failures).toEqual([]);
});
