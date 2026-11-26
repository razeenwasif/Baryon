// Read-only DIP coordinates. No screenshot, input injection, or persistent history.
export class DesktopCursor {
  constructor({window,screen,allowed,now=()=>performance.now()}){Object.assign(this,{window,screen,allowed,now});this.last=-Infinity;this.cached=null;}
  sample(){
    if(!this.allowed() || this.window.isDestroyed() || !this.window.isVisible() || this.window.isMinimized()){this.cached=null;return null;}
    const now=this.now();if(now-this.last<80)return this.cached;this.last=now;
    const point=this.screen.getCursorScreenPoint(),bounds=this.window.getContentBounds();
    if(this.screen.getDisplayNearestPoint(point).id!==this.screen.getDisplayMatching(bounds).id){this.cached=null;return null;}
    this.cached={x:point.x-bounds.x,y:point.y-bounds.y};return this.cached;
  }
}
