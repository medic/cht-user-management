<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	import { api, ApiRequestError, isSignedOut, signInUrl, type JobView } from '$lib/api';
	import { contactUrl } from '$lib/staged';

	// A hierarchy job's status and what can be done about it (docs/frontend-contract.md → Jobs)
	// links: the archive download and the log, shown on the jobs page but not on staged items; log: false
	// when the page shows the log link somewhere else
	let {
		job,
		onchange,
		links = true,
		log = links
	}: { job: JobView; onchange?: () => void; links?: boolean; log?: boolean } = $props();

	let busy = $state(false);
	let error = $state<string | null>(null);

	const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
	const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
	const duration = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.round(ms / 60_000)} min`);
	const instanceUrl = $derived(page.data.session?.instance?.url as string | undefined);
	const percent = $derived(job.progress?.total ? Math.round((100 * job.progress.written) / job.progress.total) : 0);

	async function resume() {
		busy = true;
		error = null;
		try {
			await api(fetch, `/hierarchy-jobs/${encodeURIComponent(job.id)}/resume`, { method: 'POST' });
			onchange?.();
		} catch (e) {
			if (isSignedOut(e)) {
				// sign in again, and come back here to resume
				await goto(signInUrl(page.url));
				return;
			}
			error = e instanceof ApiRequestError ? e.message : "Couldn't resume the job.";
		} finally {
			busy = false;
		}
	}
</script>

<div class="job job-{job.status}">
	{#if job.status === 'queued'}
		<span>Waiting to run{#if job.position}, {ordinal(job.position)} in line{/if}.</span>
	{:else if job.status === 'postponed' && job.postponed}
		<span>
			{job.postponed.reason === 'sentinel_backlog'
				? `The instance is busy (${job.postponed.backlog?.toLocaleString()} changes waiting).`
				: "The instance can't be reached."}
			Checking again at {time(job.postponed.nextCheckAt)}.
		</span>
	{:else if job.status === 'needs_sign_in'}
		<span>Your session expired while this waited.</span>
		<button class="btn btn-primary btn-small" type="button" onclick={resume} disabled={busy}>Sign in and resume</button>
	{:else if job.status === 'running'}
		<span class="running">
			<span class="bar" aria-hidden="true"><span class="fill" style="width: {percent}%"></span></span>
			{job.progress?.total ? `${job.progress.written.toLocaleString()} of ${job.progress.total.toLocaleString()} docs` : 'Starting…'}
		</span>
	{:else if job.status === 'done' && job.result && job.kind === 'restore'}
		{@const logins = job.result.loginsRecreated ?? []}
		<span>
			Restored {job.result.contacts.toLocaleString()} contacts and {job.result.reports.toLocaleString()} reports{#if job.result.accountsRestored}; {job.result.accountsRestored} accounts got their places back{/if}{#if logins.length}; logins recreated for {logins.map((l) => (l.username === l.previousUsername ? l.username : `${l.previousUsername} (now ${l.username})`)).join(', ')}{/if}.
		</span>
		{#if links && logins.length}
			<span class="own-line">
				<a class="link" href={`/api/v1/credentials/export?job=${encodeURIComponent(job.id)}`} download>Download their logins</a>
			</span>
		{/if}
	{:else if job.status === 'done' && job.result && job.kind === 'merge'}
		<span>
			Merged{#if job.target}{' '}into {#if instanceUrl}<a class="link" href={contactUrl(instanceUrl, job.target.placeId)} target="_blank" rel="noopener noreferrer" title="Open in CHT"
						>{job.target.placeName}<span class="external" aria-hidden="true">↗</span><span class="sr-only"> (opens in CHT, in a new tab)</span></a
					>{:else}{job.target.placeName}{/if}{/if}: updated or deleted {job.result.contacts.toLocaleString()} contacts and {job.result.reports.toLocaleString()} reports in {duration(job.result.durationMs)}{#if job.result.usersDisabled || job.result.usersUpdated}; {job.result.usersDisabled} accounts disabled, {job.result.usersUpdated} updated{/if}.
		</span>
		{#if links && job.archive?.available}
			<span class="own-line">
				<a class="link" href={`/api/v1/hierarchy-jobs/${encodeURIComponent(job.id)}/archive`} download>Download the copy from before the merge</a>
			</span>
		{/if}
	{:else if job.status === 'done' && job.result && job.kind === 'move'}
		<span>
			{job.result.contacts || job.result.reports
				? `Updated ${job.result.contacts.toLocaleString()} contacts and ${job.result.reports.toLocaleString()} reports in ${duration(job.result.durationMs)}.`
				: 'Already where it should be; nothing needed updating.'}
		</span>
	{:else if job.status === 'done' && job.result}
		<span>
			Deleted {job.result.contacts.toLocaleString()} contacts and {job.result.reports.toLocaleString()} reports in {duration(job.result.durationMs)}{#if job.result.usersDisabled || job.result.usersUpdated}; {job.result.usersDisabled} accounts disabled, {job.result.usersUpdated} updated{/if}.
		</span>
		{#if links && job.archive?.available}
			<span class="own-line">
				<a class="link" href={`/api/v1/hierarchy-jobs/${encodeURIComponent(job.id)}/archive`} download>Download what was deleted</a>
			</span>
		{/if}
	{:else if job.status === 'failed'}
		<span class="failed">{job.error?.message ?? 'The job failed.'} Retrying is safe.</span>
		<button class="btn btn-primary btn-small" type="button" onclick={resume} disabled={busy}>Retry</button>
	{/if}
	{#if log && job.status !== 'queued'}
		<a class="link" href={`/api/v1/hierarchy-jobs/${encodeURIComponent(job.id)}/log`} target="_blank" rel="noopener">Log</a>
	{/if}
	{#if error}<span class="failed">{error}</span>{/if}
</div>

<style>
	.job {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		/* the same gap between lines as the rest of a job */
		gap: 4px 12px;
		font-size: 13px;
		color: var(--cht-text-muted);
	}

	/* every link reads as one: blue and underlined */
	.link {
		color: var(--cht-blue);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.link:hover {
		color: var(--cht-blue-dark, #005a94);
	}

	.external {
		margin-left: 3px;
		font-size: 0.85em;
		color: var(--cht-text-muted);
	}

	/* a download under the summary, on a line of its own */
	.own-line {
		flex-basis: 100%;
	}

	.failed {
		color: #a94442;
	}

	.running {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}

	.bar {
		display: inline-block;
		width: 140px;
		height: 6px;
		border-radius: 3px;
		background: var(--cht-border);
		overflow: hidden;
	}

	.fill {
		display: block;
		height: 100%;
		background: var(--cht-blue);
	}
</style>
