<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { goto } from '$app/navigation';

  import { api, ApiRequestError } from '$lib/api';
  import Logo from '$lib/components/Logo.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const REMEMBERED_INSTANCE = 'cht-iam:instance';

  // starting values for the form, which the user then changes
  let instanceId = $state(untrack(() => data.instances[0]?.id ?? ''));
  let username = $state('');
  let password = $state('');
  let showPassword = $state(false);
  let submitting = $state(false);
  let error = $state<string | null>(untrack(() => data.loadError));
  let usernameInput: HTMLInputElement | undefined = $state();
  let passwordInput: HTMLInputElement | undefined = $state();

  const selectedInstance = $derived(data.instances.find((i) => i.id === instanceId));

  onMount(() => {
    try {
      const remembered = localStorage.getItem(REMEMBERED_INSTANCE);
      if (remembered && data.instances.some((i) => i.id === remembered)) {
        instanceId = remembered;
      }
    } catch {
      // storage can be unavailable (private mode, blocked site data); the first instance is fine
    }
    usernameInput?.focus();
  });

  async function signIn(event: SubmitEvent) {
    event.preventDefault();
    error = null;

    // checked here first, so only a complete form is ever sent
    if (!username.trim() || !password) {
      error = 'Enter your user name and password.';
      (username.trim() ? passwordInput : usernameInput)?.focus();
      return;
    }

    submitting = true;
    try {
      await api(fetch, '/auth/login', { method: 'POST', body: { instance: instanceId, username: username.trim(), password } });
      try {
        localStorage.setItem(REMEMBERED_INSTANCE, instanceId);
      } catch {
        // not remembering the instance is fine
      }
      await goto(data.next, { invalidateAll: true, replaceState: true });
    } catch (e) {
      submitting = false;
      error = e instanceof ApiRequestError ? e.message : 'Unexpected error logging in.';
      if (e instanceof ApiRequestError && e.code === 'INVALID_CREDENTIALS') {
        await tick();
        passwordInput?.select();
      }
    }
  }
</script>

<svelte:head>
  <title>Log in · CHT User Management</title>
</svelte:head>

<main class="login">
  <form onsubmit={signIn} novalidate aria-describedby={error ? 'login-error' : undefined}>
    <header class="brand">
      <Logo size="large" />
      <h1>User Management</h1>
      <p>for the Community Health Toolkit</p>
    </header>

    {#if data.instances.length > 1}
      <label for="instance">Instance</label>
      <select id="instance" bind:value={instanceId} disabled={submitting}>
        {#each data.instances as instance (instance.id)}
          <option value={instance.id}>{instance.name}</option>
        {/each}
      </select>
    {:else if selectedInstance}
      <p class="instance">Logging in to <strong>{selectedInstance.name}</strong></p>
    {/if}

    <label for="user">User name</label>
    <input
      id="user"
      bind:this={usernameInput}
      bind:value={username}
      autocomplete="username"
      autocapitalize="none"
      autocorrect="off"
      spellcheck="false"
      disabled={submitting}
    />

    <label for="password">Password</label>
    <div class="password">
      <input
        id="password"
        bind:this={passwordInput}
        bind:value={password}
        type={showPassword ? 'text' : 'password'}
        autocomplete="current-password"
        disabled={submitting}
      />
      <button
        type="button"
        class="toggle"
        aria-pressed={showPassword}
        aria-label={showPassword ? 'Hide password' : 'Show password'}
        title={showPassword ? 'Hide password' : 'Show password'}
        onclick={() => (showPassword = !showPassword)}
      >
        {#if showPassword}
          <svg viewBox="0 0 24 24" aria-hidden="true"
            ><path
              d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.1A10.6 10.6 0 0112 5c5 0 9 4.5 10 7-.4 1-1.3 2.4-2.6 3.7M6.6 6.6C4.4 8 2.8 10 2 12c1 2.5 5 7 10 7 1.8 0 3.4-.5 4.8-1.3"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            /></svg
          >
        {:else}
          <svg viewBox="0 0 24 24" aria-hidden="true"
            ><path
              d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12z"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linejoin="round"
            /><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8" /></svg
          >
        {/if}
      </button>
    </div>

    <p id="login-error" class="error" role="alert" aria-live="assertive">{error ?? ''}</p>

    <button class="btn login-btn" type="submit" disabled={submitting || !data.instances.length}>
      {submitting ? 'Logging in…' : 'Log in'}
    </button>
    {#if submitting}
      <div class="loader" aria-hidden="true"></div>
    {/if}
  </form>

  <p class="footnote">Use your account on the chosen CHT instance.</p>
</main>

<style>
  /* CHT's login page: charcoal, a single narrow column, labels above fields */
  .login {
    min-height: 100%;
    padding: 2em 16px;
    background: var(--cht-charcoal);
    color: var(--cht-text-on-dark);
    font-size: 1.2em;
  }

  form {
    width: 100%;
    max-width: 300px;
    margin: 0 auto;
  }

  .brand {
    margin: 30px 0 48px;
    text-align: center;
  }

  .brand h1 {
    margin: 0.4em 0 0.1em;
    color: var(--cht-text-on-dark);
    font-size: 1.6em;
    font-weight: 400;
  }

  .brand p {
    margin: 0;
    color: var(--cht-text-on-dark-muted);
    font-size: 0.75em;
  }

  label {
    display: block;
    margin-top: 1em;
  }

  input,
  select {
    display: block;
    width: 100%;
    margin: 0.3em 0 0.6em;
    padding: 6px 10px;
    border: 1px solid var(--cht-input-border);
    border-radius: var(--cht-radius);
    font-size: 1em;
    color: var(--cht-text);
    background: #fff;
  }

  input:disabled,
  select:disabled {
    background: #eee;
  }

  .instance {
    margin: 0 0 0.5em;
    color: var(--cht-text-on-dark-muted);
    font-size: 0.85em;
  }

  .instance strong {
    color: var(--cht-text-on-dark);
    font-weight: 500;
  }

  .password {
    position: relative;
  }

  .password input {
    padding-right: 44px;
  }

  .toggle {
    position: absolute;
    top: 0;
    right: 0;
    height: 100%;
    width: 44px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--cht-text-muted);
    cursor: pointer;
  }

  .toggle svg {
    width: 22px;
    height: 22px;
    vertical-align: middle;
  }

  .error {
    min-height: 1.4em;
    margin: 0.4em 0 0;
    color: var(--cht-login-red);
    font-size: 0.85em;
  }

  .login-btn {
    width: 100%;
    margin: 1.6em 0 0;
    font-size: 1em;
    color: #fff;
    background: var(--cht-login-blue);
    border-color: var(--cht-login-blue-border);
  }

  .login-btn:hover:not(:disabled) {
    background: #286090;
  }

  .footnote {
    max-width: 300px;
    margin: 3em auto 0;
    text-align: center;
    color: var(--cht-text-on-dark-muted);
    font-size: 0.7em;
  }
</style>
