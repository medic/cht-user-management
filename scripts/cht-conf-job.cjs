// Runs one cht-conf action for a hierarchy job (APP.md → Hierarchy management → Running the job).
// Started by the app in the job's own working directory, one process per action, since cht-conf keeps
// its settings in module state that can only be set once per process.
//
// Reads its settings as JSON from standard input, so the CHT session never appears on the command
// line where other processes could read it:
//   { "action": "delete-contacts" | "move-contacts" | "merge-contacts" | "upload-docs", "apiUrl": "https://host/medic",
//     "sessionToken": "<AuthSession value>", "args": ["--contacts=…", …] }
'use strict';

const chunks = [];
process.stdin.on('data', (chunk) => chunks.push(chunk));
process.stdin.on('end', async () => {
	let input;
	try {
		input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
	} catch {
		console.error('cht-conf-job: expected JSON settings on standard input');
		process.exit(2);
	}

	const actions = {
		'delete-contacts': 'cht-conf/src/fn/delete-contacts',
		'move-contacts': 'cht-conf/src/fn/move-contacts',
		'merge-contacts': 'cht-conf/src/fn/merge-contacts',
		'upload-docs': 'cht-conf/src/fn/upload-docs'
	};
	if (!actions[input.action]) {
		console.error(`cht-conf-job: unknown action "${input.action}"`);
		process.exit(2);
	}

	try {
		// cht-conf logs every staged file at trace level; its summaries and progress are at info
		const log = require('cht-conf/src/lib/log');
		log.level = log.LEVEL_INFO;
		const environment = require('cht-conf/src/lib/environment');
		// pathToProject, isArchiveMode, archiveDestination, extraArgs, apiUrl, force (no prompts),
		// skipTranslationCheck, skipValidate, sessionToken
		environment.initialize(process.cwd(), false, undefined, input.args ?? [], input.apiUrl, true, true, true, input.sessionToken);
		await require('cht-conf/src/lib/api')().available();
		await require(actions[input.action]).execute();
		process.exit(0);
	} catch (e) {
		console.error(e && e.stack ? e.stack : String(e));
		process.exit(1);
	}
});
