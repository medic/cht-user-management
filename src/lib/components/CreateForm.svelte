<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';

  import { api, ApiRequestError, isSignedOut, signInUrl, type PlaceSummary } from '$lib/api';
  import { hasMultipleRoles, type ContactProperty, type ContactType, type HierarchyConstraint } from '$lib/config-types';
  import { asWarning, type SharedPerson, type StagedItem, type StagedPersonMatch, type StagedWarning } from '$lib/staged';
  import { buildProperties, resolveRoles, type PropertyInput } from '$lib/validation';
  import { formatValue } from '$lib/validation/validators';
  import PlacePicker from './PlacePicker.svelte';
  import PropertyField from './PropertyField.svelte';
  import WarningText from './WarningText.svelte';

  type Props = {
    contactType: ContactType;
    configVersion: string;
    // editing or fixing a staged item, rather than adding a new one
    item?: StagedItem | null;
    // the item's parent, to pre-fill the hierarchy
    parentPlace?: PlaceSummary | null;
    // another place for a person who already has one (APP.md → One person, many places)
    person?: SharedPerson | null;
  };

  let { contactType, configVersion, item = null, parentPlace = null, person = null }: Props = $props();

  // the form's starting values come from the props once; the component is re-created for another item
  const start = untrack(() => ({ contactType, item, parentPlace, person }));
  const editing = !!start.item;
  const levels: HierarchyConstraint[] = [...start.contactType.hierarchy].sort((a, b) => b.level - a.level);
  const levelOne = levels.find((level) => level.level === 1)!;
  const multipleRoles = hasMultipleRoles(start.contactType);
  const canShare = !!start.contactType.can_assign_multiple;

  // ids are made once, when the form opens, and never change for this item (APP.md → Creating one user, step 3)
  let placeId = $state(start.item?.request.placeId ?? crypto.randomUUID());
  let contactId = $state(start.person?.contactId ?? start.item?.request.contact?.id ?? crypto.randomUUID());
  // set when the person is kept from another place: their section is shown, not sent
  let shared = $state<SharedPerson | null>(start.person);
  // the person just added, offered for the next place
  let lastPerson = $state<SharedPerson | null>(null);
  let picked = $state<Record<string, PlaceSummary | null>>(initialPicks());
  let placeValues = $state<PropertyInput>({ ...(start.item?.request.place ?? {}) });
  let contactValues = $state<PropertyInput>({ ...(start.item?.request.contact?.properties ?? {}) });
  let roles = $state<string[]>([...(start.item?.request.user?.roles ?? [])]);

  let touched = $state<Record<string, boolean>>({});
  let submitAttempted = $state(false);
  let serverErrors = $state<Record<string, string>>(start.item?.status === 'invalid' ? { ...(start.item.errors ?? {}) } : {});
  let duplicates = $state<StagedWarning[]>(
    start.item?.confirmation?.reason === 'duplicates' ? start.item.confirmation.warnings.map(asWarning) : []
  );
  let duplicatesAccepted = $state(Boolean(start.item?.request.ignoreWarnings));
  let checkingDuplicates = $state(false);
  let submitting = $state(false);
  let banner = $state<{ kind: 'success' | 'error' | 'info'; text: string; reload?: boolean } | null>(null);

  function initialPicks(): Record<string, PlaceSummary | null> {
    const picks: Record<string, PlaceSummary | null> = {};
    const parent = start.parentPlace;
    for (const level of levels) {
      if (!parent) {
        picks[level.property_name] = null;
      } else if (level.level === 1) {
        picks[level.property_name] = parent;
      } else {
        // a higher level is one of the parent's ancestors
        const ancestor = parent.lineage[level.level - 2];
        picks[level.property_name] = ancestor
          ? { id: ancestor.id, name: ancestor.name, type: level.contact_type, lineage: parent.lineage.slice(level.level - 1) }
          : null;
      }
    }
    return picks;
  }

  const nonEmpty = (values: PropertyInput): PropertyInput =>
    Object.fromEntries(Object.entries(values).filter(([, v]) => (Array.isArray(v) ? v.length > 0 : v !== '' && v !== undefined)));

  const parentId = $derived(picked[levelOne.property_name]?.id);
  const lineage = $derived(
    Object.fromEntries(
      levels
        .filter((level) => picked[level.property_name])
        .map((level) => [level.property_name, formatValue(level, picked[level.property_name]!.name)])
    )
  );
  // exactly the rules the server applies (the shared validation module)
  // a shared person's details aren't sent, so aren't checked here; their own item checks them
  const built = $derived(
    buildProperties({
      contactType,
      mode: 'create',
      place: nonEmpty(placeValues),
      contact: shared ? undefined : nonEmpty(contactValues),
      existingContact: shared?.properties,
      lineage
    })
  );
  const sentRoles = $derived(shared ? (shared.roles ?? []) : roles);
  const rolesResult = $derived(resolveRoles(contactType, multipleRoles ? sentRoles : undefined));
  const errors = $derived.by(() => {
    const all: Record<string, string> = { ...built.errors };
    for (const level of levels) {
      if (level.required && !picked[level.property_name]) {
        all[`hierarchy.${level.property_name}`] = 'Pick a place from the list';
      }
    }
    if (rolesResult.error) all['user.roles'] = rolesResult.error;
    return all;
  });
  const hasErrors = $derived(Object.keys(errors).length > 0);
  const remaining = $derived(Object.keys(errors).length + Object.keys(serverErrors).length);

  function shown(path: string): string | undefined {
    return serverErrors[path] ?? (touched[path] || submitAttempted ? errors[path] : undefined);
  }

  function setValue(section: 'place' | 'contact', name: string, value: string | string[]) {
    const path = `${section}.${name}`;
    delete serverErrors[path];
    if (section === 'place') placeValues[name] = value;
    else contactValues[name] = value;
  }

  function pick(level: HierarchyConstraint, place: PlaceSummary | null) {
    delete serverErrors[`hierarchy.${level.property_name}`];
    picked[level.property_name] = place;
    touched[`hierarchy.${level.property_name}`] = true;
    for (const other of levels) {
      if (other.level < level.level) {
        // the levels below were chosen under the old pick
        picked[other.property_name] = null;
      } else if (other.level > level.level && place) {
        // fill in the levels above from where the picked place sits
        const ancestor = place.lineage[other.level - level.level - 1];
        if (ancestor && !picked[other.property_name]) {
          picked[other.property_name] = {
            id: ancestor.id,
            name: ancestor.name,
            type: other.contact_type,
            lineage: place.lineage.slice(other.level - level.level)
          };
        }
      }
    }
  }

  const levelAbove = (level: HierarchyConstraint) => levels.find((other) => other.level === level.level + 1);

  // ---- the duplicate check, before anything is added (APP.md → Creating one user, step 5)
  const uniqueProperties = $derived(contactType.place_properties.filter((p) => p.unique));
  let lastDuplicateKey = '';
  $effect(() => {
    const values = Object.fromEntries(
      uniqueProperties.map((p) => [p.property_name, built.place[p.property_name] ?? '']).filter(([, v]) => v)
    );
    const ready = parentId && uniqueProperties.every((p) => !errors[`place.${p.property_name}`]) && Object.keys(values).length;
    const key = ready ? JSON.stringify([parentId, values]) : '';
    if (key === lastDuplicateKey) return;
    lastDuplicateKey = key;
    if (!key) {
      duplicates = [];
      return;
    }
    checkingDuplicates = true;
    const timer = setTimeout(async () => {
      try {
        const { warnings } = await api<{ warnings: StagedWarning[] }>(fetch, '/checks/duplicates', {
          method: 'POST',
          body: { contactType: contactType.name, parentId, placeId, place: values }
        });
        if (key !== lastDuplicateKey) return;
        const found = warnings.map(({ message, placeIds }) => ({ message, placeIds }));
        if (JSON.stringify(found) !== JSON.stringify(duplicates)) duplicatesAccepted = false;
        duplicates = found;
      } catch {
        // the server checks again when the item is added; don't block the form on this
      } finally {
        if (key === lastDuplicateKey) checkingDuplicates = false;
      }
    }, 400);
    return () => clearTimeout(timer);
  });

  // ---- is this a person already in the staged list? (APP.md → One person, many places)
  // Only when adding: an item's person id can't change once staged
  let samePerson = $state<StagedPersonMatch | null>(null);
  // the person fields the user said belong to someone else
  let someoneElseKey = $state('');
  let checkingPerson = $state(false);
  let lastPersonKey = '';
  const personKey = $derived(JSON.stringify([nonEmpty(contactValues), multipleRoles ? [...roles].sort() : []]));
  const personReady = $derived(
    canShare &&
      !editing &&
      !shared &&
      Object.keys(nonEmpty(contactValues)).length > 0 &&
      !Object.keys(errors).some((path) => path.startsWith('contact.') || path === 'user.roles')
  );
  const answeredSomeoneElse = $derived(!!samePerson && someoneElseKey === personKey);
  $effect(() => {
    const key = personReady ? personKey : '';
    if (key === lastPersonKey) return;
    lastPersonKey = key;
    if (!key) {
      samePerson = null;
      checkingPerson = false;
      return;
    }
    checkingPerson = true;
    const timer = setTimeout(async () => {
      try {
        const { match } = await api<{ match: StagedPersonMatch | null }>(fetch, '/checks/same-person', {
          method: 'POST',
          body: {
            contactType: contactType.name,
            contact: { id: contactId, properties: nonEmpty(contactValues) },
            ...(multipleRoles ? { user: { roles } } : {})
          }
        });
        if (key === lastPersonKey) samePerson = match;
      } catch {
        // the server checks again when the item is added
      } finally {
        if (key === lastPersonKey) checkingPerson = false;
      }
    }, 400);
    return () => clearTimeout(timer);
  });

  // share the matched person: the place typed so far stays
  function useStagedPerson(match: StagedPersonMatch) {
    shared = {
      contactId: match.contactId,
      name: match.name,
      properties: match.properties,
      roles: match.roles,
      placeTitle: match.placeTitle
    };
    contactId = match.contactId;
    samePerson = null;
    banner = null;
  }

  const canAdd = $derived(
    !remaining &&
      (!duplicates.length || duplicatesAccepted) &&
      (!samePerson || answeredSomeoneElse) &&
      !checkingDuplicates &&
      !checkingPerson &&
      !submitting
  );

  // ---- adding or saving

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    submitAttempted = true;
    banner = null;
    if (hasErrors) {
      await focusFirstError();
      return;
    }
    if (duplicates.length && !duplicatesAccepted) {
      document.getElementById('accept-duplicates')?.focus();
      return;
    }
    if (samePerson && !answeredSomeoneElse) {
      document.getElementById('same-person')?.focus();
      return;
    }

    const request = {
      contactType: contactType.name,
      placeId,
      parentId,
      place: nonEmpty(placeValues),
      contact: shared ? { id: contactId } : { id: contactId, properties: nonEmpty(contactValues) },
      ...(multipleRoles ? { user: { roles: sentRoles } } : {}),
      ignoreWarnings: duplicates.length > 0 && duplicatesAccepted
    };

    submitting = true;
    try {
      if (item) {
        await api(fetch, `/staged-items/${item.id}`, { method: 'PATCH', body: { revision: item.revision, request }, configVersion });
        await goto('/', { invalidateAll: true });
        return;
      }
      await api(fetch, '/staged-items', {
        method: 'POST',
        body: { kind: 'create', request, ...(answeredSomeoneElse ? { newPerson: true } : {}) },
        configVersion
      });
      const title = built.place.name ?? 'The place';
      const added: SharedPerson = shared ?? {
        contactId,
        name: built.contact.name,
        properties: nonEmpty(contactValues) as SharedPerson['properties'],
        roles: multipleRoles ? [...roles] : undefined,
        placeTitle: title
      };
      reset({ keepPerson: !!shared });
      lastPerson = canShare && !shared ? added : null;
      banner = {
        kind: 'success',
        text: shared ? `Added "${title}" for ${added.name ?? 'this person'}.` : `Added "${title}" to the staged list.`
      };
      await tick();
      document.querySelector<HTMLElement>('.place-fields input, .place-fields select')?.focus();
    } catch (e) {
      await handleError(e);
    } finally {
      submitting = false;
    }
  }

  // Another place for the person just added: the place section starts over, the person stays
  async function keepPerson(kept: SharedPerson) {
    shared = kept;
    contactId = kept.contactId;
    lastPerson = null;
    reset({ keepPerson: true });
    banner = { kind: 'info', text: `Adding another place for ${kept.name ?? 'the same person'}. They keep one login.` };
    await tick();
    document.querySelector<HTMLElement>('.place-fields input, .place-fields select')?.focus();
  }

  // back to entering a person: the place typed so far stays
  function newPerson() {
    shared = null;
    contactId = crypto.randomUUID();
    contactValues = {};
    roles = [];
    banner = null;
  }

  // keeps the hierarchy: the next place is usually in the same area
  function reset({ keepPerson }: { keepPerson: boolean }) {
    placeId = crypto.randomUUID();
    if (!keepPerson) {
      contactId = crypto.randomUUID();
      contactValues = {};
      roles = [];
    }
    placeValues = {};
    touched = {};
    submitAttempted = false;
    serverErrors = {};
    duplicates = [];
    duplicatesAccepted = false;
    lastDuplicateKey = '';
    samePerson = null;
    someoneElseKey = '';
  }

  async function handleError(e: unknown) {
    if (isSignedOut(e)) {
      await goto(signInUrl(page.url));
      return;
    }
    if (!(e instanceof ApiRequestError)) {
      banner = { kind: 'error', text: 'Something went wrong. Try again.' };
      return;
    }
    switch (e.code) {
      case 'WARNINGS':
        duplicates = ((e.details?.warnings as (StagedWarning | string)[]) ?? []).map(asWarning);
        duplicatesAccepted = false;
        banner = { kind: 'info', text: 'Possible duplicates were found since the form checked. Review them below.' };
        break;
      case 'VALIDATION_FAILED':
        serverErrors = (e.details ?? {}) as Record<string, string>;
        if (shared && serverErrors['contact.properties']) {
          // the item creating the person was removed meanwhile
          delete serverErrors['contact.properties'];
          banner = {
            kind: 'error',
            text: `${shared.name ?? 'This person'} is no longer in the staged list or in CHT. Use a new person instead.`
          };
          break;
        }
        // the form and the server disagree about the rules, which is a bug (APP.md → Creating one user, step 6)
        console.error('server validation disagreed with the form', e.details);
        banner = { kind: 'error', text: "The server found problems the form didn't catch. They're shown below; please also report this." };
        await focusFirstError();
        break;
      case 'SAME_PERSON_STAGED':
        // staged since the form checked
        samePerson = e.details as StagedPersonMatch;
        someoneElseKey = '';
        banner = { kind: 'info', text: e.message };
        break;
      case 'CONFIG_CHANGED':
        banner = { kind: 'error', text: e.message, reload: true };
        break;
      case 'REVISION_MISMATCH':
        banner = { kind: 'error', text: 'This item was changed in another tab. Reload it to see the latest version.', reload: true };
        break;
      default:
        banner = { kind: 'error', text: e.message };
    }
  }

  async function focusFirstError() {
    await tick();
    const first = [
      ...levels.map((l) => `hierarchy.${l.property_name}`),
      ...contactType.place_properties.map((p) => `place.${p.property_name}`),
      ...contactType.contact_properties.map((p) => `contact.${p.property_name}`),
      'user.roles'
    ].find((path) => shown(path));
    if (first) document.getElementById(fieldId(first))?.focus();
  }

  const fieldId = (path: string) => `f-${path.replace('.', '-')}`;
  const inputs = (properties: ContactProperty[]) => properties.filter((p) => p.type !== 'generated');
  const generated = (properties: ContactProperty[]) => properties.filter((p) => p.type === 'generated');
