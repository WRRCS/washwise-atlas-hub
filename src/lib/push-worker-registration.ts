export const PUSH_SCOPE = '/push-messaging/';
export async function messagingRegistration() {
 const registrations=await navigator.serviceWorker.getRegistrations();
 return registrations.find(r=>new URL(r.scope).pathname===PUSH_SCOPE) ?? null;
}
export async function ensureMessagingRegistration() {
 const existing=await messagingRegistration();
 if(existing)return existing;
 const reg=await navigator.serviceWorker.register('/push-sw.js',{scope:PUSH_SCOPE});
 if(!reg.active)await new Promise<void>((resolve,reject)=>{
  const worker=reg.installing ?? reg.waiting;if(!worker){reject(new Error('Notification registration unavailable'));return;}
  const timer=setTimeout(()=>reject(new Error('Notification setup timed out')),15000);
  worker.addEventListener('statechange',()=>{if(worker.state==='activated'){clearTimeout(timer);resolve();}});
 });
 return reg;
}
export async function clearLocalPushIdentity() {
 if(!('serviceWorker' in navigator))return;
 const regs=await navigator.serviceWorker.getRegistrations();
 for(const reg of regs){const sub=await reg.pushManager.getSubscription();if(sub)await sub.unsubscribe();const notices=await reg.getNotifications();notices.forEach(n=>n.close());}
 localStorage.removeItem('wrrcs-push-owner');
}
