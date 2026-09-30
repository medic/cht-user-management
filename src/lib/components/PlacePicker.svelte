<script lang="ts">
	import { untrack } from 'svelte';

	import { api, ApiRequestError, type PlaceSummary } from '$lib/api';

	type Props = {
		id: string;
		label: string;
		type: string;
		parentId?: string;
		// the field above, named when this type has too many places to search without it
		parentLabel?: string;
		// wait for the field above, whatever the type's size
		requireParent?: boolean;
		selected: PlaceSummary | null;
		// text to start with, eg. a place name from a CSV row that didn't resolve
		initialQuery?: string;
		required?: boolean;
		error?: string;
		disabled?: boolean;
		// places that can't be picked here: these, and anything under them
		exclude?: string[];
		onselect: (place: PlaceSummary | null) => void;
	};

	let { id, label, type, parentId, parentLabel, requireParent = false, selected, initialQuery = '', required = false, error, disabled = false, exclude = [], onselect }: Props = $props();

	// starts with the picked place or the starting text, so it's there in the server-rendered page too
	let query = $state(untrack(() => selected?.name ?? initialQuery));
	let results = $state<PlaceSummary[]>([]);
	let open = $state(false);
	let active = $state(-1);
	let loading = $state(false);
	let searchError = $state<string | null>(null);
	// the server said this type can only be searched under a parent: wait for one
	let needsParent = $state(false);
	const waiting = $derived((needsParent || requireParent) && !parentId);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let requestNumber = 0;

	// follows picks made elsewhere, eg. a level filled in from a lower level's pick, or cleared because
	// the level above changed. Typing clears the pick too, but keeps what was typed
	let lastSelectedId = untrack(() => selected?.id);
	let clearedByTyping = false;
	$effect(() => {
		if (selected?.id !== lastSelectedId) {
			const hadPick = !!lastSelectedId;
			lastSelectedId = selected?.id;
			if (selected) query = selected.name;
			else if (hadPick && !clearedByTyping) query = '';
			clearedByTyping = false;
		}
	});

	const listId = $derived(`${id}-results`);
	const path = (place: PlaceSummary) =>
		place.lineage
			.map((ancestor) => ancestor.name)
			.reverse()
			.join(' › ');

	async function search(text: string) {
		const mine = ++requestNumber;
		loading = true;
		searchError = null;
		try {
			const params = new URLSearchParams({ type, q: text, limit: '20' });
			if (parentId) params.set('parentId', parentId);
			const { places } = await api<{ places: PlaceSummary[] }>(fetch, `/places/search?${params}`);
			if (mine === requestNumber) {
				results = places.filter((place) => !exclude.includes(place.id) && !place.lineage.some((ancestor) => exclude.includes(ancestor.id)));
				active = results.length ? 0 : -1;
				open = true;
			}
		} catch (e) {
			if (mine === requestNumber && e instanceof ApiRequestError && e.code === 'PARENT_REQUIRED' && !parentId) {
				needsParent = true;
				open = false;
			} else if (mine === requestNumber) {
				searchError = e instanceof ApiRequestError ? e.message : "Couldn't search places.";
				open = true;
			}
		} finally {
			if (mine === requestNumber) loading = false;
		}
	}

	function onInput(text: string) {
		query = text;
		// typing again means the earlier pick no longer stands
		if (selected) {
			clearedByTyping = true;
			onselect(null);
		}
		clearTimeout(timer);
		timer = setTimeout(() => search(text.trim()), 250);
	}

	function choose(place: PlaceSummary) {
		// a search still on its way would reopen the list over the pick
		clearTimeout(timer);
		requestNumber++;
		loading = false;
		onselect(place);
		query = place.name;
		open = false;
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			if (!open) search(query.trim());
			else active = Math.min(active + 1, results.length - 1);
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			active = Math.max(active - 1, 0);
		} else if (event.key === 'Enter' && open && results[active]) {
			event.preventDefault();
			choose(results[active]);
		} else if (event.key === 'Escape') {
			open = false;
		}
	}
