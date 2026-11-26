// Trim only near-silent clip edges. Interior pauses and quiet breaths survive.
export function speechRange(buffer) {
  const rate=buffer.sampleRate, step=Math.max(1,Math.round(rate*.01));
  const channels=Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i));
  let first=-1,last=-1;
  for(let at=0;at<buffer.length;at+=step){
    const end=Math.min(buffer.length,at+step);
    const active=channels.some(data=>{
      let energy=0;for(let i=at;i<end;i++)energy+=data[i]*data[i];
      return Math.sqrt(energy/(end-at))>.0005;
    });
    if(active){if(first<0)first=at;last=end;}
  }
  if(first<0)return {offset:0,duration:buffer.duration,leadingMs:0,trailingMs:0};
  const start=Math.max(0,Math.min(first-Math.round(rate*.04),Math.round(rate*1.2)));
  const end=Math.min(buffer.length,Math.max(last+Math.round(rate*.08),buffer.length-Math.round(rate*1.2)));
  return {offset:start/rate,duration:(end-start)/rate,leadingMs:(first-start)/rate*1000,trailingMs:(end-last)/rate*1000};
}

export function joinDelay({pauseBeforeMs=160,leadingMs=0}, previous, now) {
  if(!previous)return 0;
  return Math.max(0,Math.min(400,pauseBeforeMs)-previous.trailingMs-leadingMs-(now-previous.endedAt));
}
