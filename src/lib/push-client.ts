// Browser-only helpers for subscribing to Web Push.
// Import from components; do NOT call from SSR/loader code.
import { ensureMessagingRegistration,messagingRegistration,PUSH_SCOPE } from '@/lib/push-worker-registration';

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // iOS
  if ((window.navigator as any).standalone === true) return true;
  // Android/Chrome/Firefox
  return window.matchMedia && window.matchMedia("(display-mode: standalone)").matches;
}

export function isIOSDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const platform = (navigator as any).platform || "";
  const iOSPlatforms = /iPhone|iPad|iPod/;
  return (
    iOSPlatforms.test(ua) ||
    iOSPlatforms.test(platform) ||
    (platform === "MacIntel" && (navigator as any).maxTouchPoints > 1)
  );
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function bufToBase64Url(buf: ArrayBuffer | null): string {
  if (!buf) return "";
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 1) binary += String.fromCharCode(bytes[i]);
  return window
    .btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function registerSw(): Promise<ServiceWorkerRegistration> {
  // A root offline registration is never reused as the messaging registration.
  const regs=await navigator.serviceWorker.getRegistrations();
  for(const r of regs){if(new URL(r.scope).pathname!==PUSH_SCOPE){const old=await r.pushManager.getSubscription();if(old)await old.unsubscribe();}}
  return ensureMessagingRegistration();
}

export type SubscriptionPayload = {
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string;
  device_id: string;
};

export async function subscribeToPush(vapidPublicKey: string): Promise<SubscriptionPayload> {
  if (!pushSupported()) throw new Error("Push notifications are not supported in this browser.");
  if(window.top!==window.self)throw new Error("Open WRRCS in its own tab to enable notifications.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications were not enabled.");
  const reg = await registerSw();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const key = urlBase64ToUint8Array(vapidPublicKey);
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer,
    });
  }
  return {
    endpoint: sub.endpoint,
    p256dh: bufToBase64Url(sub.getKey("p256dh")),
    auth: bufToBase64Url(sub.getKey("auth")),
    user_agent: navigator.userAgent,
    device_id: getPushDeviceId(),
  };
}

export async function unsubscribeFromPush(): Promise<string | null> {
  if (!pushSupported()) return null;
  const reg = await messagingRegistration();
  if (!reg) return null;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return null;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  return endpoint;
}

export async function getCurrentEndpoint(): Promise<string | null> {
  if (!pushSupported()) return null;
  const reg = await messagingRegistration();
  if (!reg) return null;
  const sub = await reg.pushManager.getSubscription();
  return sub?.endpoint ?? null;
}

export function getPushDeviceId() {
  const existing=localStorage.getItem('wrrcs-push-device');
  if(existing)return existing;
  const id=crypto.randomUUID();localStorage.setItem('wrrcs-push-device',id);return id;
}

export async function setMessagingOwner(userId:string|null) {
  if(!('serviceWorker' in navigator))return;
  const reg=await messagingRegistration();
  if(reg?.active)await new Promise<void>(resolve=>{
    const channel=new MessageChannel();const timer=setTimeout(resolve,2000);
    channel.port1.onmessage=()=>{clearTimeout(timer);resolve();};
    reg.active?.postMessage({type:'PUSH_OWNER',userId},[channel.port2]);
  });
  if(userId)localStorage.setItem('wrrcs-push-owner',userId);else localStorage.removeItem('wrrcs-push-owner');
}
