-- crm.get_contact_with_history
CREATE OR REPLACE FUNCTION crm.get_contact_with_history(p_phone TEXT, p_limit INTEGER DEFAULT 50)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_contact RECORD;
    v_messages JSONB;
BEGIN
    -- 1. Get contact strictly by phone
    SELECT * INTO v_contact 
    FROM crm.contacts 
    WHERE phone = p_phone 
    LIMIT 1;

    IF v_contact IS NULL THEN
        -- Return empty contact object but same structure
        RETURN jsonb_build_object(
            'contact', NULL,
            'messages', '[]'::jsonb
        );
    END IF;

    -- 2. Get recent messages across all their conversations
    SELECT COALESCE((
        WITH recent_messages AS (
            SELECT m.* 
            FROM crm.messages m
            JOIN crm.conversations c ON m."conversationId" = c.id
            WHERE c."contactId" = v_contact.id
            ORDER BY m.timestamp DESC
            LIMIT p_limit
        )
        SELECT jsonb_agg(
            jsonb_build_object(
                'id', id,
                'content', content,
                'direction', direction,
                'type', type,
                'status', status,
                'timestamp', timestamp,
                'conversationId', "conversationId"
            ) ORDER BY timestamp ASC
        )
        FROM recent_messages
    ), '[]'::jsonb) INTO v_messages;

    -- 3. Build compound result
    RETURN jsonb_build_object(
        'contact', to_jsonb(v_contact),
        'messages', v_messages
    );
END;
$$;
