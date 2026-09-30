<script lang="ts">
	import type { ContactProperty } from '$lib/config-types';
	import { formatValue, validateValue } from '$lib/validation/validators';

	type Props = {
		id: string;
		property: ContactProperty;
		value: string | string[];
		error?: string;
		disabled?: boolean;
		onchange: (value: string | string[]) => void;
		onblur: () => void;
	};

	let { id, property, value, error, disabled = false, onchange, onblur }: Props = $props();

	const options = $derived(
		property.parameter && typeof property.parameter === 'object' && !Array.isArray(property.parameter) ? Object.entries(property.parameter) : []
	);
	const text = $derived(Array.isArray(value) ? value.join(' ') : value);
	// what will be stored, when it differs from what was typed: eg. a phone number in full
	const formatted = $derived(
		text && !error && (property.type === 'phone' || property.type === 'dob') && validateValue(property, text, false) === undefined
			? formatValue(property, text)
			: ''
	);
	const selectedMany = $derived(Array.isArray(value) ? value : text.split(' ').filter(Boolean));
	const describedBy = $derived([error ? `${id}-error` : '', property.errorDescription ? `${id}-hint` : ''].filter(Boolean).join(' ') || undefined);
</script>

<div class="field">
	{#if property.type === 'select_multiple'}
		<fieldset {disabled} aria-describedby={describedBy}>
			<legend>{property.friendly_name}{#if property.required}<span class="req" aria-hidden="true">*</span>{/if}</legend>
			{#each options as [key, label] (key)}
				<label class="check">
					<input
						type="checkbox"
						checked={selectedMany.includes(key)}
						onchange={(e) => {
							const on = (e.currentTarget as HTMLInputElement).checked;
							onchange(on ? [...selectedMany, key] : selectedMany.filter((k) => k !== key));
							onblur();
						}}
					/>
					{label}
				</label>
			{/each}
		</fieldset>
	{:else}
		<label for={id}>{property.friendly_name}{#if property.required}<span class="req" aria-hidden="true">*</span>{/if}</label>
		{#if property.type === 'select_one'}
			<select
				{id}
				value={text}
				{disabled}
				aria-invalid={error ? 'true' : undefined}
				aria-describedby={describedBy}
				onchange={(e) => {
					onchange((e.currentTarget as HTMLSelectElement).value);
					onblur();
				}}
			>
				<option value="">{property.required ? 'Choose…' : '—'}</option>
				{#each options as [key, label] (key)}
					<option value={key}>{label}</option>
				{/each}
			</select>
		{:else}
			<input
				{id}
				type={property.type === 'phone' ? 'tel' : 'text'}
				inputmode={property.type === 'phone' ? 'tel' : undefined}
				placeholder={property.type === 'dob' ? 'eg. 1990-02-26, 26/2/1985, or an age' : undefined}
				value={text}
				{disabled}
				aria-invalid={error ? 'true' : undefined}
				aria-describedby={describedBy}
				oninput={(e) => onchange((e.currentTarget as HTMLInputElement).value)}
				{onblur}
			/>
		{/if}
	{/if}

	{#if error}
		<p class="field-error" id={`${id}-error`}>{error}</p>
	{:else if formatted && formatted !== text}
		<p class="hint">Saved as {formatted}</p>
	{:else if property.type === 'regex' && property.errorDescription}
		<p class="hint" id={`${id}-hint`}>{property.errorDescription}</p>
	{/if}
</div>

<style>
	.field {
		margin-bottom: 14px;
	}

	label,
	legend {
		display: block;
		margin-bottom: 4px;
		font-weight: 500;
	}

	fieldset {
		margin: 0;
		padding: 0;
		border: 0;
	}

	.check {
		display: flex;
		align-items: center;
		gap: 8px;
		font-weight: 400;
	}

	.req {
		margin-left: 2px;
		color: var(--cht-red);
	}

	input,
	select {
		width: 100%;
		padding: 7px 10px;
		border: 1px solid var(--cht-input-border);
		border-radius: var(--cht-radius);
		background: var(--cht-surface);
	}

	.check input {
		width: auto;
	}

	[aria-invalid='true'] {
		border-color: var(--cht-red);
	}

	.field-error {
		margin: 4px 0 0;
		color: var(--cht-red);
		font-size: 13px;
	}

	.hint {
		margin: 4px 0 0;
		color: var(--cht-text-muted);
		font-size: 13px;
	}
</style>
