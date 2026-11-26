export const REACTION_KINDS=['laugh','surprise','pout'];
// Deliberately conservative and local; no extra model request, metadata or TTS tags.
export function replyReaction(reply,user=''){
 const text=String(reply||'').slice(0,6000).replace(/```[\s\S]*?```/g,' ').replace(/`[^`]*`/g,' ').replace(/https?:\/\/\S+/g,' ').trim().slice(0,280);
 const context=String(user||'').slice(0,2000)+' '+text;
 if(/\b(?:grief|died|death|funeral|suicid\w*|abuse|assault|cancer|diagnos\w*|emergency|depress\w*|not funny|not joking)\b/i.test(context))return null;
 if(/^(?:[“"*\s]*(?:ha(?:ha)+|he(?:he)+|lol|that(?:'s| is) hilarious|you made me laugh|that made me laugh)\b|[“"*\s]*[😂🤣])/i.test(text))return 'laugh';
 if(/^[“"*\s]*(?:wow|whoa|oh wow|that(?:'s| is) surprising|i didn['’]t expect that)\b/i.test(text))return 'surprise';
 if(/^[“"*\s]*(?:hmph|hey[,!]?[ ]+no fair|you(?:'re| are) teasing me)\b/i.test(text))return 'pout';
 return null;
}
export class ConversationReaction {
 constructor(){this.output={kind:null,frame:0};this.kind=null;this.time=0;this.cooldown=0;}
 play(kind,manual=false){if(!REACTION_KINDS.includes(kind)||(!manual&&this.cooldown>0))return false;this.kind=kind;this.time=0;this.cooldown=12;return true;}
 stop(){this.kind=null;this.time=0;}
 tick(dt,{allowed=true,ready=true}={}){dt=Math.max(0,Math.min(.1,dt));this.cooldown=Math.max(0,this.cooldown-dt);if(!allowed){this.stop();return;}if(this.kind&&ready){this.time+=dt;if(this.time>=4.8)this.stop();}}
 sample(){this.output.kind=this.kind;this.output.frame=Math.min(5,Math.floor(this.time/.8));return this.output;}
}
