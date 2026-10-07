-- Phase 7E — cover the two remaining unindexed private foreign keys.

create index if not exists production_alert_delivery_config_updated_by_idx
  on private.production_alert_delivery_config(updated_by);

create index if not exists production_incident_acknowledgements_acknowledged_by_idx
  on private.production_incident_acknowledgements(acknowledged_by);
