<script lang="ts">
	import { untrack } from 'svelte';
	import { goto, invalidate } from '$app/navigation';
	import { page } from '$app/state';

	import { api, ApiRequestError, isSignedOut, signInUrl } from '$lib/api';
	import StagedItemRow from '$lib/components/StagedItemRow.svelte';
	import { browser } from '$app/environment';
	import {
		KIND_LABELS,
		MOVING_JOBS,
		MOVING_STATUSES,
		NOT_UPLOADED,
		STATUS_LABELS,
		STATUS_ORDER,
		UPLOADED_EARLIER,
		uploadGroup,
		type StagedItem,
		type StagedList,
		type StagedStatus
	} from '$lib/staged';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const POLL_MS = 3000;

	let moreItems = $state<StagedItem[]>([]);
	let moreCursor = $state<string | undefined>(undefined);
	let loadingMore = $state(false);
	let selected = $state<string[]>([]);
	let busy = $state(false);
	let message = $state<{ kind: 'error' | 'info'; text: string } | null>(null);
	let search = $state('');
	let typedFor = $state<StagedItem | null>(null);
	let typedName = $state('');
	let dialog: HTMLDialogElement | undefined = $state();
	let clearDialog: HTMLDialogElement | undefined = $state();

	// a new load (filters changed, or a refresh) replaces anything paged in by "Show more"
	// Only a new list re-runs it: the state it resets is read untracked, since an effect that reads
	// what it writes keeps re-running itself until Svelte stops it, and then the page stops updating
	$effect(() => {
		const list = data.list;
		untrack(() => {
			moreItems = [];
			moreCursor = list.nextCursor;
			selected = selected.filter((id) => list.items.some((item) => item.id === id && item.status === 'needs_confirmation'));
		});
	});

	$effect(() => {
		search = data.filters.q;
	});

	const list = $derived(data.list);
	const items = $derived([...list.items, ...moreItems]);

	// The timeline: what isn't uploaded yet, then each upload, latest first. The server already sends
	// the items in that order, so a group starts wherever an item's upload changes.
	type Group = { key: string; items: StagedItem[]; startedAt?: string; runId?: string };
	const groups = $derived(
		items.reduce<Group[]>((all, item) => {
			const key = uploadGroup(item);
			const last = all.at(-1);
			if (last?.key === key) last.items.push(item);
			else all.push({ key, items: [item], startedAt: item.upload?.startedAt, runId: item.upload?.runId });
			return all;
		}, [])
	);

	// in the viewer's own time zone, so only in the browser; the server renders the date alone
	function uploadedAt(iso: string): string {
		const at = new Date(iso);
		if (!browser) return iso.slice(0, 10);
		const time = at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
		const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86_400_000);
		if (days === 0) return `Today, ${time}`;
		if (days === 1) return `Yesterday, ${time}`;
		return `${at.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: at.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })}, ${time}`;
	}
	const counts = $derived(list.counts);
	const totalItems = $derived(Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0));
	const readyCount = $derived(counts.ready ?? 0);
	const createdCount = $derived(counts.created ?? 0);
	const uploading = $derived(list.upload.state === 'running');
	const validating = $derived(list.validation.state === 'running');
	const filtered = $derived(Boolean(data.filters.status || data.filters.kind || data.filters.q || data.filters.file));
	const statusChips = $derived(STATUS_ORDER.filter((status) => (counts[status] ?? 0) > 0 || data.filters.status === status));

	// keep checking while an upload or background validation is changing things
	$effect(() => {
		const moving =
			uploading ||
			validating ||
			MOVING_STATUSES.some((status) => (counts[status] ?? 0) > 0) ||
			items.some((item) => item.job && MOVING_JOBS.includes(item.job.status));
		if (!moving) {
			return;
		}
		const timer = setInterval(() => invalidate('app:staged'), POLL_MS);
		return () => clearInterval(timer);
	});

	function setFilter(key: 'status' | 'kind' | 'q' | 'file', value: string) {
		const params = new URLSearchParams(page.url.searchParams);
		if (value) {
			params.set(key, value);
		} else {
			params.delete(key);
		}
		const query = params.toString();
		goto(query ? `?${query}` : '/', { keepFocus: true, noScroll: true, replaceState: key === 'q' });
	}

	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	function onSearch(value: string) {
		search = value;
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => setFilter('q', value.trim()), 300);
	}

	async function run(action: () => Promise<unknown>, done?: string) {
		busy = true;
		message = null;
		try {
			await action();
			if (done) {
				message = { kind: 'info', text: done };
			}
		} catch (e) {
			if (isSignedOut(e)) {
				await goto(signInUrl(page.url));
				return;
			}
			const text = e instanceof ApiRequestError ? e.message : 'Something went wrong. Try again.';
			message = { kind: 'error', text };
		} finally {
			busy = false;
			await invalidate('app:staged');
		}
	}

	const upload = (ids?: string[]) =>
		run(async () => {
			const { uploading: n } = await api<{ uploading: number }>(fetch, '/staged-items/upload', { method: 'POST', body: ids ? { ids } : {} });
			if (!n) {
				message = { kind: 'info', text: 'Nothing is ready to upload.' };
			}
		});

	function confirm(item: StagedItem) {
		if (item.confirmation?.reason === 'typed_name') {
			typedFor = item;
			typedName = '';
			dialog?.showModal();
			return;
		}
		run(() => api(fetch, `/staged-items/${item.id}/confirm`, { method: 'POST', body: { revision: item.revision } }));
	}

	function confirmTyped(event: SubmitEvent) {
		event.preventDefault();
		const item = typedFor;
		if (!item) {
			return;
		}
		dialog?.close();
		run(() => api(fetch, `/staged-items/${item.id}/confirm`, { method: 'POST', body: { revision: item.revision, confirmName: typedName.trim() } }));
	}

	const confirmSelected = () =>
		run(async () => {
			const { confirmed, skipped } = await api<{ confirmed: string[]; skipped: string[] }>(fetch, '/staged-items/confirm', {
				method: 'POST',
				body: { ids: selected }
			});
			selected = [];
			message = {
				kind: 'info',
				text: `Confirmed ${confirmed.length}.${skipped.length ? ` ${skipped.length} need their name typed and were left for you to confirm one at a time.` : ''}`
			};
		});

	// every removal is confirmed first: one item, or every finished one
	let removing = $state<{ item: StagedItem } | { finished: number } | null>(null);
	// the person this item creates, when other places in the list share them (they're handed over)
	const sharedWith = $derived.by(() => {
		const id = removing && 'item' in removing ? removing.item.id : undefined;
		return id ? items.filter((other) => other.dependsOn === id && other.status !== 'created').length : 0;
	});

	function remove(item: StagedItem) {
		removing = { item };
		clearDialog?.showModal();
	}

	function askToClear() {
		removing = { finished: createdCount };
		clearDialog?.showModal();
	}

	function confirmRemoval(event: SubmitEvent) {
		event.preventDefault();
		const what = removing;
		clearDialog?.close();
		removing = null;
		if (what && 'item' in what) {
			run(() => api(fetch, `/staged-items/${what.item.id}`, { method: 'DELETE' }));
		} else if (what) {
			clearFinished();
		}
	}

	const clearFinished = () =>
		run(async () => {
			const { removed } = await api<{ removed: number }>(fetch, '/staged-items?status=created', { method: 'DELETE' });
			message = { kind: 'info', text: `Cleared ${removed} finished ${removed === 1 ? 'item' : 'items'}.` };
		});

	function downloadLogins() {
		const placeIds = items.filter((item) => item.status === 'created').map((item) => item.result?.placeId ?? item.request.placeId);
		const query = placeIds.length ? `?placeIds=${encodeURIComponent(placeIds.join(','))}` : '';
		window.location.href = `/api/v1/credentials/export${query}`;
	}

	// one upload's logins; the server finds its items, including any not paged in yet
	function downloadGroupLogins(group: Group) {
		const upload = group.key === UPLOADED_EARLIER ? UPLOADED_EARLIER : group.runId;
		if (upload) window.location.href = `/api/v1/credentials/export?upload=${encodeURIComponent(upload)}`;
	}

	async function showMore() {
		if (!moreCursor) {
			return;
		}
		loadingMore = true;
		try {
			const params = new URLSearchParams(page.url.searchParams);
			params.set('cursor', moreCursor);
			const next = await api<StagedList>(fetch, `/staged-items?${params}`);
			moreItems = [...moreItems, ...next.items];
			moreCursor = next.nextCursor;
		} catch (e) {
			message = { kind: 'error', text: e instanceof ApiRequestError ? e.message : "Couldn't load more items." };
		} finally {
			loadingMore = false;
		}
	}

	function toggle(id: string, on: boolean) {
		selected = on ? [...new Set([...selected, id])] : selected.filter((s) => s !== id);
	}
