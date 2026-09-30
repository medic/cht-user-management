<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	import { api, ApiRequestError, isSignedOut, signInUrl, type PersonMatch, type PlaceDetail, type PlaceSummary, type ReplacePreview } from '$lib/api';
	import { hasMultipleRoles, type ContactProperty, type ContactType, type HierarchyConstraint } from '$lib/config-types';
	import type { StagedItem } from '$lib/staged';
	import { buildProperties, resolveRoles, type PropertyInput } from '$lib/validation';
	import { formatValue } from '$lib/validation/validators';
	import PersonPicker from './PersonPicker.svelte';
	import PlacePicker from './PlacePicker.svelte';
	import PropertyField from './PropertyField.svelte';

	// APP.md → Replacing in the UI: one form for every handover
	type Props = {
		contactType: ContactType;
		configVersion: string;
		// editing a staged replace item
		item?: StagedItem | null;
		// the item's place, and its incoming existing person, loaded by the page
		place?: PlaceDetail | null;
		existingPerson?: PersonMatch | null;
	};

	let { contactType, configVersion, item = null, place = null, existingPerson = null }: Props = $props();

	const start = untrack(() => ({ contactType, item, place, existingPerson }));
	const editing = !!start.item;
	const levels: HierarchyConstraint[] = [...start.contactType.hierarchy].sort((a, b) => b.level - a.level);
	const levelOne = levels.find((level) => level.level === 1)!;
	const multipleRoles = hasMultipleRoles(start.contactType);
	const canShare = !!start.contactType.can_assign_multiple;
	const sent = !!start.item?.upload || start.item?.status === 'failed';

	// ---- 1. the place being replaced
	let picked = $state<Record<string, PlaceSummary | null>>(initialPicks());
	let target = $state<PlaceSummary | null>(start.place ? { id: start.place.id, name: start.place.name, type: start.place.type, lineage: start.place.lineage } : null);
	let current = $state<PlaceDetail | null>(start.place);
	let loadingPlace = $state(false);
	let placeError = $state<string | null>(null);

	function initialPicks(): Record<string, PlaceSummary | null> {
		const picks: Record<string, PlaceSummary | null> = {};
		const lineage = start.place?.lineage ?? [];
		for (const level of levels) {
			const ancestor = lineage[level.level - 1];
			picks[level.property_name] = ancestor
				? { id: ancestor.id, name: ancestor.name, type: level.contact_type, lineage: lineage.slice(level.level) }
				: null;
		}
		return picks;
	}

	function pickLevel(level: HierarchyConstraint, chosen: PlaceSummary | null) {
		picked[level.property_name] = chosen;
		for (const other of levels) {
			if (other.level < level.level) {
				picked[other.property_name] = null;
			} else if (other.level > level.level && chosen) {
				const ancestor = chosen.lineage[other.level - level.level - 1];
				if (ancestor && !picked[other.property_name]) {
					picked[other.property_name] = { id: ancestor.id, name: ancestor.name, type: other.contact_type, lineage: chosen.lineage.slice(other.level - level.level) };
				}
			}
		}
		if (level.level === 1 && target && target.lineage[0]?.id !== chosen?.id) pickTarget(null);
	}

	async function pickTarget(chosen: PlaceSummary | null) {
		target = chosen;
		current = null;
		placeError = null;
		placeValues = {};
		scope = 'all';
		if (!chosen) return;
		// fill in the levels above from where the place sits
		for (const level of levels) {
			const ancestor = chosen.lineage[level.level - 1];
			if (ancestor) picked[level.property_name] = { id: ancestor.id, name: ancestor.name, type: level.contact_type, lineage: chosen.lineage.slice(level.level) };
		}
		loadingPlace = true;
		try {
			const detail = await api<PlaceDetail>(fetch, `/places/${encodeURIComponent(chosen.id)}`);
			if (target?.id === chosen.id) current = detail;
		} catch (e) {
			if (isSignedOut(e)) return goto(signInUrl(page.url));
			placeError = e instanceof ApiRequestError ? e.message : "Couldn't load the place.";
		} finally {
			loadingPlace = false;
		}
	}

	// the outgoing person's other places, from their accounts
	const otherPlaces = $derived.by(() => {
		if (!current) return [];
		const seen = new Map<string, string>();
		for (const account of current.accounts) for (const p of account.places) if (p.id !== current.id) seen.set(p.id, p.name);
		return [...seen].map(([id, name]) => ({ id, name }));
	});

	// ---- 2. who takes over
	const newContactId = untrack(() => (start.item?.request.contact?.properties ? start.item.request.contact.id : crypto.randomUUID()));
	let who = $state<'new' | 'existing'>(start.item && !start.item.request.contact?.properties ? 'existing' : 'new');
	let person = $state<PersonMatch | null>(start.existingPerson);
	let contactValues = $state<PropertyInput>({ ...(start.item?.request.contact?.properties ?? {}) });
	let roles = $state<string[]>([...(start.item?.request.user?.roles ?? [])]);
	const whoLocked = sent;

	// ---- 3. what they take over
	let scope = $state<'all' | 'place'>(start.item?.request.scope ?? 'all');

	// ---- 4. place details: pre-filled, optional, and only the changed ones sent
	let placeValues = $state<PropertyInput>({ ...(start.item?.request.place ?? {}) });
	const originalValue = (name: string) => current?.properties[name] ?? '';
	const shownValue = (name: string) => placeValues[name] ?? originalValue(name);
	const changedPlace = $derived(
		Object.fromEntries(Object.entries(placeValues).filter(([name, value]) => value !== originalValue(name)))
	);

	let touched = $state<Record<string, boolean>>({});
	let submitAttempted = $state(false);
	// a CSV row's errors from the background checks, until the fields they're about change
	let serverErrors = $state<Record<string, string>>(start.item?.status === 'invalid' ? { ...(start.item.errors ?? {}) } : {});
	let submitting = $state(false);
	let banner = $state<{ kind: 'success' | 'error' | 'info'; text: string; reload?: boolean } | null>(null);

	const nonEmpty = (values: PropertyInput): PropertyInput =>
		Object.fromEntries(Object.entries(values).filter(([, v]) => (Array.isArray(v) ? v.length > 0 : v !== '' && v !== undefined)));

	const lineage = $derived({
		...Object.fromEntries(levels.filter((l) => picked[l.property_name]).map((l) => [l.property_name, formatValue(l, picked[l.property_name]!.name)])),
		...(current ? { replacement: formatValue(contactType.replacement_property, current.name) } : {})
	});
	// exactly the server's rules (the shared validation module)
	const built = $derived(
		buildProperties({
			contactType,
			mode: 'replace',
			place: changedPlace,
			contact: who === 'new' ? nonEmpty(contactValues) : undefined,
			existingPlace: current?.properties,
			existingContact: who === 'existing' && person ? { name: person.name, phone: person.phone } : undefined,
			lineage
		})
	);
	const rolesResult = $derived(who === 'new' ? resolveRoles(contactType, multipleRoles ? roles : undefined) : { roles: [] });
	const errors = $derived.by(() => {
		const all: Record<string, string> = { ...built.errors };
		if (!target) all['place'] = `Pick the ${contactType.friendly.toLowerCase()} being replaced`;
		if (who === 'existing' && !person) all['contact.id'] = 'Pick who takes over';
		if ('error' in rolesResult && rolesResult.error) all['user.roles'] = rolesResult.error;
		return all;
	});
	const remaining = $derived(Object.keys(errors).length + Object.keys(serverErrors).length);

	function shown(path: string): string | undefined {
		return serverErrors[path] ?? (touched[path] || submitAttempted ? errors[path] : undefined);
	}

	const request = $derived({
		contactType: contactType.name,
		placeId: target?.id,
		contact: who === 'new' ? { id: newContactId, properties: nonEmpty(contactValues) } : { id: person?.id },
		...(canShare && otherPlaces.length ? { scope } : {}),
		...(Object.keys(changedPlace).length ? { place: changedPlace } : {}),
		...(who === 'new' && multipleRoles ? { user: { roles } } : {})
	});

	// ---- 5. what will happen: the server's own checks and effects, before anything is added
	let preview = $state<ReplacePreview | null>(null);
	let previewError = $state<string | null>(null);
	let previewing = $state(false);
	let lastPreviewKey = '';
	$effect(() => {
		const ready = !Object.keys(errors).length && current;
		const key = ready ? JSON.stringify(request) : '';
		if (key === lastPreviewKey) return;
		lastPreviewKey = key;
		preview = null;
		previewError = null;
		if (!key) {
			previewing = false;
			return;
		}
		previewing = true;
		const body = { kind: 'replace', request: JSON.parse(key) };
		const timer = setTimeout(async () => {
			try {
				const result = await api<ReplacePreview>(fetch, '/preview', { method: 'POST', body });
				if (key === lastPreviewKey) {
					preview = result;
					// the server's own checks now pass, so a CSV row's earlier errors are fixed
					serverErrors = {};
				}
			} catch (e) {
				if (key !== lastPreviewKey) return;
				if (isSignedOut(e)) return goto(signInUrl(page.url));
				previewError = e instanceof ApiRequestError ? e.message : "Couldn't work out what this would do.";
			} finally {
				if (key === lastPreviewKey) previewing = false;
			}
		}, 350);
		return () => clearTimeout(timer);
	});

	const canAdd = $derived(!remaining && !!preview && !previewError && !previewing && !submitting);
	const list = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

	// ---- adding or saving

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		submitAttempted = true;
		banner = null;
		if (remaining || !preview) {
			await tick();
			document.querySelector<HTMLElement>('[aria-invalid="true"], .field-error')?.focus();
			return;
		}
		submitting = true;
		try {
			if (item) {
				await api(fetch, `/staged-items/${item.id}`, { method: 'PATCH', body: { revision: item.revision, request }, configVersion });
			} else {
				await api(fetch, '/staged-items', { method: 'POST', body: { kind: 'replace', request }, configVersion });
			}
			await goto('/', { invalidateAll: true });
		} catch (e) {
			if (isSignedOut(e)) return goto(signInUrl(page.url));
			if (e instanceof ApiRequestError && e.code === 'VALIDATION_FAILED') {
				serverErrors = (e.details ?? {}) as Record<string, string>;
				console.error('server validation disagreed with the form', e.details);
				banner = { kind: 'error', text: "The server found problems the form didn't catch. They're shown below; please also report this." };
			} else if (e instanceof ApiRequestError && (e.code === 'CONFIG_CHANGED' || e.code === 'REVISION_MISMATCH')) {
				banner = { kind: 'error', text: e.message, reload: true };
			} else {
				banner = { kind: 'error', text: e instanceof ApiRequestError ? e.message : 'Something went wrong. Try again.' };
			}
		} finally {
			submitting = false;
		}
	}

	const fieldId = (path: string) => `r-${path.replace('.', '-')}`;
	const inputs = (properties: ContactProperty[]) => properties.filter((p) => p.type !== 'generated');
	const generated = (properties: ContactProperty[]) => properties.filter((p) => p.type === 'generated');
	const levelAbove = (level: HierarchyConstraint) => levels.find((other) => other.level === level.level + 1);
	const personLabel = start.contactType.contact_friendly ?? 'Person';