</script>

<div class="picker">
	<label for={id}>{label}{#if required}<span class="req" aria-hidden="true">*</span>{/if}</label>
	<div class="control">
		<input
			{id}
			type="text"
			role="combobox"
			autocomplete="off"
			aria-autocomplete="list"
			aria-expanded={open}
			aria-controls={listId}
			aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
			aria-invalid={error ? 'true' : undefined}
			aria-describedby={error ? `${id}-error` : undefined}
			class:picked={!!selected}
			value={query}
			placeholder={waiting ? `Choose ${parentLabel ?? 'the place above'} first` : 'Type to search'}
			disabled={disabled || waiting}
			oninput={(e) => onInput((e.currentTarget as HTMLInputElement).value)}
			onfocus={() => !selected && search(query.trim())}
			onblur={() => setTimeout(() => (open = false), 150)}
			onkeydown={onKeydown}
		/>
		{#if selected}<span class="tick" aria-label="Picked">✓</span>{:else if loading}<span class="spin" aria-hidden="true"></span>{/if}

		{#if open}
			<ul class="results" id={listId} role="listbox">
				{#if searchError}
					<li class="empty">{searchError}</li>
				{:else if !results.length}
					<li class="empty">No matching places{parentId ? ' under the place above' : ''}</li>
				{/if}
				{#each results as place, index (place.id)}
					<li
						id={`${listId}-${index}`}
						role="option"
						aria-selected={index === active}
						class:active={index === active}
						onmousedown={(e) => {
							e.preventDefault();
							choose(place);
						}}
					>
						<span class="name">{place.name}</span>
						{#if place.lineage.length}<span class="where">{path(place)}</span>{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
	{#if error}<p class="field-error" id={`${id}-error`}>{error}</p>
	{:else if waiting && needsParent}<p class="hint">There are too many to search them all: choose {parentLabel ?? 'the place above'} first</p>
	{:else if !selected && query}<p class="hint">Pick a place from the list</p>{/if}
</div>

<style>
	.picker {
		margin-bottom: 14px;
	}

	label {
		display: block;
		margin-bottom: 4px;
		font-weight: 500;
	}

	.req {
		margin-left: 2px;
		color: var(--cht-red);
	}

	.control {
		position: relative;
	}

	input {
		width: 100%;
		padding: 7px 32px 7px 10px;
		border: 1px solid var(--cht-input-border);
		border-radius: var(--cht-radius);
		background: var(--cht-surface);
	}

	input.picked {
		border-color: #9ccbe6;
		background: #f5fafd;
	}

	input[aria-invalid='true'] {
		border-color: var(--cht-red);
	}

	.tick,
	.spin {
		position: absolute;
		top: 50%;
		right: 10px;
		transform: translateY(-50%);
		color: var(--cht-blue);
	}

	.spin {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		border: 2px solid var(--cht-border);
		border-left-color: var(--cht-blue);
		animation: cht-spin 1s infinite linear;
	}

	.results {
		position: absolute;
		z-index: 20;
		top: calc(100% + 2px);
		left: 0;
		right: 0;
		max-height: 280px;
		overflow-y: auto;
		margin: 0;
		padding: 4px 0;
		list-style: none;
		background: var(--cht-surface);
		border: 1px solid var(--cht-border);
		border-radius: var(--cht-radius);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
	}

	.results li {
		display: flex;
		flex-direction: column;
		padding: 6px 12px;
		cursor: pointer;
	}

	.results li.active {
		background: #e5f2fa;
	}

	.results li.empty {
		color: var(--cht-text-muted);
		cursor: default;
	}

	.where {
		color: var(--cht-text-muted);
		font-size: 12px;
	}

	.field-error {
		margin: 4px 0 0;
		color: var(--cht-red);
		font-size: 13px;
	}

	.hint {
		margin: 4px 0 0;
		color: var(--cht-text-muted);
		font-size: 13px;
	}
</style>
