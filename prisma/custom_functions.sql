-- crm.get_or_create_client
CREATE OR REPLACE FUNCTION crm.get_or_create_client(p_phone VARCHAR, p_name VARCHAR)
RETURNS SETOF crm.contacts AS $$
DECLARE
    v_contact crm.contacts;
BEGIN
    SELECT * INTO v_contact FROM crm.contacts WHERE phone = p_phone LIMIT 1;
    IF NOT FOUND THEN
        INSERT INTO crm.contacts (id, phone, name)
        VALUES (gen_random_uuid()::text, p_phone, p_name)
        RETURNING * INTO v_contact;
    END IF;
    RETURN NEXT v_contact;
END;
$$ LANGUAGE plpgsql;

-- crm.get_conversation
CREATE OR REPLACE FUNCTION crm.get_conversation(p_client_id VARCHAR, p_limit INTEGER)
RETURNS TABLE(role VARCHAR, message TEXT, metadata JSONB, created_at TIMESTAMP) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        CASE m.direction WHEN 'inbound' THEN 'user'::varchar ELSE 'assistant'::varchar END as role,
        m.content::text as message,
        '{}'::jsonb as metadata,
        m.timestamp as created_at
    FROM crm.messages m
    JOIN crm.conversations c ON m."conversationId" = c.id
    WHERE c."contactId" = p_client_id
    ORDER BY m.timestamp DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- crm.save_user_message
CREATE OR REPLACE FUNCTION crm.save_user_message(p_client_id VARCHAR, p_message_text TEXT)
RETURNS void AS $$
DECLARE
    v_conv_id VARCHAR;
BEGIN
    -- get active conversation
    SELECT id INTO v_conv_id FROM crm.conversations WHERE "contactId" = p_client_id AND status = 'open' LIMIT 1;
    IF NOT FOUND THEN
        v_conv_id := gen_random_uuid()::text;
        INSERT INTO crm.conversations (id, "contactId", status, "botEnabled")
        VALUES (v_conv_id, p_client_id, 'open', true);
    END IF;
    
    INSERT INTO crm.messages (id, "conversationId", content, direction, status)
    VALUES (gen_random_uuid()::text, v_conv_id, p_message_text, 'inbound', 'sent');

    -- Update lastMessageAt
    UPDATE crm.conversations SET "lastMessageAt" = NOW() WHERE id = v_conv_id;
END;
$$ LANGUAGE plpgsql;

-- crm.save_bot_message
CREATE OR REPLACE FUNCTION crm.save_bot_message(p_client_id VARCHAR, p_message_text TEXT, p_metadata JSONB)
RETURNS void AS $$
DECLARE
    v_conv_id VARCHAR;
BEGIN
    -- get active conversation
    SELECT id INTO v_conv_id FROM crm.conversations WHERE "contactId" = p_client_id AND status = 'open' LIMIT 1;
    IF NOT FOUND THEN
        v_conv_id := gen_random_uuid()::text;
        INSERT INTO crm.conversations (id, "contactId", status, "botEnabled")
        VALUES (v_conv_id, p_client_id, 'open', true);
    END IF;
    
    INSERT INTO crm.messages (id, "conversationId", content, direction, status)
    VALUES (gen_random_uuid()::text, v_conv_id, p_message_text, 'outbound', 'sent');

    -- Update lastMessageAt
    UPDATE crm.conversations SET "lastMessageAt" = NOW() WHERE id = v_conv_id;
END;
$$ LANGUAGE plpgsql;

-- crm.update_client_status
CREATE OR REPLACE FUNCTION crm.update_client_status(p_client_id VARCHAR, p_status VARCHAR, p_service VARCHAR)
RETURNS void AS $$
BEGIN
    UPDATE crm.contacts
    SET "interestStatus" = p_status, "recommendedService" = p_service
    WHERE id = p_client_id;
END;
$$ LANGUAGE plpgsql;
