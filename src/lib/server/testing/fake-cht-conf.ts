import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ChtConfRun, ChtConfRunner } from '../hierarchy/cht-conf';
import { ChtConfFailed } from '../hierarchy/cht-conf';
import type { FakeCht } from './fake-cht';

// For tests: behaves like cht-conf's delete-contacts and upload-docs --disable-users against a
// FakeCht, including where it writes its files. The real cht-conf is exercised against a real CHT.
export function fakeChtConf(cht: FakeCht, options: { fail?: 'delete-contacts' | 'upload-docs' } = {}): ChtConfRunner & { runs: ChtConfRun[] } {
	const runs: ChtConfRun[] = [];
	const runner = async (run: ChtConfRun) => {
		runs.push(run);
		const arg = (name: string) => run.args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
		if (options.fail === run.action) {
			run.onLine('Error: something went wrong');
			throw new ChtConfFailed(run.action, 'exited with 1');
		}
		const dir = arg('docDirectoryPath')!;

		if (run.action === 'delete-contacts') {
			mkdirSync(dir, { recursive: true });
			const id = arg('contacts')!;
			const disable = run.args.includes('--disable-users');
			const branch = await cht.docsAtDepth(id, Array.from({ length: 21 }, (_, d) => d));
			for (const doc of branch) {
				const isPlace = doc.type !== 'person' && doc.contact_type !== 'person';
				writeFileSync(join(dir, `${doc._id}.doc.json`), JSON.stringify({ _id: doc._id, _rev: doc._rev, _deleted: true, cht_disable_linked_users: disable && isPlace }));
				for (const report of cht.docs.values()) {
					if (report.type === 'data_record' && [report.patient_id, report.place_id, report.fields?.patient_id].includes(doc._id)) {
						writeFileSync(join(dir, `${report._id}.doc.json`), JSON.stringify({ _id: report._id, _rev: report._rev, _deleted: true }));
					}
				}
			}
			run.onLine(`Staged updates to delete '${id}'.`);
			return;
		}

		if (run.action === 'merge-contacts') {
			// like cht-conf with --merge-primary-contacts --disable-users: everything under the source moves
			// under the destination, the source (and its primary contact, when the destination has one) is
			// deleted, and reports about them are reassigned
			mkdirSync(dir, { recursive: true });
			const sourceId = arg('sources')!;
			const destination = cht.docs.get(arg('destination')!)!;
			const source = cht.docs.get(sourceId)!;
			const sourceContact = source.contact?._id;
			const destinationContact = destination.contact?._id;
			const above = [destination._id, ...idsOf(destination.parent)];
			const write = (doc: any) => writeFileSync(join(dir, `${doc._id}.doc.json`), JSON.stringify(doc));
			write({ _id: source._id, _rev: source._rev, _deleted: true, cht_disable_linked_users: true });
			for (const doc of await cht.docsAtDepth(sourceId, Array.from({ length: 20 }, (_, d) => d + 1))) {
				if (doc._id === sourceContact && destinationContact) {
					write({ _id: doc._id, _rev: doc._rev, _deleted: true, cht_disable_linked_users: false });
					continue;
				}
				const ids = idsOf(doc.parent);
				write({ ...doc, parent: nest([...ids.slice(0, ids.indexOf(sourceId)), ...above]) });
			}
			const reassign = new Map([[sourceId, destination._id], ...(sourceContact && destinationContact ? [[sourceContact, destinationContact] as [string, string]] : [])]);
			for (const report of cht.docs.values()) {
				if (report.type !== 'data_record') continue;
				const changed: Record<string, any> = { ...report, fields: { ...(report.fields ?? {}) } };
				let touched = false;
				for (const key of ['patient_id', 'patient_uuid', 'place_id', 'place_uuid']) {
					if (reassign.has(changed[key])) [changed[key], touched] = [reassign.get(changed[key]), true];
					if (reassign.has(changed.fields[key])) [changed.fields[key], touched] = [reassign.get(changed.fields[key]), true];
				}
				if (touched) write(changed);
			}
			run.onLine(`Staged updates to '${sourceId}'.`);
			return;
		}

		if (run.action === 'move-contacts') {
			// like cht-conf: every doc in the branch, with its lineage from the moved place up replaced
			mkdirSync(dir, { recursive: true });
			const id = arg('contacts')!;
			const parent = cht.docs.get(arg('parent')!)!;
			const above = [parent._id, ...idsOf(parent.parent)];
			for (const doc of await cht.docsAtDepth(id, Array.from({ length: 21 }, (_, d) => d))) {
				const ids = [doc._id, ...idsOf(doc.parent)];
				const kept = ids.slice(1, ids.indexOf(id) + 1);
				const moved = { ...doc, parent: nest(doc._id === id ? above : [...kept, ...above]) };
				if (JSON.stringify(moved.parent) !== JSON.stringify(doc.parent)) writeFileSync(join(dir, `${doc._id}.doc.json`), JSON.stringify(moved));
			}
			run.onLine(`Staged updates to '${id}'.`);
			return;
		}

		const stubs = readdirSync(dir).map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')));
		// cht-conf handles the accounts first, then writes the docs
		let disabled = 0;
		let updated = 0;
		const deletedPlaces = stubs.filter((doc) => doc.cht_disable_linked_users).map((doc) => doc._id);
		for (const user of cht.users.values()) {
			if (!user.place.some((id) => deletedPlaces.includes(id))) continue;
			user.place = user.place.filter((id) => !deletedPlaces.includes(id));
			if (user.place.length) updated++;
			else {
				user.inactive = true;
				disabled++;
			}
		}
		run.onLine(`${disabled} users disabled. ${updated} users updated.`);
		const ok: string[] = [];
		for (const stub of stubs) {
			// deletions, or docs written back, eg. a restore
			if (stub._deleted) cht.docs.delete(stub._id);
			else cht.docs.set(stub._id, { ...stub, _rev: `${Number(String(stub._rev ?? '0').split('-')[0]) + 1}-moved` });
			ok.push(stub._id);
			run.onLine(`${ok.length}/${stubs.length} docs`);
		}
		writeFileSync(join(run.workDir, `upload-docs.${Date.now()}.log.json`), JSON.stringify({ ok, failed: {} }));
	};
	return Object.assign(runner, { runs });
}

function idsOf(lineage: any): string[] {
	const ids: string[] = [];
	for (let at = lineage; at?._id; at = at.parent) ids.push(at._id);
	return ids;
}

function nest(ids: string[]): any {
	return ids.reduceRight<any>((parent, id) => ({ _id: id, ...(parent ? { parent } : {}) }), undefined);
}
