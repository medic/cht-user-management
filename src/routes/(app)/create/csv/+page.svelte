<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	import { isSignedOut, ApiRequestError, signInUrl } from '$lib/api';
	import { allowsAction } from '$lib/config-types';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let typeName = $state(page.url.searchParams.get('type') ?? '');
	// adding new places, or replacing who is behind existing ones
	const asked = page.url.searchParams.get('kind');
	let kind = $state<'create' | 'replace' | 'move' | 'merge' | 'delete'>(
		asked === 'replace' || asked === 'move' || asked === 'merge' || asked === 'delete' ? asked : 'create'
	);
	let file = $state<File | null>(null);
	let uploading = $state(false);
	let error = $state<{ text: string; columns?: string[] } | null>(null);

	// only the types that allow the chosen kind; a type that doesn't gives way to the first that does
	const types = $derived(data.config.contactTypes.filter((type) => allowsAction(type, kind)));
	$effect(() => {
		if (types.length && !types.some((type) => type.name === typeName)) typeName = types[0].name;
	});

	const contactType = $derived(types.find((type) => type.name === typeName));

	async function upload(event: SubmitEvent) {
		event.preventDefault();
		if (!file || !contactType) return;
		error = null;
		uploading = true;
		try {
			const form = new FormData();
			form.set('file', file);
			form.set('kind', kind);
			form.set('contactType', contactType.name);
			const response = await fetch('/api/v1/staged-items/csv', {
				method: 'POST',
				body: form,
				headers: { 'X-Config-Version': data.config.configVersion }
			});
			const body = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new ApiRequestError(response.status, body.error?.code ?? 'UNKNOWN', body.error?.message ?? 'The upload failed.', body.error?.details);
			}
			// the rows are staged; the list shows them being checked
			await goto(`/?file=${encodeURIComponent(file.name)}`);
		} catch (e) {
			if (isSignedOut(e)) {
				await goto(signInUrl(page.url));
				return;
			}
			const columns = e instanceof ApiRequestError && e.code === 'MISSING_COLUMNS' ? (e.details?.columns as string[]) : undefined;
			error = { text: e instanceof ApiRequestError ? e.message : "Couldn't upload the file. Try again.", columns };
		} finally {
			uploading = false;
		}
	}
</script>

<svelte:head>
	<title>Import CSV · CHT User Management</title>
</svelte:head>

<nav class="crumbs"><a href="/">Staged list</a> › Import CSV</nav>
<h1>Import a CSV</h1>
<p class="lead">
	Every row becomes an item in your staged list. Rows are checked in the background, and any that need fixing open in the
	same form as a single entry. Nothing is written to CHT until you upload.
</p>

