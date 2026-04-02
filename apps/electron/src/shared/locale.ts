// Re-export from locale module for backward compatibility.
// New code should import from '@shared/locale/index.js' directly.
import { getMessages } from './locale/index.js';

export const LOCALE = getMessages('en-US');
