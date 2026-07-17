-- ============================================================
-- 042_broadcast_unsubscribed_stats.sql
--
-- Adds support for 'unsubscribed' stats.
-- ============================================================

-- 1) Add new column to broadcasts table
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS unsubscribed_count INTEGER DEFAULT 0;

-- 2) Update constraint on broadcast_recipients status
ALTER TABLE broadcast_recipients DROP CONSTRAINT IF EXISTS broadcast_recipients_status_check;
ALTER TABLE broadcast_recipients ADD CONSTRAINT broadcast_recipients_status_check 
  CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'replied', 'failed', 'not_in_whatsapp', 'frequency_limit', 'unsubscribed'));

-- 3) Update helper function for broadcast status columns mapping
CREATE OR REPLACE FUNCTION public._bcast_cols_for_status(s TEXT)
RETURNS TEXT[] AS $$
BEGIN
  IF s = 'pending' THEN RETURN ARRAY[]::TEXT[]; END IF;
  IF s = 'sent'      THEN RETURN ARRAY['sent_count']; END IF;
  IF s = 'delivered' THEN RETURN ARRAY['sent_count','delivered_count']; END IF;
  IF s = 'read'      THEN RETURN ARRAY['sent_count','delivered_count','read_count']; END IF;
  IF s = 'replied'   THEN RETURN ARRAY['sent_count','delivered_count','read_count','replied_count']; END IF;
  IF s = 'failed'    THEN RETURN ARRAY['failed_count']; END IF;
  IF s = 'not_in_whatsapp' THEN RETURN ARRAY['not_in_whatsapp_count']; END IF;
  IF s = 'frequency_limit' THEN RETURN ARRAY['frequency_limit_count']; END IF;
  IF s = 'unsubscribed'    THEN RETURN ARRAY['unsubscribed_count']; END IF;
  RETURN ARRAY[]::TEXT[];
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 4) Update counts recomputation function
CREATE OR REPLACE FUNCTION public.recompute_broadcast_counts(bid UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE broadcasts b SET
    sent_count      = agg.sent_count,
    delivered_count = agg.delivered_count,
    read_count      = agg.read_count,
    replied_count   = agg.replied_count,
    failed_count    = agg.failed_count,
    not_in_whatsapp_count = agg.not_in_whatsapp_count,
    frequency_limit_count = agg.frequency_limit_count,
    unsubscribed_count    = agg.unsubscribed_count,
    updated_at      = NOW()
  FROM (
    SELECT
      COUNT(*) FILTER (WHERE status IN ('sent','delivered','read','replied')) AS sent_count,
      COUNT(*) FILTER (WHERE status IN ('delivered','read','replied'))        AS delivered_count,
      COUNT(*) FILTER (WHERE status IN ('read','replied'))                    AS read_count,
      COUNT(*) FILTER (WHERE status = 'replied')                              AS replied_count,
      COUNT(*) FILTER (WHERE status = 'failed')                               AS failed_count,
      COUNT(*) FILTER (WHERE status = 'not_in_whatsapp')                      AS not_in_whatsapp_count,
      COUNT(*) FILTER (WHERE status = 'frequency_limit')                      AS frequency_limit_count,
      COUNT(*) FILTER (WHERE status = 'unsubscribed')                         AS unsubscribed_count
    FROM broadcast_recipients
    WHERE broadcast_id = bid
  ) agg
  WHERE b.id = bid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
