<script lang="ts">
	import ReplaceForm from '$lib/components/ReplaceForm.svelte';
	import { allowsAction } from '$lib/config-types';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const locked = $derived(data.item && ['uploading', 'created'].includes(data.item.status));
</script>

<svelte:head>
	<title>{data.mode === 'edit' ? 'Edit replace' : 'Replace'} · CHT User Management</title>
</svelte:head>

{#if data.mode === 'choose'}
	<h1>Replace</h1>
	<p class="lead">Someone else takes over a place that already exists. The place stays; who is behind it changes.</p>
	<ul class="types">
		{#each data.config.contactTypes.filter((type) => allowsAction(type, 'replace')) as type (type.name)}
			<li>
				<a class="type" href={`/replace?type=${encodeURIComponent(type.name)}`}>
					<span class="name">{type.friendly}</span>
					<span class="who">{type.can_assign_multiple ? `a new or existing ${(type.contact_friendly ?? 'person').toLowerCase()} takes over` : `a new ${(type.contact_friendly ?? 'person').toLowerCase()} takes over`}</span>
				</a>
				<a class="csv" href={`/create/csv?type=${encodeURIComponent(type.name)}&kind=replace`}>or import a CSV</a>
			</li>
		{/each}
	</ul>
{:else if data.contactType}
	<nav class="crumbs"><a href="/">Staged list</a> › Replace</nav>
	<h1>{data.mode === 'edit' ? `Edit the replace of ${data.item?.summary.title}` : `Replace a ${data.contactType.friendly}`}</h1>
	<p class="lead">
		Checked as you fill it in, then added to your staged list. Nothing changes in CHT until you upload.
		{#if data.mode !== 'edit'}
			<a href={`/create/csv?type=${encodeURIComponent(data.contactType.name)}&kind=replace`}>Replacing many? Import a CSV.</a>
		{/if}
	</p>

	{#if locked}
		<p class="banner">This item has already been {data.item?.status === 'created' ? 'uploaded' : 'sent'}, so it can't be changed. <a href="/">Back to the staged list</a></p>
	{:else}
		{#key data.item?.id ?? data.contactType.name}
			<ReplaceForm contactType={data.contactType} configVersion={data.config.configVersion} item={data.item} place={data.place} existingPerson={data.existingPerson} />
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

	.csv {
		padding-left: 2px;
		font-size: 13px;
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

	.banner {
		padding: 10px 14px;
		color: #31708f;
		background: #d9edf7;
		border: 1px solid #bce8f1;
		border-radius: var(--cht-radius);
	}
</style>
