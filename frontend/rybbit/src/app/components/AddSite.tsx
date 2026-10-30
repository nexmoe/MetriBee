// GA4 property assignment using Rybbit's native dialog and controls. AGPL-3.0-only.
import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useExtracted } from 'next-intl';
import { authClient } from '../../lib/auth';
import { authedFetch } from '../../api/utils';
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../../components/ui/select';
import { Alert } from '../../components/ui/alert';
export function AddSite({ trigger, disabled, disabledReason }: { trigger?: ReactNode; disabled?: boolean; disabledReason?: string }) {
  const t = useExtracted(), client = useQueryClient();
  const { data: organization } = authClient.useActiveOrganization();
  const [open,setOpen] = useState(false), [propertyId,setPropertyId] = useState(''), [error,setError] = useState(''), [saving,setSaving] = useState(false);
  const { data } = useQuery({ queryKey: ['available-properties',organization?.id], enabled: open, queryFn: () => authedFetch<{ properties: { id:string; name:string; organizationId:string }[] }>('/properties/available') });
  const available = data?.properties.filter(p => p.organizationId !== organization?.id) || [];
  const save = async () => {
    if (!organization) return;
    setSaving(true); setError('');
    try { await authedFetch(`/organizations/${organization.id}/sites`,undefined,{ method:'POST',data:{propertyId} }); await client.invalidateQueries(); setOpen(false); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setSaving(false); }
  };
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild>{trigger || <Button disabled={disabled} title={disabledReason}><Plus className="size-4" />{t('Add website')}</Button>}</DialogTrigger>
    <DialogContent><DialogHeader><DialogTitle>{t('Add GA4 property')}</DialogTitle><DialogDescription>{t('Choose a connected property you can transfer to this organization. Its saved reports move with it.')}</DialogDescription></DialogHeader>
      {available.length ? <Select value={propertyId} onValueChange={setPropertyId}><SelectTrigger><SelectValue placeholder={t('Select a property')} /></SelectTrigger><SelectContent>{available.map(p=><SelectItem key={p.id} value={p.id}>{p.name} · {p.id}</SelectItem>)}</SelectContent></Select> : <p className="py-4 text-sm text-neutral-500">{t('No properties are available to add. Ask a system administrator to assign a connected GA4 property.')}</p>}
      {error && <Alert variant="destructive">{error}</Alert>}<DialogFooter><Button variant="outline" onClick={()=>setOpen(false)}>{t('Cancel')}</Button><Button variant="success" disabled={!propertyId || saving} onClick={save}>{saving?t('Saving...'):t('Add property')}</Button></DialogFooter>
    </DialogContent></Dialog>;
}
