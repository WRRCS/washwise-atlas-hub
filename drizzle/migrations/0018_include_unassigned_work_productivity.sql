DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('public.get_employee_productivity(date,date)'::regprocedure) INTO definition;
 definition:=replace(definition,'FROM public.time_entries te','FROM (SELECT user_id,tenant_id,started_at,ended_at FROM public.time_entries UNION ALL SELECT user_id,tenant_id,started_at,ended_at FROM public.work_clock_entries WHERE kind=''work'') te');
 EXECUTE definition;
END $$;