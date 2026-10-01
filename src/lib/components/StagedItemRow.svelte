<script lang="ts">
  import { page } from '$app/state';

  import { api, ApiRequestError } from '$lib/api';
  import type { ContactType } from '$lib/config-types';
  import { invalidate } from '$app/navigation';
  import JobStatus from './JobStatus.svelte';
  import WarningText from './WarningText.svelte';
  import { contactUrl, fieldLabel, JOB_LABELS, KIND_LABELS, STATUS_LABELS, type StagedItem } from '$lib/staged';

  type Props = {
    item: StagedItem;
    // for the item's field labels
    contactType?: ContactType;
    selected: boolean;
    busy: boolean;
    onselect: (selected: boolean) => void;
    onconfirm: (item: StagedItem) => void;
    onremove: (item: StagedItem) => void;
    onretry: (item: StagedItem) => void;
  };

  let { item, contactType, selected, busy, onselect, onconfirm, onremove, onretry }: Props = $props();

  // only create items have a form to open so far
  const editable = $derived(
    (item.kind === 'create' || item.kind === 'replace') && !['uploading', 'created', 'pending', 'validating'].includes(item.status)
  );
  const editHref = $derived(`/${item.kind === 'replace' ? 'replace' : 'create'}?item=${encodeURIComponent(item.id)}`);
  // one person, many places: open the form with this item's person kept
  // ready, or done (the person is then in CHT, so the new place only adds to their login)
  const anotherPlace = $derived(
    item.kind === 'create' &&
      !!contactType?.can_assign_multiple &&
      (item.status === 'ready' || item.status === 'created') &&
      !!item.summary.person
  );
  const selectable = $derived(item.status === 'needs_confirmation' && item.confirmation?.reason !== 'typed_name');
  const errorEntries = $derived(Object.entries(item.errors ?? {}));

  // Done items open what they created in the CHT app, in another tab
  const instanceUrl = $derived(page.data.session?.instance?.url as string | undefined);
  const created = $derived(item.status === 'created' && instanceUrl ? item.result : undefined);
  // only a place this app created: a replaced place was already there, so its name stays plain
  const placeHref = $derived(created?.placeId && item.kind === 'create' ? contactUrl(instanceUrl!, String(created.placeId)) : undefined);
  const personHref = $derived(created?.contactId ? contactUrl(instanceUrl!, String(created.contactId)) : undefined);

  // where a merge goes (its destination) or a move goes (its new parent's breadcrumb), linked where it
  // appears. Items staged before it was recorded carry it only in the text.
  const goesTo = $derived.by(() => {
    if (item.kind !== 'merge' && item.kind !== 'move') return undefined;
    if (item.summary.target) return item.summary.target;
    const [pattern, id] =
      item.kind === 'merge'
        ? [/^Merges into (.+?), with /, item.request.destinationId]
        : [/^(?:Moves to|Already under) (.+?), with /, item.request.newParentId];
    const name = item.summary.person?.match(pattern)?.[1];
    return name && id ? { placeId: String(id), name } : undefined;
  });
  const splitAt = (text: string, part: string): [string, string] => {
    const at = text.indexOf(part);
    return at < 0 ? [text + ' ', ''] : [text.slice(0, at), text.slice(at + part.length)];
  };

  // ---- the login pop-up, next to the Done badge
  // Both hidden by default. The password comes from the credentials record only when shown or
  // copied, and is dropped again when the pop-up closes.
  const MASK = '••••••••';
  const username = $derived(item.status === 'created' ? item.result?.username : undefined);
  let loginOpen = $state(false);
  let revealed = $state(false);
  let password = $state<string | null>(null);
  let passwordState = $state<'unfetched' | 'loading' | 'ready' | 'unavailable'>('unfetched');
  let copied = $state(false);
  let loginBox: HTMLElement | undefined = $state();

  function toggleLogin() {
    if (loginOpen) closeLogin();
    else loginOpen = true;
  }

  function closeLogin() {
    loginOpen = false;
    revealed = false;
    password = null;
    passwordState = 'unfetched';
    copied = false;
  }

  async function fetchPassword(): Promise<string | null> {
    if (passwordState === 'ready' || passwordState === 'unavailable') return password;
    const placeId = item.result?.placeId ?? item.request.placeId;
    passwordState = 'loading';
    try {
      const { credentials } = await api<{ credentials: { password?: string }[] }>(
        fetch,
        `/credentials?placeIds=${encodeURIComponent(placeId)}`
      );
      password = credentials[0]?.password ?? null;
      passwordState = password ? 'ready' : 'unavailable';
    } catch (e) {
      password = null;
      passwordState = e instanceof ApiRequestError && e.status === 401 ? 'unfetched' : 'unavailable';
    }
    return password;
  }

  async function toggleReveal() {
    if (revealed) {
      revealed = false;
      return;
    }
    await fetchPassword();
    revealed = true;
  }

  async function copyLogin() {
    const secret = await fetchPassword();
    try {
      await navigator.clipboard.writeText(secret ? `${username} ${secret}` : String(username));
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      copied = false;
    }
  }

  function onWindowClick(event: MouseEvent) {
    if (loginOpen && loginBox && !loginBox.contains(event.target as Node)) closeLogin();
  }
