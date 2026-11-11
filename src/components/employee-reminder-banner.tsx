import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Bell } from 'lucide-react';
import { getMyReminderBanner } from '@/lib/employee-reminder-pilot.functions';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';
export function EmployeeReminderBanner() {
 const get=useServerFn(getMyReminderBanner);
 const t=useT();
 const q=useQuery({queryKey:['my-reminder-banner'],queryFn:()=>get(),refetchInterval:15000});
 if(!q.data)return null;
 return <section aria-label={t("Appointment action reminder")} className="my-4 flex flex-wrap items-center gap-3 border-y border-border bg-muted px-3 py-3"><Bell className="size-5 shrink-0"/><div className="min-w-0 flex-1"><p className="font-semibold">{t(q.data.title)}</p><p className="text-sm break-words">{q.data.body.replace("Pacific", t("Pacific")).replace("Location needs review", t("Location needs review"))}</p></div><Button asChild><a href={q.data.url}>{t(q.data.title)}</a></Button></section>;
}
