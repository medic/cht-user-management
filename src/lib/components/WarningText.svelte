<script lang="ts">
  import { page } from '$app/state';

  import { asWarning, contactUrl, type StagedWarning } from '$lib/staged';

  // A warning, with a link per existing place it's about, opening that place in the CHT app in
  // another tab
  let { warning }: { warning: StagedWarning | string } = $props();

  const shown = $derived(asWarning(warning));
  const instanceUrl = $derived(page.data.session?.instance?.url as string | undefined);
</script>

<span>{shown.message}</span>
{#if shown.placeIds?.length}
  {#each shown.placeIds as id, index (id)}
    {#if instanceUrl}
      <a class="open" href={contactUrl(instanceUrl, id)} target="_blank" rel="noopener noreferrer" title="Open in CHT">
        {shown.placeIds.length > 1 ? `Open ${index + 1}` : 'Open'}<span aria-hidden="true"> ↗</span><span class="sr-only">
          in CHT, in a new tab</span
        >
      </a>
    {:else}
      <code>{id}</code>
    {/if}
  {/each}
{/if}

<style>
  .open {
    margin-left: 6px;
    white-space: nowrap;
    color: var(--cht-blue);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  code {
    margin-left: 6px;
    font-size: 12px;
  }
</style>
