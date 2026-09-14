import narration from './pip-review-story.json';
export function pipAudioUrl(step:number,currency:string){const spoken=['CAD','AUD'].includes(currency)?'USD':currency;const clip=narration.find(c=>'step' in c&&c.step===step&&c.currency===spoken)||narration[step];return '/audio/pip/'+clip.id+'.mp3';}
/** One cancellable request at a time. Browser/CDN cache is shared with playback. */
export function warmPipAudio(steps:number[],currency:string,onOpeningReady?:()=>void){
 const controller=new AbortController();let released=false;
 const release=()=>{if(!released){released=true;onOpeningReady?.();}};
 const deadline=setTimeout(release,2500);
 void(async()=>{for(let i=0;i<steps.length;i++){if(controller.signal.aborted)break;try{const response=await fetch(pipAudioUrl(steps[i],currency),{signal:controller.signal,cache:'force-cache'});if(response.ok)await response.arrayBuffer();}catch{if(controller.signal.aborted)break;}if(i===1)release();}if(!controller.signal.aborted)release();})();
 return()=>{controller.abort();clearTimeout(deadline);};
}
