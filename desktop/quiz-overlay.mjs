import { spawn } from 'node:child_process';
import { nativeBin, beside } from './bundle-path.cjs';
import { createInterface } from 'node:readline';

const menuActions = new Set(['show', 'companion', 'mute', 'meeting', 'ideas', 'login', 'quit']);

export class QuizOverlay {
  constructor({ onError = () => {}, onAction = () => {}, onReady = () => {}, spawnProcess = spawn } = {}) {
    this.onError = onError; this.onAction = onAction; this.onReady = onReady;
    this.spawnProcess = spawnProcess; this.child = null; this.menu = null;
  }
  start() {
    if (!this.child) {
      const child = this.spawnProcess(nativeBin('fairy-quiz-overlay'),
        [beside('assets/tray/trayTemplate.png')], { stdio: ['pipe', 'pipe', 'ignore'] });
      this.child = child;
      let ready = false;
      const output = child.stdout ? createInterface({ input: child.stdout }) : null;
      this.output = output;
      output?.on('line', line => {
        if (this.child !== child || line.length > 4096) return;
        let value; try { value = JSON.parse(line); } catch { return; }
        if (value?.ready === true && !ready) { ready = true; this.onReady(); }
        else if (menuActions.has(value?.action)) this.onAction(value.action);
      });
      const failed = () => {
        output?.close();
        if (this.child === child) { this.child = null; this.last = null; this.lastMenu = null; this.onError(); }
      };
      child.on('error', failed);
      child.stdin.on('error', () => {});
      child.on('close', failed);
      if (this.menu) { child.stdin.write(this.menu + '\n'); this.lastMenu = this.menu; }
    }
  }
  show(text, displayId) {
    if (typeof text !== 'string' || text.length > 180 || !Number.isInteger(displayId)) throw new Error('Invalid quiz hint.');
    this.start();
    const signature=JSON.stringify({text,displayId});if(this.last===signature)return;this.last=signature;
    this.child.stdin.write(signature + '\n');
  }
  // Clear the answer while retaining the helper's idle menu-bar icon.
  hide() { this.last=null; if (this.child) this.child.stdin.write('{"text":"","displayId":0}\n'); }
  setMenu(items, tooltip) {
    if (!Array.isArray(items) || items.length > 20 || typeof tooltip !== 'string' || tooltip.length > 180) throw new Error('Invalid Fairy menu.');
    const menu = items.map(item => {
      if (item.type === 'separator') return { type: 'separator' };
      if (!menuActions.has(item.id) || typeof item.label !== 'string' || item.label.length > 180) throw new Error('Invalid Fairy menu action.');
      return { id: item.id, label: item.label, type: item.type === 'checkbox' ? 'checkbox' : 'normal', checked: Boolean(item.checked) };
    });
    this.menu = JSON.stringify({ menu, tooltip });
    if (this.child && this.lastMenu !== this.menu) { this.child.stdin.write(this.menu + '\n'); this.lastMenu = this.menu; }
  }
  close() { const child = this.child; this.child = null; this.last=null; this.lastMenu=null; this.output?.close(); child?.stdin.end(); }
}
