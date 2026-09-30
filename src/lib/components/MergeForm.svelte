<script lang="ts">
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';

  import { api, ApiRequestError, isSignedOut, signInUrl, type MergePreview, type PlaceSummary } from '$lib/api';
  import type { ContactType, HierarchyConstraint } from '$lib/config-types';
  import PlacePicker from './PlacePicker.svelte';

  // APP.md → Merging places: the source is merged away into the destination. It deletes the source,
  // so it's confirmed by typing the source's name.
  let { contactType, configVersion }: { contactType: ContactType; configVersion: string } = $props();

  const start = untrack(() => ({ contactType }));
  const levels: HierarchyConstraint[] = [...start.contactType.hierarchy].sort((a, b) => b.level - a.level);
  const levelOne = levels.find((level) => level.level === 1)!;
  const jobId = crypto.randomUUID();

  // the source, then the destination, each found within its hierarchy
  let from = $state<Record<string, PlaceSummary | null>>(Object.fromEntries(levels.map((l) => [l.property_name, null])));
  let into = $state<Record<string, PlaceSummary | null>>(Object.fromEntries(levels.map((l) => [l.property_name, null])));
  let source = $state<PlaceSummary | null>(null);
  let destination = $state<PlaceSummary | null>(null);
  let preview = $state<MergePreview | null>(null);
  let previewError = $state<string | null>(null);
  let loading = $state(false);
  let typed = $state('');
  let submitting = $state(false);
  let banner = $state<string | null>(null);

  function pickLevel(picks: Record<string, PlaceSummary | null>, level: HierarchyConstraint, chosen: PlaceSummary | null) {
    picks[level.property_name] = chosen;
    for (const other of levels) {
      if (other.level < level.level) picks[other.property_name] = null;
      else if (other.level > level.level && chosen) {
        const ancestor = chosen.lineage[other.level - level.level - 1];
        if (ancestor && !picks[other.property_name]) {
          picks[other.property_name] = {
            id: ancestor.id,
            name: ancestor.name,
            type: other.contact_type,
            lineage: chosen.lineage.slice(other.level - level.level)
          };
        }
      }
    }
  }

  function fillAbove(picks: Record<string, PlaceSummary | null>, chosen: PlaceSummary | null) {
    if (!chosen) return;
    for (const level of levels) {
      const ancestor = chosen.lineage[level.level - 1];
      if (ancestor)
        picks[level.property_name] = {
          id: ancestor.id,
          name: ancestor.name,
          type: level.contact_type,
          lineage: chosen.lineage.slice(level.level)
        };
    }
  }

  let lastKey = '';
  $effect(() => {
    const key = source && destination ? `${source.id}|${destination.id}` : '';
    if (key === lastKey) return;
    lastKey = key;
    preview = null;
    previewError = null;
    typed = '';
    if (!key) return;
    loading = true;
    const request = { jobId, contactType: contactType.name, sourceId: source!.id, destinationId: destination!.id };
    api<MergePreview>(fetch, '/preview', { method: 'POST', body: { kind: 'merge', request } })
      .then((result) => {
        if (key === lastKey) preview = result;
      })
      .catch((e) => {
        if (isSignedOut(e)) return goto(signInUrl(page.url));
        if (key === lastKey) previewError = e instanceof ApiRequestError ? e.message : "Couldn't work out what this would do.";
      })
      .finally(() => {
        if (key === lastKey) loading = false;
      });
  });

  const confirmed = $derived(!!preview && typed.trim() === preview.confirmName);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!confirmed || !source || !destination) return;
    submitting = true;
    banner = null;
    try {
      await api(fetch, '/staged-items', {
        method: 'POST',
        body: {
          kind: 'merge',
          request: { jobId, contactType: contactType.name, sourceId: source.id, destinationId: destination.id, confirmName: typed.trim() }
        },
        configVersion
      });
      await goto('/', { invalidateAll: true });
    } catch (e) {
      if (isSignedOut(e)) return goto(signInUrl(page.url));
      banner = e instanceof ApiRequestError ? e.message : 'Something went wrong. Try again.';
    } finally {
      submitting = false;
    }
  }

  const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
  const lastSync = (iso: string | null) => {
    if (!preview?.lastSyncKnown) return 'unknown';
    if (!iso) return 'never';
    const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
    return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  };
  const levelAbove = (level: HierarchyConstraint) => levels.find((other) => other.level === level.level + 1);
</script>

