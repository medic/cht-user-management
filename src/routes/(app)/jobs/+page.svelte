<script lang="ts">
	import { goto, invalidate } from '$app/navigation';
	import { page } from '$app/state';

	import { api, ApiRequestError, isSignedOut, signInUrl, type JobView, type UndoPreview } from '$lib/api';
	import JobStatus from '$lib/components/JobStatus.svelte';
	import { contactUrl, JOB_KIND_LABELS, JOB_LABELS, MOVING_JOBS } from '$lib/staged';
	import type { PageProps } from './$types';

	// Your moves, merges and deletes, newest first (docs/frontend-contract.md → Jobs)
	let { data }: PageProps = $props();

	$effect(() => {
		if (!data.jobs.some((job) => MOVING_JOBS.includes(job.status))) return;
		const timer = setInterval(() => invalidate('app:jobs'), 3000);
		return () => clearInterval(timer);
	});

	// ---- undoing a delete, from its archive (APP.md → Undoing a delete)
	let dialog: HTMLDialogElement | undefined = $state();
	let undoing = $state<JobView | null>(null);
	let preview = $state<UndoPreview | null>(null);
	let previewError = $state<string | null>(null);
	let recreateLogins = $state(false);
	let busy = $state(false);

	const undoable = (job: JobView) =>
		job.kind === 'delete' && job.status === 'done' && !job.undoneBy && !!job.archive?.available && Date.parse(job.archive.expiresAt) > Date.now();
	const disabled = $derived(preview?.accounts.filter((a) => a.disabled) ?? []);
	const kept = $derived(preview?.accounts.filter((a) => !a.disabled) ?? []);

	async function askUndo(job: JobView) {
		undoing = job;
		preview = null;
		previewError = null;
		recreateLogins = false;
		dialog?.showModal();
		try {
			preview = await api<UndoPreview>(fetch, `/hierarchy-jobs/${encodeURIComponent(job.id)}/undo`);
		} catch (e) {
			if (isSignedOut(e)) return goto(signInUrl(page.url));
			previewError = e instanceof ApiRequestError ? e.message : "Couldn't work out what this would restore.";
		}
	}

	async function undo(event: SubmitEvent) {
		event.preventDefault();
		if (!undoing) return;
		busy = true;
		try {
			await api(fetch, `/hierarchy-jobs/${encodeURIComponent(undoing.id)}/undo`, { method: 'POST', body: { recreateLogins } });
			dialog?.close();
			await invalidate('app:jobs');
		} catch (e) {
			if (isSignedOut(e)) return goto(signInUrl(page.url));
			previewError = e instanceof ApiRequestError ? e.message : "Couldn't schedule the undo.";
		} finally {
			busy = false;
		}
	}

	const instanceUrl = $derived(page.data.session?.instance?.url as string | undefined);

	const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

	const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
</script>

<svelte:head>
	<title>Background jobs · CHT User Management</title>
</svelte:head>

<h1>Background jobs</h1>
<p class="lead">Moves, merges, deletes and undos run in the background, one at a time on each instance.</p>

