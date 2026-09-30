<script lang="ts">
	import CreateForm from '$lib/components/CreateForm.svelte';
	import { allowsAction } from '$lib/config-types';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const lockedStatuses = ['uploading', 'created'];
	const locked = $derived(data.item && lockedStatuses.includes(data.item.status));
</script>

<svelte:head>
	<title>{data.mode === 'edit' ? 'Edit' : 'Add'} · CHT User Management</title>
</svelte:head>

{#if data.mode === 'choose'}
	<h1>Add</h1>
	<p class="lead">What are you adding? Each one creates the place, its person, and a login for them.</p>
	<ul class="types">
		{#each data.config.contactTypes.filter((type) => allowsAction(type, 'create')) as type (type.name)}
			<li>
				<a class="type" href={`/create?type=${encodeURIComponent(type.name)}`}>
					<span class="name">{type.friendly}</span>
					<span class="who">with a {type.contact_friendly ?? 'person'}</span>
				</a>
				<a class="csv" href={`/create/csv?type=${encodeURIComponent(type.name)}`}>or import a CSV</a>
			</li>
		{/each}
	</ul>
{:else if data.contactType}
	<nav class="crumbs"><a href="/">Staged list</a> › {data.mode === 'edit' ? 'Edit' : 'Add'}</nav>
	<h1>
		{#if data.mode === 'edit'}
			{data.item?.status === 'invalid' ? 'Fix' : 'Edit'} {data.item?.summary.title}
		{:else}
			Add a {data.contactType.friendly}
		{/if}
	</h1>
	{#if data.mode === 'create' && data.person}
		<p class="lead">Another place for {data.person.name ?? 'the same person'}, who keeps one login. Nothing is written to CHT until you upload.</p>
	{:else if data.mode === 'create'}
		<p class="lead">
			Checked as you fill it in, then added to your staged list. Nothing is written to CHT until you upload.
			<a href={`/create/csv?type=${encodeURIComponent(data.contactType.name)}`}>Adding many? Import a CSV.</a>
		</p>
	{:else if data.item?.source.type === 'csv'}
		<p class="lead">From {data.item.source.file}, row {data.item.source.row}.</p>
	{/if}

	{#if locked}
		<p class="banner">This item has already been {data.item?.status === 'created' ? 'uploaded' : 'sent'}, so it can't be changed. <a href="/">Back to the staged list</a></p>
	{:else}
		{#key data.item?.id ?? data.person?.contactId ?? data.contactType.name}
			<CreateForm
				contactType={data.contactType}
				configVersion={data.config.configVersion}
				item={data.item}
				parentPlace={data.parentPlace}
				person={data.person}
			/>
		{/key}
	{/if}
{/if}

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

	.types {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		/* every card in a row as tall as the tallest */
		align-items: stretch;
		gap: 12px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.types li {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.type {
		flex: 1;
		display: flex;
		flex-direction: column;
		padding: 16px 18px;
		background: var(--cht-surface);
		border: 1px solid var(--cht-border);
		border-radius: var(--cht-radius);
		color: var(--cht-text);
		text-decoration: none;
	}

	.type:hover {
		border-color: var(--cht-blue);
	}

	.name {
		font-size: 16px;
		font-weight: 500;
	}

	.who {
		color: var(--cht-text-muted);
		font-size: 13px;
	}

	.csv {
		padding-left: 2px;
		font-size: 13px;
	}

	.banner {
		padding: 10px 14px;
		color: #31708f;
		background: #d9edf7;
		border: 1px solid #bce8f1;
		border-radius: var(--cht-radius);
	}
</style>
