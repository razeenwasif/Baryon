import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../build-ts/src/sprite-avatar.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export class SpriteAvatar','class SpriteAvatar')+'\nthis.SpriteAvatar=SpriteAvatar;';
function fixture(){
 const document={hidden:false},context:any=vm.createContext({document,window:{devicePixelRatio:2}});vm.runInContext(source,context);
 const sprite=Object.create(context.SpriteAvatar.prototype);let draws=0,rect={width:350,height:394};
 Object.assign(sprite,{loaded:false,active:true,awake:false,disposed:false,canvas:{width:0,height:0},container:{getBoundingClientRect:()=>rect},effects:{hideQuiz(){}},render(){draws++;},frameLoop:{running:false,setRunning(value:boolean){this.running=value;}},stopAnimations(){}});
 return {sprite,document,draws:()=>draws,resize:(r:{width:number;height:number})=>{rect=r;sprite.resize();}};
}
test('late artwork loading paints a paused sprite without starting the frame loop',()=>{
 const f=fixture();f.sprite.syncLoop();f.sprite.resize();assert.equal(f.draws(),0);
 f.sprite.loaded=true;f.sprite.resize();assert.equal(f.draws(),1);assert.equal(f.sprite.frameLoop.running,false);assert.equal(f.sprite.awake,false);
 f.resize({width:400,height:500});assert.equal(f.draws(),2);assert.equal(f.sprite.canvas.width,800);assert.equal(f.sprite.canvas.height,1000);
});
test('pausing leaves a still frame, while hidden/inactive/disposed sprites do no painting',()=>{
 const f=fixture();f.sprite.loaded=true;f.sprite.setAwake(true);assert.equal(f.sprite.frameLoop.running,true);assert.equal(f.draws(),0);
 f.sprite.setAwake(false);assert.equal(f.sprite.frameLoop.running,false);assert.equal(f.draws(),1);
 f.document.hidden=true;f.sprite.resize();f.sprite.syncLoop();assert.equal(f.draws(),1);
 f.document.hidden=false;f.sprite.syncLoop();assert.equal(f.draws(),2);
 f.sprite.active=false;f.sprite.resize();f.sprite.syncLoop();assert.equal(f.draws(),2);
 f.sprite.active=true;f.sprite.disposed=true;f.sprite.resize();f.sprite.syncLoop();assert.equal(f.draws(),2);
});
