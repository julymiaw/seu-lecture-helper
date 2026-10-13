import * as ort from 'onnxruntime-web/wasm';
ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;
function decode(output,chars,digitsOnly){
 const [batch,steps,classes]=output.dims;
 if(batch!==1||classes!==chars.length)throw Error('Unexpected output shape '+output.dims+' / '+chars.length);
 const allowed=chars.map((x,i)=>i===0||!digitsOnly||/^[0-9]$/.test(x));
 let text='',previous=0;
 for(let t=0;t<steps;t++){
  let best=0;for(let c=1;c<classes;c++)if(allowed[c]&&output.data[t*classes+c]>output.data[t*classes+best])best=c;
  if(best!==0&&best!==previous)text+=chars[best];previous=best;
 }
 return text;
}
async function input(data){
 const image=new Image();image.src=data;await image.decode();
 const h=48,w=320,rw=Math.min(w,Math.ceil(h*image.width/image.height));
 const canvas=document.createElement('canvas');canvas.width=rw;canvas.height=h;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0,rw,h);
 const pixels=ctx.getImageData(0,0,rw,h).data,floats=new Float32Array(3*h*w);
 for(let y=0;y<h;y++)for(let x=0;x<rw;x++)for(let c=0;c<3;c++)floats[c*h*w+y*w+x]=pixels[(y*rw+x)*4+(2-c)]/127.5-1;
 return new ort.Tensor('float32',floats,[1,3,h,w]);
}
window.runPaddleModels=async(models,samples)=>{
 ort.env.wasm.wasmBinary=await fetch('/wasm').then(r=>r.arrayBuffer());const results=[];
 for(const model of models){let session;
  try{
   const begin=performance.now();const chars=await fetch('/'+model.name+'.json').then(r=>r.json());
   const bytes=await fetch('/'+model.name+'.onnx').then(r=>r.arrayBuffer());session=await ort.InferenceSession.create(new Uint8Array(bytes),{executionProviders:['wasm']});
   const warm=new ort.Tensor('float32',new Float32Array(3*48*320),[1,3,48,320]);const outputs=await session.run({[session.inputNames[0]]:warm});Object.values(outputs).forEach(x=>x.dispose());warm.dispose();
   const initializationMs=performance.now()-begin,rows=[];
   for(const sample of samples){const start=performance.now();const tensor=await input(sample.data);
    try{const output=await session.run({[session.inputNames[0]]:tensor});
     try{const value=output[session.outputNames[0]];rows.push({id:sample.id,expected:sample.expected,prediction:decode(value,chars,false),digitsPrediction:decode(value,chars,true),ms:performance.now()-start});}
     finally{Object.values(output).forEach(x=>x.dispose());}
    }finally{tensor.dispose();}
   }
   results.push({...model,initializationMs,rows});
  }catch(error){results.push({...model,error:String(error)});}finally{if(session)await session.release();}
 }
 return results;
};