</script>

<form class="replace-form" onsubmit={submit} novalidate>
	{#if banner}
		<div class="banner banner-{banner.kind}" role={banner.kind === 'error' ? 'alert' : 'status'}>
			<span>{banner.text}</span>
			{#if banner.reload}<button class="btn btn-default btn-small" type="button" onclick={() => location.reload()}>Reload</button>{/if}
		</div>
	{/if}

	<section class="card">
		<h2>Which {contactType.friendly.toLowerCase()}</h2>
		{#each levels as level (level.property_name)}
			{@const above = levelAbove(level)}
			<PlacePicker
				id={fieldId(`hierarchy.${level.property_name}`)}
				label={level.friendly_name}
				type={level.contact_type}
				parentId={above ? picked[above.property_name]?.id : undefined}
				selected={picked[level.property_name]}
				initialQuery={start.item?.raw?.[level.friendly_name] ?? ''}
				error={shown(`hierarchy.${level.property_name}`)}
				disabled={submitting || sent}
				onselect={(chosen) => pickLevel(level, chosen)}
			/>
		{/each}
		<PlacePicker
			id={fieldId('place')}
			label={contactType.replacement_property.friendly_name}
			type={contactType.name}
			parentId={picked[levelOne.property_name]?.id}
			selected={target}
			initialQuery={start.item?.raw?.[contactType.replacement_property.friendly_name] ?? ''}
			required
			error={shown('place') ?? shown('replacement')}
			disabled={submitting || sent}
			onselect={pickTarget}
		/>

		{#if loadingPlace}
			<p class="note">Loading who's there now…</p>
		{:else if placeError}
			<p class="field-error">{placeError}</p>
		{:else if current}
			<div class="now" aria-live="polite">
				<h3>There now</h3>
				{#if current.primaryContact}
					<p>
						<strong>{current.primaryContact.name}</strong>{#if current.primaryContact.phone}, {current.primaryContact.phone}{/if}
					</p>
					{#if current.accounts.length}
						<p class="muted">
							{current.accounts.length === 1 ? 'Account' : 'Accounts'}:
							{#each current.accounts as account, index (account.username)}
								{index ? ', ' : ''}<code>{account.username}</code>{#if !account.active} (not active){/if}
							{/each}
						</p>
					{:else}
						<p class="muted">No account.</p>
					{/if}
					{#if otherPlaces.length}
						<p class="muted">Also serves {list(otherPlaces.map((p) => p.name))}.</p>
					{/if}
				{:else}
					<p class="muted">No primary contact.</p>
				{/if}
			</div>
		{/if}
	</section>

	{#if current}
		<section class="card">
			<h2>Who takes over</h2>
			{#if canShare}
				<div class="choice" role="radiogroup" aria-label="Who takes over">
					<label class:chosen={who === 'new'}>
						<input type="radio" name="who" value="new" bind:group={who} disabled={submitting || whoLocked} />
						<span><strong>A new {personLabel.toLowerCase()}</strong><span class="muted">Created with their own new login</span></span>
					</label>
					<label class:chosen={who === 'existing'}>
						<input type="radio" name="who" value="existing" bind:group={who} disabled={submitting || whoLocked} />
						<span><strong>Someone already here</strong><span class="muted">Keeps their login, which gains the places</span></span>
					</label>
				</div>
				{#if whoLocked}<p class="note">This item has been sent, so who takes over can't change.</p>{/if}
			{/if}

			{#if who === 'existing'}
				<PersonPicker
					id={fieldId('contact.id')}
					label={personLabel}
					type={contactType.name}
					selected={person}
					exclude={current.primaryContact ? [current.primaryContact.id] : []}
					error={shown('contact.id')}
					disabled={submitting || whoLocked}
					onselect={(chosen) => {
						person = chosen;
						touched['contact.id'] = true;
					}}
				/>
			{:else}
				{#each inputs(contactType.contact_properties) as property (property.property_name)}
					<PropertyField
						id={fieldId(`contact.${property.property_name}`)}
						{property}
						value={contactValues[property.property_name] ?? ''}
						error={shown(`contact.${property.property_name}`)}
						disabled={submitting}
						onchange={(value) => {
							delete serverErrors[`contact.${property.property_name}`];
							contactValues[property.property_name] = value;
						}}
						onblur={() => (touched[`contact.${property.property_name}`] = true)}
					/>
				{/each}
				{#if multipleRoles}
					<fieldset class="roles" id={fieldId('user.roles')}>
						<legend>Roles<span class="req" aria-hidden="true">*</span></legend>
						{#each contactType.user_role as role (role)}
							<label class="check">
								<input
									type="checkbox"
									checked={roles.includes(role)}
									disabled={submitting}
									onchange={(e) => {
										roles = (e.currentTarget as HTMLInputElement).checked ? [...roles, role] : roles.filter((r) => r !== role);
										touched['user.roles'] = true;
									}}
								/>
								{role.replace(/_/g, ' ')}
							</label>
						{/each}
						{#if shown('user.roles')}<p class="field-error">{shown('user.roles')}</p>{/if}
					</fieldset>
				{/if}
			{/if}
		</section>

		{#if canShare && otherPlaces.length}
			<section class="card">
				<h2>What they take over</h2>
				<div class="choice" role="radiogroup" aria-label="What they take over">
					<label class:chosen={scope === 'all'}>
						<input type="radio" name="scope" value="all" bind:group={scope} disabled={submitting} />
						<span>
							<strong>All {otherPlaces.length + 1} places</strong>
							<span class="muted">{list([current.name, ...otherPlaces.map((p) => p.name)])}</span>
						</span>
					</label>
					<label class:chosen={scope === 'place'}>
						<input type="radio" name="scope" value="place" bind:group={scope} disabled={submitting} />
						<span>
							<strong>Just {current.name}</strong>
							<span class="muted">{current.primaryContact?.name ?? 'The current person'} keeps {list(otherPlaces.map((p) => p.name))}</span>
						</span>
					</label>
				</div>
			</section>
		{/if}

		<section class="card">
			<h2>{contactType.friendly} details</h2>
			<p class="note">Optional: change anything that should change with the handover.</p>
			{#each inputs(contactType.place_properties) as property (property.property_name)}
				<PropertyField
					id={fieldId(`place.${property.property_name}`)}
					{property}
					value={shownValue(property.property_name)}
					error={shown(`place.${property.property_name}`)}
					disabled={submitting}
					onchange={(value) => {
						delete serverErrors[`place.${property.property_name}`];
						placeValues[property.property_name] = value;
					}}
					onblur={() => (touched[`place.${property.property_name}`] = true)}
				/>
			{/each}
			{#each generated(contactType.place_properties) as property (property.property_name)}
				{@const before = current.properties[property.property_name] ?? ''}
				{@const after = built.place[property.property_name] ?? before}
				<div class="generated">
					<span class="label">{property.friendly_name}</span>
					<span class="value">
						{#if after !== before}{before || '—'} <span aria-hidden="true">→</span><span class="sr-only">becomes</span> <strong>{after}</strong>{:else}{before || '—'}{/if}
					</span>
					<span class="note">Filled in automatically</span>
				</div>
			{/each}
		</section>

		<section class="card impact" aria-live="polite">
			<h2>What will happen</h2>
			{#if previewing}
				<p class="muted">Working it out…</p>
			{:else if previewError}
				<p class="field-error" tabindex="-1">{previewError}</p>
			{:else if preview}
				{@const outgoing = preview.outgoing?.name ?? 'The current person'}
				<ul>
					<li>
						<strong>{preview.incoming.name || 'The new person'}</strong> takes over {list(preview.placesHandedOver.map((p) => p.name))}{#if preview.incoming.kind === 'existing'}, added to their login <code>{preview.incoming.username}</code>{:else}, with a new login{/if}.
					</li>
					{#each preview.retiredAccounts as account (account.username)}
						<li>{outgoing}'s account <code>{account.username}</code> will be {account.action === 'disable' ? 'disabled' : 'deactivated'}.</li>
					{/each}
					{#each preview.keptAccounts as account (account.username)}
						<li>{outgoing}'s account <code>{account.username}</code> keeps its other places.</li>
					{/each}
					{#if preview.keptAccounts.length}
						<!-- CHT doesn't remove data a device already has when an account loses a place (APP.md → Replace → Known issues) -->
						<li class="warn">
							A phone that has already synced {list(preview.placesHandedOver.map((p) => p.name))} may still show
							{preview.placesHandedOver.length === 1 ? 'it' : 'them'}, as {preview.placesHandedOver.length === 1 ? 'it was' : 'they were'} before
							the handover, until the CHT app's data on that phone is cleared.
						</li>
					{/if}
					{#if preview.placesKept.length}
						<li>{outgoing} keeps {list(preview.placesKept.map((p) => p.name))}.</li>
					{/if}
					{#if preview.outgoingPerson === 'keep' && !preview.placesKept.length}
						<li>{outgoing}'s record stays under {current.name}, with their reports.</li>
					{/if}
					{#each Object.entries(preview.generated) as [path, change] (path)}
						<li>{path.split('.')[1] === 'name' ? 'The name' : path} changes from {change.from} to <strong>{change.to}</strong>.</li>
					{/each}
				</ul>
			{:else}
				<p class="muted">Shown once the form is complete.</p>
			{/if}
		</section>
	{/if}

	<div class="actions">
		<a class="btn btn-default" href="/">Cancel</a>
		<button class="btn btn-primary" type="submit" disabled={!canAdd}>
			{#if submitting}{editing ? 'Saving…' : 'Adding…'}{:else if previewing}Checking…{:else}{editing ? 'Save changes' : 'Add to staged list'}{/if}
		</button>
	</div>
	<p class="summary-note" aria-live="polite">
		{#if remaining}
			{remaining} {remaining === 1 ? 'thing needs' : 'things need'} attention before this can be {editing ? 'saved' : 'added'}.
		{:else if previewError}
			This handover can't go ahead as it is.
		{/if}
	</p>
</form>

<style>
	.replace-form {
		max-width: 640px;
	}

	.card {
		margin-bottom: 16px;
		padding: 18px 20px 6px;
		background: var(--cht-surface);
		border: 1px solid var(--cht-border);
		border-radius: var(--cht-radius);
	}

	h2 {
		margin: 0 0 14px;
		font-size: 16px;
	}

	h3 {
		margin: 0 0 4px;
		font-size: 13px;
		font-weight: 500;
		color: var(--cht-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.now {
		margin: 0 0 14px;
		padding: 10px 14px;
		background: var(--cht-surface-muted);
		border-radius: var(--cht-radius);
	}

	.now p {
		margin: 2px 0;
	}

	.muted,
	.note {
		color: var(--cht-text-muted);
		font-size: 13px;
	}

	.note {
		margin: -6px 0 12px;
	}

	.choice {
		display: grid;
		gap: 8px;
		margin-bottom: 14px;
	}

	.choice label {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		padding: 10px 12px;
		border: 1px solid var(--cht-border);
		border-radius: var(--cht-radius);
		cursor: pointer;
	}

	.choice label.chosen {
		border-color: var(--cht-blue);
		background: #f5fafd;
	}

	.choice label > span {
		display: flex;
		flex-direction: column;
	}

	.choice input {
		margin-top: 3px;
	}

	.roles {
		margin: 0 0 10px;
		padding: 0;
		border: 0;
	}

	.roles legend {
		margin-bottom: 4px;
		font-weight: 500;
	}

	.check {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.req {
		margin-left: 2px;
		color: var(--cht-red);
	}

	.generated {
		display: grid;
		margin-bottom: 14px;
	}

	.generated .label {
		font-weight: 500;
	}

	.generated .value {
		padding: 7px 10px;
		border: 1px dashed var(--cht-border);
		border-radius: var(--cht-radius);
		background: var(--cht-surface-muted);
	}

	.generated .note {
		margin: 2px 0 0;
	}

	.impact ul {
		margin: 0 0 12px;
		padding-left: 18px;
	}

	.impact li {
		margin-bottom: 4px;
	}

	.impact li.warn {
		color: #8a6d3b;
	}

	code {
		padding: 1px 5px;
		border-radius: 3px;
		background: var(--cht-surface-muted);
		font-size: 13px;
	}

	.field-error {
		color: var(--cht-red);
		font-size: 13px;
	}

	.summary-note {
		min-height: 1.4em;
		text-align: right;
		color: var(--cht-text-muted);
		font-size: 13px;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}

	.actions .btn-primary {
		padding: 8px 18px;
	}

	.banner {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
		margin-bottom: 16px;
		padding: 10px 14px;
		border: 1px solid;
		border-radius: var(--cht-radius);
	}

	.banner-error {
		color: #a94442;
		background: #f2dede;
		border-color: #ebccd1;
	}

	.banner-info,
	.banner-success {
		color: #31708f;
		background: #d9edf7;
		border-color: #bce8f1;
	}
</style>
