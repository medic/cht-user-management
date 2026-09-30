<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	import { api } from '$lib/api';
	import Logo from '$lib/components/Logo.svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
	let signingOut = $state(false);

	// "Manage": the hierarchy operations (move and merge join delete here), then, after a divider, the
	// background jobs that run them
	const MANAGE = [
		{ href: '/move', label: 'Move' },
		{ href: '/merge', label: 'Merge' },
		{ href: '/delete', label: 'Delete' }
	];
	const JOBS = { href: '/jobs', label: 'Background jobs' };
	let manageOpen = $state(false);
	let manage: HTMLElement | undefined = $state();
	const managing = $derived([...MANAGE, JOBS].some((link) => page.url.pathname === link.href));

	// a pick, a click elsewhere or Escape closes it
	$effect(() => {
		void page.url.pathname;
		manageOpen = false;
	});

	async function signOut() {
		signingOut = true;
		// signed out either way: the token is revoked, or it was no longer valid
		await api(fetch, '/auth/logout', { method: 'POST' }).catch(() => undefined);
		await goto('/login', { invalidateAll: true, replaceState: true });
	}
</script>

<svelte:window
	onclick={(event) => manageOpen && manage && !manage.contains(event.target as Node) && (manageOpen = false)}
	onkeydown={(event) => event.key === 'Escape' && (manageOpen = false)}
/>

<div class="app">
	<header class="bar">
		<a class="title" href="/">
			<Logo size="small" />
			<span>User Management</span>
		</a>

		<nav class="nav" aria-label="Main">
			<a href="/create" aria-current={page.url.pathname === '/create' ? 'page' : undefined}>Add</a>
			<a href="/replace" aria-current={page.url.pathname === '/replace' ? 'page' : undefined}>Replace</a>
			<a href="/create/csv" aria-current={page.url.pathname === '/create/csv' ? 'page' : undefined}>Import CSV</a>
			<div class="menu" bind:this={manage}>
				<button
					type="button"
					class="menu-button"
					class:current={managing}
					aria-haspopup="true"
					aria-expanded={manageOpen}
					aria-controls="manage-menu"
					onclick={() => (manageOpen = !manageOpen)}
				>
					Manage <span class="caret" aria-hidden="true">▾</span>
				</button>
				{#if manageOpen}
					<div class="menu-list" id="manage-menu">
						{#each MANAGE as link (link.href)}
							<a href={link.href} aria-current={page.url.pathname === link.href ? 'page' : undefined}>{link.label}</a>
						{/each}
						<hr class="divider" />
						<a href={JOBS.href} aria-current={page.url.pathname === JOBS.href ? 'page' : undefined}>{JOBS.label}</a>
					</div>
				{/if}
			</div>
		</nav>

		<div class="account">
			<span class="who">
				<span class="username">{data.session.username}</span>
				<span class="instance">{data.session.instance.name}</span>
			</span>
			<button class="btn signout" type="button" onclick={signOut} disabled={signingOut}>
				{signingOut ? 'Logging out…' : 'Log out'}
			</button>
		</div>
	</header>

	<main class="content">
		{@render children()}
	</main>
</div>

<style>
	.app {
		min-height: 100%;
		display: flex;
		flex-direction: column;
	}

	/* CHT's dark top bar */
	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		min-height: 56px;
		padding: 0 16px;
		background: var(--cht-charcoal);
		color: var(--cht-text-on-dark);
	}

	.title {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		color: var(--cht-text-on-dark);
		text-decoration: none;
		font-size: 17px;
		white-space: nowrap;
	}

	.nav {
		display: flex;
		gap: 4px;
		margin-right: auto;
		margin-left: 24px;
	}

	.nav a {
		padding: 6px 12px;
		white-space: nowrap;
		border-radius: var(--cht-radius);
		color: var(--cht-text-on-dark-muted);
		text-decoration: none;
	}

	.nav a:hover {
		color: var(--cht-text-on-dark);
	}

	.nav a[aria-current='page'] {
		color: var(--cht-text-on-dark);
		background: var(--cht-charcoal-raised);
	}

	.menu {
		position: relative;
	}

	.menu-button {
		padding: 6px 12px;
		white-space: nowrap;
		border: 0;
		border-radius: var(--cht-radius);
		background: none;
		color: var(--cht-text-on-dark-muted);
		font: inherit;
		cursor: pointer;
	}

	.menu-button:hover,
	.menu-button[aria-expanded='true'] {
		color: var(--cht-text-on-dark);
	}

	.menu-button.current {
		color: var(--cht-text-on-dark);
		background: var(--cht-charcoal-raised);
	}

	.caret {
		font-size: 11px;
	}

	.menu-list {
		position: absolute;
		top: calc(100% + 6px);
		left: 0;
		z-index: 30;
		display: flex;
		flex-direction: column;
		min-width: 170px;
		padding: 4px 0;
		background: var(--cht-surface);
		border: 1px solid var(--cht-border);
		border-radius: var(--cht-radius);
		box-shadow: 0 4px 14px rgb(0 0 0 / 15%);
	}

	.divider {
		margin: 4px 0;
		border: 0;
		border-top: 1px solid var(--cht-border);
	}

	.nav .menu-list a {
		padding: 7px 14px;
		border-radius: 0;
		color: var(--cht-text);
	}

	.nav .menu-list a:hover {
		background: var(--cht-surface-muted);
		color: var(--cht-text);
	}

	.nav .menu-list a[aria-current='page'] {
		background: #e5f2fa;
		color: var(--cht-blue);
	}

	.account {
		display: flex;
		align-items: center;
		gap: 14px;
		min-width: 0;
	}

	.who {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		line-height: 1.25;
		min-width: 0;
	}

	.username,
	.instance {
		max-width: 40vw;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.instance {
		color: var(--cht-text-on-dark-muted);
		font-size: 12px;
	}

	.signout {
		color: var(--cht-text-on-dark);
		background: transparent;
		border-color: rgba(255, 255, 255, 0.35);
	}

	.signout:hover:not(:disabled) {
		background: var(--cht-charcoal-raised);
	}

	.content {
		flex: 1;
		width: 100%;
		max-width: 1100px;
		margin: 0 auto;
		padding: 24px 16px;
	}

	/* beside the deployment's logo, the title only fits on wide screens */
	@media (max-width: 960px) {
		.title span {
			display: none;
		}
	}

	@media (max-width: 720px) {
		.bar {
			flex-wrap: wrap;
			padding-top: 8px;
			padding-bottom: 8px;
		}

		.nav {
			order: 3;
			width: 100%;
			margin: 0;
		}

		.nav a,
		.menu-button {
			padding: 6px 8px;
		}
	}

	/* the smallest phones: shorten the account so it stays beside the logo */
	@media (max-width: 380px) {
		.username,
		.instance {
			max-width: 26vw;
		}
	}
</style>
