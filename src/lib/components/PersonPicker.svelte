<script lang="ts">
	import { untrack } from 'svelte';

	import { api, ApiRequestError, type PersonMatch, type PersonNotEligible } from '$lib/api';

	// Search for someone already here to take over a place (APP.md → Replacing in the UI, step 3).
	// People who can't take over are listed too, but can't be picked, with the reason.
	type Props = {
		id: string;
		label: string;
		type: string;
		selected: PersonMatch | null;
		// people who can't be picked here, eg. the outgoing person
		exclude?: string[];
		error?: string;
		disabled?: boolean;
		onselect: (person: PersonMatch | null) => void;
	};

	let { id, label, type, selected, exclude = [], error, disabled = false, onselect }: Props = $props();

	const REASONS: Record<PersonNotEligible, string> = {
		NO_ACCOUNT: 'No account',
		SEVERAL_ACCOUNTS: 'Several accounts',
		NO_ACTIVE_ACCOUNT: 'Account not active',
		MISSING_ROLE: 'Missing the role for this type'
	};

	let query = $state(untrack(() => selected?.name ?? ''));
	let results = $state<PersonMatch[]>([]);
	let open = $state(false);
	let active = $state(-1);
	let loading = $state(false);
	let searchError = $state<string | null>(null);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let requestNumber = 0;

	const listId = $derived(`${id}-results`);
	const shown = $derived(results.filter((person) => !exclude.includes(person.id)));
	const pickable = (person: PersonMatch) => person.eligible;

	async function search(text: string) {
		const mine = ++requestNumber;
		loading = true;
		searchError = null;
		try {
			const params = new URLSearchParams({ type, q: text, limit: '20' });
			const { people } = await api<{ people: PersonMatch[] }>(fetch, `/people/search?${params}`);
			if (mine === requestNumber) {
				results = people;
				active = shown.findIndex(pickable);
				open = true;
			}
		} catch (e) {
			if (mine === requestNumber) {
				searchError = e instanceof ApiRequestError ? e.message : "Couldn't search people.";
				open = true;
			}
		} finally {
			if (mine === requestNumber) loading = false;
		}
	}

	function onInput(text: string) {
		query = text;
		if (selected) onselect(null);
		clearTimeout(timer);
		timer = setTimeout(() => search(text.trim()), 250);
	}

	function choose(person: PersonMatch) {
		if (!pickable(person)) return;
		// a search still on its way would reopen the list over the pick
		clearTimeout(timer);
		requestNumber++;
		loading = false;
		onselect(person);
		query = person.name;
		open = false;
	}

	function step(direction: 1 | -1) {
		for (let next = active + direction; next >= 0 && next < shown.length; next += direction) {
			if (pickable(shown[next])) {
				active = next;
				return;
			}
		}
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			if (!open) search(query.trim());
			else step(1);
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			step(-1);
		} else if (event.key === 'Enter' && open && shown[active]) {
			event.preventDefault();
			choose(shown[active]);
		} else if (event.key === 'Escape') {
			open = false;
		}
	}

	const places = (person: PersonMatch) => person.account?.places.map((place) => place.name).join(', ');
</script>

<div class="picker">
	<label for={id}>{label}<span class="req" aria-hidden="true">*</span></label>
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
			placeholder="Type a name to search"
			{disabled}
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
				{:else if !shown.length}
					<li class="empty">No matching people</li>
				{/if}
				{#each shown as person, index (person.id)}
					<li
						id={`${listId}-${index}`}
						role="option"
						aria-selected={index === active}
						aria-disabled={!person.eligible}
						class:active={index === active}
						class:unavailable={!person.eligible}
						onmousedown={(e) => {
							e.preventDefault();
							choose(person);
						}}
					>
						<span class="name">
							{person.name}
							{#if !person.eligible && person.reason}<span class="reason">{REASONS[person.reason]}</span>{/if}
						</span>
						<span class="where">
							{[person.phone, person.account?.username, places(person)].filter(Boolean).join(' · ')}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
	{#if error}
		<p class="field-error" id={`${id}-error`}>{error}</p>
	{:else if selected}
		<p class="hint">{[selected.phone, selected.account?.username, places(selected)].filter(Boolean).join(' · ')}</p>
	{:else if query}
		<p class="hint">Pick a person from the list</p>
	{/if}
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
		max-height: 300px;
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

	.results li.unavailable {
		color: var(--cht-text-muted);
		cursor: not-allowed;
	}

	.results li.empty {
		color: var(--cht-text-muted);
		cursor: default;
	}

	.reason {
		margin-left: 6px;
		padding: 0 6px;
		border-radius: 999px;
		background: var(--cht-surface-muted);
		font-size: 12px;
	}

	.where,
	.hint {
		color: var(--cht-text-muted);
		font-size: 12px;
	}

	.hint {
		margin: 4px 0 0;
		font-size: 13px;
	}

	.field-error {
		margin: 4px 0 0;
		color: var(--cht-red);
		font-size: 13px;
	}
</style>
