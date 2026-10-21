import { ApiError } from './deepseek.js';
import { VaultError } from './vault.js';

const CONTEXT_LENGTH = /context length/i;

export class CatalogError extends Error {}

export class EmptyNote extends Error {}

export function vaultProblem(error, labels) {
  return labels.errors[error instanceof VaultError ? error.reason : 'failed'] ?? labels.errors.failed;
}

export function requestProblem(error, labels) {
  if (error instanceof CatalogError) return labels.errors.catalog;
  if (error instanceof TypeError) return labels.errors.network;
  if (!(error instanceof ApiError)) return labels.errors.other(error.message);
  if (error.status === 401) return labels.errors.invalidKey;
  if (error.status === 402) return labels.errors.balance;
  if (error.status === 429) return labels.errors.rate;
  if (error.status === 400 && CONTEXT_LENGTH.test(error.message)) return labels.errors.tooLong;
  if (error.status >= 500) return labels.errors.server;
  return labels.errors.other(error.message);
}
