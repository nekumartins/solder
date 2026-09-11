import { useCallback, useRef, useState } from 'react';

/**
 * Bridges the promise-based auth flow to a rendered sheet: auth asks for a
 * code, the sheet collects it, the promise resolves.
 */
export function usePinPrompt() {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<'create' | 'unlock'>('unlock');
  const pending = useRef<{ resolve: (pin: string) => void; reject: (error: Error) => void } | null>(null);

  const request = useCallback((next: 'create' | 'unlock') => {
    setReason(next);
    setOpen(true);
    return new Promise<string>((resolve, reject) => { pending.current = { resolve, reject }; });
  }, []);

  const submit = useCallback((pin: string) => {
    setOpen(false);
    pending.current?.resolve(pin);
    pending.current = null;
  }, []);

  const cancel = useCallback(() => {
    setOpen(false);
    pending.current?.reject(new Error('cancelled'));
    pending.current = null;
  }, []);

  return { open, reason, request, submit, cancel };
}