</script>

<svelte:head>
	<title>Staged list · CHT User Management</title>
</svelte:head>

<section class="page">
	<header class="page-head">
		<div>
			<h1>Staged list</h1>
			<p class="lead">Check everything once, then upload it to {data.session.instance.name}.</p>
		</div>
		<button class="btn btn-primary upload" type="button" onclick={() => upload()} disabled={busy || uploading || !readyCount}>
			{uploading ? 'Uploading…' : readyCount ? `Upload ${readyCount}` : 'Upload'}
		</button>
	</header>

	{#if uploading}
		<div class="progress" role="status" aria-live="polite">
			<div class="bar"><div class="fill" style="width: {list.upload.total ? (100 * list.upload.done) / list.upload.total : 0}%"></div></div>
			<span>Uploading {list.upload.done} of {list.upload.total}</span>
		</div>
	{/if}

	{#if validating}
		<div class="progress" role="status" aria-live="polite">
			<div class="bar"><div class="fill checking" style="width: {list.validation.total ? (100 * list.validation.done) / list.validation.total : 0}%"></div></div>
			<span>Checking rows: {list.validation.done} of {list.validation.total}</span>
		</div>
	{/if}

	{#if message}
		<p class="banner banner-{message.kind}" role={message.kind === 'error' ? 'alert' : 'status'}>
			{message.text}
			<button class="dismiss" type="button" aria-label="Dismiss" onclick={() => (message = null)}>×</button>
		</p>
	{/if}

	{#if totalItems === 0 && !filtered}
		<div class="empty">
			<h2>Nothing staged yet</h2>
			<p>
				Places and users you add from a form or a CSV file wait here for one last check. Nothing is written to CHT until you
				upload.
			</p>
			<p class="empty-actions">
				<a class="btn btn-primary" href="/create">Add one</a>
				<a class="btn btn-default" href="/create/csv">Import a CSV</a>
			</p>
		</div>
	{:else}
		<div class="toolbar">
			<div class="chips" role="group" aria-label="Filter by status">
				<button class="chip" type="button" aria-pressed={!data.filters.status} onclick={() => setFilter('status', '')}>
					All <span class="count">{totalItems}</span>
				</button>
				{#each statusChips as status (status)}
					<button class="chip chip-{status}" type="button" aria-pressed={data.filters.status === status} onclick={() => setFilter('status', status)}>
						{STATUS_LABELS[status as StagedStatus]} <span class="count">{counts[status] ?? 0}</span>
					</button>
				{/each}
			</div>
			<div class="filters">
				<label class="sr-only" for="kind">Kind</label>
				<select id="kind" value={data.filters.kind} onchange={(e) => setFilter('kind', (e.currentTarget as HTMLSelectElement).value)}>
					<option value="">All kinds</option>
					{#each Object.entries(KIND_LABELS) as [kind, label] (kind)}
						<option value={kind}>{label}</option>
					{/each}
				</select>
				<label class="sr-only" for="search">Search</label>
				<input
					id="search"
					type="search"
					placeholder="Search place or person"
					value={search}
					oninput={(e) => onSearch((e.currentTarget as HTMLInputElement).value)}
				/>
			</div>
		</div>

		{#if data.filters.file}
			<p class="file-filter">
				Showing rows from <strong>{data.filters.file}</strong>
				<button class="btn btn-link btn-small" type="button" onclick={() => setFilter('file', '')}>Show everything</button>
			</p>
		{/if}

		{#if selected.length || createdCount}
			<div class="bulk">
				{#if selected.length}
					<button class="btn btn-default btn-small" type="button" onclick={confirmSelected} disabled={busy}>Confirm selected ({selected.length})</button>
				{/if}
				{#if createdCount}
					<button class="btn btn-default btn-small" type="button" onclick={downloadLogins}>Download new logins</button>
					<button class="btn btn-default btn-small" type="button" onclick={askToClear} disabled={busy}>Clear finished ({createdCount})</button>
				{/if}
			</div>
		{/if}

		{#if items.length}
			<ol class="timeline">
				{#each groups as group (group.key)}
					{@const running = group.items.some((item) => item.status === 'uploading')}
					<li class="group" class:pending={group.key === NOT_UPLOADED} class:running>
						<div class="group-head">
							<span class="dot" aria-hidden="true"></span>
							{#if group.key === NOT_UPLOADED}
								<h2>Not uploaded yet</h2>
								<span class="group-meta">{group.items.length} {group.items.length === 1 ? 'item' : 'items'}</span>
							{:else}
								<h2>
									{#if group.key === UPLOADED_EARLIER}
										Uploaded earlier
									{:else}
										{running ? 'Uploading since' : 'Uploaded'} <time datetime={group.startedAt}>{uploadedAt(group.startedAt ?? '')}</time>
									{/if}
								</h2>
								<span class="group-meta">
									{group.items.filter((item) => item.status === 'created').length} created{#if running}, {group.items.filter((item) => item.status === 'uploading').length} still uploading{/if}
								</span>
								<!-- only when the upload made logins: a delete, for one, makes none -->
								{#if group.items.some((item) => item.status === 'created' && item.result?.username)}
									<button class="btn btn-default btn-small group-download" type="button" onclick={() => downloadGroupLogins(group)}>
										Download logins
									</button>
								{/if}
							{/if}
						</div>
						<ul class="items">
							{#each group.items as item (item.id)}
								<StagedItemRow
									{item}
									contactType={data.config.contactTypes.find((type) => type.name === item.request.contactType)}
									{busy}
									selected={selected.includes(item.id)}
									onselect={(on) => toggle(item.id, on)}
									onconfirm={confirm}
									onremove={remove}
									onretry={(failed) => upload([failed.id])}
								/>
							{/each}
						</ul>
					</li>
				{/each}
			</ol>
			<p class="footer">
				Showing {items.length} of {list.total}
				{#if moreCursor}
					<button class="btn btn-default btn-small" type="button" onclick={showMore} disabled={loadingMore}>
						{loadingMore ? 'Loading…' : 'Show more'}
					</button>
				{/if}
			</p>
		{:else}
			<div class="empty">
				<h2>No items match</h2>
				<p><button class="btn btn-default" type="button" onclick={() => goto('/')}>Clear filters</button></p>
			</div>
		{/if}
	{/if}
</section>

<dialog bind:this={dialog} class="confirm-dialog" aria-labelledby="confirm-title">
	{#if typedFor?.confirmation?.reason === 'typed_name'}
		<form method="dialog" onsubmit={confirmTyped}>
			<h2 id="confirm-title">Confirm {KIND_LABELS[typedFor.kind].toLowerCase()}</h2>
			<p>This can't be undone. Type <strong>{typedFor.confirmation.expected}</strong> to confirm.</p>
			<label class="sr-only" for="typed-name">Place name</label>
			<input id="typed-name" bind:value={typedName} autocomplete="off" />
			<div class="dialog-actions">
				<button class="btn btn-default" type="button" onclick={() => dialog?.close()}>Cancel</button>
				<button class="btn btn-primary" type="submit" disabled={typedName.trim() !== typedFor.confirmation.expected}>Confirm</button>
			</div>
		</form>
	{/if}
</dialog>

<dialog bind:this={clearDialog} class="confirm-dialog" aria-labelledby="clear-title" onclose={() => (removing = null)}>
	{#if removing}
		<form method="dialog" onsubmit={confirmRemoval}>
			{#if 'item' in removing}
				{@const done = removing.item.status === 'created'}
				<h2 id="clear-title">{done ? 'Clear' : 'Remove'} "{removing.item.summary.title}"?</h2>
				{#if done}
					<p>It's removed from your staged list. What it created stays in CHT. Download its login first if you still need it.</p>
				{:else}
					<p>It's removed from your staged list and won't be uploaded.</p>
					{#if sharedWith}
						<p>
							{removing.item.summary.person ?? 'Its person'} is kept for their other {sharedWith === 1 ? 'place' : `${sharedWith} places`},
							which will create them instead.
						</p>
					{/if}
				{/if}
				<div class="dialog-actions">
					<button class="btn btn-default" type="button" onclick={() => clearDialog?.close()}>Cancel</button>
					<button class="btn btn-primary" type="submit">{done ? 'Clear' : 'Remove'}</button>
				</div>
			{:else}
				<h2 id="clear-title">Clear {removing.finished === 1 ? 'the finished item' : `${removing.finished} finished items`}?</h2>
				<p>
					{removing.finished === 1 ? "It's" : "They're"} removed from your staged list. What {removing.finished === 1 ? 'it' : 'they'} created
					stays in CHT. Download {removing.finished === 1 ? 'its login' : 'their logins'} first if you still need them.
				</p>
				<div class="dialog-actions">
					<button class="btn btn-default" type="button" onclick={() => clearDialog?.close()}>Cancel</button>
					<button class="btn btn-primary" type="submit">Clear {removing.finished}</button>
				</div>
			{/if}
		</form>
	{/if}
</dialog>

<style>
	.page-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 16px;
	}

	h1 {
		margin: 0;
		font-size: 22px;
	}

	.lead {
		margin: 4px 0 0;
		color: var(--cht-text-muted);
	}

	.upload {
		padding: 8px 18px;
		font-size: 15px;
	}

	.progress {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 12px;
		color: var(--cht-text-muted);
		font-size: 13px;
	}

	.bar {
		flex: 1;
		height: 6px;
		border-radius: 3px;
		background: var(--cht-border);
		overflow: hidden;
	}

	.fill {
		height: 100%;
		background: var(--cht-blue);
		transition: width 0.3s;
	}

	.fill.checking {
		background: #8a6d3b;
	}

	.file-filter {
		margin: 0 0 10px;
		color: var(--cht-text-muted);
	}

	.empty-actions {
		display: flex;
		justify-content: center;
		gap: 8px;
		margin-top: 16px !important;
	}

	.banner {
		position: relative;
		margin: 0 0 12px;
		padding: 10px 40px 10px 14px;
		border-radius: var(--cht-radius);
		border: 1px solid;
	}

	.banner-error {
		color: #a94442;
		background: #f2dede;
		border-color: #ebccd1;
	}

	.banner-info {
		color: #31708f;
		background: #d9edf7;
		border-color: #bce8f1;
	}

	.dismiss {
		position: absolute;
		top: 4px;
		right: 8px;
		border: 0;
		background: none;
		color: inherit;
		font-size: 20px;
		cursor: pointer;
	}

	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		margin-bottom: 10px;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 4px 10px;
		border: 1px solid var(--cht-border);
		border-radius: 999px;
		background: var(--cht-surface);
		color: var(--cht-text);
		cursor: pointer;
		font-size: 13px;
	}

	.chip[aria-pressed='true'] {
		border-color: var(--cht-blue);
		background: #e5f2fa;
		color: var(--cht-blue);
	}

	.count {
		min-width: 18px;
		padding: 0 5px;
		border-radius: 999px;
		background: var(--cht-surface-muted);
		color: var(--cht-text-muted);
		font-size: 12px;
		text-align: center;
	}

	.chip-invalid .count,
	.chip-failed .count {
		background: #f2dede;
		color: #a94442;
	}

	.chip-needs_confirmation .count {
		background: #fcf8e3;
		color: #8a6d3b;
	}

	.filters {
		display: flex;
		gap: 8px;
	}

	.filters select,
	.filters input {
		padding: 5px 8px;
		border: 1px solid var(--cht-input-border);
		border-radius: var(--cht-radius);
		background: var(--cht-surface);
	}

	.filters input {
		width: 220px;
	}

	.bulk {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-bottom: 10px;
	}

	/* the timeline: a rail down the left, with a dot per group */
	.timeline {
		margin: 0;
		padding: 0 0 0 24px;
		list-style: none;
	}

	.group {
		position: relative;
		padding-bottom: 22px;
	}

	.group::before {
		content: '';
		position: absolute;
		top: 16px;
		bottom: -2px;
		left: -18px;
		width: 2px;
		background: var(--cht-border);
	}

	.group:last-child {
		padding-bottom: 12px;
	}

	.group:last-child::before {
		display: none;
	}

	.group-head {
		position: relative;
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 2px 10px;
		margin-bottom: 8px;
	}

	.group-head h2 {
		margin: 0;
		font-size: 14px;
		font-weight: 500;
	}

	.group-meta {
		color: var(--cht-text-muted);
		font-size: 13px;
	}

	.group-download {
		align-self: center;
		margin-left: auto;
	}

	.dot {
		position: absolute;
		top: 3px;
		left: -23px;
		width: 12px;
		height: 12px;
		box-sizing: border-box;
		border-radius: 50%;
		border: 2px solid #3c763d;
		background: #3c763d;
	}

	.pending .dot {
		border-color: var(--cht-blue);
		background: var(--cht-surface);
	}

	.running .dot {
		border-color: var(--cht-blue);
		background: var(--cht-blue);
		animation: pulse 1.4s ease-in-out infinite;
	}

	@keyframes pulse {
		50% {
			box-shadow: 0 0 0 5px rgb(0 114 188 / 18%);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.running .dot {
			animation: none;
		}
	}

	.items {
		margin: 0;
		padding: 0;
		list-style: none;
		border: 1px solid var(--cht-border);
		border-bottom: 0;
		border-radius: var(--cht-radius);
	}

	/* the corners are on the rows, not clipped, so a row's login pop-up can reach past the list */
	.items > :global(li:first-child) {
		border-top-left-radius: var(--cht-radius);
		border-top-right-radius: var(--cht-radius);
	}

	.items > :global(li:last-child) {
		border-bottom-left-radius: var(--cht-radius);
		border-bottom-right-radius: var(--cht-radius);
	}

	.footer {
		display: flex;
		align-items: center;
		gap: 12px;
		color: var(--cht-text-muted);
		font-size: 13px;
	}

	.empty {
		padding: 40px 24px;
		text-align: center;
		background: var(--cht-surface);
		border: 1px dashed var(--cht-border);
		border-radius: var(--cht-radius);
	}

	.empty h2 {
		margin: 0 0 8px;
		font-size: 18px;
	}

	.empty p {
		max-width: 460px;
		margin: 0 auto;
		color: var(--cht-text-muted);
	}

	.confirm-dialog {
		max-width: 420px;
		width: calc(100% - 32px);
		padding: 20px;
		border: 1px solid var(--cht-border);
		border-radius: var(--cht-radius);
	}

	.confirm-dialog::backdrop {
		background: rgba(0, 0, 0, 0.4);
	}

	.confirm-dialog h2 {
		margin: 0 0 8px;
		font-size: 18px;
	}

	.confirm-dialog input {
		width: 100%;
		padding: 6px 10px;
		border: 1px solid var(--cht-input-border);
		border-radius: var(--cht-radius);
	}

	.dialog-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 16px;
	}

	@media (max-width: 600px) {
		.page-head {
			flex-direction: column;
		}

		.upload {
			width: 100%;
		}

		.filters,
		.filters input {
			width: 100%;
		}
	}
</style>
