import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  getNestedValue,
  evaluateConditions,
  resolveMapping,
  type WebhookCondition
} from '@/lib/generic-webhooks/utils';
import { decrypt } from '@/lib/whatsapp/encryption';
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api';
import { findExistingContact } from '@/lib/contacts/dedupe';
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError
} from '@/lib/whatsapp/phone-utils';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: workflowId } = await context.params;
  const db = supabaseAdmin();

  let payload: any = null;
  try {
    const rawBody = await request.text();
    if (rawBody) {
      payload = JSON.parse(rawBody);
    }
  } catch (e) {
    console.error('[webhooks] failed to parse incoming body as JSON:', e);
    return NextResponse.json({ error: 'Payload must be valid JSON' }, { status: 400 });
  }

  let workflow: any = null;
  let integration: any = null;

  try {
    // 1. Fetch workflow and associated integration
    const { data: workflowRow, error: workflowErr } = await db
      .from('webhook_workflows')
      .select('*, integration:webhook_integrations(*)')
      .eq('id', workflowId)
      .maybeSingle();

    workflow = workflowRow;
    integration = workflowRow?.integration;

    if (workflowErr || !workflowRow) {
      // Fallback: check if the ID belongs to an integration (for test capture)
      const { data: integrationRow, error: intErr } = await db
        .from('webhook_integrations')
        .select('*')
        .eq('id', workflowId)
        .maybeSingle();

      if (integrationRow) {
        if (payload) {
          await db
            .from('webhook_integrations')
            .update({
              last_payload: payload,
              is_connected: true,
              updated_at: new Date().toISOString()
            })
            .eq('id', integrationRow.id);
        }
        return NextResponse.json({ status: 'connected', message: 'Sample payload captured successfully' });
      }

      console.warn('[webhooks] workflow/integration not found for id:', workflowId);
      return NextResponse.json({ error: 'Workflow or Integration not found' }, { status: 404 });
    }

    // 2. Update the integration's last_payload and set is_connected to true
    if (payload) {
      await db
        .from('webhook_integrations')
        .update({
          last_payload: payload,
          is_connected: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', integration.id);
    }

    // 3. Check if the workflow is active
    if (!workflow.is_active) {
      return NextResponse.json({ status: 'skipped', message: 'Workflow is inactive' });
    }

    // If payload is empty, treat as test connection check and exit early
    if (!payload || Object.keys(payload).length === 0) {
      return NextResponse.json({ status: 'connected', message: 'Empty test payload received successfully' });
    }

    // 4. Evaluate conditions
    const condObj = workflow.conditions || {};
    const conditions: WebhookCondition[] = Array.isArray(condObj.rules) ? condObj.rules : [];
    const matchType: 'all' | 'any' = condObj.matchType === 'any' ? 'any' : 'all';

    const conditionsMatch = evaluateConditions(payload, conditions, matchType);
    if (!conditionsMatch) {
      // Record a log with no_match status
      await db.from('webhook_logs').insert({
        account_id: workflow.account_id,
        integration_id: integration.id,
        workflow_id: workflow.id,
        workflow_name: workflow.name,
        status: 'no_match',
        payload: payload,
        error_message: 'Conditions did not match'
      });
      return NextResponse.json({ status: 'no_match', message: 'Conditions did not match' });
    }

    // 5. Resolve recipient phone and name
    const phonePath = workflow.recipient_phone_field;
    const rawPhone = getNestedValue(payload, phonePath);
    if (!rawPhone) {
      await db.from('webhook_logs').insert({
        account_id: workflow.account_id,
        integration_id: integration.id,
        workflow_id: workflow.id,
        workflow_name: workflow.name,
        status: 'failed',
        payload: payload,
        error_message: `Recipient phone path "${phonePath}" resolved to empty value.`
      });
      return NextResponse.json({ error: 'Recipient phone number not found in payload' }, { status: 400 });
    }

    const sanitizedPhone = sanitizePhoneForMeta(String(rawPhone));
    if (!isValidE164(sanitizedPhone)) {
      await db.from('webhook_logs').insert({
        account_id: workflow.account_id,
        integration_id: integration.id,
        workflow_id: workflow.id,
        workflow_name: workflow.name,
        status: 'failed',
        payload: payload,
        customer_phone: String(rawPhone),
        error_message: `Sanitized phone number "${sanitizedPhone}" is not valid E164 format.`
      });
      return NextResponse.json({ error: 'Invalid phone number format' }, { status: 400 });
    }

    const namePath = workflow.recipient_name_field;
    const rawName = getNestedValue(payload, namePath);
    const customerName = rawName ? String(rawName) : sanitizedPhone;

    // 6. Resolve WhatsApp configuration
    const configId = integration.whatsapp_config_id;
    if (!configId) {
      await db.from('webhook_logs').insert({
        account_id: workflow.account_id,
        integration_id: integration.id,
        workflow_id: workflow.id,
        workflow_name: workflow.name,
        status: 'failed',
        payload: payload,
        customer_phone: sanitizedPhone,
        customer_name: customerName,
        error_message: 'No WhatsApp channel selected for integration.'
      });
      return NextResponse.json({ error: 'WhatsApp config not linked to integration' }, { status: 400 });
    }

    const { data: config, error: configErr } = await db
      .from('whatsapp_config')
      .select('*')
      .eq('id', configId)
      .maybeSingle();

    if (configErr || !config) {
      await db.from('webhook_logs').insert({
        account_id: workflow.account_id,
        integration_id: integration.id,
        workflow_id: workflow.id,
        workflow_name: workflow.name,
        status: 'failed',
        payload: payload,
        customer_phone: sanitizedPhone,
        customer_name: customerName,
        error_message: 'WhatsApp configuration record not found.'
      });
      return NextResponse.json({ error: 'WhatsApp config not found' }, { status: 400 });
    }

    const accessToken = decrypt(config.access_token);

    // 7. Execute actions (e.g. Send template)
    const actions = workflow.actions || [];
    const templateAction = actions.find((act: any) => act.type === 'send_template');
    
    if (!templateAction) {
      await db.from('webhook_logs').insert({
        account_id: workflow.account_id,
        integration_id: integration.id,
        workflow_id: workflow.id,
        workflow_name: workflow.name,
        status: 'failed',
        payload: payload,
        customer_phone: sanitizedPhone,
        customer_name: customerName,
        error_message: 'No template action defined for this workflow.'
      });
      return NextResponse.json({ error: 'No send_template action defined' }, { status: 400 });
    }

    const templateName = templateAction.template_name;
    const language = templateAction.language || 'en_US';

    // Load template row
    const { data: templateRow } = await db
      .from('message_templates')
      .select('*')
      .eq('account_id', workflow.account_id)
      .eq('name', templateName)
      .eq('language', language)
      .maybeSingle();

    // Resolve template parameters from payload mapping
    const mappings = templateAction.mappings || {};
    const bodyParams = Array.isArray(mappings.body)
      ? mappings.body.map((m: any) => resolveMapping(payload, m))
      : [];
    const headerText = mappings.headerText
      ? resolveMapping(payload, mappings.headerText)
      : undefined;
    
    const buttonParams: Record<number, string> = {};
    if (mappings.buttons) {
      for (const idx in mappings.buttons) {
        const numIdx = parseInt(idx, 10);
        if (!isNaN(numIdx) && mappings.buttons[idx]) {
          buttonParams[numIdx] = resolveMapping(payload, mappings.buttons[idx]);
        }
      }
    }

    const templateParams = {
      body: bodyParams,
      headerText,
      buttonParams
    };

    // 8. Resolve / create Contact & Conversation
    const adminUserId = config.user_id;

    const contactOutcome = await findOrCreateContact(
      workflow.account_id,
      adminUserId,
      sanitizedPhone,
      customerName
    );
    if (!contactOutcome) {
      throw new Error('Failed to resolve or create contact');
    }
    const contact = contactOutcome.contact;

    const conversation = await findOrCreateConversation(
      workflow.account_id,
      adminUserId,
      contact.id
    );
    if (!conversation) {
      throw new Error('Failed to resolve or create conversation');
    }

    // 9. Send via Meta API with variant retries
    let waMessageId = ''
    let workingPhone = sanitizedPhone;
    let lastError: unknown = null;
    const variants = phoneVariants(sanitizedPhone);

    const attempt = async (phone: string): Promise<string> => {
      const result = await sendTemplateMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        templateName,
        language,
        template: templateRow ?? undefined,
        messageParams: templateParams
      });
      return result.messageId;
    };

    for (const variant of variants) {
      try {
        waMessageId = await attempt(variant);
        workingPhone = variant;
        lastError = null;
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!isRecipientNotAllowedError(msg)) {
          throw err;
        }
        lastError = err;
      }
    }

    if (lastError) {
      throw lastError;
    }

    // Update phone variant on contact if it corrected
    if (workingPhone !== sanitizedPhone) {
      await db.from('contacts').update({ phone: workingPhone }).eq('id', contact.id);
    }

    // 10. Record message in conversation history
    const { error: msgErr } = await db.from('messages').insert({
      conversation_id: conversation.id,
      sender_type: 'bot',
      content_type: 'template',
      template_name: templateName,
      message_id: waMessageId,
      status: 'sent'
    });
    if (msgErr) {
      console.error('[webhooks] db message insert failed:', msgErr.message);
    }

    // Update conversation last message details
    await db
      .from('conversations')
      .update({
        last_message_text: `[template:${templateName}]`,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', conversation.id);

    // 11. Create success log entry
    await db.from('webhook_logs').insert({
      account_id: workflow.account_id,
      integration_id: integration.id,
      workflow_id: workflow.id,
      workflow_name: workflow.name,
      customer_name: customerName,
      customer_phone: workingPhone,
      status: 'success',
      payload: payload
    });

    return NextResponse.json({ success: true, message_id: waMessageId });
  } catch (error: any) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown execution error';
    console.error('[webhooks] incoming trigger failed:', errorMsg);
    
    // Attempt logging failure
    try {
      await db.from('webhook_logs').insert({
        account_id: workflow?.account_id || workflowId,
        integration_id: integration?.id || null,
        workflow_id: workflowId,
        workflow_name: workflow?.name || 'Unknown Workflow',
        status: 'failed',
        error_message: errorMsg,
        payload: payload
      });
    } catch (logErr) {
      console.error('[webhooks] logging failure failed:', logErr);
    }

    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

// Local findOrCreateContact & findOrCreateConversation helpers mirrors webhook/route.ts
async function findOrCreateContact(
  accountId: string,
  configOwnerUserId: string,
  phone: string,
  name: string
) {
  const db = supabaseAdmin();
  const existingContact = await findExistingContact(db, accountId, phone);

  if (existingContact) {
    if (name && name !== existingContact.name) {
      await db.from('contacts').update({ name, updated_at: new Date().toISOString() }).eq('id', existingContact.id);
    }
    return { contact: existingContact, wasCreated: false };
  }

  const { data: newContact, error: createError } = await db
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      phone,
      name: name || phone
    })
    .select()
    .single();

  if (createError) {
    console.error('Error creating webhook contact:', createError);
    return null;
  }

  return { contact: newContact, wasCreated: true };
}

async function findOrCreateConversation(
  accountId: string,
  configOwnerUserId: string,
  contactId: string
) {
  const db = supabaseAdmin();
  const { data: existing, error: findError } = await db
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .single();

  if (!findError && existing) {
    return existing;
  }

  const { data: newConv, error: createError } = await db
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      contact_id: contactId
    })
    .select()
    .single();

  if (createError) {
    console.error('Error creating webhook conversation:', createError);
    return null;
  }

  return newConv;
}