</script>

<svelte:window onclick={onWindowClick} onkeydown={(e) => e.key === 'Escape' && loginOpen && closeLogin()} />

<li class="row" class:selected>
  <div class="select">
    {#if selectable}
      <input
        type="checkbox"
        checked={selected}
        aria-label={`Select ${item.summary.title}`}
        disabled={busy}
        onchange={(event) => onselect((event.currentTarget as HTMLInputElement).checked)}
      />
    {/if}
  </div>

  <div class="main">
    <div class="heading">
      <span class="kind kind-{item.kind}"
        >{KIND_LABELS[item.kind]}{#if contactType}&nbsp;· {contactType.friendly}{/if}</span
      >
      {#if placeHref}
        <a class="title" href={placeHref} target="_blank" rel="noopener noreferrer" title="Open in CHT"
          >{item.summary.title}<span class="external" aria-hidden="true">↗</span><span class="sr-only">
            (opens in CHT, in a new tab)</span
          ></a
        >
      {:else}
        <span class="title">{item.summary.title}</span>
      {/if}
    </div>
    <div class="meta">
      {#if item.summary.subtitle}<span>{item.summary.subtitle}</span>{/if}
      {#if goesTo && instanceUrl}
        {@const [before, after] = splitAt(item.summary.person ?? '', goesTo.name)}
        <span
          >{before}<a
            class="person"
            href={contactUrl(instanceUrl, goesTo.placeId)}
            target="_blank"
            rel="noopener noreferrer"
            title="Open in CHT"
            >{goesTo.name}<span class="external" aria-hidden="true">↗</span><span class="sr-only"> (opens in CHT, in a new tab)</span></a
          >{after}</span
        >
      {:else if item.summary.person}<span
          >{#if personHref}<a class="person" href={personHref} target="_blank" rel="noopener noreferrer" title="Open in CHT"
              >{item.summary.person}<span class="external" aria-hidden="true">↗</span><span class="sr-only">
                (opens in CHT, in a new tab)</span
              ></a
            >{:else}{item.summary.person}{/if}{#if item.kind === 'create' && !item.request.contact?.properties}<span class="shared-tag"
              >&nbsp;· also serves another place</span
            >{/if}</span
        >{/if}
    </div>

    {#if item.status === 'invalid' && errorEntries.length}
      <ul class="details errors">
        {#each errorEntries as [field, message] (field)}
          <li><strong>{fieldLabel(field, contactType)}:</strong> {message}</li>
        {/each}
      </ul>
    {:else if item.status === 'needs_confirmation' && item.confirmation}
      <div class="details warning">
        {#if item.confirmation.reason === 'duplicates'}
          <ul>
            {#each item.confirmation.warnings as warning, index (index)}
              <li><WarningText {warning} /></li>
            {/each}
          </ul>
        {:else if item.confirmation.reason === 'large_move'}
          <p>This is a large move. It runs in the background and may take hours.</p>
        {:else}
          <p>Type the place's name to confirm. This can't be undone.</p>
        {/if}
      </div>
    {:else if item.status === 'failed' && item.failure}
      <p class="details errors">{item.failure.message}</p>
    {:else if item.status === 'ready' && item.failure}
      <p class="details note">{item.failure.message}</p>
    {:else if item.job && item.job.status !== 'done'}
      <!-- what a finished job did is on the jobs page; here only what still needs doing -->
      <div class="details"><JobStatus job={item.job} links={false} onchange={() => invalidate('app:staged')} /></div>
    {/if}
  </div>

  <div class="side">
    <div class="status-line" bind:this={loginBox}>
      {#if username}
        <button
          class="login-toggle"
          type="button"
          aria-label={`Login for ${item.summary.person ?? item.summary.title}`}
          title="Login"
          aria-expanded={loginOpen}
          aria-controls={`login-${item.id}`}
          onclick={toggleLogin}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"
            ><circle cx="8" cy="15" r="4" fill="none" stroke="currentColor" stroke-width="2" /><path
              d="M11 12l8-8m-3 3l2 2m-4 0l2 2"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            /></svg
          >
        </button>
        {#if loginOpen}
          <div class="login-pop" id={`login-${item.id}`} role="dialog" aria-label="Login">
            <dl>
              <dt>Username</dt>
              <dd><code>{revealed ? username : MASK}</code></dd>
              <dt>Password</dt>
              <dd>
                {#if passwordState === 'loading'}
                  <span class="muted">Loading…</span>
                {:else if passwordState === 'unavailable'}
                  <span class="muted">No longer available</span>
                {:else}
                  <code>{revealed && password ? password : MASK}</code>
                {/if}
              </dd>
            </dl>
            <div class="login-actions">
              <button class="btn btn-default btn-small" type="button" onclick={toggleReveal} disabled={passwordState === 'loading'}>
                {revealed ? 'Hide' : 'Show'}
              </button>
              <button class="btn btn-default btn-small" type="button" onclick={copyLogin} disabled={passwordState === 'loading'}>
                {copied ? 'Copied' : passwordState === 'unavailable' ? 'Copy username' : 'Copy login'}
              </button>
            </div>
          </div>
        {/if}
      {/if}
      <!-- the badge stays the rightmost item -->
      {#if item.job}
        <!-- a scheduled job: its own status rather than "Done" -->
        <span class="status status-job-{item.job.status}">
          {#if item.job.status === 'running'}<span class="dot-spin" aria-hidden="true"></span>{/if}
          {JOB_LABELS[item.job.status]}
        </span>
      {:else}
        <span class="status status-{item.status}">
          {#if item.status === 'uploading' || item.status === 'validating'}<span class="dot-spin" aria-hidden="true"></span>{/if}
          {STATUS_LABELS[item.status]}
        </span>
      {/if}
    </div>
    <div class="actions">
      {#if item.status === 'needs_confirmation'}
        <button class="btn btn-primary btn-small" type="button" onclick={() => onconfirm(item)} disabled={busy}>Confirm</button>
      {/if}
      {#if item.status === 'failed'}
        <button class="btn btn-primary btn-small" type="button" onclick={() => onretry(item)} disabled={busy}>Retry</button>
      {/if}
      {#if editable}
        <a class="btn btn-small {item.status === 'invalid' ? 'btn-primary' : 'btn-link'}" href={editHref}>
          {item.status === 'invalid' ? 'Fix' : 'Edit'}
        </a>
      {/if}
      {#if anotherPlace}
        <a
          class="btn btn-link btn-small"
          href={`/create?person=${encodeURIComponent(item.id)}`}
          title={`Another place for ${item.summary.person}`}
        >
          Add place
        </a>
      {/if}
      {#if item.status !== 'uploading'}
        <button class="btn btn-link btn-small" type="button" onclick={() => onremove(item)} disabled={busy}>
          {item.status === 'created' ? 'Clear' : 'Remove'}
        </button>
      {/if}
    </div>
  </div>
</li>

<style>
  .row {
    display: grid;
    grid-template-columns: 28px 1fr auto;
    gap: 12px;
    padding: 14px 16px;
    background: var(--cht-surface);
    border-bottom: 1px solid var(--cht-border);
  }

  .row.selected {
    background: #f2f8fc;
  }

  .select {
    padding-top: 2px;
  }

  .select input {
    width: 16px;
    height: 16px;
  }

  .main {
    min-width: 0;
  }

  .heading {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
  }

  .title {
    font-size: 15px;
    font-weight: 500;
    color: var(--cht-text);
    overflow-wrap: anywhere;
  }

  /* links read as links, as in a job's status: blue and underlined */
  a.title,
  a.person {
    color: var(--cht-blue);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  a.title:hover,
  a.person:hover {
    color: var(--cht-blue-dark);
  }

  .actions :global(a.btn-link),
  .actions :global(button.btn-link) {
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .external {
    margin-left: 3px;
    font-size: 0.85em;
    color: var(--cht-text-muted);
  }

  .kind {
    padding: 1px 6px;
    border: 1px solid var(--cht-border);
    border-radius: 3px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--cht-text-muted);
  }

  /* one line each: where, and who */
  .meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 2px;
    color: var(--cht-text-muted);
    font-size: 13px;
  }

  .details {
    margin: 8px 0 0;
    font-size: 13px;
  }

  ul.details,
  .details ul {
    margin: 8px 0 0;
    padding-left: 18px;
  }

  .details ul {
    margin-top: 0;
  }

  .errors {
    color: #a94442;
  }

  .warning {
    color: #8a6d3b;
  }

  .warning p {
    margin: 0;
  }

  .note,
  .muted {
    color: var(--cht-text-muted);
  }

  .status-line {
    position: relative;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .login-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 50%;
    background: none;
    color: #3c763d;
    cursor: pointer;
  }

  .login-toggle:hover,
  .login-toggle[aria-expanded='true'] {
    border-color: #d6e9c6;
    background: #dff0d8;
  }

  .login-toggle svg {
    width: 15px;
    height: 15px;
  }

  .login-pop {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 10;
    min-width: 230px;
    padding: 10px 12px;
    background: var(--cht-surface);
    border: 1px solid var(--cht-border);
    border-radius: var(--cht-radius);
    box-shadow: 0 4px 14px rgb(0 0 0 / 12%);
    font-size: 13px;
  }

  .login-pop dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 6px 10px;
    align-items: center;
    margin: 0 0 10px;
  }

  .login-pop dt {
    color: var(--cht-text-muted);
  }

  .login-pop dd {
    margin: 0;
    overflow-wrap: anywhere;
  }

  .login-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }

  code {
    padding: 1px 5px;
    border-radius: 3px;
    background: var(--cht-surface-muted);
    font-size: 13px;
  }

  .side {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
  }

  /* the CHT app's alert colours, as status pills */
  .status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 9px;
    border-radius: 999px;
    font-size: 12px;
    white-space: nowrap;
    color: var(--cht-text-muted);
    background: var(--cht-surface-muted);
  }

  .status-ready {
    color: var(--cht-blue);
    background: #e5f2fa;
  }

  .status-needs_confirmation {
    color: #8a6d3b;
    background: #fcf8e3;
  }

  .status-invalid,
  .status-failed {
    color: #a94442;
    background: #f2dede;
  }

  .status-job-queued,
  .status-job-postponed,
  .status-job-running {
    color: var(--cht-blue);
    background: #e5f2fa;
  }

  .status-job-needs_sign_in,
  .status-job-failed {
    color: #a94442;
    background: #f2dede;
  }

  .status-job-done,
  .status-created {
    color: #3c763d;
    background: #dff0d8;
  }

  .dot-spin {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    border: 2px solid currentColor;
    border-left-color: transparent;
    animation: cht-spin 1s infinite linear;
  }

  .actions {
    display: flex;
    gap: 6px;
  }

  :global(.btn-small) {
    padding: 3px 10px;
    font-size: 13px;
  }

  :global(.btn-link) {
    color: var(--cht-blue);
    background: none;
  }

  :global(.btn-link:hover:not(:disabled)) {
    text-decoration: underline;
  }

  @media (max-width: 600px) {
    .row {
      grid-template-columns: 24px 1fr;
    }

    .side {
      grid-column: 2;
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
    }
  }
</style>
