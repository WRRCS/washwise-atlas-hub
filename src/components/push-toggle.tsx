import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Bell, BellOff, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  getVapidPublicKey,
  savePushSubscription,
  deletePushSubscription,
  sendTestPush,
  checkMyPushRegistration,
} from "@/lib/push.functions";
import {
  isIOSDevice,
  isStandalone,
  pushSupported,
  subscribeToPush,
  unsubscribeFromPush,
  getCurrentEndpoint,
  setMessagingOwner,
} from "@/lib/push-client";

type Props = {
  /**
   * When "portal", subscription is saved via portal_save_push_subscription RPC
   * (for client-portal magic-link users). When "app", it's saved via authenticated
   * server function (for owners/employees).
   */
  mode: "app" | "portal";
  className?: string;
};

export function PushToggle({ mode, className }: Props) {
  const vapidFn = useServerFn(getVapidPublicKey);
  const saveFn = useServerFn(savePushSubscription);
  const deleteFn = useServerFn(deletePushSubscription);
  const testFn = useServerFn(sendTestPush);
  const checkFn = useServerFn(checkMyPushRegistration);
  const [detail,setDetail]=useState("Not checked on this device");
  const [userId,setUserId]=useState<string | null>(null);

  const [subscribed, setSubscribed] = useState<boolean>(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const supported = pushSupported();
  const iosNeedsInstall = isIOSDevice() && !isStandalone();

  useEffect(() => {
    supabase.auth.getUser().then(({data})=>setUserId(data.user?.id ?? null));
  },[]);
  async function recheck() {
    setSubscribed(false);
    try {
      if(!supported){setDetail('Notifications unsupported on this device');return;}
      const endpoint=await getCurrentEndpoint();
      if(!endpoint){setDetail('Not registered on this device');return;}
      if(mode==='app') {
        const result=await checkFn({data:{endpoint}});
        const permission=Notification.permission;
        setSubscribed(result.registered && permission==='granted');
        setDetail(result.registered ? `Registration saved · permission ${permission} · phone display unverified` : 'This account has no matching registration · enable again');
        if(result.registered && permission==='granted')await setMessagingOwner(result.userId);
        else await setMessagingOwner(null);
      } else {setSubscribed(Notification.permission==='granted');setDetail('Browser registration found · phone display unverified');}
    } catch(e){setDetail(e instanceof Error?e.message:'Unable to recheck registration');}
    finally {setReady(true);}
  }
  useEffect(()=>{setReady(false);void recheck();},[userId,mode]);

  async function enable() {
    setBusy(true);
    try {
      if(window.top!==window.self)throw new Error('Open WRRCS in its own tab to enable notifications.');
      // Never reuse another account's endpoint on a shared phone.
      const current=await getCurrentEndpoint();
      if(current && mode==='app') {
        const check=await checkFn({data:{endpoint:current}});
        if(!check.registered) {await setMessagingOwner(null);await unsubscribeFromPush();}
      }
      const { publicKey } = await vapidFn();
      const payload = await subscribeToPush(publicKey);
      if (mode === "portal") {
        const { error } = await supabase.rpc("portal_save_push_subscription", {
          _endpoint: payload.endpoint,
          _p256dh: payload.p256dh,
          _auth: payload.auth,
          _user_agent: payload.user_agent,
        });
        if (error) throw new Error(error.message);
      } else {
        await saveFn({ data: payload });
        const check=await checkFn({data:{endpoint:payload.endpoint}});
        await setMessagingOwner(check.userId);
      }
      setSubscribed(true);
      setDetail("Registration saved · permission granted · phone display unverified");
      toast.success("Device registered · phone delivery still needs testing");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not enable notifications");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const endpoint = await getCurrentEndpoint();
      await setMessagingOwner(null);
      if (endpoint) {
        if (mode === "portal") {
          await supabase.rpc("portal_delete_push_subscription", { _endpoint: endpoint });
        } else {
          await deleteFn({ data: { endpoint } });
        }
      }
      await unsubscribeFromPush();
      setSubscribed(false);
      setDetail("Not registered on this device");
      toast.success("Notifications disabled");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not disable notifications");
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return null;

  if (!supported) {
    return (
      <div className={className}>
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Info className="h-3.5 w-3.5" />
          Push notifications aren't supported in this browser.
        </p>
      </div>
    );
  }

  if (iosNeedsInstall) {
    return (
      <div className={className}>
        <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          <div className="font-medium text-foreground mb-1 flex items-center gap-1.5">
            <Bell className="h-3.5 w-3.5" /> Install to enable notifications
          </div>
          On iPhone/iPad, tap Share → <span className="font-medium">Add to Home Screen</span>, then
          open WRRCS.com from your home screen to turn on notifications.
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <p className="text-xs text-muted-foreground mb-2">{detail}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={()=>recheck()} disabled={busy}>Recheck registration</Button>
        {subscribed ? (
          <>
            <Button size="sm" variant="outline" onClick={disable} disabled={busy}>
              <BellOff className="h-4 w-4 mr-1.5" />
              Turn off notifications
            </Button>
            {mode === "app" ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await testFn();
                    toast.success(`Push service accepted ${r.sent}/${r.devices} requests · check your phone`);
                  } catch (e: any) {
                    toast.error(e?.message ?? "Test failed");
                  } finally {
                    setBusy(false);
                  }
                }}
                disabled={busy}
              >
                Send test
              </Button>
            ) : null}
          </>
        ) : (
          <Button size="sm" onClick={enable} disabled={busy}>
            <Bell className="h-4 w-4 mr-1.5" />
            Enable notifications
          </Button>
        )}
      </div>
    </div>
  );
}
