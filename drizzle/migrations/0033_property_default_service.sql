ALTER TABLE public.client_properties ADD COLUMN default_service_type_id UUID REFERENCES public.service_types(id);

COMMENT ON COLUMN public.client_properties.default_service_type_id IS 'Default cleaning service for scheduling; auto-populates New Job but never restricts choices.';

-- Backfill only where appointment history is unambiguous: every non-canceled
-- appointment at the property used the same service. Mixed history stays NULL
-- so the owner chooses the default once rather than the system guessing.
UPDATE public.client_properties cp
SET default_service_type_id = sub.service_type_id
FROM (
  SELECT property_id, (ARRAY_AGG(service_type_id))[1] AS service_type_id
  FROM public.jobs
  WHERE property_id IS NOT NULL
    AND status <> 'canceled'
    AND service_type_id IS NOT NULL
  GROUP BY property_id
  HAVING COUNT(DISTINCT service_type_id) = 1
) sub
WHERE cp.id = sub.property_id
  AND cp.default_service_type_id IS NULL;