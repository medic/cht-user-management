<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	import { api, ApiRequestError, isSignedOut, signInUrl, type MovePreview, type PlaceSummary } from '$lib/api';
	import type { ContactType, HierarchyConstraint } from '$lib/config-types';
	import PlacePicker from './PlacePicker.svelte';

	// APP.md → Moving places → Moving in the UI: find the place, find its new parent, see the impact,
	// confirm, and add it to the staged list
	let { contactType, configVersion }: { contactType: ContactType; configVersion: string } = $props();

	const start = untrack(() => ({ contactType }));
	const levels: HierarchyConstraint[] = [...start.contactType.hierarchy].sort((a, b) => b.level - a.level);
	const levelOne = levels.find((level) => level.level === 1)!;
	// where it goes: the levels above the new parent, top first, as the CSV's "New …" columns
	const destinationLevels = levels.filter((level) => level.level > 1);
	// made once, when the form opens: scheduling the same id again returns the same job
	const jobId = crypto.randomUUID();

	let picked = $state<Record<string, PlaceSummary | null>>(Object.fromEntries(levels.map((l) => [l.property_name, null])));
	let target = $state<PlaceSummary | null>(null);
	let destination = $state<Record<string, PlaceSummary | null>>(Object.fromEntries(destinationLevels.map((l) => [l.property_name, null])));
	let newParent = $state<PlaceSummary | null>(null);
	let preview = $state<MovePreview | null>(null);
	let previewError = $state<string | null>(null);
	let loading = $state(false);
	let acceptLarge = $state(false);
	let submitting = $state(false);
	let banner = $state<string | null>(null);

	function pickLevel(level: HierarchyConstraint, chosen: PlaceSummary | null) {
		picked[level.property_name] = chosen;
		for (const other of levels) {
			if (other.level < level.level) picked[other.property_name] = null;
			else if (other.level > level.level && chosen) {
				const ancestor = chosen.lineage[other.level - level.level - 1];
				if (ancestor && !picked[other.property_name]) {
					picked[other.property_name] = { id: ancestor.id, name: ancestor.name, type: other.contact_type, lineage: chosen.lineage.slice(other.level - level.level) };
				}
			}
		}
		if (level.level === 1 && target && target.lineage[0]?.id !== chosen?.id) pickTarget(null);
	}

	function pickTarget(chosen: PlaceSummary | null) {
		target = chosen;
		newParent = null;
		for (const level of destinationLevels) destination[level.property_name] = null;
		if (!chosen) return;
		for (const level of levels) {
			const ancestor = chosen.lineage[level.level - 1];
			const place = ancestor && { id: ancestor.id, name: ancestor.name, type: level.contact_type, lineage: chosen.lineage.slice(level.level) };
			if (place) picked[level.property_name] = place;
			// most moves stay close: the new parent starts out searched under the current one's parent
			if (place && level.level > 1) destination[level.property_name] = place;
		}
	}

	// picking a level clears everything below it: each field waits for the one directly above
	function pickDestination(level: HierarchyConstraint, chosen: PlaceSummary | null) {
		destination[level.property_name] = chosen;
		for (const other of destinationLevels) if (other.level < level.level) destination[other.property_name] = null;
		newParent = null;
	}

	// the impact, once both places are picked
	let lastKey = '';
	$effect(() => {
		const key = target && newParent ? `${target.id}|${newParent.id}` : '';
		if (key === lastKey) return;
		lastKey = key;
		preview = null;
		previewError = null;
		acceptLarge = false;
		if (!key) return;
		loading = true;
		const request = { jobId, contactType: contactType.name, placeId: target!.id, newParentId: newParent!.id };
		api<MovePreview>(fetch, '/preview', { method: 'POST', body: { kind: 'move', request } })
			.then((result) => {
				if (key === lastKey) preview = result;
			})
			.catch((e) => {
				if (isSignedOut(e)) return goto(signInUrl(page.url));
				if (key === lastKey) previewError = e instanceof ApiRequestError ? e.message : "Couldn't work out what this would move.";
			})
			.finally(() => {
				if (key === lastKey) loading = false;
			});
	});

	const canAdd = $derived(!!preview && (!preview.large || acceptLarge) && !submitting);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!canAdd || !target || !newParent) return;
		submitting = true;
		banner = null;
		try {
			await api(fetch, '/staged-items', {
				method: 'POST',
				body: { kind: 'move', request: { jobId, contactType: contactType.name, placeId: target.id, newParentId: newParent.id, acceptLarge } },
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
	const levelTwo = destinationLevels.find((level) => level.level === 2);
	// the current parent, the place itself and anything under it can't be the new parent
	const excluded = $derived(target ? [target.id, ...(target.lineage[0] ? [target.lineage[0].id] : [])] : []);
</script>

<form class="move-form" onsubmit={submit} novalidate>
	{#if banner}<div class="banner" role="alert">{banner}</div>{/if}

	<section class="card">
		<h2>Which {contactType.friendly.toLowerCase()}</h2>
		{#each levels as level (level.property_name)}
			{@const above = levelAbove(level)}
			<PlacePicker
				id={`m-${level.property_name}`}
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
			id="m-place"
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

	{#if target}
		<section class="card">
			<h2>Where it goes</h2>
			{#key target.id}
				{#each destinationLevels as level (level.property_name)}
					{@const above = levelAbove(level)}
					<PlacePicker
						id={`m-new-${level.property_name}`}
						label={level.friendly_name}
						type={level.contact_type}
						parentId={above ? destination[above.property_name]?.id : undefined}
						parentLabel={above?.friendly_name}
						requireParent={!!above}
						selected={destination[level.property_name]}
						exclude={[target.id]}
						disabled={submitting}
						onselect={(chosen) => pickDestination(level, chosen)}
					/>
				{/each}
				<PlacePicker
					id="m-parent"
					label={levelOne.friendly_name}
					type={levelOne.contact_type}
					parentId={levelTwo ? destination[levelTwo.property_name]?.id : undefined}
					parentLabel={levelTwo?.friendly_name}
					requireParent={!!levelTwo}
					selected={newParent}
					exclude={excluded}
					required
					disabled={submitting}
					onselect={(chosen) => (newParent = chosen)}
				/>
			{/key}
		</section>
	{/if}

	{#if loading}
		<p class="muted">Counting everything under it…</p>
	{:else if previewError}
		<p class="error" role="alert">{previewError}</p>
	{:else if preview}
		<section class="card impact" aria-live="polite">
			<h2>What will happen</h2>
			<p class="path"><span>{preview.from}</span> <span aria-hidden="true">→</span><span class="sr-only">moves to</span> <strong>{preview.to}</strong></p>
			{#if preview.alreadyThere}
				<p class="muted">It's already there. Running the move again finishes one that was interrupted, and changes nothing otherwise.</p>
			{/if}
			<p>
				<strong>{plural(preview.counts.places, 'place')}</strong> and <strong>{plural(preview.counts.people, 'person', 'people')}</strong> move, with
				their reports. Every account keeps its places. People who work above the old location stop seeing the moved data at their next sync;
				those above the new one start seeing it.
			</p>
			{#if preview.accounts.length}
				<h3>Accounts at {preview.place.name}, whose devices will re-sync</h3>
				<ul class="accounts">
					{#each preview.accounts as account (account.username)}
						<li><code>{account.username}</code> <span class="muted">last sync {lastSync(account.lastSync)}</span></li>
					{/each}
				</ul>
				{#if !preview.lastSyncKnown}<p class="muted">Only admins can see when accounts last synced.</p>{/if}
			{/if}
			{#if preview.large}
				<div class="large">
					<p>This is a large move. It runs in the background and may take hours.</p>
					<label class="check">
						<input type="checkbox" bind:checked={acceptLarge} disabled={submitting} />
						I understand this is a large move
					</label>
				</div>
			{/if}
		</section>
	{/if}

	<div class="actions">
		<a class="btn btn-default" href="/">Cancel</a>
		<button class="btn btn-primary" type="submit" disabled={!canAdd}>{submitting ? 'Adding…' : 'Add move to staged list'}</button>
	</div>
</form>

<style>
	.move-form {
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
		margin: 12px 0 6px;
		font-size: 14px;
	}

	.path {
		overflow-wrap: anywhere;
	}

	.muted {
		color: var(--cht-text-muted);
		font-size: 13px;
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

	.large {
		margin-bottom: 12px;
		padding: 10px 12px;
		color: #8a6d3b;
		background: #fcf8e3;
		border-radius: var(--cht-radius);
	}

	.large p {
		margin: 0 0 6px;
	}

	.check {
		display: flex;
		align-items: center;
		gap: 8px;
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
</style>
