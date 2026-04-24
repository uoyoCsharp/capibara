import { describe, it, expect } from 'vitest';
import { enUS } from '@shared/locale/en-US';
import { zhCN } from '@shared/locale/zh-CN';

type AnyRecord = Record<string, unknown>;

function collectPaths(obj: AnyRecord, prefix = ''): Set<string> {
  const paths = new Set<string>();
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const inner of collectPaths(value as AnyRecord, path)) paths.add(inner);
    } else {
      paths.add(path);
    }
  }
  return paths;
}

function diff(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((p) => !b.has(p)).sort();
}

describe('Locale symmetry (en-US vs zh-CN)', () => {
  const enPaths = collectPaths(enUS as unknown as AnyRecord);
  const zhPaths = collectPaths(zhCN as unknown as AnyRecord);

  it('every en-US key path exists in zh-CN', () => {
    const missingInZh = diff(enPaths, zhPaths);
    expect(missingInZh, `missing in zh-CN: ${missingInZh.join(', ')}`).toEqual([]);
  });

  it('every zh-CN key path exists in en-US', () => {
    const missingInEn = diff(zhPaths, enPaths);
    expect(missingInEn, `missing in en-US: ${missingInEn.join(', ')}`).toEqual([]);
  });

  it('both locales have identical leaf counts', () => {
    expect(enPaths.size).toBe(zhPaths.size);
  });

  it('every leaf value is a non-empty string in both locales', () => {
    const emptyEn: string[] = [];
    const emptyZh: string[] = [];
    function walk(obj: AnyRecord, prefix: string, out: string[]) {
      for (const [key, value] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          walk(value as AnyRecord, path, out);
        } else if (typeof value !== 'string' || value.length === 0) {
          out.push(path);
        }
      }
    }
    walk(enUS as unknown as AnyRecord, '', emptyEn);
    walk(zhCN as unknown as AnyRecord, '', emptyZh);
    expect(emptyEn, `en-US empty/non-string: ${emptyEn.join(', ')}`).toEqual([]);
    expect(emptyZh, `zh-CN empty/non-string: ${emptyZh.join(', ')}`).toEqual([]);
  });
});
