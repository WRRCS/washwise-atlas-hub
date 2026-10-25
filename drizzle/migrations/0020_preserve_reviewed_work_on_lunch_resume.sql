DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('public.employee_clock_action(text,text)'::regprocedure) INTO definition;
 definition:=replace(definition,'stamp,e.job_id,v)','stamp,coalesce(e.job_id,w.job_id),v)');
 EXECUTE definition;
END $$;