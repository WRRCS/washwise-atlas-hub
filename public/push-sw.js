// Dedicated Web Push messaging service worker for WRRCS.com.
// This is NOT an app-shell cache; its only jobs are receiving push events
// and opening the right URL when the user taps a notification.

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function ownerDb() {
  return new Promise((resolve,reject)=>{const r=indexedDB.open('wrrcs-push-identity',1);r.onupgradeneeded=()=>r.result.createObjectStore('identity');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
}
async function pushOwner(value,write=false) {
 const db=await ownerDb();
 return new Promise((resolve,reject)=>{const tx=db.transaction('identity',write?'readwrite':'readonly');const store=tx.objectStore('identity');const r=write?store.put(value,'user'):store.get('user');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);tx.oncomplete=()=>db.close();});
}
self.addEventListener('message',event=>{
 if(event.data?.type==='PUSH_OWNER')event.waitUntil(pushOwner(event.data.userId,true).then(()=>event.ports[0]?.postMessage({ok:true})));
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = { title: "WRRCS.com", body: event.data ? event.data.text() : "" };
  }
  const title = payload.title || "WRRCS.com";
  const options = {
    body: payload.body || "",
    icon: "/wrrc-icon-192.png",
    badge: "/wrrc-icon-192.png",
    tag: payload.tag || undefined,
    data: { url: payload.url || "/" },
  };
  event.waitUntil((async()=>{
    if(payload.recipientUserId && await pushOwner()!==payload.recipientUserId)return;
    await self.registration.showNotification(title, options);
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientsArr) => {
      for (const client of clientsArr) {
        if ("focus" in client) {
          return client.navigate(target).then(c=>(c || client).focus()).catch(()=>client.focus());
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
