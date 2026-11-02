DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('public.admin_correct_timesheet(uuid,uuid,timestamptz,timestamptz,jsonb,jsonb,jsonb,text,text)'::regprocedure) INTO definition;
 definition:=replace(definition,'IF jsonb_typeof(_records)<>''array'' OR jsonb_typeof(_visits)<>''array''','IF _records IS NULL OR _visits IS NULL OR jsonb_typeof(_records)<>''array'' OR jsonb_typeof(_visits)<>''array''');
 definition:=replace(definition,'IF _status NOT IN (','IF _status IS NULL OR _status NOT IN (');
 definition:=replace(definition,'IF kind_value NOT IN (','IF rid IS NULL OR kind_value IS NULL OR source_value IS NULL OR kind_value NOT IN (');
 definition:=replace(definition,'IF st IS NULL OR (en IS NOT NULL AND en<=st)','IF rid IS NULL OR st IS NULL OR (en IS NOT NULL AND en<=st)');
 EXECUTE definition;
 SELECT pg_get_functiondef('public.guard_employee_clock()'::regprocedure) INTO definition;
 definition:=replace(definition,'AND is_active) THEN RAISE EXCEPTION','AND (is_active OR public.is_owner_or_manager())) THEN RAISE EXCEPTION');
 EXECUTE definition;
END $$;