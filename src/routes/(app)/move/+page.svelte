<script lang="ts">
  import MoveForm from '$lib/components/MoveForm.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<svelte:head>
  <title>Move · CHT User Management</title>
</svelte:head>

{#if !data.contactType}
  <h1>Move</h1>
  <p class="lead">Moves a place to a new parent, with everything under it. It runs in the background once uploaded.</p>
  <ul class="types">
    {#each data.types as type (type.name)}
      <li>
        <a class="type" href={`/move?type=${encodeURIComponent(type.name)}`}><span class="name">{type.friendly}</span></a>
        <a class="csv" href={`/create/csv?type=${encodeURIComponent(type.name)}&kind=move`}>or import a CSV</a>
      </li>
    {/each}
  </ul>
{:else}
  <nav class="crumbs"><a href="/">Staged list</a> › Move</nav>
  <h1>Move a {data.contactType.friendly}</h1>
  <p class="lead">
    Added to your staged list, and scheduled when you upload. Nothing changes in CHT until then.
    <a href={`/create/csv?type=${encodeURIComponent(data.contactType.name)}&kind=move`}>Moving many? Import a CSV.</a>
  </p>
  {#key data.contactType.name}
    <MoveForm contactType={data.contactType} configVersion={data.config.configVersion} />
  {/key}
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
</style>
