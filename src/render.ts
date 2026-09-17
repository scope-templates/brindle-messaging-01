/**
 * Filling `{{placeholders}}` in. Values going into an email are escaped, because bodies are HTML;
 * values going into an SMS are written as they arrive. A placeholder with no value stops the send.
 */
import { refuse } from './errors.js';
import type { Channel, TemplateVersion } from './types.js';

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export interface Rendered {
  subject: string | null;
  body: string;
}

/** The placeholder names in a piece of template text, in the order they first appear. */
export function placeholdersIn(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(PLACEHOLDER)) {
    const name = match[1];
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

export function escapeForEmail(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function fill(text: string, variables: Record<string, string>, channel: Channel): string {
  return text.replace(PLACEHOLDER, (_whole, name: string) => {
    const value = variables[name];
    if (value === undefined) {
      throw refuse(
        'variable_missing',
        `This template needs a value for "${name}" and the request did not carry one.`,
      );
    }
    return channel === 'email' ? escapeForEmail(value) : value;
  });
}

export function renderVersion(
  version: TemplateVersion,
  channel: Channel,
  variables: Record<string, string>,
): Rendered {
  return {
    subject: version.subject === null ? null : fill(version.subject, variables, channel),
    body: fill(version.body, variables, channel),
  };
}