{#if data.jobs.length}
	<ul class="jobs">
		{#each data.jobs as job (job.id)}
			<li>
				<div class="main">
					<div class="heading">
						<span class="kind">{JOB_KIND_LABELS[job.kind]}</span>
						<span class="title">{job.branch.placeName}</span>
					</div>
					<p class="meta">Scheduled {when(job.createdAt)}{#if job.attempts > 1}{' '}· {job.attempts} attempts{/if}</p>
					<JobStatus {job} log={false} onchange={() => invalidate('app:jobs')} />
				</div>
				<div class="side">
					<span class="status status-{job.status}">{JOB_LABELS[job.status]}</span>
					{#if job.finishedAt}
						<time class="finished" datetime={job.finishedAt}>{job.status === 'done' ? 'Completed' : 'Stopped'} {when(job.finishedAt)}</time>
					{/if}
					<!-- one line: the log, then undo at the far right -->
					<span class="links">
						{#if job.status !== 'queued'}
							<a class="log" href={`/api/v1/hierarchy-jobs/${encodeURIComponent(job.id)}/log`} target="_blank" rel="noopener">Log</a>
						{/if}
						{#if undoable(job)}
							<button class="undo" type="button" onclick={() => askUndo(job)} title="Undo this delete">Undo</button>
						{:else if job.undoneBy}
							<span class="finished">Undone</span>
						{/if}
					</span>
				</div>
			</li>
		{/each}
	</ul>
{:else}
	<p class="empty">No jobs yet. Deleting a place from the staged list schedules one.</p>
{/if}

<dialog bind:this={dialog} class="undo-dialog" aria-labelledby="undo-title" onclose={() => (undoing = null)}>
	{#if undoing}
		<form method="dialog" onsubmit={undo}>
			<h2 id="undo-title">Undo the delete of {undoing.branch.placeName}?</h2>
			{#if previewError}
				<p class="error" role="alert">{previewError}</p>
			{:else if !preview}
				<p class="muted">Reading the archive…</p>
			{:else}
				<p>
					Restores <strong>{plural(preview.counts.contacts, 'contact')}</strong> and <strong>{plural(preview.counts.reports, 'report')}</strong> from the
					archive, as they were, under {preview.parent?.name ?? 'the place above'}. It runs in the background.
				</p>
				{#if kept.length}
					<p>{plural(kept.length, 'account')} that kept a login get their places back: {kept.map((a) => a.username).join(', ')}.</p>
				{/if}
				{#if disabled.length}
					<div class="logins">
						<p>
							The delete disabled {plural(disabled.length, 'account')}, and CHT deleted their logins, passwords included:
							<span class="names">{disabled.map((a) => a.username).join(', ')}</span>.
						</p>
						<label class="check">
							<input type="checkbox" bind:checked={recreateLogins} disabled={busy} />
							Recreate their logins, with new passwords. CHT keeps the old usernames for the disabled accounts, so each gets a
							number added, eg. {disabled[0]?.username}12
						</label>
					</div>
				{/if}
			{/if}
			<div class="dialog-actions">
				<button class="btn btn-default" type="button" onclick={() => dialog?.close()}>Cancel</button>
				<button class="btn btn-primary" type="submit" disabled={!preview || busy}>{busy ? 'Scheduling…' : 'Undo delete'}</button>
			</div>
		</form>
	{/if}
</dialog>

<style>
	.external {
		margin-left: 3px;
		font-size: 0.85em;
		color: var(--cht-text-muted);
	}

	.links {
		display: flex;
		gap: 12px;
		line-height: 20px;
	}

	.undo {
		padding: 0;
		border: 0;
		background: none;
		color: var(--cht-blue);
		font-size: 13px;
		line-height: 20px;
		cursor: pointer;
	}

	/* reads as a link, like Log beside it */
	.undo {
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.undo-dialog {
		max-width: 520px;
		padding: 20px 22px;
		border: 1px solid var(--cht-border);
		border-radius: var(--cht-radius);
	}

	.undo-dialog::backdrop {
		background: rgb(0 0 0 / 35%);
	}

	.undo-dialog h2 {
		margin: 0 0 12px;
		font-size: 17px;
	}

	.logins {
		padding: 10px 12px;
		background: #fcf8e3;
		border-radius: var(--cht-radius);
	}

	.logins p {
		margin: 0 0 8px;
	}

	.names {
		font-family: monospace;
		font-size: 13px;
	}

	.check {
		display: flex;
		gap: 8px;
		align-items: flex-start;
	}

	.check input {
		margin-top: 3px;
	}

	.error {
		color: #a94442;
	}

	.muted {
		color: var(--cht-text-muted);
	}

	.dialog-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 16px;
	}

	h1 {
		margin: 0 0 4px;
		font-size: 22px;
	}

	.lead,
	.empty,
	.meta {
		color: var(--cht-text-muted);
	}

	.lead {
		margin: 0 0 20px;
	}

	.jobs {
		margin: 0;
		padding: 0;
		list-style: none;
		border: 1px solid var(--cht-border);
		border-radius: var(--cht-radius);
		background: var(--cht-surface);
	}

	/* the job on the left; its badge, and when it finished, on the right */
	.jobs li {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 12px;
		padding: 14px 16px;
		border-bottom: 1px solid var(--cht-border);
	}

	.jobs li:last-child {
		border-bottom: 0;
	}

	.heading {
		display: flex;
		align-items: baseline;
		gap: 8px;
	}

	.title {
		font-weight: 500;
	}

	.kind {
		padding: 1px 6px;
		border: 1px solid var(--cht-border);
		border-radius: 3px;
		font-size: 11px;
		text-transform: uppercase;
		color: var(--cht-text-muted);
	}

	/* the badge, with when the job finished under it */
	.side {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 4px;
	}

	/* one even gap between every line of a job, on both sides */
	.main {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}

	.side {
		line-height: 20px;
	}

	.main > :global(*) {
		min-height: 20px;
		line-height: 20px;
	}

	/* the links read as text here, so they don't make their line taller */
	.main :global(.job .btn-link) {
		padding: 0;
		line-height: 20px;
	}

	.log {
		font-size: 13px;
	}

	.finished {
		color: var(--cht-text-muted);
		font-size: 12px;
		white-space: nowrap;
	}

	.status {
		padding: 2px 9px;
		border-radius: 999px;
		font-size: 12px;
		color: var(--cht-blue);
		background: #e5f2fa;
	}

	.status-done {
		color: #3c763d;
		background: #dff0d8;
	}

	.status-failed,
	.status-needs_sign_in {
		color: #a94442;
		background: #f2dede;
	}

	.meta {
		margin: 0;
		font-size: 13px;
	}
</style>