</script>

<form class="create-form" onsubmit={submit} novalidate>
  {#if banner}
    <div class="banner banner-{banner.kind}" role={banner.kind === 'error' ? 'alert' : 'status'}>
      <span>{banner.text}</span>
      {#if banner.kind === 'success' && lastPerson}
        {@const kept = lastPerson}
        <button class="btn btn-default btn-small" type="button" onclick={() => keepPerson(kept)}>
          Keep {kept.name ?? 'this person'}, add another place
        </button>
      {/if}
      {#if banner.kind === 'success'}<a href="/">Go to the staged list</a>{/if}
      {#if banner.reload}<button class="btn btn-default btn-small" type="button" onclick={() => location.reload()}>Reload</button>{/if}
    </div>
  {/if}

  <section class="card">
    <h2>Where</h2>
    {#each levels as level (level.property_name)}
      {@const above = levelAbove(level)}
      <PlacePicker
        id={fieldId(`hierarchy.${level.property_name}`)}
        label={level.friendly_name}
        type={level.contact_type}
        parentId={above ? picked[above.property_name]?.id : undefined}
        parentLabel={above?.friendly_name}
        selected={picked[level.property_name]}
        initialQuery={start.item?.raw?.[level.friendly_name] ?? ''}
        required={level.required}
        error={shown(`hierarchy.${level.property_name}`)}
        disabled={submitting}
        onselect={(place) => pick(level, place)}
      />
    {/each}
  </section>

  <section class="card place-fields">
    <h2>{contactType.friendly}</h2>
    {#each inputs(contactType.place_properties) as property (property.property_name)}
      <PropertyField
        id={fieldId(`place.${property.property_name}`)}
        {property}
        value={placeValues[property.property_name] ?? ''}
        error={shown(`place.${property.property_name}`)}
        disabled={submitting}
        onchange={(value) => setValue('place', property.property_name, value)}
        onblur={() => (touched[`place.${property.property_name}`] = true)}
      />
    {/each}
    {#each generated(contactType.place_properties) as property (property.property_name)}
      <div class="generated">
        <span class="label">{property.friendly_name}</span>
        <span class="value">{built.place[property.property_name] ?? '—'}</span>
        <span class="note">Filled in automatically</span>
      </div>
    {/each}

    {#if duplicates.length}
      <div class="duplicates" role="alert">
        <p><strong>Possible duplicate</strong></p>
        <ul>
          {#each duplicates as warning, index (index)}<li><WarningText {warning} /></li>{/each}
        </ul>
        <label class="accept">
          <input id="accept-duplicates" type="checkbox" bind:checked={duplicatesAccepted} disabled={submitting} />
          This is intended; add it anyway
        </label>
      </div>
    {/if}
  </section>

  {#if shared}
    {@const details = inputs(contactType.contact_properties).filter((p) => shared?.properties?.[p.property_name])}
    <section class="card shared">
      <div class="shared-heading">
        <h2>{contactType.contact_friendly ?? 'Person'}: {shared.name ?? 'the same person'}</h2>
        {#if !editing}
          <button class="btn btn-link btn-small" type="button" onclick={newPerson} disabled={submitting}>Use a new person instead</button>
        {/if}
      </div>
      {#if details.length}
        <dl>
          {#each details as property (property.property_name)}
            {@const value = shared.properties?.[property.property_name]}
            <dt>{property.friendly_name}</dt>
            <dd>{Array.isArray(value) ? value.join(', ') : value}</dd>
          {/each}
          {#if multipleRoles && shared.roles?.length}
            <dt>Roles</dt>
            <dd>{shared.roles.map((r) => r.replace(/_/g, ' ')).join(', ')}</dd>
          {/if}
        </dl>
      {/if}
      <p class="note">This place is added to their existing login; no new person or login is created.</p>
      {#if shown('user.roles')}<p class="field-error">{shown('user.roles')}</p>{/if}
    </section>
  {:else}
    <section class="card">
      <h2>{contactType.contact_friendly ?? 'Person'}</h2>
      {#each inputs(contactType.contact_properties) as property (property.property_name)}
        <PropertyField
          id={fieldId(`contact.${property.property_name}`)}
          {property}
          value={contactValues[property.property_name] ?? ''}
          error={shown(`contact.${property.property_name}`)}
          disabled={submitting}
          onchange={(value) => setValue('contact', property.property_name, value)}
          onblur={() => (touched[`contact.${property.property_name}`] = true)}
        />
      {/each}
      {#each generated(contactType.contact_properties) as property (property.property_name)}
        <div class="generated">
          <span class="label">{property.friendly_name}</span>
          <span class="value">{built.contact[property.property_name] ?? '—'}</span>
          <span class="note">Filled in automatically</span>
        </div>
      {/each}

      {#if multipleRoles}
        <fieldset class="roles" id={fieldId('user.roles')} tabindex="-1">
          <legend>Roles<span class="req" aria-hidden="true">*</span></legend>
          {#each contactType.user_role as role (role)}
            <label class="check">
              <input
                type="checkbox"
                checked={roles.includes(role)}
                disabled={submitting}
                onchange={(e) => {
                  roles = (e.currentTarget as HTMLInputElement).checked ? [...roles, role] : roles.filter((r) => r !== role);
                  touched['user.roles'] = true;
                  delete serverErrors['user.roles'];
                }}
              />
              {role.replace(/_/g, ' ')}
            </label>
          {/each}
          {#if shown('user.roles')}<p class="field-error">{shown('user.roles')}</p>{/if}
        </fieldset>
      {/if}
      {#if samePerson}
        {@const match = samePerson}
        <div class="duplicates same-person" id="same-person" tabindex="-1" role="alert">
          <p>
            <strong>{match.name ?? 'This person'} is already in your staged list</strong>, for "{match.placeTitle}". Is this the same
            person?
          </p>
          <div class="choices">
            <button class="btn btn-primary btn-small" type="button" onclick={() => useStagedPerson(match)} disabled={submitting}>
              Same person: add this place to their login
            </button>
            <label class="accept">
              <input
                type="checkbox"
                checked={answeredSomeoneElse}
                disabled={submitting}
                onchange={(e) => (someoneElseKey = (e.currentTarget as HTMLInputElement).checked ? personKey : '')}
              />
              Someone else with the same details
            </label>
          </div>
        </div>
      {/if}
      <p class="note">A login is created for this person when the item is uploaded. The username comes from their name.</p>
    </section>
  {/if}

  <div class="actions">
    <a class="btn btn-default" href="/">Cancel</a>
    <button class="btn btn-primary" type="submit" disabled={!canAdd}>
      {#if submitting}{editing ? 'Saving…' : 'Adding…'}{:else if checkingDuplicates || checkingPerson}Checking…{:else}{editing
          ? 'Save changes'
          : 'Add to staged list'}{/if}
    </button>
  </div>
  <p class="summary-note" aria-live="polite">
    {#if remaining}
      {remaining} {remaining === 1 ? 'field needs' : 'fields need'} attention before this can be {editing ? 'saved' : 'added'}.
    {:else if duplicates.length && !duplicatesAccepted}
      Confirm the possible duplicate above to continue.
    {:else if samePerson && !answeredSomeoneElse}
      Say whether this is the person already in your staged list to continue.
    {/if}
  </p>
</form>

<style>
  .create-form {
    max-width: 640px;
  }

  .card {
    margin-bottom: 16px;
    padding: 18px 20px 6px;
    background: var(--cht-surface);
    border: 1px solid var(--cht-border);
    border-radius: var(--cht-radius);
  }

  h2 {
    margin: 0 0 14px;
    font-size: 16px;
  }

  .shared-heading {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 4px 12px;
  }

  .shared dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 4px 16px;
    margin: 0 0 10px;
  }

  .shared dt {
    color: var(--cht-text-muted);
  }

  .shared dd {
    margin: 0;
    overflow-wrap: anywhere;
  }

  .generated {
    display: grid;
    grid-template-columns: 1fr;
    margin-bottom: 14px;
  }

  .generated .label {
    font-weight: 500;
  }

  .generated .value {
    padding: 7px 10px;
    border: 1px dashed var(--cht-border);
    border-radius: var(--cht-radius);
    background: var(--cht-surface-muted);
  }

  .note {
    color: var(--cht-text-muted);
    font-size: 13px;
  }

  .duplicates {
    margin: 4px 0 14px;
    padding: 10px 14px;
    color: #8a6d3b;
    background: #fcf8e3;
    border: 1px solid #faebcc;
    border-radius: var(--cht-radius);
  }

  .duplicates p {
    margin: 0;
  }

  .duplicates ul {
    margin: 6px 0;
    padding-left: 18px;
  }

  .same-person .choices {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 16px;
    margin-top: 8px;
  }

  .accept,
  .check {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .roles {
    margin: 0 0 10px;
    padding: 0;
    border: 0;
  }

  .roles legend {
    margin-bottom: 4px;
    font-weight: 500;
  }

  .req {
    margin-left: 2px;
    color: var(--cht-red);
  }

  .field-error {
    color: var(--cht-red);
    font-size: 13px;
  }

  .summary-note {
    min-height: 1.4em;
    text-align: right;
    color: var(--cht-text-muted);
    font-size: 13px;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .actions .btn-primary {
    padding: 8px 18px;
  }

  .banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin-bottom: 16px;
    padding: 10px 14px;
    border: 1px solid;
    border-radius: var(--cht-radius);
  }

  .banner-success {
    color: #3c763d;
    background: #dff0d8;
    border-color: #d6e9c6;
  }

  .banner-info {
    color: #31708f;
    background: #d9edf7;
    border-color: #bce8f1;
  }

  .banner-error {
    color: #a94442;
    background: #f2dede;
    border-color: #ebccd1;
  }
</style>
