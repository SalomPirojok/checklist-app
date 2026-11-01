import { supabase } from '../../../lib/supabase.js';
import { decryptSecret } from '../../../lib/secrets.js';
import { getProfile } from './instagram.js';
import { notifyLater } from './notify.js';
import { leadNewText, messageNewText } from './notifyText.js';

const CLOSED_LEAD = ['completed', 'lost'];

export async function loadIntegrationByAccount(accountId) {
    const { data, error } = await supabase
        .from('crm_integrations')
        .select('id, organization_id, status, config, secrets_encrypted')
        .eq('provider', 'instagram')
        .eq('status', 'connected')
        .filter('config->>ig_user_id', 'eq', accountId)
        .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
}

async function sourceIdByKey(orgId, key) {
    const { data } = await supabase.from('crm_sources').select('id').eq('organization_id', orgId).eq('key', key).maybeSingle();
    return data?.id || null;
}

// Finds the client for an Instagram user, linking an existing card by
// username or creating a new one.
async function findOrCreateClient(orgId, igsid, token, referral) {
    const { data: byId } = await supabase
        .from('crm_clients')
        .select('*')
        .eq('organization_id', orgId)
        .eq('instagram_user_id', igsid)
        .is('merged_into_id', null)
        .maybeSingle();
    if (byId) return { client: byId, created: false };

    const profile = await getProfile(igsid, token);
    const username = profile.username ? profile.username.toLowerCase() : null;
    if (username) {
        const { data: byName } = await supabase
            .from('crm_clients')
            .select('*')
            .eq('organization_id', orgId)
            .eq('instagram_username', username)
            .is('merged_into_id', null)
            .maybeSingle();
        if (byName) {
            const { data: linked } = await supabase.from('crm_clients').update({ instagram_user_id: igsid }).eq('id', byName.id).select().single();
            return { client: linked || byName, created: false };
        }
    }

    const sourceId = await sourceIdByKey(orgId, referral?.ad_id ? 'instagram_ads' : 'instagram_organic');
    const [firstName, ...rest] = (profile.name || username || 'Instagram').trim().split(/\s+/);
    const { data: client, error } = await supabase
        .from('crm_clients')
        .insert({
            organization_id: orgId,
            first_name: firstName.slice(0, 100),
            last_name: rest.join(' ').slice(0, 100) || null,
            instagram_username: username,
            instagram_user_id: igsid,
            source_id: sourceId,
        })
        .select()
        .single();
    if (error) {
        // Created concurrently by a parallel webhook for the same person.
        if (error.code === '23505') return findOrCreateClient(orgId, igsid, token, referral);
        throw new Error(error.message);
    }
    return { client, created: true };
}

// The client's open lead, or a new Instagram lead for this inquiry.
async function findOrCreateLead(orgId, client, referral) {
    const { data: open } = await supabase
        .from('crm_leads')
        .select('*')
        .eq('client_id', client.id)
        .not('status', 'in', `(${CLOSED_LEAD.join(',')})`)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (open) return { lead: open, created: false };

    const { count, error: countError } = await supabase.from('crm_leads').select('id', { count: 'exact', head: true }).eq('client_id', client.id);
    if (countError || count === null) throw new Error(countError?.message || 'Failed to count leads');
    const key = referral?.ad_id ? 'instagram_ads' : count > 0 ? 'repeat' : 'instagram_organic';
    const sourceId = (await sourceIdByKey(orgId, key)) || client.source_id;

    // Meta sends the ad id; a campaign lists its ads' ids (comma-separated)
    // in external_campaign_id.
    let campaignId = null;
    if (referral?.ad_id) {
        const { data: campaigns } = await supabase
            .from('crm_campaigns')
            .select('id, external_campaign_id')
            .eq('organization_id', orgId)
            .not('external_campaign_id', 'is', null);
        campaignId = (campaigns || []).find((c) => c.external_campaign_id.split(/[\s,]+/).includes(referral.ad_id))?.id || null;
    }

    const { data: lead, error } = await supabase
        .from('crm_leads')
        .insert({
            organization_id: orgId,
            client_id: client.id,
            channel: 'instagram',
            source_id: sourceId,
            campaign_id: campaignId,
            external_ad_id: referral?.ad_id || null,
            referral,
            manager_id: client.manager_id,
        })
        .select()
        .single();
    if (error) throw new Error(error.message);
    return { lead, created: true };
}

// One parsed message (see parseWebhook). Idempotent on the message id.
export async function processInstagramMessage(item) {
    const integration = await loadIntegrationByAccount(item.accountId);
    if (!integration) return { skipped: 'no_integration' };
    const orgId = integration.organization_id;

    const { data: existing } = await supabase.from('crm_messages').select('id').eq('channel', 'instagram').eq('external_id', item.mid).maybeSingle();
    if (existing) return { skipped: 'duplicate' };

    const token = decryptSecret(integration.secrets_encrypted);
    // Echo = a message the business sent (from the Instagram app or from us).
    const customerId = item.isEcho ? item.recipientId : item.senderId;
    const { client, created: clientCreated } = await findOrCreateClient(orgId, customerId, token, item.isEcho ? null : item.referral);

    let lead = null;
    let leadCreated = false;
    if (!item.isEcho) ({ lead, created: leadCreated } = await findOrCreateLead(orgId, client, item.referral));

    const { error } = await supabase.from('crm_messages').insert({
        organization_id: orgId,
        client_id: client.id,
        lead_id: lead?.id || null,
        channel: 'instagram',
        direction: item.isEcho ? 'out' : 'in',
        external_id: item.mid,
        body: item.text,
        attachments: item.attachments,
        status: item.isEcho ? 'sent' : 'received',
        sent_at: item.timestamp,
    });
    if (error) {
        if (error.code === '23505') return { skipped: 'duplicate' };
        throw new Error(error.message);
    }

    if (!item.isEcho) {
        if (leadCreated) {
            const { data: source } = lead.source_id ? await supabase.from('crm_sources').select('name').eq('id', lead.source_id).single() : { data: null };
            notifyLater(orgId, 'lead_new', () => ({
                text: leadNewText({ lead: { ...lead, notes: item.text }, client, sourceName: source?.name }),
                link: `leads/${lead.id}`,
            }));
        } else {
            notifyLater(orgId, 'message_new', () => ({ text: messageNewText({ client, text: item.text, attachments: item.attachments }), link: `clients/${client.id}` }));
        }
    }
    return { clientCreated, leadCreated, clientId: client.id, leadId: lead?.id || null };
}
