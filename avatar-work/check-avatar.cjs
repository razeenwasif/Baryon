const {app, BrowserWindow} = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const output = process.env.STELLA_PREVIEW_OUTPUT || path.join(__dirname,'mavuika');
app.whenReady().then(async()=>{
 const win = new BrowserWindow({show:false,width:700,height:900,webPreferences:{backgroundThrottling:false}});
 const errors=[];
 win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)errors.push(message)});
 await fs.mkdir(output,{recursive:true});
 await win.loadURL('http://127.0.0.1:5173/avatar-work/preview.html'+(process.env.STELLA_PREVIEW_MODEL?'?model='+encodeURIComponent(process.env.STELLA_PREVIEW_MODEL):''));
 let ready=false;
 for(let i=0;i<120;i++){
  ready=await win.webContents.executeJavaScript('Boolean(window.avatarPreview?.motion)');
  if(ready)break;
  await new Promise(r=>setTimeout(r,250));
 }
 if(!ready)throw new Error('VRM failed to load');
 await win.webContents.executeJavaScript(`document.querySelector('nav').style.display='none';document.querySelector('#status').style.display='none';avatarPreview.renderer.setAnimationLoop(null);avatarPreview.setFloating(true);`);
 if(process.env.STELLA_PREVIEW_BONES){
  const poseData=await win.webContents.executeJavaScript(`(()=>{
   const a=avatarPreview,rest={};a.motion.restore(a.motion.rest);a.vrm.update(0);a.vrm.scene.updateMatrixWorld(true);
   for(const name of Object.keys(a.vrm.humanoid.humanBones)){const n=a.vrm.humanoid.getRawBoneNode(name);if(n)rest[name]=n.matrixWorld.clone();}
   a.motion.restore(a.motion.poses.crossed);a.vrm.update(0);a.vrm.scene.updateMatrixWorld(true);
   return Object.fromEntries(Object.entries(rest).map(([name,m])=>[name,a.vrm.humanoid.getRawBoneNode(name).matrixWorld.clone().multiply(m.invert()).toArray()]));
  })()`);
  await fs.writeFile(path.join(output,'crossed-bone-deltas.json'),JSON.stringify(poseData));
 }
 for(const pose of ['relaxed','crossed','wave','speaking','blink']){
  const report=await win.webContents.executeJavaScript(`(()=>{
   const a=avatarPreview;
   a.motion.restore(a.motion.poses[${JSON.stringify(['speaking','blink'].includes(pose)?'relaxed':pose)}]);
   a.vrm.expressionManager.setValue('aa',${pose==='speaking'?.7:0});
   a.vrm.expressionManager.setValue('blink',${pose==='blink'?1:0});
   a.vrm.update(0); a.controls.update(); a.renderer.render(a.scene,a.camera);
   let finite=true;a.vrm.scene.traverse(o=>{if(o.isBone)finite&&=o.matrixWorld.elements.every(Number.isFinite)});
   return {pose:${JSON.stringify(pose)},finite,bones:Object.keys(a.vrm.humanoid.humanBones).length,expressions:a.vrm.expressionManager.expressions.map(e=>e.expressionName),aa:a.vrm.expressionManager.getValue('aa'),blink:a.vrm.expressionManager.getValue('blink')};
  })()`);
  if(!report.finite)throw new Error('Nonfinite rig transform');
  await new Promise(r=>setTimeout(r,150));
  await fs.writeFile(path.join(output,`preview-${pose}.png`),(await win.webContents.capturePage()).toPNG());
  console.log(JSON.stringify(report));
 }
 if(process.env.STELLA_PREVIEW_FULL){
  await win.webContents.executeJavaScript(`(()=>{
   const a=avatarPreview;a.vrm.expressionManager.setValue('blink',0);a.vrm.expressionManager.setValue('aa',0);
   a.motion.restore(a.motion.poses.relaxed);a.vrm.update(0);a.setFloating(false);a.controls.enableDamping=false;
   const height=a.modelBounds.max.y-a.modelBounds.min.y;
   a.controls.target.set(0,a.modelBounds.min.y+height*.52,0);
   window.previewFullHeight=height;
  })()`);
  for(const [view,angle] of [['front',0],['side',Math.PI/2],['back',Math.PI]]){
   await win.webContents.executeJavaScript(`(()=>{
    const a=avatarPreview,h=previewFullHeight;a.camera.position.set(Math.sin(${angle})*h*2.15,a.controls.target.y,Math.cos(${angle})*h*2.15);
    a.controls.update();a.renderer.render(a.scene,a.camera);
   })()`);
   await new Promise(r=>setTimeout(r,150));
   await fs.writeFile(path.join(output,`full-${view}.png`),(await win.webContents.capturePage()).toPNG());
  }
 }
 await fs.writeFile(path.join(output,'render-check.json'),JSON.stringify({errors},null,2));
 if(errors.length)throw new Error(errors.join('\n'));
 app.quit();
}).catch(e=>{console.error(e);app.exit(1)});