<form class="card" onsubmit={upload}>
	<fieldset class="kind">
		<legend>What the file does</legend>
		<label><input type="radio" name="kind" value="create" bind:group={kind} disabled={uploading} /> Adds new places, each with a person and a login</label>
		<label><input type="radio" name="kind" value="replace" bind:group={kind} disabled={uploading} /> Replaces who is behind existing places</label>
		<label><input type="radio" name="kind" value="move" bind:group={kind} disabled={uploading} /> Moves places to a new parent, with everything under them</label>
		<label><input type="radio" name="kind" value="merge" bind:group={kind} disabled={uploading} /> Merges places into others of the same type</label>
		<label><input type="radio" name="kind" value="delete" bind:group={kind} disabled={uploading} /> Deletes places, with everything under them</label>
	</fieldset>

	<label for="type">What's in the file</label>
	<select id="type" bind:value={typeName} disabled={uploading}>
		{#each types as type (type.name)}
			<option value={type.name}>{type.friendly}</option>
		{/each}
	</select>

	{#if contactType}
		<p class="template">
			Start from the template, which has one column per field:
			<a href={`/api/v1/config/contact-types/${encodeURIComponent(contactType.name)}/csv-template?kind=${kind}`} download>
				Download the {contactType.friendly} {kind === 'create' ? '' : `${kind} `}template
			</a>
		</p>
		{#if kind === 'move'}
			<p class="template">
				Each row names a {contactType.friendly} where it is now, and its new place in the columns starting "New". Large moves wait
				in your staged list until you confirm them.
			</p>
		{:else if kind === 'merge'}
			<p class="template">
				Each row names a {contactType.friendly} to merge away, and, in the columns starting "Into", the one it merges into. Rows wait in
				your staged list until you type each place's name to confirm it; they're never confirmed together.
			</p>
		{:else if kind === 'delete'}
			<p class="template">
				Each row names a {contactType.friendly} to delete, with everything under it. Rows wait in your staged list until you type
				each place's name to confirm it; they're never confirmed together.
			</p>
		{:else if kind === 'replace'}
			<p class="template">
				Each row names the {contactType.replacement_property.friendly_name} being replaced, and a new
				{contactType.contact_friendly?.toLowerCase() ?? 'person'} to take over.
				{#if contactType.can_assign_multiple}
					Or fill in <strong>Username</strong> instead, to hand over to someone already here. <strong>Scope</strong> is
					<code>all</code> (the default: all the outgoing person's places) or <code>place</code> (just this one).
				{/if}
			</p>
		{:else if contactType.can_assign_multiple}
			<p class="template">
				One {contactType.contact_friendly?.toLowerCase() ?? 'person'} can serve several places: rows whose
				{contactType.contact_friendly?.toLowerCase() ?? 'person'} fields are the same (ignoring case, spacing and how the phone is
				written) become one person with one login.
			</p>
		{/if}
	{/if}

	<label for="file">CSV file</label>
	<input
		id="file"
		type="file"
		accept=".csv,text/csv"
		disabled={uploading}
		onchange={(e) => {
			file = (e.currentTarget as HTMLInputElement).files?.[0] ?? null;
			error = null;
		}}
	/>

	{#if error}
		<div class="error" role="alert">
			<p>{error.text}</p>
			{#if error.columns?.length}
				<ul>{#each error.columns as column (column)}<li>{column}</li>{/each}</ul>
			{/if}
		</div>
	{/if}

	<div class="actions">
		<a class="btn btn-default" href="/">Cancel</a>
		<button class="btn btn-primary" type="submit" disabled={!file || !contactType || uploading}>
			{uploading ? 'Uploading…' : 'Add rows to the staged list'}
		</button>
	</div>
</form>

<style>
	h1 {
		margin: 0 0 4px;
		font-size: 22px;
	}

	.lead {
		max-width: 640px;
		margin: 0 0 20px;
		color: var(--cht-text-muted);
	}

	.crumbs {
		margin-bottom: 8px;
		color: var(--cht-text-muted);
		font-size: 13px;
	}

	.kind {
		margin: 0 0 14px;
		padding: 0;
		border: 0;
	}

	.kind legend {
		margin-bottom: 4px;
		font-weight: 500;
	}

	.kind label {
		display: flex;
		align-items: center;
		gap: 8px;
		font-weight: normal;
	}

	.card {
		max-width: 640px;
		padding: 18px 20px;
		background: var(--cht-surface);
		border: 1px solid var(--cht-border);
		border-radius: var(--cht-radius);
	}

	label {
		display: block;
		margin: 0 0 4px;
		font-weight: 500;
	}

	select,
	input[type='file'] {
		width: 100%;
		margin-bottom: 14px;
		padding: 7px 10px;
		border: 1px solid var(--cht-input-border);
		border-radius: var(--cht-radius);
		background: var(--cht-surface);
	}

	.template {
		margin: -4px 0 16px;
		color: var(--cht-text-muted);
	}

	.error {
		margin-bottom: 14px;
		padding: 10px 14px;
		color: #a94442;
		background: #f2dede;
		border: 1px solid #ebccd1;
		border-radius: var(--cht-radius);
	}

	.error p {
		margin: 0;
	}

	.error ul {
		margin: 6px 0 0;
		padding-left: 18px;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
</style>
