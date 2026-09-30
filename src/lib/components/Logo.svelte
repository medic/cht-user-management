<script lang="ts">
  // The deployment's logo, on a light plate so dark artwork still shows on the charcoal bars. Without
  // one (the endpoint answers 404), the generic mark stands in.
  let { size }: { size: 'small' | 'large' } = $props();
  let missing = $state(false);
</script>

{#if missing}
  <svg class="mark {size}" viewBox="0 0 32 32" aria-hidden="true">
    <circle cx="16" cy="16" r="15" fill="currentColor" />
    <circle cx="16" cy="12" r="5" fill="#323232" />
    <path d="M6.5 25.5c1.8-4.4 5.3-6.7 9.5-6.7s7.7 2.3 9.5 6.7" fill="none" stroke="#323232" stroke-width="3" stroke-linecap="round" />
  </svg>
{:else}
  <span class="plate {size}">
    <img src="/api/v1/config/logo" alt="" onerror={() => (missing = true)} />
  </span>
{/if}

<style>
  .plate {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: #fff;
    border-radius: var(--cht-radius);
  }

  .plate img {
    display: block;
    width: auto;
    height: 100%;
    max-width: 100%;
    object-fit: contain;
  }

  .plate.small {
    height: 36px;
    max-width: 150px;
    padding: 3px 6px;
    box-sizing: border-box;
  }

  @media (max-width: 720px) {
    .plate.small {
      height: 32px;
      max-width: 110px;
    }
  }

  @media (max-width: 380px) {
    .plate.small {
      max-width: 96px;
    }
  }

  .plate.large {
    height: 88px;
    max-width: 100%;
    padding: 8px 12px;
    box-sizing: border-box;
  }

  .mark {
    color: var(--cht-text-on-dark);
  }

  .mark.small {
    width: 28px;
    height: 28px;
  }

  .mark.large {
    width: 56px;
    height: 56px;
  }
</style>
