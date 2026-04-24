import { describe, it, expect, beforeEach } from 'vitest';

describe('useToastStore', () => {
  let useToastStore: typeof import('@renderer/store/toast.store').useToastStore;
  let toast: typeof import('@renderer/store/toast.store').toast;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    const mod = await import('@renderer/store/toast.store');
    useToastStore = mod.useToastStore;
    toast = mod.toast;
  });

  it('add appends a toast with the right shape', () => {
    toast.success('hi');
    const list = useToastStore.getState().toasts;
    expect(list).toHaveLength(1);
    expect(list[0].type).toBe('success');
    expect(list[0].message).toBe('hi');
  });

  it('dismiss removes a toast by id', () => {
    toast.info('x');
    const id = useToastStore.getState().toasts[0].id;
    useToastStore.getState().dismiss(id);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('error toast uses 6000ms default duration', () => {
    toast.error('bad');
    expect(useToastStore.getState().toasts[0].duration).toBe(6000);
  });

  it('toast auto-dismisses after the duration elapses', () => {
    toast.success('auto', { duration: 1000 });
    expect(useToastStore.getState().toasts).toHaveLength(1);

    vi.advanceTimersByTime(1000);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('duration 0 means no auto-dismiss', () => {
    toast.info('persist', { duration: 0 });
    vi.advanceTimersByTime(60_000);
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });
});
