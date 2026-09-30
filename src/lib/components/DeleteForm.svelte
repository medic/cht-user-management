<script lang="ts">
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';

  import { api, ApiRequestError, isSignedOut, signInUrl, type DeletePreview, type PlaceSummary } from '$lib/api';
  import type { ContactType, HierarchyConstraint } from '$lib/config-types';
  import PlacePicker from './PlacePicker.svelte';

  // APP.md → Deleting places: find the place, show everything that goes with it, and confirm by typing
  // its name. Deleting is permanent, so this is the strictest confirmation in the app.
  let { contactType, configVersion }: { contactType: ContactType; configVersion: string } = $props();

  const start = untrack(() => ({ contactType }));
  const levels: HierarchyConstraint[] = [...start.contactType.hierarchy].sort((a, b) => b.level - a.level);
  const levelOne = levels.find((level) => level.level === 1)!;
  // made once, when the form opens: scheduling the same id again returns the same job
  const jobId = crypto.randomUUID();

  let picked = $state<Record<string, PlaceSummary | null>>(Object.fromEntries(levels.map((l) => [l.property_name, null])));
  let target = $state<PlaceSummary | null>(null);
  let preview = $state<DeletePreview | null>(null);
  let previewError = $state<string | null>(null);
  let loading = $state(false);
  let typed = $state('');
  let submitting = $state(false);
  let banner = $state<string | null>(null);

  function pickLevel(level: HierarchyConstraint, chosen: PlaceSummary | null) {
    picked[level.property_name] = chosen;
    for (const other of levels) {
      if (other.level < level.level) picked[other.property_name] = null;
      else if (other.level > level.level && chosen) {
        const ancestor = chosen.lineage[other.level - level.level - 1];
        if (ancestor && !picked[other.property_name]) {
          picked[other.property_name] = {
            id: ancestor.id,
            name: ancestor.name,
            type: other.contact_type,
            lineage: chosen.lineage.slice(other.level - level.level)
          };
        }
      }
    }
    if (level.level === 1 && target && target.lineage[0]?.id !== chosen?.id) pickTarget(null);
  }

  async function pickTarget(chosen: PlaceSummary | null) {
    target = chosen;
    preview = null;
    previewError = null;
    typed = '';
    if (!chosen) return;
    for (const level of levels) {
      const ancestor = chosen.lineage[level.level - 1];
      if (ancestor)
        picked[level.property_name] = {
          id: ancestor.id,
          name: ancestor.name,
          type: level.contact_type,
          lineage: chosen.lineage.slice(level.level)
        };
    }
    loading = true;
    try {
      const result = await api<DeletePreview>(fetch, '/preview', {
        method: 'POST',
        body: { kind: 'delete', request: { jobId, contactType: contactType.name, placeId: chosen.id } }
      });
      if (target?.id === chosen.id) preview = result;
    } catch (e) {
      if (isSignedOut(e)) return goto(signInUrl(page.url));
      if (target?.id === chosen.id) previewError = e instanceof ApiRequestError ? e.message : "Couldn't work out what this would delete.";
    } finally {
      loading = false;
    }
  }

  const confirmed = $derived(!!preview && typed.trim() === preview.confirmName);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!confirmed || !target || !preview) return;
    submitting = true;
    banner = null;
    try {
      await api(fetch, '/staged-items', {
        method: 'POST',
        body: { kind: 'delete', request: { jobId, contactType: contactType.name, placeId: target.id, confirmName: typed.trim() } },
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
  const recent = (iso: string | null) => !!iso && Date.now() - Date.parse(iso) < 60 * 86_400_000;
  const levelAbove = (level: HierarchyConstraint) => levels.find((other) => other.level === level.level + 1);
</script>

<form class="delete-form" onsubmit={submit} novalidate>
  {#if banner}<div class="banner" role="alert">{banner}</div>{/if}

  <section class="card">
    <h2>Which {contactType.friendly.toLowerCase()}</h2>
    {#each levels as level (level.property_name)}
      {@const above = levelAbove(level)}
      <PlacePicker
        id={`d-${level.property_name}`}
        label={level.friendly_name}
        type={level.contact_type}
        parentId={above ? picked[above.property_name]?.id : undefined}
        parentLabel={above?.friendly_name}
        selected={picked[level.property_name]}
        disabled={submitting}
        onselect={(chosen) => pickLevel(level, chosen)}
      />
    {/each}
    <PlacePicker
      id="d-place"
      label={contactType.friendly}
      type={contactType.name}
      parentId={picked[levelOne.property_name]?.id}
      parentLabel={levelOne.friendly_name}
      selected={target}
      required
      disabled={submitting}
      onselect={pickTarget}
    />
  </section>

  {#if loading}
    <p class="muted">Counting everything under it…</p>
  {:else if previewError}
    <p class="error" role="alert">{previewError}</p>
  {:else if preview}
    <section class="card impact" aria-live="polite">
      <h2>What will be deleted</h2>
      <p class="where">{preview.place.location}</p>
      <p class="counts">
        <strong>{plural(preview.counts.places, 'place')}</strong>, <strong>{plural(preview.counts.people, 'person', 'people')}</strong> and
        <strong>{plural(preview.counts.reports, 'report')}</strong>, including {preview.place.name} itself. This can't be undone; a copy is kept
        for a while, for recovery.
      </p>
      {#if preview.large}
        <p class="large">This is a large delete. It runs in the background and may take a long time.</p>
      {/if}

      {#if preview.accounts.length}
        <h3>Accounts at these places</h3>
        <table>
          <thead><tr><th>Account</th><th>What happens</th><th>Last sync</th></tr></thead>
          <tbody>
            {#each preview.accounts as account (account.username)}
              <tr class:recent={recent(account.lastSync)}>
                <td><code>{account.username}</code></td>
                <td>
                  {account.action === 'retire' ? 'Disabled: no places left' : `Loses ${account.places.join(', ')}, keeps its other places`}
                </td>
                <td
                  >{lastSync(account.lastSync)}{#if recent(account.lastSync)}
                    <span class="warn">in use</span>{/if}</td
                >
              </tr>
            {/each}
          </tbody>
        </table>
        {#if !preview.lastSyncKnown}<p class="muted">Only admins can see when accounts last synced.</p>{/if}
      {:else}
        <p class="muted">No accounts are assigned to these places.</p>
      {/if}
    </section>

    <section class="card confirm">
      <label for="d-confirm">Type <strong>{preview.confirmName}</strong> to confirm</label>
      <input id="d-confirm" type="text" autocomplete="off" bind:value={typed} disabled={submitting} />
    </section>
  {/if}

  <div class="actions">
    <a class="btn btn-default" href="/">Cancel</a>
    <button class="btn btn-danger" type="submit" disabled={!confirmed || submitting}>
      {submitting ? 'Adding…' : 'Add delete to staged list'}
    </button>
  </div>
</form>

<style>
  .delete-form {
    max-width: 640px;
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
    margin: 16px 0 6px;
    font-size: 14px;
  }

  .where,
  .muted {
    color: var(--cht-text-muted);
    font-size: 13px;
  }

  .where {
    margin: -8px 0 8px;
  }

  .large {
    padding: 8px 12px;
    color: #8a6d3b;
    background: #fcf8e3;
    border-radius: var(--cht-radius);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  th,
  td {
    padding: 6px 8px;
    border-bottom: 1px solid var(--cht-border);
    text-align: left;
    vertical-align: top;
  }

  th {
    color: var(--cht-text-muted);
    font-weight: 500;
  }

  tr.recent td {
    background: #fcf8e3;
  }

  .warn {
    margin-left: 4px;
    padding: 0 6px;
    border-radius: 999px;
    color: #8a6d3b;
    background: #faebcc;
    font-size: 12px;
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
