import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';

test('native quiz window selection skips Safari utility windows and preserves document order',{skip:process.platform!=='darwin'},()=>{
 const source=readFileSync(new URL('../native/QuizOCR.swift',import.meta.url),'utf8');
 const functionCode=source.slice(source.indexOf('func quizForegroundWindow('),source.indexOf('func recognize('));
 assert(functionCode.length>100);
 const dir=mkdtempSync(join(tmpdir(),'fairy-quiz-window-'));
 try{
  const file=join(dir,'main.swift'),binary=join(dir,'test');
  writeFileSync(file,`import Foundation\nimport AppKit\n${functionCode}
func window(_ id: Int, _ x: Double, _ y: Double, _ w: Double, _ h: Double, _ pid: Int = 10, _ layer: Int = 0) -> [String: Any] {
 return [kCGWindowNumber as String:id, kCGWindowOwnerPID as String:pid, kCGWindowLayer as String:layer, kCGWindowBounds as String:CGRect(x:x,y:y,width:w,height:h).dictionaryRepresentation]
}
let display=CGRect(x:0,y:0,width:1512,height:982)
let tiny=window(1,57,54,66,20), main=window(2,20,30,1400,900), older=window(3,0,0,1512,982)
func selected(_ windows:[[String:Any]]) -> Int? { quizForegroundWindow(windows,pid:10,display:display)?[kCGWindowNumber as String] as? Int }
precondition(selected([tiny,main,older]) == 2)
precondition(selected([tiny]) == nil)
precondition(selected([window(4,0,0,1512,982,11),main]) == 2)
precondition(selected([window(5,0,0,1512,982,10,3),main]) == 2)
precondition(selected([window(6,2000,0,1200,900),main]) == 2)
precondition(selected([window(7,10,10,400,300),older]) == 7)
var hidden=main; hidden[kCGWindowAlpha as String]=0.0
precondition(selected([hidden]) == nil)
print("7 native window-selection cases passed")
`);
  execFileSync('swiftc',['-module-cache-path',join(tmpdir(),'fairy-quiz-test-cache'),file,'-o',binary],{timeout:60000});
  assert.match(execFileSync(binary,{encoding:'utf8',timeout:5000}),/7 native window-selection cases passed/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('native quiz capture uses the same foreground document selector and omits the cursor',()=>{
 const ocr=readFileSync(new URL('../native/QuizOCR.swift',import.meta.url),'utf8');
 const capture=readFileSync(new URL('../native/ScreenCapture.swift',import.meta.url),'utf8');
 const selector=ocr.slice(ocr.indexOf('func quizForegroundWindow('),ocr.indexOf('func recognize('));
 assert(capture.includes(selector));
 assert(capture.includes('SCContentFilter(display: display, including: [window])'));
 assert(capture.includes('config.showsCursor = false'));
});
