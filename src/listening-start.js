// Electron's invoke bridge may preserve only the message, not Error.name.
export function isListeningCancellation(error) {
  return error?.name==='AbortError' || /(?:^|:\s*)AbortError(?::|$)/.test(String(error?.message??error));
}

// A late stop/settings update can cancel preparation just as listening resumes.
// Retry only while this setup still owns the current listening intent.
export async function startListeningSession({cancel,prepare,start,current,wait=ms=>new Promise(r=>setTimeout(r,ms))}) {
  for(let attempt=0;attempt<3;attempt++){
    if(!current())return false;
    try{
      await cancel();if(!current())return false;
      await prepare();if(!current())return false;
      await start();return current();
    }catch(error){
      if(!current())return false;
      if(!isListeningCancellation(error))throw error;
      if(attempt===2)throw Error('Local listening was interrupted repeatedly. Retry the microphone when other recording has stopped.');
      await wait(150*(attempt+1));
    }
  }
}