{#snippet find(
  label: string,
  prefix: string,
  picks: Record<string, PlaceSummary | null>,
  picked: PlaceSummary | null,
  onpick: (p: PlaceSummary | null) => void,
  exclude: string[]
)}
  {#each levels as level (level.property_name)}
    {@const above = levelAbove(level)}
    <PlacePicker
      id={`${prefix}-${level.property_name}`}
      label={level.friendly_name}
      type={level.contact_type}
      parentId={above ? picks[above.property_name]?.id : undefined}
      parentLabel={above?.friendly_name}
      selected={picks[level.property_name]}
      disabled={submitting}
      onselect={(chosen) => {
        pickLevel(picks, level, chosen);
        if (level.level === 1 && picked && picked.lineage[0]?.id !== chosen?.id) onpick(null);
      }}
    />
  {/each}
  <PlacePicker
    id={`${prefix}-place`}
    {label}
    type={contactType.name}
    parentId={picks[levelOne.property_name]?.id}
    parentLabel={levelOne.friendly_name}
    selected={picked}
    {exclude}
    required
    disabled={submitting}
    onselect={(chosen) => {
      fillAbove(picks, chosen);
      onpick(chosen);
    }}
  />
{/snippet}

<form class="merge-form" onsubmit={submit} novalidate>
  {#if banner}<div class="banner" role="alert">{banner}</div>{/if}

  <section class="card">
    <h2>Merge away</h2>
    {@render find(contactType.friendly, 'from', from, source, (p) => (source = p), [])}
  </section>

  {#if source}
    <section class="card">
      <h2>Into</h2>
      {#key source.id}
        {@render find(`${contactType.friendly} to keep`, 'into', into, destination, (p) => (destination = p), [source.id])}
      {/key}
    </section>
  {/if}

  {#if loading}
    <p class="muted">Working out what this would do…</p>
  {:else if previewError}
    <p class="error" role="alert">{previewError}</p>
  {:else if preview}
    <section class="card impact" aria-live="polite">
      <h2>What will happen</h2>
      <p>
        Everything under <strong>{preview.source.name}</strong> — {plural(preview.counts.places, 'place')} and
        {plural(preview.counts.people, 'person', 'people')} — moves to <strong>{preview.destination.location}</strong>, with their reports.
        Reports about {preview.source.name} move to {preview.destination.name}. Then <strong>{preview.source.name} is deleted</strong>; a
        copy is kept for a while.
      </p>
      {#if preview.large}
        <p class="large">This is a large merge. It runs in the background and may take a long time.</p>
      {/if}

      <h3>Primary contacts</h3>
      <p>
        {#if preview.primaryContacts.source && preview.primaryContacts.destination}
          {preview.primaryContacts.source.name} is merged into {preview.primaryContacts.destination.name}: their reports go to
          {preview.primaryContacts.destination.name}, and {preview.primaryContacts.source.name}'s record is deleted.
        {:else if preview.primaryContacts.source}
          {preview.destination.name} has no primary contact, so {preview.primaryContacts.source.name} moves under it as an ordinary person.
        {:else}
          {preview.source.name} has no primary contact.
        {/if}
      </p>

      {#if preview.properties.length}
        <h3>Lost with {preview.source.name}</h3>
        <table>
          <thead><tr><th></th><th>{preview.source.name} (deleted)</th><th>{preview.destination.name} (kept)</th></tr></thead>
          <tbody>
            {#each preview.properties as property (property.name)}
              <tr class:differs={property.source !== property.destination}>
                <th scope="row">{property.label}</th>
                <td>{property.source || '—'}</td>
                <td>{property.destination || '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}

      {#if preview.accounts.length}
        <h3>Accounts at {preview.source.name}</h3>
        <ul class="accounts">
          {#each preview.accounts as account (account.username)}
            <li>
              <code>{account.username}</code>
              {account.action === 'retire' ? 'disabled: no places left' : `loses ${preview.source.name}, keeps its other places`}
              <span class="muted">· last sync {lastSync(account.lastSync)}</span>
            </li>
          {/each}
        </ul>
        {#if !preview.lastSyncKnown}<p class="muted">Only admins can see when accounts last synced.</p>{/if}
      {/if}
    </section>

    <section class="card confirm">
      <label for="merge-confirm">Type <strong>{preview.confirmName}</strong> to confirm</label>
      <input id="merge-confirm" type="text" autocomplete="off" bind:value={typed} disabled={submitting} />
    </section>
  {/if}

  <div class="actions">
    <a class="btn btn-default" href="/">Cancel</a>
    <button class="btn btn-danger" type="submit" disabled={!confirmed || submitting}
      >{submitting ? 'Adding…' : 'Add merge to staged list'}</button
    >
  </div>
</form>

<style>
  .merge-form {
    max-width: 680px;
  }

  .card {
    margin-bottom: 16px;
    padding: 18px 20px 8px;
    background: var(--cht-surface);
    border: 1px solid var(--cht-border);
    border-radius: var(--cht-radius);
  }

  h2 {
    margin: 0 0 14px;
    font-size: 16px;
  }

  h3 {
    margin: 14px 0 6px;
    font-size: 14px;
  }

  .muted {
    color: var(--cht-text-muted);
    font-size: 13px;
  }

  .large {
    padding: 8px 12px;
    color: #8a6d3b;
    background: #fcf8e3;
    border-radius: var(--cht-radius);
  }

  table {
    width: 100%;
    margin-bottom: 8px;
    border-collapse: collapse;
    font-size: 13px;
  }

  th,
  td {
    padding: 6px 8px;
    border-bottom: 1px solid var(--cht-border);
    text-align: left;
  }

  thead th {
    color: var(--cht-text-muted);
    font-weight: 500;
  }

  tr.differs td:nth-child(2) {
    color: #a94442;
  }

  .accounts {
    margin: 0 0 10px;
    padding-left: 18px;
  }

  code {
    padding: 1px 5px;
    border-radius: 3px;
    background: var(--cht-surface-muted);
  }

  .confirm label {
    display: block;
    margin-bottom: 6px;
  }

  .confirm input {
    width: 100%;
    margin-bottom: 12px;
    padding: 7px 10px;
    border: 1px solid var(--cht-input-border);
    border-radius: var(--cht-radius);
  }

  .error,
  .banner {
    padding: 10px 14px;
    color: #a94442;
    background: #f2dede;
    border: 1px solid #ebccd1;
    border-radius: var(--cht-radius);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .btn-danger {
    padding: 8px 18px;
    color: #fff;
    background: var(--cht-red);
    border: 1px solid var(--cht-red);
  }

  .btn-danger:disabled {
    opacity: 0.55;
  }
</style>
